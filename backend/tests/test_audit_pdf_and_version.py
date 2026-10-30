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
import backend.database.db as db_module
import backend.core.reverse_proxy as reverse_proxy_module
from backend.database.models import User, Organization, EnrolledNode, AuditLog
from backend.core.auth_manager import AuthManager
from backend.core.update_checker import (
    get_git_metadata,
    check_latest_release,
    compare_semver,
    _parse_semver_tuple,
)
from backend.services.audit_pdf_generator import AuditPdfReportGenerator, AuditSingleEventPdfGenerator


class TestAuditPdfAndVersion(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.db_path = os.path.join(cls.temp_dir.name, "test_audit_version.db")
        cls.engine = create_engine(
            f"sqlite:///{cls.db_path}",
            connect_args={"check_same_thread": False, "timeout": 30},
        )
        cls.TestingSessionLocal = sessionmaker(
            autocommit=False, autoflush=False, bind=cls.engine
        )
        Base.metadata.create_all(bind=cls.engine)
        cls.orig_session_local = db_module.SessionLocal
        db_module.SessionLocal = cls.TestingSessionLocal
        cls.orig_rp_session_local = reverse_proxy_module.SessionLocal
        reverse_proxy_module.SessionLocal = cls.TestingSessionLocal

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
        db_module.SessionLocal = cls.orig_session_local
        reverse_proxy_module.SessionLocal = cls.orig_rp_session_local
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

        self.superadmin_id = self.superadmin.id
        self.superadmin_password_hash = self.superadmin.password_hash
        self.org_id = self.org.id

        # Seed tenant admin
        self.tenant_admin = User(
            username="tenant_admin_user",
            password_hash=AuthManager.hash_password("TenantPass123!"),
            role="org_admin",
            org_id=self.org_id,
        )
        db.add(self.tenant_admin)
        db.commit()
        db.refresh(self.tenant_admin)
        self.tenant_admin_id = self.tenant_admin.id
        self.tenant_admin_password_hash = self.tenant_admin.password_hash

        # Seed Audit Logs
        self.now = datetime.datetime.now(datetime.timezone.utc)
        self.t1 = self.now - datetime.timedelta(days=10)
        self.t2 = self.now - datetime.timedelta(days=2)
        self.t3 = self.now - datetime.timedelta(hours=1)

        db.add_all([
            AuditLog(
                timestamp=self.t1.replace(tzinfo=None),
                org_id=self.org_id,
                node_id="encoder-node-01",
                channel="cloudhub",
                username="test_owner",
                action="TENANT_CREATE",
                target_type="organization",
                target_id=str(self.org_id),
                ip_address="127.0.0.1",
                details="Created initial organization",
            ),
            AuditLog(
                timestamp=self.t2.replace(tzinfo=None),
                org_id=self.org_id,
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
                org_id=self.org_id,
                node_id="encoder-node-02",
                channel="cloudhub",
                username="test_owner",
                action="AUTH_LOGIN_SUCCESS",
                target_type="user",
                target_id=str(self.superadmin_id),
                ip_address="203.0.113.4",
                details="Successful WebUI login from office network",
            ),
        ])
        db.commit()

        # Session tokens
        self.owner_token = AuthManager.create_session(self.superadmin_id, self.superadmin_password_hash)
        self.tenant_token = AuthManager.create_session(self.tenant_admin_id, self.tenant_admin_password_hash)
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

    def test_audit_single_day_filter_excludes_previous_days(self):
        db = self.TestingSessionLocal()
        db.query(AuditLog).delete()
        # Entry on 2026-10-28
        db.add(AuditLog(
            timestamp=datetime.datetime(2026, 10, 28, 14, 30, 0),
            org_id=self.org_id,
            node_id="node-a",
            username="test_owner",
            action="YESTERDAY_EVENT",
            target_type="system",
            details="Yesterday log",
        ))
        # Entry on 2026-10-29
        db.add(AuditLog(
            timestamp=datetime.datetime(2026, 10, 29, 10, 15, 0),
            org_id=self.org_id,
            node_id="node-a",
            username="test_owner",
            action="TODAY_EVENT",
            target_type="system",
            details="Today log",
        ))
        db.commit()
        db.close()

        # Query single day "2026-10-29"
        res = self.client.get(
            "/api/hub/audit-logs?start_date=2026-10-29&end_date=2026-10-29",
            headers=self.owner_headers,
        )
        self.assertEqual(res.status_code, 200)
        logs = res.json()
        actions = [l["action"] for l in logs]
        self.assertIn("TODAY_EVENT", actions)
        self.assertNotIn("YESTERDAY_EVENT", actions)

    def test_node_session_start_audit_logging(self):
        db = self.TestingSessionLocal()
        node = EnrolledNode(
            node_id="node-test-sso",
            org_id=self.org_id,
            name="Studio Node 1",
            tunnel_secret="secret123",
        )
        db.add(node)
        db.commit()
        db.close()

        res = self.client.get("/api/hub/nodes/node-test-sso/sso-url", headers=self.owner_headers)
        self.assertEqual(res.status_code, 200)

        db = self.TestingSessionLocal()
        audit_entry = (
            db.query(AuditLog)
            .filter(AuditLog.action == "NODE_SESSION_START", AuditLog.node_id == "node-test-sso")
            .first()
        )
        self.assertIsNotNone(audit_entry)
        self.assertEqual(audit_entry.username, "test_owner")
        self.assertIn("Studio Node 1", audit_entry.details)
        db.close()

        # Test disconnect / logout via proxy route
        self.client.post("/proxy/node-test-sso/api/auth/logout", headers=self.owner_headers)

        db = self.TestingSessionLocal()
        disconnect_entry = (
            db.query(AuditLog)
            .filter(AuditLog.action == "NODE_SESSION_END", AuditLog.node_id == "node-test-sso")
            .first()
        )
        self.assertIsNotNone(disconnect_entry)
        self.assertEqual(disconnect_entry.username, "test_owner")
        self.assertIn("closed remote session", disconnect_entry.details)
        db.close()

    def test_logging_setup_captures_info_level(self):
        import logging
        from backend.services.maintenance_scheduler import setup_cloudhub_logging

        with tempfile.TemporaryDirectory() as tmpdir:
            test_log_file = os.path.join(tmpdir, "cloudhub.log")
            setup_cloudhub_logging(log_dir=test_log_file, mode="both", log_level=logging.INFO)

            test_logger = logging.getLogger("cloudhub.unit_test")
            test_logger.info("Informational message for test_logging_setup_captures_info_level")

            for h in logging.getLogger().handlers:
                h.flush()

            self.assertTrue(os.path.exists(test_log_file))
            with open(test_log_file, "r", encoding="utf-8") as f:
                content = f.read()
            self.assertIn("Informational message for test_logging_setup_captures_info_level", content)



    def test_single_event_pdf_generator(self):
        sample_log = {
            "id": 101,
            "timestamp": "2026-10-29T10:00:00Z",
            "channel": "cloudhub",
            "username": "admin",
            "action": "CONFIG_UPDATE",
            "target_type": "settings",
            "target_id": "general",
            "node_id": "node-alpha",
            "ip_address": "192.168.1.100",
            "details": "Operator changed network interface to 0.0.0.0.\nPayload details: { 'ssl': True }",
        }
        gen = AuditSingleEventPdfGenerator(sample_log, {
            "tenant_name": "Test Org",
            "node_name": "Node Alpha",
            "exported_by": "test_owner",
            "app_version": "1.5.2",
        })
        pdf_bytes = gen.build_pdf()
        self.assertTrue(pdf_bytes.startswith(b"%PDF-1.4"))
        self.assertEqual(len(gen.pages), 1)
        self.assertIn(b"%%EOF", pdf_bytes)

    def test_export_single_audit_log_pdf_endpoint(self):
        db = self.TestingSessionLocal()
        entry = AuditLog(
            timestamp=datetime.datetime(2026, 10, 29, 10, 30, 0),
            org_id=self.org_id,
            node_id="node-sample",
            username="test_owner",
            action="SERVICE_CREATE",
            target_type="service",
            target_id="15",
            ip_address="127.0.0.1",
            details="Created SRT listener service on port 9000",
        )
        db.add(entry)
        db.commit()
        db.refresh(entry)
        entry_id = entry.id
        db.close()

        res = self.client.get(
            f"/api/hub/audit-logs/{entry_id}/export-pdf",
            headers=self.owner_headers,
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers.get("content-type"), "application/pdf")
        disp = res.headers.get("content-disposition", "")
        self.assertIn(f"audit_event_{entry_id}_service_create", disp)
        self.assertTrue(res.content.startswith(b"%PDF-1.4"))

    def test_proxy_referer_fallback_routes(self):
        # 1. Without proxy Referer -> 404
        res = self.client.get("/uploads/custom_logo.png")
        self.assertEqual(res.status_code, 404)

        # 2. With proxy Referer -> 307 Redirect to /proxy/{node_id}/uploads/...
        res = self.client.get(
            "/uploads/custom_logo.png",
            headers={"referer": "https://vps1.ecohosting.es/proxy/my-encoder-01/settings"},
            follow_redirects=False,
        )
        self.assertEqual(res.status_code, 307)
        self.assertEqual(res.headers.get("location"), "/proxy/my-encoder-01/uploads/custom_logo.png")

        # 3. Software engine icon with proxy Referer
        res = self.client.get(
            "/api/settings/software/ffmpeg/icon?t=12345",
            headers={"referer": "https://vps1.ecohosting.es/proxy/my-encoder-01/settings/programs"},
            follow_redirects=False,
        )
        self.assertEqual(res.status_code, 307)
        self.assertEqual(
            res.headers.get("location"),
            "/proxy/my-encoder-01/api/settings/software/ffmpeg/icon?t=12345",
        )

        # 4. Favicon with proxy Referer
        res = self.client.get(
            "/favicon.svg",
            headers={"referer": "https://vps1.ecohosting.es/proxy/my-encoder-01/"},
            follow_redirects=False,
        )
        self.assertEqual(res.status_code, 307)
        self.assertEqual(res.headers.get("location"), "/proxy/my-encoder-01/favicon.svg")

    def test_operator_role_forbidden_from_audit_logs(self):
        db = self.TestingSessionLocal()
        operator = User(
            username="operator_jim",
            password_hash=AuthManager.hash_password("OperatorPass123!"),
            role="group_operator",
            org_id=self.org_id,
        )
        db.add(operator)
        db.commit()
        db.refresh(operator)
        op_token = AuthManager.create_session(operator.id, operator.password_hash)
        op_headers = {"Authorization": f"Bearer {op_token}"}
        db.close()

        # 1. Accessing audit log listing -> 403
        res = self.client.get("/api/hub/audit-logs", headers=op_headers)
        self.assertEqual(res.status_code, 403)

        # 2. Accessing audit log PDF export -> 403
        res = self.client.get("/api/hub/audit-logs/export-pdf", headers=op_headers)
        self.assertEqual(res.status_code, 403)

        # 3. Accessing single audit log PDF export -> 403
        res = self.client.get("/api/hub/audit-logs/1/export-pdf", headers=op_headers)
        self.assertEqual(res.status_code, 403)

if __name__ == "__main__":
    unittest.main()
