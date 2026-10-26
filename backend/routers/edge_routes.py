"""Edge appliance provisioning, enrollment ceremony, and telemetry ingestion."""

import uuid
import secrets
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Header, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.database.db import get_db
from backend.database.models import EnrollmentToken, EnrolledNode, AuditLog
from backend.core.auth_manager import AuthManager
from backend.core.telemetry_collector import telemetry_collector

logger = logging.getLogger("cloudhub.api.edge")
router = APIRouter(prefix="/api/edge", tags=["edge"])


class EnrollRequest(BaseModel):
    token: str = Field(..., min_length=10)
    name: str = Field(..., min_length=1, max_length=150)
    icon_data: Optional[str] = None
    current_version: Optional[str] = None


class HeartbeatPayload(BaseModel):
    current_version: Optional[str] = None
    system: Dict[str, Any] = Field(default_factory=dict)
    workload: Dict[str, Any] = Field(default_factory=dict)


@router.post("/enroll")
def enroll_appliance(
    req: EnrollRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Public edge enrollment endpoint.
    Exchanges a single-use token for a permanent node identity and tunnel secret.
    """
    now = datetime.now(timezone.utc)
    token_record = (
        db.query(EnrollmentToken)
        .filter(EnrollmentToken.token == req.token.strip())
        .first()
    )

    if not token_record:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid enrollment token",
        )

    if token_record.used:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Enrollment token has already been used",
        )

    # Check expiry
    # Note: sqlite stores naive datetimes by default, ensure comparison handles tz
    exp = token_record.expires_at
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp < now:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Enrollment token has expired",
        )

    # Generate permanent node credentials
    node_id = f"ch_node_{uuid.uuid4().hex[:12]}"
    tunnel_secret = secrets.token_hex(32)

    node = EnrolledNode(
        node_id=node_id,
        name=req.name.strip(),
        org_id=token_record.org_id,
        group_id=token_record.group_id,
        tunnel_secret=tunnel_secret,
        icon_data=req.icon_data,
        current_version=req.current_version,
        last_seen_at=now,
    )
    db.add(node)

    # Invalidate token
    token_record.used = True
    token_record.used_at = now

    client_ip = request.client.host if request.client else "0.0.0.0"
    db.add(
        AuditLog(
            username=f"edge:{node_id}",
            org_id=token_record.org_id,
            action="ENROLL_NODE",
            target_type="node",
            target_id=node_id,
            ip_address=client_ip,
            details=f"Enrolled node '{node.name}' (version: {req.current_version})",
        )
    )
    db.commit()

    logger.info("Successfully enrolled edge node '%s' (ID: %s)", node.name, node_id)
    return {
        "status": "ok",
        "node_id": node_id,
        "tunnel_secret": tunnel_secret,
        "org_id": node.org_id,
        "group_id": node.group_id,
        "name": node.name,
    }


@router.post("/heartbeat")
def edge_heartbeat(
    payload: HeartbeatPayload,
    x_node_id: Optional[str] = Header(None, alias="X-Node-ID"),
    x_timestamp: Optional[str] = Header(None, alias="X-Timestamp"),
    x_signature: Optional[str] = Header(None, alias="X-Signature"),
    db: Session = Depends(get_db),
):
    """
    Authenticated telemetry ingestion endpoint from edge appliances.
    Validates HMAC handshake headers and updates in-memory vitality and DB last_seen.
    """
    if not x_node_id or not x_timestamp or not x_signature:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing edge authentication headers (X-Node-ID, X-Timestamp, X-Signature)",
        )

    node = db.query(EnrolledNode).filter(EnrolledNode.node_id == x_node_id).first()
    if not node:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Node not found or enrollment revoked",
        )

    valid = AuthManager.verify_edge_handshake(
        node_id=x_node_id,
        timestamp=x_timestamp,
        signature=x_signature,
        tunnel_secret=node.tunnel_secret,
        window_seconds=60,
    )
    if not valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid edge handshake signature or timestamp skew > 60s",
        )

    now = datetime.now(timezone.utc)
    node.last_seen_at = now
    if payload.current_version:
        node.current_version = payload.current_version
    db.commit()

    vitality = telemetry_collector.record_heartbeat(
        node_id=x_node_id,
        payload=payload.model_dump(),
    )

    return {
        "status": "ok",
        "vitality": vitality,
    }
