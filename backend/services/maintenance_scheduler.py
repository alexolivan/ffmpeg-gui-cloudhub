"""Background maintenance scheduler and gzipped log rotation for CloudHub."""

import os
import gzip
import shutil
import asyncio
import datetime
import logging
import logging.handlers
from typing import Optional

from backend.database.db import SessionLocal
from backend.database.models import AuditLog, SystemSettings
from backend.services.cert_manager import cert_manager

logger = logging.getLogger("cloudhub.maintenance")


class GzippedRotatingFileHandler(logging.handlers.RotatingFileHandler):
    """
    Custom RotatingFileHandler that compresses rotated files using gzip.
    Rotates cloudhub.log -> cloudhub.log.1.gz ... up to backupCount.
    """

    def doRollover(self):
        if self.stream:
            self.stream.close()
            self.stream = None

        if self.backupCount > 0:
            for i in range(self.backupCount - 1, 0, -1):
                sfn = f"{self.baseFilename}.{i}.gz"
                dfn = f"{self.baseFilename}.{i+1}.gz"
                if os.path.exists(sfn):
                    if os.path.exists(dfn):
                        os.remove(dfn)
                    os.rename(sfn, dfn)

            dest_1 = f"{self.baseFilename}.1"
            dest_1_gz = f"{dest_1}.gz"
            if os.path.exists(dest_1_gz):
                os.remove(dest_1_gz)
            if os.path.exists(dest_1):
                os.remove(dest_1)

            if os.path.exists(self.baseFilename):
                os.rename(self.baseFilename, dest_1)

            if os.path.exists(dest_1):
                try:
                    with open(dest_1, "rb") as f_in:
                        with gzip.open(dest_1_gz, "wb") as f_out:
                            shutil.copyfileobj(f_in, f_out)
                finally:
                    if os.path.exists(dest_1):
                        os.remove(dest_1)

        if not self.delay:
            self.stream = self._open()


def setup_cloudhub_logging(
    log_dir: Optional[str] = None,
    max_bytes: int = 10 * 1024 * 1024,
    backup_count: int = 5,
    log_level: int = logging.INFO,
    mode: str = "both",
    timestamp_tz: str = "utc",
    rotation_enabled: bool = True,
):
    """Configures server logging with gzipped rotation, timezone formatting, and graceful read-only fallback."""
    root_logger = logging.getLogger()

    # Remove existing GzippedRotatingFileHandlers to allow dynamic reconfiguration
    for h in list(root_logger.handlers):
        if isinstance(h, GzippedRotatingFileHandler):
            root_logger.removeHandler(h)
            try:
                h.close()
            except Exception:
                pass

    if mode == "journalctl":
        return

    effective_path = log_dir or os.environ.get("CLOUDHUB_LOG_DIR", "data/logs")
    try:
        if effective_path.endswith(".log"):
            main_log_path = effective_path
            os.makedirs(os.path.dirname(effective_path) or ".", exist_ok=True)
        else:
            os.makedirs(effective_path, exist_ok=True)
            main_log_path = os.path.join(effective_path, "cloudhub.log")

        formatter = logging.Formatter(
            "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
        )
        if timestamp_tz == "utc":
            import time
            formatter.converter = time.gmtime

        handler = GzippedRotatingFileHandler(
            main_log_path,
            maxBytes=max_bytes if rotation_enabled else 0,
            backupCount=backup_count if rotation_enabled else 0,
            encoding="utf-8",
        )
        handler.setFormatter(formatter)
        handler.setLevel(log_level)
        root_logger.addHandler(handler)
    except OSError as exc:
        logger.warning("Could not setup file logging at '%s': %s (running in console-only mode)", effective_path, exc)


class MaintenanceScheduler:
    """Periodic maintenance daemon for SSL auto-renewal and audit log cleanup."""

    def __init__(self, check_interval_hours: int = 12):
        self.check_interval_seconds = check_interval_hours * 3600
        self._task: Optional[asyncio.Task] = None
        self._running = False

    def perform_ssl_check(self) -> bool:
        """Evaluates SSL certificate expiration and triggers ACME renewal if <= 30 days remain."""
        try:
            status = cert_manager.get_cert_status()
            if status.get("mode") != "acme" or not status.get("valid"):
                return False

            days_remaining = status.get("days_remaining", 0)
            if days_remaining > 30:
                logger.info(
                    "SSL certificate is healthy (%d days remaining). No renewal needed.",
                    days_remaining,
                )
                return False

            logger.warning(
                "SSL certificate expires in %d days. Triggering automated ACME renewal...",
                days_remaining,
            )

            # Retrieve domain and email from SystemSettings
            with SessionLocal() as db:
                import json
                records = db.query(SystemSettings).all()
                settings = {}
                for r in records:
                    try:
                        settings[r.key] = json.loads(r.value)
                    except Exception:
                        settings[r.key] = r.value

                domain = settings.get("hub_domain")
                email = settings.get("letsencrypt_email")
                staging = bool(settings.get("letsencrypt_staging", False))

                if not domain or not email:
                    logger.error("Cannot auto-renew: hub_domain or letsencrypt_email missing in settings.")
                    return False

                ok, msg = cert_manager.renew_acme_certificate(domain, email, staging=staging)
                if ok:
                    db.add(
                        AuditLog(
                            username="system",
                            action="AUTO_RENEW_SSL",
                            target_type="ssl",
                            details=f"Automated ACME renewal successful for '{domain}'. New days remaining: {cert_manager.get_cert_status().get('days_remaining')}",
                        )
                    )
                    db.commit()
                    logger.info("Automated ACME renewal completed successfully.")
                    return True
                else:
                    logger.error("Automated ACME renewal failed: %s", msg)
                    return False
        except Exception as e:
            logger.error("Error during automated SSL maintenance check: %s", e)
            return False

    def prune_audit_logs(self, retention_days: int = 90) -> int:
        """Prunes audit logs older than retention_days (configured in SystemSettings)."""
        try:
            with SessionLocal() as db:
                import json
                setting = db.query(SystemSettings).filter(SystemSettings.key == "audit_retention_days").first()
                if setting:
                    try:
                        retention_days = int(json.loads(setting.value))
                    except Exception:
                        try:
                            retention_days = int(setting.value)
                        except Exception:
                            pass

                cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=retention_days)
                deleted = (
                    db.query(AuditLog)
                    .filter(AuditLog.timestamp < cutoff)
                    .delete(synchronize_session=False)
                )
                if deleted > 0:
                    db.commit()
                    logger.info("Pruned %d audit log entries older than %d days.", deleted, retention_days)
                return deleted
        except Exception as e:
            logger.error("Error during audit log retention prune: %s", e)
            return 0

    async def _worker_loop(self):
        """Asynchronous periodic execution loop."""
        # Initial grace delay after boot (60 seconds)
        await asyncio.sleep(60)

        while self._running:
            try:
                self.perform_ssl_check()
                self.prune_audit_logs(retention_days=90)
            except Exception as e:
                logger.error("Unexpected error in maintenance worker: %s", e)

            try:
                await asyncio.sleep(self.check_interval_seconds)
            except asyncio.CancelledError:
                break

    def start(self):
        """Starts background worker task."""
        if not self._running:
            self._running = True
            try:
                loop = asyncio.get_running_loop()
                self._task = loop.create_task(self._worker_loop())
                logger.info("MaintenanceScheduler background worker started.")
            except RuntimeError:
                logger.warning("No running asyncio loop found to start MaintenanceScheduler.")

    def stop(self):
        """Stops background worker task."""
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            logger.info("MaintenanceScheduler background worker stopped.")


maintenance_scheduler = MaintenanceScheduler()
