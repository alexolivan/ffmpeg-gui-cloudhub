"""System configuration, SSL management, and audit log inspection routes."""

import json
import logging
from typing import Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database.db import get_db
from backend.database.models import User, SystemSettings, AuditLog
from backend.services.cert_manager import cert_manager
from backend.routers.auth_routes import get_current_user, require_roles

logger = logging.getLogger("cloudhub.api.settings")
router = APIRouter(prefix="/api/hub", tags=["settings"])


class UpdateSettingsRequest(BaseModel):
    settings: Dict[str, Any]


@router.get("/settings")
def get_settings(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Retrieve global CloudHub settings (superadmin only for full access)."""
    if current_user.role != "superadmin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    records = db.query(SystemSettings).all()
    out = {}
    for r in records:
        try:
            out[r.key] = json.loads(r.value)
        except Exception:
            out[r.key] = r.value

    # Defaults if not present in DB
    defaults = {
        "hub_domain": "localhost",
        "force_https": False,
        "letsencrypt_email": "",
        "letsencrypt_staging": False,
        "session_timeout_days": 7,
    }
    for k, v in defaults.items():
        if k not in out:
            out[k] = v

    return out


@router.put("/settings")
def update_settings(
    req: UpdateSettingsRequest,
    current_user: User = Depends(require_roles(["superadmin"])),
    db: Session = Depends(get_db),
):
    """Update global CloudHub settings."""
    for k, v in req.settings.items():
        record = db.query(SystemSettings).filter(SystemSettings.key == k).first()
        val_str = json.dumps(v) if not isinstance(v, str) else v
        if not record:
            record = SystemSettings(key=k, value=val_str)
            db.add(record)
        else:
            record.value = val_str

    db.add(
        AuditLog(
            username=current_user.username,
            action="UPDATE_SETTINGS",
            target_type="settings",
            details=f"Updated keys: {list(req.settings.keys())}",
        )
    )
    db.commit()
    return {"status": "ok", "message": "Settings updated"}


@router.get("/settings/ssl/status")
def get_ssl_status(
    current_user: User = Depends(require_roles(["superadmin"])),
):
    """Get active SSL certificate expiration and validity status."""
    return cert_manager.get_cert_status()


@router.get("/audit-logs")
def list_audit_logs(
    limit: int = 100,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Query audit logs filtered by organization permissions."""
    query = db.query(AuditLog)
    if current_user.role != "superadmin":
        query = query.filter(AuditLog.org_id == current_user.org_id)

    logs = query.order_by(AuditLog.timestamp.desc()).limit(min(limit, 500)).all()
    return [
        {
            "id": l.id,
            "timestamp": l.timestamp.isoformat() if l.timestamp else None,
            "org_id": l.org_id,
            "username": l.username,
            "action": l.action,
            "target_type": l.target_type,
            "target_id": l.target_id,
            "ip_address": l.ip_address,
            "details": l.details,
        }
        for l in logs
    ]
