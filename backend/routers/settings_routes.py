"""System configuration, network binding, SSL management, and audit log inspection routes."""

import os
import re
import json
import uuid
import signal
import time
import threading
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status, File, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from backend.version import __version__
from backend.database.version import DB_SCHEMA_VERSION
from backend.database.db import get_db
from backend.database.models import User, SystemSettings, AuditLog, Organization, EnrolledNode
from backend.services.cert_manager import cert_manager
from backend.core.network_inspector import get_network_interfaces
from backend.core.update_checker import get_git_metadata, check_latest_release
from backend.services.audit_pdf_generator import AuditPdfReportGenerator, AuditSingleEventPdfGenerator
from backend.routers.auth_routes import get_current_user, require_roles

logger = logging.getLogger("cloudhub.api.settings")
router = APIRouter(prefix="/api/hub", tags=["settings"])

UPLOAD_DIR = os.environ.get("CLOUDHUB_UPLOAD_DIR", "data/uploads")


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
        "logging_mode": "both",
        "logging_timestamp_tz": "utc",
        "logging_path": "data/logs",
        "logging_rotation_enabled": True,
        "logging_rotation_max_bytes": 10485760,
        "logging_rotation_backup_count": 5,
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


@router.get("/public-branding")
def get_public_branding(db: Session = Depends(get_db)):
    """Public unauthenticated branding info for Login screen and Favicon."""
    cfg = _load_settings_dict(db)
    return {
        "hub_name": cfg.get("hub_name", "ffmpeg-gui CloudHub"),
        "login_logo_text": cfg.get("login_logo_text", "CH"),
        "login_logo_url": cfg.get("login_logo_url", ""),
    }


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

    logging_keys = (
        "logging_mode",
        "logging_path",
        "logging_timestamp_tz",
        "logging_rotation_enabled",
        "logging_rotation_max_bytes",
        "logging_rotation_backup_count",
    )
    if any(k in incoming for k in logging_keys):
        updated_settings = _load_settings_dict(db)
        from backend.services.maintenance_scheduler import setup_cloudhub_logging
        setup_cloudhub_logging(
            log_dir=str(updated_settings.get("logging_path", "data/logs")),
            max_bytes=int(updated_settings.get("logging_rotation_max_bytes", 10485760)),
            backup_count=int(updated_settings.get("logging_rotation_backup_count", 5)),
            mode=str(updated_settings.get("logging_mode", "both")),
            timestamp_tz=str(updated_settings.get("logging_timestamp_tz", "utc")),
            rotation_enabled=bool(updated_settings.get("logging_rotation_enabled", True)),
        )

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


@router.post("/settings/logo")
async def upload_logo(
    file: UploadFile = File(...),
    current_user: User = Depends(require_roles(["superadmin"])),
    db: Session = Depends(get_db),
):
    """Uploads custom platform branding logo with thumbnail optimization."""
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    filename = f"logo_{uuid.uuid4().hex[:8]}.png"
    disk_path = os.path.join(UPLOAD_DIR, filename)

    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Image file exceeds maximum allowed size (5MB).",
        )

    try:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(content))
        img = img.convert("RGBA")
        img.thumbnail((256, 256), Image.Resampling.LANCZOS)
        img.save(disk_path, format="PNG")
    except Exception as exc:
        logger.warning("PIL thumbnailing skipped or failed: %s, saving raw bytes", exc)
        with open(disk_path, "wb") as f:
            f.write(content)

    url_path = "/api/hub/settings/logo/file"

    # Remove old logo file if existed
    rec_disk = db.query(SystemSettings).filter(SystemSettings.key == "login_logo_disk_path").first()
    if rec_disk and rec_disk.value and os.path.exists(rec_disk.value) and rec_disk.value != disk_path:
        try:
            os.remove(rec_disk.value)
        except Exception:
            pass

    for k, v in [("login_logo_url", url_path), ("login_logo_disk_path", disk_path)]:
        rec = db.query(SystemSettings).filter(SystemSettings.key == k).first()
        if not rec:
            db.add(SystemSettings(key=k, value=v))
        else:
            rec.value = v

    db.add(
        AuditLog(
            username=current_user.username,
            action="UPLOAD_LOGO",
            target_type="settings",
            details="Uploaded custom platform brand logo",
        )
    )
    db.commit()

    return {"status": "ok", "logo_url": url_path}


@router.get("/settings/logo/file")
def get_logo_file(db: Session = Depends(get_db)):
    """Serves the custom uploaded branding logo without requiring authentication."""
    rec_disk = db.query(SystemSettings).filter(SystemSettings.key == "login_logo_disk_path").first()
    if rec_disk and rec_disk.value and os.path.isfile(rec_disk.value):
        return FileResponse(rec_disk.value, media_type="image/png")
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No custom logo uploaded")


@router.delete("/settings/logo")
def delete_logo(
    current_user: User = Depends(require_roles(["superadmin"])),
    db: Session = Depends(get_db),
):
    """Deletes custom branding logo and restores default monogram."""
    rec_disk = db.query(SystemSettings).filter(SystemSettings.key == "login_logo_disk_path").first()
    if rec_disk:
        if rec_disk.value and os.path.exists(rec_disk.value):
            try:
                os.remove(rec_disk.value)
            except Exception:
                pass
        rec_disk.value = ""

    rec_url = db.query(SystemSettings).filter(SystemSettings.key == "login_logo_url").first()
    if rec_url:
        rec_url.value = ""

    db.add(
        AuditLog(
            username=current_user.username,
            action="DELETE_LOGO",
            target_type="settings",
            details="Removed custom platform brand logo",
        )
    )
    db.commit()

    return {"status": "ok", "message": "Custom logo removed"}


class TestLoggingPathRequest(BaseModel):
    path: str


@router.post("/settings/logging/test-path")
def test_logging_path(
    req: TestLoggingPathRequest,
    current_user: User = Depends(require_roles(["superadmin"])),
):
    """Validates filesystem write permissions for a requested logging directory or file path."""
    raw_path = req.path.strip()
    if not raw_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Log path cannot be empty.",
        )

    test_dir = raw_path
    if raw_path.endswith(".log") or os.path.splitext(raw_path)[1]:
        test_dir = os.path.dirname(raw_path) or "."

    try:
        os.makedirs(test_dir, exist_ok=True)
        probe_file = os.path.join(test_dir, f".probe_perm_{uuid.uuid4().hex[:6]}.tmp")
        with open(probe_file, "w") as f:
            f.write("probe write test")
        if os.path.exists(probe_file):
            os.remove(probe_file)

        abs_path = os.path.abspath(test_dir)
        return {
            "status": "ok",
            "writable": True,
            "resolved_path": abs_path,
            "message": f"Path is valid and writable: {abs_path}",
        }
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Filesystem permission error on '{test_dir}': {str(exc)}",
        )


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


def _apply_audit_filters(
    query,
    current_user: User,
    node_id: Optional[str] = None,
    org_id: Optional[int] = None,
    channel: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    search: Optional[str] = None,
):
    # Strict RBAC boundary
    if current_user.role != "superadmin":
        query = query.filter(AuditLog.org_id == current_user.org_id)
    elif org_id is not None:
        query = query.filter(AuditLog.org_id == org_id)

    if node_id and node_id != "all":
        query = query.filter(AuditLog.node_id == node_id)

    if channel and channel != "all":
        query = query.filter(AuditLog.channel == channel)

    if start_date and start_date.strip():
        try:
            clean_start = start_date.strip().replace("Z", "+00:00")
            dt_start = datetime.fromisoformat(clean_start)
            if dt_start.tzinfo is not None:
                dt_start = dt_start.astimezone(timezone.utc).replace(tzinfo=None)
            query = query.filter(AuditLog.timestamp >= dt_start)
        except Exception as e:
            logger.debug("Could not parse start_date '%s': %s", start_date, e)

    if end_date and end_date.strip():
        try:
            clean_end = end_date.strip().replace("Z", "+00:00")
            dt_end = datetime.fromisoformat(clean_end)
            if len(clean_end) <= 10:
                dt_end = dt_end.replace(hour=23, minute=59, second=59, microsecond=999999)
            if dt_end.tzinfo is not None:
                dt_end = dt_end.astimezone(timezone.utc).replace(tzinfo=None)
            query = query.filter(AuditLog.timestamp <= dt_end)
        except Exception as e:
            logger.debug("Could not parse end_date '%s': %s", end_date, e)

    if search and search.strip():
        term = f"%{search.strip()}%"
        query = query.filter(
            or_(
                AuditLog.username.ilike(term),
                AuditLog.action.ilike(term),
                AuditLog.details.ilike(term),
                AuditLog.ip_address.ilike(term),
                AuditLog.node_id.ilike(term),
            )
        )

    return query


@router.get("/audit-logs")
def list_audit_logs(
    limit: int = 200,
    node_id: Optional[str] = None,
    org_id: Optional[int] = None,
    channel: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    search: Optional[str] = None,
    current_user: User = Depends(require_roles(["superadmin", "org_admin", "tenant_admin"])),
    db: Session = Depends(get_db),
):
    """Query audit logs filtered by organization permissions, date range, origin, and node."""
    query = db.query(AuditLog)
    query = _apply_audit_filters(
        query, current_user, node_id, org_id, channel, start_date, end_date, search
    )

    logs = query.order_by(AuditLog.timestamp.desc()).limit(min(max(1, limit), 2000)).all()
    return [
        {
            "id": l.id,
            "timestamp": (
                l.timestamp.replace(tzinfo=timezone.utc).isoformat()
                if l.timestamp
                else None
            ),
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


def _resolve_pdf_logo_bytes(db: Session, tenant_icon: Optional[str] = None) -> Optional[bytes]:
    """Resolves raw logo bytes for PDF header branding from tenant icon or platform logo."""
    if tenant_icon and str(tenant_icon).startswith("data:image"):
        try:
            import base64
            _, b64 = tenant_icon.split(",", 1)
            raw = base64.b64decode(b64)
            logger.info("Resolved PDF logo from tenant icon data URL (%d bytes)", len(raw))
            return raw
        except Exception as e:
            logger.warning("Failed decoding tenant icon data URL: %s", e)

    # Clean disk path resolution (handling quotes, relative paths, and uploads dir fallback)
    rec_disk = db.query(SystemSettings).filter(SystemSettings.key == "login_logo_disk_path").first()
    if rec_disk and rec_disk.value:
        raw_val = rec_disk.value.strip().strip('"').strip("'")
        candidates = [
            raw_val,
            os.path.abspath(raw_val),
            os.path.join(UPLOAD_DIR, os.path.basename(raw_val)),
        ]
        for c in candidates:
            if c and os.path.isfile(c):
                try:
                    with open(c, "rb") as f:
                        data = f.read()
                    logger.info("Resolved PDF logo from disk '%s' (%d bytes)", c, len(data))
                    return data
                except Exception as e:
                    logger.warning("Error reading logo file '%s': %s", c, e)
    else:
        logger.debug("No login_logo_disk_path configured")

    # Also check if login_logo_url is a base64 Data URL
    rec_url = db.query(SystemSettings).filter(SystemSettings.key == "login_logo_url").first()
    if rec_url and rec_url.value:
        raw_url = rec_url.value.strip().strip('"')
        if raw_url.startswith("data:image"):
            try:
                import base64
                _, b64 = raw_url.split(",", 1)
                raw = base64.b64decode(b64)
                logger.info("Resolved PDF logo from login_logo_url data URL (%d bytes)", len(raw))
                return raw
            except Exception as e:
                logger.warning("Failed decoding login_logo_url: %s", e)

    if os.path.isdir(UPLOAD_DIR):
        for fname in sorted(os.listdir(UPLOAD_DIR), reverse=True):
            if fname.startswith("logo_"):
                p = os.path.join(UPLOAD_DIR, fname)
                try:
                    with open(p, "rb") as f:
                        data = f.read()
                    logger.info("Resolved PDF logo fallback '%s' (%d bytes)", p, len(data))
                    return data
                except Exception as e:
                    logger.warning("Error reading fallback logo '%s': %s", p, e)

    logger.warning("No logo image bytes could be resolved for PDF header")
    return None


@router.get("/audit-logs/export-pdf")
def export_audit_pdf(
    node_id: Optional[str] = None,
    org_id: Optional[int] = None,
    channel: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 1500,
    current_user: User = Depends(require_roles(["superadmin", "org_admin", "tenant_admin"])),
    db: Session = Depends(get_db),
):
    """Generates a downloadable corporate PDF report of filtered audit logs."""
    query = db.query(AuditLog)
    query = _apply_audit_filters(
        query, current_user, node_id, org_id, channel, start_date, end_date, search
    )
    logs = query.order_by(AuditLog.timestamp.desc()).limit(min(max(1, limit), 2500)).all()

    # Determine tenant name
    tenant_name = "All Tenants (Global Platform)"
    if current_user.role != "superadmin":
        org = db.query(Organization).filter(Organization.id == current_user.org_id).first()
        tenant_name = org.name if org else f"Tenant #{current_user.org_id}"
    elif org_id is not None:
        org = db.query(Organization).filter(Organization.id == org_id).first()
        tenant_name = org.name if org else f"Tenant #{org_id}"

    # Determine node name
    node_name = "All Appliances"
    if node_id and node_id != "all":
        enrolled = db.query(EnrolledNode).filter(EnrolledNode.node_id == node_id).first()
        node_name = enrolled.name if enrolled else node_id

    # Format date range text
    if start_date and end_date:
        date_range_str = f"{start_date[:10]} to {end_date[:10]}"
    elif start_date:
        date_range_str = f"Since {start_date[:10]}"
    elif end_date:
        date_range_str = f"Until {end_date[:10]}"
    else:
        date_range_str = "All Recorded Events"

    node_name_map = {n.node_id: (n.name or n.node_id) for n in db.query(EnrolledNode).all()}

    log_dicts = [
        {
            "id": l.id,
            "timestamp": (
                l.timestamp.replace(tzinfo=timezone.utc).isoformat()
                if l.timestamp
                else None
            ),
            "org_id": l.org_id,
            "node_id": l.node_id,
            "node_name": node_name_map.get(l.node_id, l.node_id or "CloudHub") if l.node_id else "CloudHub",
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

    tenant_icon = None
    if org_id:
        t_org = db.query(Organization).filter(Organization.id == org_id).first()
        if t_org:
            tenant_name = t_org.name
            tenant_icon = t_org.icon_data
    elif current_user.org_id:
        t_org = db.query(Organization).filter(Organization.id == current_user.org_id).first()
        if t_org:
            tenant_name = t_org.name
            tenant_icon = t_org.icon_data

    settings_dict = _load_settings_dict(db)
    metadata = {
        "tenant_name": tenant_name,
        "tenant_icon": tenant_icon,
        "platform_logo_text": settings_dict.get("login_logo_text", "CH"),
        "platform_logo_url": settings_dict.get("login_logo_url", ""),
        "logo_image_bytes": _resolve_pdf_logo_bytes(db, tenant_icon),
        "date_range": date_range_str,
        "node_name": node_name,
        "app_version": __version__,
    }

    generator = AuditPdfReportGenerator(log_dicts, metadata)
    pdf_bytes = generator.build_pdf()

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"cloudhub_audit_report_{ts}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    )


@router.get("/audit-logs/{log_id}/export-pdf")
def export_single_audit_log_pdf(
    log_id: int,
    current_user: User = Depends(require_roles(["superadmin", "org_admin", "tenant_admin"])),
    db: Session = Depends(get_db),
):
    """Generates an official single-event compliance certificate PDF for a specific audit log record."""
    log = db.query(AuditLog).filter(AuditLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Audit log record not found")

    # Access control: non-superadmin users can only export events of their own organization
    if current_user.role != "superadmin" and log.org_id != current_user.org_id:
        raise HTTPException(status_code=403, detail="Access denied to this audit log record")

    # Resolve tenant name
    tenant_name = "Global Platform"
    if log.org_id:
        org = db.query(Organization).filter(Organization.id == log.org_id).first()
        tenant_name = org.name if org else f"Tenant #{log.org_id}"

    # Resolve node name
    node_name = None
    if log.node_id:
        enrolled = db.query(EnrolledNode).filter(EnrolledNode.node_id == log.node_id).first()
        node_name = enrolled.name if enrolled else log.node_id

    log_dict = {
        "id": log.id,
        "timestamp": (
            log.timestamp.replace(tzinfo=timezone.utc).isoformat()
            if log.timestamp
            else None
        ),
        "org_id": log.org_id,
        "node_id": log.node_id,
        "channel": getattr(log, "channel", "cloudhub"),
        "username": log.username,
        "action": log.action,
        "target_type": log.target_type,
        "target_id": log.target_id,
        "ip_address": log.ip_address,
        "details": log.details,
    }

    tenant_icon = None
    if log.org_id:
        t_org = db.query(Organization).filter(Organization.id == log.org_id).first()
        if t_org:
            tenant_name = t_org.name
            tenant_icon = t_org.icon_data

    settings_dict = _load_settings_dict(db)
    metadata = {
        "tenant_name": tenant_name,
        "tenant_icon": tenant_icon,
        "platform_logo_text": settings_dict.get("login_logo_text", "CH"),
        "platform_logo_url": settings_dict.get("login_logo_url", ""),
        "logo_image_bytes": _resolve_pdf_logo_bytes(db, tenant_icon),
        "node_name": node_name,
        "exported_by": current_user.username,
        "app_version": __version__,
    }

    generator = AuditSingleEventPdfGenerator(log_dict, metadata)
    pdf_bytes = generator.build_pdf()

    ts = (
        log.timestamp.strftime("%Y%m%d_%H%M%S")
        if log.timestamp
        else datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    )
    safe_action = re.sub(r"[^A-Za-z0-9_-]", "_", log.action.lower())
    filename = f"audit_event_{log.id}_{safe_action}_{ts}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    )


@router.get("/version")
def get_hub_version(
    current_user: User = Depends(require_roles(["superadmin"])),
):
    """Returns CloudHub software release version, git environment metadata, and upstream update status."""
    git_meta = get_git_metadata()
    update_info = check_latest_release(__version__, force=False)
    return {
        "app": "ffmpeg-gui-cloudhub",
        "version": __version__,
        "db_schema_version": DB_SCHEMA_VERSION,
        "git_branch": git_meta.get("branch"),
        "git_commit": git_meta.get("commit"),
        "is_release": git_meta.get("is_release"),
        "update_available": update_info.get("update_available", False),
        "latest_release": update_info.get("latest_release"),
        "release_url": update_info.get("release_url"),
        "checked_at": update_info.get("checked_at"),
    }


@router.post("/version/check-updates")
def force_check_updates(
    current_user: User = Depends(require_roles(["superadmin"])),
):
    """Forces an immediate check against GitHub Releases/Tags for CloudHub updates."""
    git_meta = get_git_metadata(force=True)
    update_info = check_latest_release(__version__, force=True)
    return {
        "app": "ffmpeg-gui-cloudhub",
        "version": __version__,
        "db_schema_version": DB_SCHEMA_VERSION,
        "git_branch": git_meta.get("branch"),
        "git_commit": git_meta.get("commit"),
        "is_release": git_meta.get("is_release"),
        "update_available": update_info.get("update_available", False),
        "latest_release": update_info.get("latest_release"),
        "release_url": update_info.get("release_url"),
        "checked_at": update_info.get("checked_at"),
    }
