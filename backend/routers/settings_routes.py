"""System configuration, network binding, SSL management, and audit log inspection routes."""

import os
import json
import signal
import time
import threading
import logging
from typing import Optional, Dict, Any
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status, File, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database.db import get_db
from backend.database.models import User, SystemSettings, AuditLog
from backend.services.cert_manager import cert_manager
from backend.core.network_inspector import get_network_interfaces
from backend.routers.auth_routes import get_current_user, require_roles

logger = logging.getLogger("cloudhub.api.settings")
router = APIRouter(prefix="/api/hub", tags=["settings"])


def _trigger_warm_reload_delayed(delay_sec: float = 1.0):
    """Sends SIGHUP to the current server process after flushing the HTTP response."""
    def _worker():
        time.sleep(delay_sec)
        try:
            if hasattr(signal, "SIGHUP"):
                logger.info("Triggering SIGHUP warm reload to apply network/SSL listener changes...")
                os.kill(os.getpid(), signal.SIGHUP)
        except Exception as exc:
            logger.error("Failed to send SIGHUP warm reload signal: %s", exc)

    t = threading.Thread(target=_worker, daemon=True)
    t.start()


def _load_settings_dict(db: Session) -> Dict[str, Any]:
    records = db.query(SystemSettings).all()
    out: Dict[str, Any] = {}
    for r in records:
        try:
            out[r.key] = json.loads(r.value)
        except Exception:
            out[r.key] = r.value

    cert_st = cert_manager.get_cert_status()
    default_ssl_mode = out.get("ssl_mode") or (cert_st.get("mode") if cert_st.get("valid") else "acme")

    defaults = {
        "hub_name": "ffmpeg-gui CloudHub",
        "login_logo_text": "CH",
        "login_logo_url": "",
        "bind_address": os.environ.get("CLOUDHUB_HOST", "0.0.0.0"),
        "http_port": int(os.environ.get("CLOUDHUB_PORT", "9000")),
        "https_port": int(os.environ.get("CLOUDHUB_HTTPS_PORT", "9443")),
        "ssl_enabled": False,
        "force_https_redirect": bool(out.get("force_https", False)),
        "force_https": bool(out.get("force_https_redirect", out.get("force_https", False))),
        "ssl_mode": default_ssl_mode or "acme",
        "hub_domain": cert_st.get("domain") or out.get("hub_domain") or "localhost",
        "letsencrypt_email": "",
        "letsencrypt_staging": False,
        "session_timeout_days": 7,
        "audit_retention_days": 90,
    }
    for k, v in defaults.items():
        if k not in out:
            out[k] = v

    # Ensure consistency: if no valid certificate exists, ssl_enabled and force_https_redirect cannot be active
    if not cert_st.get("valid"):
        out["ssl_enabled"] = False
        out["force_https_redirect"] = False
        out["force_https"] = False
    elif not out.get("ssl_enabled"):
        out["force_https_redirect"] = False
        out["force_https"] = False

    return out


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

    return _load_settings_dict(db)


@router.put("/settings")
def update_settings(
    req: UpdateSettingsRequest,
    current_user: User = Depends(require_roles(["superadmin"])),
    db: Session = Depends(get_db),
):
    """Update global CloudHub settings with SSL validation and automatic warm reload when listeners change."""
    current = _load_settings_dict(db)
    incoming = dict(req.settings)

    # Synchronize force_https_redirect <-> force_https aliases
    if "force_https_redirect" in incoming and "force_https" not in incoming:
        incoming["force_https"] = bool(incoming["force_https_redirect"])
    elif "force_https" in incoming and "force_https_redirect" not in incoming:
        incoming["force_https_redirect"] = bool(incoming["force_https"])

    # Validate SSL enablement against CertificateManager (exact parity with ffmpeg-gui)
    cert_status = cert_manager.get_cert_status()
    if incoming.get("ssl_enabled") is True and not cert_status.get("valid"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot enable HTTPS encryption without a valid active SSL certificate and keypair.",
        )

    effective_ssl_enabled = incoming.get("ssl_enabled", current.get("ssl_enabled", False))
    if not effective_ssl_enabled or not cert_status.get("valid"):
        incoming["ssl_enabled"] = False
        incoming["force_https_redirect"] = False
        incoming["force_https"] = False

    # Validate port numbers if provided
    for port_key in ("http_port", "https_port"):
        if port_key in incoming and incoming[port_key] is not None:
            try:
                p_val = int(incoming[port_key])
                if not (1 <= p_val <= 65535):
                    raise ValueError()
                incoming[port_key] = p_val
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid port number for {port_key}. Must be between 1 and 65535.",
                )

    listener_keys = ("bind_address", "http_port", "https_port", "ssl_enabled")
    listener_changed = any(
        k in incoming and incoming[k] != current.get(k) for k in listener_keys
    )

    for k, v in incoming.items():
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
            details=f"Updated keys: {list(incoming.keys())}",
        )
    )
    db.commit()

    if listener_changed:
        _trigger_warm_reload_delayed(1.0)

    return {
        "status": "ok",
        "message": "Settings updated",
        "reloading_listeners": listener_changed,
        "settings": _load_settings_dict(db),
    }


@router.get("/settings/network/interfaces")
def list_network_interfaces(
    current_user: User = Depends(require_roles(["superadmin"])),
):
    """Enumerate host network interfaces for bind_address selection (ported from ffmpeg-gui)."""
    return {"interfaces": get_network_interfaces()}


@router.post("/settings/restart")
def restart_cloudhub_panel(
    current_user: User = Depends(require_roles(["superadmin"])),
):
    """Triggers a warm reload of the HTTP/HTTPS listeners."""
    _trigger_warm_reload_delayed(1.0)
    return {"status": "ok", "message": "CloudHub listeners reloading"}


@router.get("/settings/ssl/status")
def get_ssl_status(
    current_user: User = Depends(require_roles(["superadmin"])),
    db: Session = Depends(get_db),
):
    """Get active SSL certificate expiration, validity status, and active ports."""
    st = dict(cert_manager.get_cert_status())
    cfg = _load_settings_dict(db)
    st["http_port"] = int(cfg.get("http_port", 9000))
    st["https_port"] = int(cfg.get("https_port", 9443))
    st["ssl_enabled"] = bool(cfg.get("ssl_enabled", False) and st.get("valid"))
    st["force_https_redirect"] = bool(cfg.get("force_https_redirect", False) and st["ssl_enabled"])
    st["listen_port"] = st["https_port"] if st["ssl_enabled"] else st["http_port"]
    st["listen_scheme"] = "https" if st["ssl_enabled"] else "http"
    return st


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
    settings_map = _load_settings_dict(db)
    domain = req.domain or settings_map.get("hub_domain")
    email = req.email or settings_map.get("letsencrypt_email")
    staging = req.staging if req.staging is not None else bool(settings_map.get("letsencrypt_staging", False))

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

    # Always persist ssl_mode='acme', hub_domain, and letsencrypt_email so user inputs are preserved
    for k, v in [
        ("ssl_mode", "acme"),
        ("hub_domain", domain.strip()),
        ("letsencrypt_email", email.strip()),
        ("letsencrypt_staging", bool(staging)),
    ]:
        rec = db.query(SystemSettings).filter(SystemSettings.key == k).first()
        val_str = json.dumps(v) if not isinstance(v, str) else v
        if not rec:
            db.add(SystemSettings(key=k, value=val_str))
        else:
            rec.value = val_str

    db.add(
        AuditLog(
            username=current_user.username,
            action="DRYRUN_ACME_CERTIFICATE" if staging else "ISSUE_ACME_CERTIFICATE",
            target_type="ssl",
            details=f"{'Dry-run validated' if staging else 'Issued & installed'} Let's Encrypt SSL certificate for '{domain}' (staging={staging})",
        )
    )
    db.commit()

    return {
        "status": "ok",
        "dry_run": bool(staging),
        "message": msg,
        "detail": msg,
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

    rec = db.query(SystemSettings).filter(SystemSettings.key == "ssl_mode").first()
    if not rec:
        db.add(SystemSettings(key="ssl_mode", value="custom"))
    else:
        rec.value = "custom"

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
    """Deletes active SSL certificates and disables HTTPS encryption / redirection."""
    ok, err = cert_manager.delete_cert()
    if not ok:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=err)

    for k, v in [("ssl_enabled", False), ("force_https_redirect", False), ("force_https", False), ("ssl_mode", "disabled")]:
        rec = db.query(SystemSettings).filter(SystemSettings.key == k).first()
        val_str = json.dumps(v) if not isinstance(v, str) else v
        if not rec:
            db.add(SystemSettings(key=k, value=val_str))
        else:
            rec.value = val_str

    db.add(
        AuditLog(
            username=current_user.username,
            action="DELETE_SSL",
            target_type="ssl",
            details="Deleted active SSL certificate files and disabled HTTPS listener",
        )
    )
    db.commit()

    _trigger_warm_reload_delayed(1.0)

    return {
        "status": "ok",
        "message": "SSL certificate removed and HTTPS disabled",
        "cert_status": cert_manager.get_cert_status(),
    }


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
