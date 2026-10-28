"""Unit tests for CertificateManager and SSL management endpoints."""

import os
import shutil
import tempfile
import unittest
from unittest.mock import patch, MagicMock

from backend.services.cert_manager import CertificateManager


class TestCertificateManager(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp(prefix="cloudhub_cert_test_")
        self.mgr = CertificateManager(certs_dir=self.test_dir)

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_missing_cert_status(self):
        status = self.mgr.get_cert_status()
        self.assertEqual(status["status"], "missing")
        self.assertFalse(status["valid"])
        self.assertEqual(status["days_remaining"], 0)

    def test_save_and_delete_custom_cert(self):
        # Generate self-signed cert and key for test
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        import datetime

        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        subject = issuer = x509.Name([
            x509.NameAttribute(NameOID.COMMON_NAME, u"test.cloudhub.local"),
        ])
        cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(issuer)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(datetime.datetime.now(datetime.timezone.utc))
            .not_valid_after(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=60))
            .sign(key, hashes.SHA256())
        )

        cert_bytes = cert.public_bytes(serialization.Encoding.PEM)
        key_bytes = key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )

        saved, err = self.mgr.save_custom_cert(cert_bytes, key_bytes, mode="custom")
        self.assertTrue(saved, f"Error saving cert: {err}")
        self.assertTrue(os.path.exists(self.mgr.fullchain_path))
        self.assertTrue(os.path.exists(self.mgr.privkey_path))

        status = self.mgr.get_cert_status()
        self.assertTrue(status["valid"])
        self.assertEqual(status["mode"], "custom")
        self.assertGreater(status["days_remaining"], 50)

        # Delete cert
        del_ok, del_err = self.mgr.delete_cert()
        self.assertTrue(del_ok)
        self.assertFalse(os.path.exists(self.mgr.fullchain_path))
        self.assertFalse(os.path.exists(self.mgr.privkey_path))

    @patch("acme.client.ClientV2")
    def test_acme_validation_failure_on_invalid_domain(self, mock_acme):
        ok, msg = self.mgr.renew_acme_certificate("", "admin@example.com")
        self.assertFalse(ok)
        self.assertIn("valid public Domain Name", msg)

        ok2, msg2 = self.mgr.renew_acme_certificate("localhost", "admin@example.com")
        self.assertFalse(ok2)

    def test_leftover_staging_cert_is_automatically_purged_from_status(self):
        """Ensures any leftover staging/dry-run certificate on disk is purged and not reported as valid."""
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        import datetime

        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, u"staging.cloudhub.local")])
        issuer = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, u"(STAGING) Counterfeit Cashew R10")])
        cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(issuer)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(datetime.datetime.now(datetime.timezone.utc))
            .not_valid_after(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=60))
            .sign(key, hashes.SHA256())
        )
        cert_bytes = cert.public_bytes(serialization.Encoding.PEM)
        key_bytes = key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )
        saved, _ = self.mgr.save_custom_cert(
            cert_bytes, key_bytes, mode="acme", extra_meta={"staging": True}
        )
        self.assertTrue(saved)
        self.assertTrue(os.path.exists(self.mgr.fullchain_path))

        status = self.mgr.get_cert_status()
        self.assertFalse(status["valid"])
        self.assertEqual(status["status"], "missing")
        self.assertFalse(os.path.exists(self.mgr.fullchain_path))


class TestSslApiRoutes(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from backend.main import app
        from backend.database.db import get_db
        from backend.database.models import Base, User
        from backend.core.auth_manager import AuthManager

        from sqlalchemy.pool import StaticPool
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        self.SessionFactory = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)
        Base.metadata.create_all(bind=self.engine)

        def override_get_db():
            db = self.SessionFactory()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)

        with self.SessionFactory() as db:
            u = User(
                username="ssl_admin",
                password_hash=AuthManager.hash_password("SuperSecret123!"),
                role="superadmin",
            )
            db.add(u)
            db.commit()

        login_resp = self.client.post(
            "/api/hub/auth/login",
            json={"username": "ssl_admin", "password": "SuperSecret123!"},
        )
        token = login_resp.json()["token"]
        self.headers = {"Authorization": f"Bearer {token}"}

    def tearDown(self):
        from backend.main import app
        app.dependency_overrides.clear()
        self.engine.dispose()

    def test_get_ssl_status_endpoint(self):
        resp = self.client.get("/api/hub/settings/ssl/status", headers=self.headers)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("status", data)
        self.assertIn("valid", data)

    def test_issue_acme_missing_domain_returns_400(self):
        resp = self.client.post(
            "/api/hub/settings/ssl/issue-acme",
            headers=self.headers,
            json={"domain": "", "email": ""},
        )
        self.assertEqual(resp.status_code, 400)

    def test_network_interfaces_endpoint(self):
        resp = self.client.get("/api/hub/settings/network/interfaces", headers=self.headers)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("interfaces", data)
        self.assertIsInstance(data["interfaces"], list)

    def test_cannot_enable_ssl_without_valid_cert(self):
        with patch("backend.routers.settings_routes.cert_manager.get_cert_status", return_value={"valid": False, "status": "missing"}):
            resp = self.client.put(
                "/api/hub/settings",
                headers=self.headers,
                json={"settings": {"ssl_enabled": True, "https_port": 9443}},
            )
            self.assertEqual(resp.status_code, 400)
            self.assertIn("without a valid active SSL certificate", resp.json()["detail"])


if __name__ == "__main__":
    unittest.main()
