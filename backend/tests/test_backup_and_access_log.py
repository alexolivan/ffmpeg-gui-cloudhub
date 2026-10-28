"""Unit tests for Backup Export/Import and W3C Access Log Middleware."""

import os
import io
import json
import tempfile
import unittest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.main import app
from backend.database.db import get_db, Base
from backend.database.models import (
    User,
    Organization,
    NodeGroup,
    EnrolledNode,
    SystemSettings,
    AuditLog,
)
from backend.core.auth_manager import AuthManager


class TestBackupAndAccessLog(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.db_path = os.path.join(cls.temp_dir.name, "test_backup.db")
        cls.access_log_path = os.path.join(cls.temp_dir.name, "access.log")
        os.environ["ACCESS_LOG_PATH"] = cls.access_log_path

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
        os.environ.pop("ACCESS_LOG_PATH", None)
        cls.temp_dir.cleanup()

    def setUp(self):
        db = self.TestingSessionLocal()
        db.query(AuditLog).delete()
        db.query(EnrolledNode).delete()
        db.query(NodeGroup).delete()
        db.query(User).delete()
        db.query(Organization).delete()
        db.query(SystemSettings).delete()

        # Seed global setting
        db.add(SystemSettings(key="hub_name", value="Test CloudHub"))

        # Seed Organization 1 (Alpha)
        self.org_alpha = Organization(name="Alpha Org", slug="alpha-org")
        db.add(self.org_alpha)
        db.flush()
        self.org_alpha_id = self.org_alpha.id

        # Seed Organization 2 (Beta)
        self.org_beta = Organization(name="Beta Org", slug="beta-org")
        db.add(self.org_beta)
        db.flush()

        # Seed Groups
        self.grp_alpha = NodeGroup(name="Studio-A", org_id=self.org_alpha.id)
        self.grp_beta = NodeGroup(name="Transcode-B", org_id=self.org_beta.id)
        db.add_all([self.grp_alpha, self.grp_beta])
        db.flush()

        # Seed Nodes
        self.node_alpha = EnrolledNode(
            node_id="node-alpha-001",
            name="Alpha Encoder",
            org_id=self.org_alpha.id,
            group_id=self.grp_alpha.id,
            tunnel_secret="sec_alpha",
        )
        self.node_beta = EnrolledNode(
            node_id="node-beta-001",
            name="Beta Streamer",
            org_id=self.org_beta.id,
            group_id=self.grp_beta.id,
            tunnel_secret="sec_beta",
        )
        db.add_all([self.node_alpha, self.node_beta])

        # Seed Users
        self.superadmin = User(
            username="superowner",
            password_hash=AuthManager.hash_password("SuperSecret123!"),
            role="superadmin",
        )
        self.admin_alpha = User(
            username="alphaadmin",
            password_hash=AuthManager.hash_password("AlphaPass123!"),
            role="org_admin",
            org_id=self.org_alpha.id,
        )
        db.add_all([self.superadmin, self.admin_alpha])
        db.commit()
        db.close()

        # Login superadmin
        res = self.client.post(
            "/api/hub/auth/login",
            json={"username": "superowner", "password": "SuperSecret123!"},
        )
        self.assertEqual(res.status_code, 200)
        self.super_token = res.json()["token"]
        self.super_headers = {"Authorization": f"Bearer {self.super_token}"}

        # Login alpha admin
        res_a = self.client.post(
            "/api/hub/auth/login",
            json={"username": "alphaadmin", "password": "AlphaPass123!"},
        )
        self.assertEqual(res_a.status_code, 200)
        self.alpha_token = res_a.json()["token"]
        self.alpha_headers = {"Authorization": f"Bearer {self.alpha_token}"}

    def test_access_log_middleware_emits_w3c_combined_format(self):
        # Trigger an authenticated API request and a failed login
        self.client.get("/api/hub/settings", headers=self.super_headers)
        self.client.post(
            "/api/hub/auth/login",
            json={"username": "nonexistent", "password": "wrongpassword"},
        )

        self.assertTrue(os.path.exists(self.access_log_path))
        with open(self.access_log_path, "r", encoding="utf-8") as f:
            lines = [l.strip() for l in f.readlines() if l.strip()]

        self.assertGreaterEqual(len(lines), 2)
        # Verify failed login request is recorded with 401 status in W3C format
        failed_lines = [l for l in lines if '"POST /api/hub/auth/login HTTP/1.1" 401' in l]
        self.assertGreaterEqual(len(failed_lines), 1)

    def test_superadmin_exports_full_backup(self):
        res = self.client.post(
            "/api/hub/backup/export",
            headers=self.super_headers,
            json={"scope": "full"},
        )
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["app"], "ffmpeg-gui-cloudhub")
        self.assertEqual(data["scope"], "full")
        self.assertIn("system_settings", data["sections"])
        self.assertEqual(len(data["sections"]["organizations"]), 2)
        self.assertEqual(len(data["sections"]["groups"]), 2)
        self.assertEqual(len(data["sections"]["nodes"]), 2)

    def test_org_admin_exports_only_own_tenant_data(self):
        res = self.client.post(
            "/api/hub/backup/export",
            headers=self.alpha_headers,
            json={"scope": "full"},  # Even if requested full, must force tenant scope
        )
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["scope"], "tenant")
        self.assertEqual(data["tenant"]["slug"], "alpha-org")
        # Global system settings must be empty
        self.assertEqual(data["sections"]["system_settings"], {})
        # Only Alpha organization
        self.assertEqual(len(data["sections"]["organizations"]), 1)
        self.assertEqual(data["sections"]["organizations"][0]["slug"], "alpha-org")
        # Only Alpha group and node
        self.assertEqual(len(data["sections"]["groups"]), 1)
        self.assertEqual(data["sections"]["groups"][0]["name"], "Studio-A")
        self.assertEqual(len(data["sections"]["nodes"]), 1)
        self.assertEqual(data["sections"]["nodes"][0]["node_id"], "node-alpha-001")

    def test_validate_backup_rejects_non_cloudhub_file(self):
        invalid_payload = {"app": "some-other-app", "version": "1.0"}
        res = self.client.post(
            "/api/hub/backup/validate",
            headers=self.super_headers,
            json=invalid_payload,
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("Invalid backup file signature", res.json()["detail"])

    def test_validate_backup_rejects_full_backup_for_tenant_admin(self):
        full_payload = {
            "app": "ffmpeg-gui-cloudhub",
            "version": "1.4.0",
            "scope": "full",
            "sections": {},
        }
        res = self.client.post(
            "/api/hub/backup/validate",
            headers=self.alpha_headers,
            json=full_payload,
        )
        self.assertEqual(res.status_code, 403)
        self.assertIn("cannot restore a Full Platform Backup", res.json()["detail"])

    def test_import_tenant_backup_atomic_restoration(self):
        tenant_payload = {
            "app": "ffmpeg-gui-cloudhub",
            "version": "1.4.0",
            "scope": "tenant",
            "tenant": {"name": "Alpha Org", "slug": "alpha-org"},
            "sections": {
                "groups": [{"name": "NewStudio-2", "icon_data": "studio"}],
                "nodes": [
                    {
                        "node_id": "node-alpha-new99",
                        "name": "Live Enrolled Encoder",
                        "group_name": "NewStudio-2",
                        "tunnel_secret": "tok_99",
                    }
                ],
                "users": [
                    {
                        "username": "newoperator99",
                        "password_hash": AuthManager.hash_password("OpPass123!"),
                        "role": "group_operator",
                        "group_names": ["NewStudio-2"],
                    }
                ],
            },
        }

        res = self.client.post(
            "/api/hub/backup/import",
            headers=self.alpha_headers,
            json=tenant_payload,
        )
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["summary"]["groups"], 1)
        self.assertEqual(data["summary"]["nodes"], 1)
        self.assertEqual(data["summary"]["users"], 1)

        # Verify DB persisted
        db = self.TestingSessionLocal()
        node = db.query(EnrolledNode).filter(EnrolledNode.node_id == "node-alpha-new99").first()
        self.assertIsNotNone(node)
        self.assertEqual(node.name, "Live Enrolled Encoder")
        self.assertEqual(node.org_id, self.org_alpha_id)

        user = db.query(User).filter(User.username == "newoperator99").first()
        self.assertIsNotNone(user)
        self.assertEqual(user.role, "group_operator")
        self.assertEqual(user.org_id, self.org_alpha_id)
        db.close()
