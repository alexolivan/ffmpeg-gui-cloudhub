"""Unit tests for Version Inspection, GitHub Update Checker, and Audit Log PDF Report Generation."""

import os
import tempfile
import unittest
import datetime
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.main import app
from backend.database.db import get_db, Base
from backend.database.models import User, Organization, EnrolledNode, AuditLog
from backend.core.auth_manager import AuthManager
from backend.core.update_checker import (
    get_git_metadata,
    check_latest_release,
    compare_semver,
    _parse_semver_tuple,
)
from backend.services.audit_pdf_generator import AuditPdfReportGenerator


class TestAuditPdfAndVersion(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.db_path = os.path.join(cls.temp_dir.name, "test_audit_version.db")
        cls.engine = create_engine(
            f"sqlite:///{cls.db_path}",
            connect_args={"check_same_thread": False},
        )
        cls.TestingSessionLocal = sessionmaker(
            autocommit=False, autoflush=False, bind=cls.engine
        )
        Base.metadata.create_all(bind=cls.engine)

        def override_get_db():
            db = cls.TestingSessionLocal()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        app.dependency_overrides.clear()
        cls.temp_dir.cleanup()

    def setUp(self):
        db = self.TestingSessionLocal()
        db.query(AuditLog).delete()
        db.query(User).delete()
        db.query(Organization).delete()
        db.query(EnrolledNode).delete()

        # Seed superadmin
        self.superadmin = User(
            username="test_owner",
            password_hash=AuthManager.hash_password("OwnerPassword123!"),
            role="superadmin",
            org_id=None,
        )
        # Seed tenant
        self.org = Organization(name="Audit Test Org", slug="audit-org")
        db.add_all([self.superadmin, self.org])
        db.commit()
        db.refresh(self.superadmin)
        db.refresh(self.org)

        # Seed tenant admin
        self.tenant_admin = User(
            username="tenant_admin_user",
            password_hash=AuthManager.hash_password("TenantPass123!"),
            role="org_admin",
            org_id=self.org.id,
        )
        db.add(self.tenant_admin)
        db.commit()
        db.refresh(self.tenant_admin)

        # Seed Audit Logs
        self.now = datetime.datetime.now(datetime.timezone.utc)
        self.t1 = self.now - datetime.timedelta(days=10)
        self.t2 = self.now - datetime.timedelta(days=2)
        self.t3 = self.now - datetime.timedelta(hours=1)

        db.add_all([
            AuditLog(
                timestamp=self.t1.replace(tzinfo=None),
                org_id=self.org.id,
                node_id="encoder-node-01",
                channel="cloudhub",
                username="test_owner",
                action="TENANT_CREATE",
                target_type="organization",
                target_id=str(self.org.id),
                ip_address="127.0.0.1",
                details="Created initial organization",
            ),
            AuditLog(
                timestamp=self.t2.replace(tzinfo=None),
                org_id=self.org.id,
                node_id="encoder-node-01",
                channel="local_gui",
                username="operator_carlos",
                action="SERVICE_START",
                target_type="service",
                target_id="1",
                ip_address="192.168.1.50",
                details="Started Main Stream HLS service",
            ),
            AuditLog(
                timestamp=self.t3.replace(tzinfo=None),
                org_id=self.org.id,
                node_id="encoder-node-02",
                channel="cloudhub",
                username="test_owner",
                action="AUTH_LOGIN_SUCCESS",
                target_type="user",
                target_id=str(self.superadmin.id),
                ip_address="203.0.113.4",
                details="Successful WebUI login from office network",
            ),
        ])
        db.commit()

        # Session tokens
        self.owner_token = AuthManager.create_session(self.superadmin.id, self.superadmin.password_hash)
        self.tenant_token = AuthManager.create_session(self.tenant_admin.id, self.tenant_admin.password_hash)
        self.owner_headers = {"Authorization": f"Bearer {self.owner_token}"}
        self.tenant_headers = {"Authorization": f"Bearer {self.tenant_token}"}
        db.close()

    def test_semver_parsing_and_comparison(self):
        self.assertEqual(_parse_semver_tuple("v1.4.0"), (1, 4, 0))
        self.assertEqual(_parse_semver_tuple("1.5.0-rc1"), (1, 5, 0))
        self.assertTrue(compare_semver("1.5.0", "1.4.0"))
        self.assertFalse(compare_semver("1.4.0", "1.4.0"))
        self.assertFalse(compare_semver("1.3.9", "1.4.0"))

    def test_git_metadata_resolver(self):
        meta = get_git_metadata()
        self.assertIn("branch", meta)
        self.assertIn("commit", meta)
        self.assertIn("is_release", meta)
        self.assertIsInstance(meta["is_release"], bool)

    def test_get_hub_version_endpoint_rbac(self):
        # Tenant admin cannot access owner version endpoint
        res_denied = self.client.get("/api/hub/version", headers=self.tenant_headers)
        self.assertEqual(res_denied.status_code, 403)

        # Superadmin can access version endpoint
        res_ok = self.client.get("/api/hub/version", headers=self.owner_headers)
        self.assertEqual(res_ok.status_code, 200)
        data = res_ok.json()
        self.assertEqual(data["app"], "ffmpeg-gui-cloudhub")
        self.assertIn("version", data)
        self.assertIn("db_schema_version", data)
        self.assertIn("git_branch", data)
        self.assertIn("is_release", data)

    def test_audit_logs_date_filtering(self):
        # Filter: last 3 days (should catch t2 and t3, but not t1)
        start_date = (self.now - datetime.timedelta(days=3)).strftime("%Y-%m-%d")
        res = self.client.get(
            f"/api/hub/audit-logs?start_date={start_date}",
            headers=self.owner_headers,
        )
        self.assertEqual(res.status_code, 200)
        logs = res.json()
        actions = [l["action"] for l in logs]
        self.assertIn("SERVICE_START", actions)
        self.assertIn("AUTH_LOGIN_SUCCESS", actions)
        self.assertNotIn("TENANT_CREATE", actions)

        # Filter by end_date: older than 5 days (should catch only t1)
        end_date = (self.now - datetime.timedelta(days=5)).strftime("%Y-%m-%d")
        res_old = self.client.get(
            f"/api/hub/audit-logs?end_date={end_date}",
            headers=self.owner_headers,
        )
        self.assertEqual(res_old.status_code, 200)
        old_logs = res_old.json()
        self.assertEqual(len(old_logs), 1)
        self.assertEqual(old_logs[0]["action"], "TENANT_CREATE")

    def test_audit_pdf_export_endpoint(self):
        res = self.client.get(
            "/api/hub/audit-logs/export-pdf",
            headers=self.owner_headers,
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers["content-type"], "application/pdf")
        self.assertIn("attachment; filename=", res.headers["content-disposition"])

        # Check PDF binary signature
        pdf_bytes = res.content
        self.assertTrue(pdf_bytes.startswith(b"%PDF-1.4"))
        self.assertIn(b"%%EOF", pdf_bytes)

    def test_audit_pdf_generator_multipage(self):
        # Create 50 synthetic entries to verify multi-page pagination
        synthetic_logs = [
            {
                "timestamp": f"2026-10-28T10:{i:02d}:00Z",
                "channel": "cloudhub",
                "username": f"user_{i}",
                "ip_address": f"10.0.0.{i}",
                "action": "CONFIG_UPDATE",
                "target_type": "settings",
                "target_id": str(i),
                "details": f"Applied configuration update parameter key_{i}",
            }
            for i in range(50)
        ]
        gen = AuditPdfReportGenerator(synthetic_logs, {
            "tenant_name": "Test Enterprise",
            "date_range": "2026-10-01 to 2026-10-28",
            "node_name": "All Appliances",
            "app_version": "1.5.0",
        })
        pdf_bytes = gen.build_pdf()
        self.assertTrue(pdf_bytes.startswith(b"%PDF-1.4"))
        self.assertGreater(len(gen.pages), 1)
        self.assertIn(b"%%EOF", pdf_bytes)


if __name__ == "__main__":
    unittest.main()
