"""System configuration, SSL management, and audit log inspection routes."""

import json
import logging
from typing import Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status, File, UploadFile
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
        "hub_name": "ffmpeg-gui CloudHub",
        "login_logo_text": "CH",
        "login_logo_url": "",
        "hub_domain": "localhost",
        "force_https": False,
        "letsencrypt_email": "",
        "letsencrypt_staging": False,
        "session_timeout_days": 7,
        "audit_retention_days": 90,
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


class IssueAcmeRequest(BaseModel):
    domain: Optional[str] = None
    email: Optional[str] = None
    staging: Optional[bool] = None


@router.post("/settings/ssl/issue-acme")
def issue_acme_certificate(
    req: IssueAcmeRequest,
    current_user: User = Depends(require_roles(["superadmin"])),
    db: Session = Depends(get_db),
):
    """Issues or renews a Let's Encrypt certificate via ACME HTTP-01 challenge."""
    # Resolve domain and email from request or fallback to stored settings
    domain = req.domain
    email = req.email
    staging = req.staging

    if not domain or not email:
        records = db.query(SystemSettings).all()
        settings_map = {}
        for r in records:
            try:
                settings_map[r.key] = json.loads(r.value)
            except Exception:
                settings_map[r.key] = r.value

        if not domain:
            domain = settings_map.get("hub_domain")
        if not email:
            email = settings_map.get("letsencrypt_email")
        if staging is None:
            staging = bool(settings_map.get("letsencrypt_staging", False))

    if not domain or not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Domain FQDN and contact email are required to request a Let's Encrypt certificate.",
        )

    ok, msg = cert_manager.renew_acme_certificate(
        domain=domain.strip(),
        email=email.strip(),
        staging=bool(staging),
    )

    if not ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg)

    db.add(
        AuditLog(
            username=current_user.username,
            action="ISSUE_ACME_CERTIFICATE",
            target_type="ssl",
            details=f"Issued Let's Encrypt SSL certificate for '{domain}' (staging={staging})",
        )
    )
    db.commit()

    return {
        "status": "ok",
        "message": msg,
        "cert_status": cert_manager.get_cert_status(),
    }


@router.post("/settings/ssl/upload-custom")
async def upload_custom_ssl(
    cert_file: UploadFile = File(...),
    key_file: UploadFile = File(...),
    current_user: User = Depends(require_roles(["superadmin"])),
    db: Session = Depends(get_db),
):
    """Uploads custom fullchain certificate and private key."""
    cert_bytes = await cert_file.read()
    key_bytes = await key_file.read()

    saved, err = cert_manager.save_custom_cert(cert_bytes, key_bytes, mode="custom")
    if not saved:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=err)

    db.add(
        AuditLog(
            username=current_user.username,
            action="UPLOAD_CUSTOM_SSL",
            target_type="ssl",
            details="Uploaded custom SSL certificate and private key",
        )
    )
    db.commit()

    return {
        "status": "ok",
        "message": "Custom SSL certificate saved successfully",
        "cert_status": cert_manager.get_cert_status(),
    }


@router.post("/settings/ssl/delete")
def delete_ssl(
    current_user: User = Depends(require_roles(["superadmin"])),
    db: Session = Depends(get_db),
):
    """Deletes active SSL certificates, reverting to plain HTTP."""
    ok, err = cert_manager.delete_cert()
    if not ok:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=err)

    db.add(
        AuditLog(
            username=current_user.username,
            action="DELETE_SSL",
            target_type="ssl",
            details="Deleted active SSL certificate files",
        )
    )
    db.commit()

    return {"status": "ok", "message": "SSL certificate removed successfully"}


@router.get("/audit-logs")
def list_audit_logs(
    limit: int = 100,
    node_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Query audit logs filtered by organization permissions and optional edge node."""
    query = db.query(AuditLog)
    if current_user.role != "superadmin":
        query = query.filter(AuditLog.org_id == current_user.org_id)
    if node_id:
        query = query.filter(AuditLog.node_id == node_id)

    logs = query.order_by(AuditLog.timestamp.desc()).limit(min(limit, 500)).all()
    return [
        {
            "id": l.id,
            "timestamp": l.timestamp.isoformat() if l.timestamp else None,
            "org_id": l.org_id,
            "node_id": l.node_id,
            "channel": getattr(l, "channel", "cloudhub"),
            "username": l.username,
            "action": l.action,
            "target_type": l.target_type,
            "target_id": l.target_id,
            "ip_address": l.ip_address,
            "details": l.details,
        }
        for l in logs
    ]

