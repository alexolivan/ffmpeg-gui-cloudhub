"""Unit tests for CloudHub MaintenanceScheduler and GzippedRotatingFileHandler."""

import os
import gzip
import shutil
import logging
import tempfile
import unittest
import datetime
from unittest.mock import patch, MagicMock

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.database.models import Base, AuditLog, SystemSettings
from backend.services.maintenance_scheduler import (
    GzippedRotatingFileHandler,
    MaintenanceScheduler,
    setup_cloudhub_logging,
)


class TestMaintenanceScheduler(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp(prefix="cloudhub_maint_test_")
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        self.TestingSession = sessionmaker(bind=self.engine)
        Base.metadata.create_all(bind=self.engine)

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_gzipped_rotating_file_handler(self):
        log_file = os.path.join(self.test_dir, "test.log")
        handler = GzippedRotatingFileHandler(
            log_file,
            maxBytes=80,
            backupCount=2,
            encoding="utf-8",
        )

        test_logger = logging.getLogger("test_rotator")
        test_logger.setLevel(logging.INFO)
        test_logger.addHandler(handler)

        # Write enough bytes to trigger rollover
        for i in range(10):
            test_logger.info(f"Log line number {i:04d} - padding text to force rollover quickly")

        handler.close()
        test_logger.removeHandler(handler)

        gz_file = f"{log_file}.1.gz"
        self.assertTrue(os.path.exists(gz_file), f"Expected rotated file {gz_file} to exist")

        with gzip.open(gz_file, "rt", encoding="utf-8") as f:
            content = f.read()
            self.assertIn("Log line number", content)

    def test_prune_audit_logs(self):
        with patch("backend.services.maintenance_scheduler.SessionLocal", self.TestingSession):
            with self.TestingSession() as db:
                old_ts = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=100)
                recent_ts = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=5)

                db.add(AuditLog(username="alice", action="OLD_ACTION", target_type="auth", details="old", timestamp=old_ts))
                db.add(AuditLog(username="bob", action="NEW_ACTION", target_type="auth", details="recent", timestamp=recent_ts))
                db.commit()

            scheduler = MaintenanceScheduler()
            deleted = scheduler.prune_audit_logs(retention_days=90)
            self.assertEqual(deleted, 1)

            with self.TestingSession() as db:
                logs = db.query(AuditLog).all()
                self.assertEqual(len(logs), 1)
                self.assertEqual(logs[0].username, "bob")

    def test_perform_ssl_check_non_acme(self):
        with patch("backend.services.maintenance_scheduler.cert_manager") as mock_cm:
            mock_cm.get_cert_status.return_value = {
                "valid": True,
                "mode": "custom",
                "days_remaining": 15,
            }
            scheduler = MaintenanceScheduler()
            result = scheduler.perform_ssl_check()
            self.assertFalse(result)

    def test_perform_ssl_check_acme_healthy(self):
        with patch("backend.services.maintenance_scheduler.cert_manager") as mock_cm:
            mock_cm.get_cert_status.return_value = {
                "valid": True,
                "mode": "acme",
                "days_remaining": 45,
            }
            scheduler = MaintenanceScheduler()
            result = scheduler.perform_ssl_check()
            self.assertFalse(result)

    def test_perform_ssl_check_acme_renew_trigger(self):
        with patch("backend.services.maintenance_scheduler.SessionLocal", self.TestingSession):
            with self.TestingSession() as db:
                db.add(SystemSettings(key="hub_domain", value='"hub.example.com"'))
                db.add(SystemSettings(key="letsencrypt_email", value='"admin@example.com"'))
                db.commit()

            with patch("backend.services.maintenance_scheduler.cert_manager") as mock_cm:
                mock_cm.get_cert_status.side_effect = [
                    {"valid": True, "mode": "acme", "days_remaining": 10},
                    {"valid": True, "mode": "acme", "days_remaining": 90},
                ]
                mock_cm.renew_acme_certificate.return_value = (True, "Certificate renewed successfully")

                scheduler = MaintenanceScheduler()
                result = scheduler.perform_ssl_check()
                self.assertTrue(result)
                mock_cm.renew_acme_certificate.assert_called_once_with(
                    "hub.example.com", "admin@example.com", staging=False
                )


if __name__ == "__main__":
    import logging
    unittest.main()
