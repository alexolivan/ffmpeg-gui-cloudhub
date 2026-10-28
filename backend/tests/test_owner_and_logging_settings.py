"""Unit tests for Owner Credentials, Logo Upload, and Logging Path settings."""

import os
import io
import tempfile
import unittest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.main import app
from backend.database.db import get_db, Base
from backend.database.models import User, SystemSettings
from backend.core.auth_manager import AuthManager
import backend.routers.settings_routes as settings_routes


class TestOwnerAndLoggingSettings(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.db_path = os.path.join(cls.temp_dir.name, "test_hub.db")
        cls.upload_dir = os.path.join(cls.temp_dir.name, "uploads")
        os.makedirs(cls.upload_dir, exist_ok=True)
        cls.orig_upload_dir = settings_routes.UPLOAD_DIR
        settings_routes.UPLOAD_DIR = cls.upload_dir

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
        settings_routes.UPLOAD_DIR = cls.orig_upload_dir
        app.dependency_overrides.clear()
        cls.temp_dir.cleanup()

    def setUp(self):
        db = self.TestingSessionLocal()
        db.query(User).delete()
        db.query(SystemSettings).delete()

        # Create superadmin owner
        self.superadmin = User(
            username="superowner",
            password_hash=AuthManager.hash_password("SuperSecret123!"),
            role="superadmin",
        )
        # Create normal viewer
        self.viewer = User(
            username="normalviewer",
            password_hash=AuthManager.hash_password("ViewerPass123!"),
            role="viewer",
        )
        db.add_all([self.superadmin, self.viewer])
        db.commit()
        db.close()

        # Login superadmin
        res = self.client.post(
            "/api/hub/auth/login",
            json={"username": "superowner", "password": "SuperSecret123!"},
        )
        self.assertEqual(res.status_code, 200)
        self.superadmin_token = res.json()["token"]
        self.superadmin_headers = {"Authorization": f"Bearer {self.superadmin_token}"}

        # Login viewer
        res = self.client.post(
            "/api/hub/auth/login",
            json={"username": "normalviewer", "password": "ViewerPass123!"},
        )
        self.assertEqual(res.status_code, 200)
        self.viewer_token = res.json()["token"]
        self.viewer_headers = {"Authorization": f"Bearer {self.viewer_token}"}

    def test_update_owner_credentials_success(self):
        # Update username to 'masteradmin' and change password
        res = self.client.put(
            "/api/hub/auth/owner-profile",
            headers=self.superadmin_headers,
            json={
                "current_password": "SuperSecret123!",
                "new_username": "masteradmin",
                "new_password": "NewSecretPassword99!",
            },
        )
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["user"]["username"], "masteradmin")

        # Verify old password fails
        res_old = self.client.post(
            "/api/hub/auth/login",
            json={"username": "masteradmin", "password": "SuperSecret123!"},
        )
        self.assertEqual(res_old.status_code, 401)

        # Verify new credentials work
        res_new = self.client.post(
            "/api/hub/auth/login",
            json={"username": "masteradmin", "password": "NewSecretPassword99!"},
        )
        self.assertEqual(res_new.status_code, 200)

    def test_update_owner_credentials_wrong_current_password(self):
        res = self.client.put(
            "/api/hub/auth/owner-profile",
            headers=self.superadmin_headers,
            json={
                "current_password": "WrongPassword!",
                "new_username": "shouldfail",
            },
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("Incorrect current password", res.json()["detail"])

    def test_update_owner_credentials_duplicate_username(self):
        res = self.client.put(
            "/api/hub/auth/owner-profile",
            headers=self.superadmin_headers,
            json={
                "current_password": "SuperSecret123!",
                "new_username": "normalviewer",
            },
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("already taken", res.json()["detail"])

    def test_viewer_forbidden_from_owner_profile(self):
        res = self.client.put(
            "/api/hub/auth/owner-profile",
            headers=self.viewer_headers,
            json={
                "current_password": "ViewerPass123!",
                "new_username": "hackedowner",
            },
        )
        self.assertEqual(res.status_code, 403)

    def test_logo_upload_serve_and_delete(self):
        # Create dummy PNG image bytes
        from PIL import Image
        img = Image.new("RGBA", (64, 64), color=(212, 255, 91, 255))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)

        # Upload logo as superadmin
        res = self.client.post(
            "/api/hub/settings/logo",
            headers=self.superadmin_headers,
            files={"file": ("test_logo.png", buf.getvalue(), "image/png")},
        )
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["status"], "ok")
        self.assertEqual(res.json()["logo_url"], "/api/hub/settings/logo/file")

        # Fetch served logo file (unauthenticated)
        res_file = self.client.get("/api/hub/settings/logo/file")
        self.assertEqual(res_file.status_code, 200)
        self.assertEqual(res_file.headers.get("content-type"), "image/png")

        # Delete logo
        res_del = self.client.delete("/api/hub/settings/logo", headers=self.superadmin_headers)
        self.assertEqual(res_del.status_code, 200)

        # Fetch after delete returns 404
        res_file_after = self.client.get("/api/hub/settings/logo/file")
        self.assertEqual(res_file_after.status_code, 404)

    def test_logging_test_path_endpoint(self):
        test_dir = os.path.join(self.temp_dir.name, "custom_logs")
        res = self.client.post(
            "/api/hub/settings/logging/test-path",
            headers=self.superadmin_headers,
            json={"path": test_dir},
        )
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertTrue(data["writable"])
        self.assertEqual(data["resolved_path"], os.path.abspath(test_dir))

    def test_logging_settings_update(self):
        res = self.client.put(
            "/api/hub/settings",
            headers=self.superadmin_headers,
            json={
                "settings": {
                    "logging_mode": "file",
                    "logging_timestamp_tz": "local",
                    "logging_path": os.path.join(self.temp_dir.name, "logs"),
                    "logging_rotation_enabled": True,
                    "logging_rotation_max_bytes": 5242880,
                    "logging_rotation_backup_count": 3,
                }
            },
        )
        self.assertEqual(res.status_code, 200)
        settings = res.json()["settings"]
        self.assertEqual(settings["logging_mode"], "file")
        self.assertEqual(settings["logging_timestamp_tz"], "local")
        self.assertEqual(settings["logging_rotation_max_bytes"], 5242880)
