"""Unit tests for models, RBAC, authentication, security guard, and admin CLI."""

import os
import time
import unittest
from datetime import datetime, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.database.models import (
    Base,
    User,
    Organization,
    NodeGroup,
    UserGroupPermission,
    EnrollmentToken,
    EnrolledNode,
)
from backend.database.db import init_db
from backend.core.auth_manager import AuthManager
from backend.core.security_guard import SecurityGuard
from backend.cli import reset_admin_password, create_superadmin


class TestModelsAndRBAC(unittest.TestCase):
    def setUp(self):
        # Use an in-memory SQLite database for test isolation
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(bind=self.engine)
        self.SessionFactory = sessionmaker(bind=self.engine)
        self.db = self.SessionFactory()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_init_db_creates_bootstrap_superadmin(self):
        test_engine = create_engine("sqlite:///:memory:")
        try:
            init_db(db_engine=test_engine)

            Session = sessionmaker(bind=test_engine)
            with Session() as session:
                admin = session.query(User).filter(User.role == "superadmin").first()
                self.assertIsNotNone(admin)
                self.assertEqual(admin.username, "admin")
                self.assertTrue(AuthManager.verify_password("cloudhubadmin", admin.password_hash))
        finally:
            test_engine.dispose()

    def test_password_hashing_and_verification(self):
        pwd = "SecretPassword123!"
        hashed = AuthManager.hash_password(pwd)
        self.assertTrue(hashed.startswith("pbkdf2:sha256:"))
        self.assertTrue(AuthManager.verify_password(pwd, hashed))
        self.assertFalse(AuthManager.verify_password("WrongPassword", hashed))
        self.assertFalse(AuthManager.verify_password("", hashed))
        self.assertFalse(AuthManager.verify_password(pwd, "invalid_hash_string"))

    def test_session_lifecycle_and_invalidation_on_password_change(self):
        user = User(
            id=1,
            username="operator1",
            password_hash=AuthManager.hash_password("OldPassword123"),
            role="group_operator",
        )
        self.db.add(user)
        self.db.commit()

        # Generate session
        token = AuthManager.create_session(user.id, user.password_hash, expiry_seconds=3600)
        self.assertIsNotNone(token)

        # Validate session
        def lookup(uid: int):
            return self.db.query(User).filter(User.id == uid).first()

        validated_user = AuthManager.validate_session(token, lookup)
        self.assertIsNotNone(validated_user)
        self.assertEqual(validated_user.username, "operator1")

        # Expired token test
        expired_token = AuthManager.create_session(user.id, user.password_hash, expiry_seconds=-10)
        self.assertIsNone(AuthManager.validate_session(expired_token, lookup))

        # Tampered token test
        tampered_token = token[:-4] + "ffff"
        self.assertIsNone(AuthManager.validate_session(tampered_token, lookup))

        # Password change must invalidate old token immediately
        user.password_hash = AuthManager.hash_password("NewPassword456")
        self.db.commit()

        # Previous token is now invalid!
        self.assertIsNone(AuthManager.validate_session(token, lookup))

    def test_rbac_can_user_access_node(self):
        # Create Organizations
        org_a = Organization(name="Radio A", slug="radio-a")
        org_b = Organization(name="Radio B", slug="radio-b")
        self.db.add_all([org_a, org_b])
        self.db.commit()

        # Create Groups
        group_a1 = NodeGroup(name="Studio 1", org_id=org_a.id)
        group_a2 = NodeGroup(name="Transmitter", org_id=org_a.id)
        group_b1 = NodeGroup(name="Main Hub", org_id=org_b.id)
        self.db.add_all([group_a1, group_a2, group_b1])
        self.db.commit()

        # Create Nodes
        node_a_grouped = EnrolledNode(
            node_id="ch_node_a1",
            name="Studio 1 On-Air",
            org_id=org_a.id,
            group_id=group_a1.id,
            tunnel_secret="secret_a1",
        )
        node_a_ungrouped = EnrolledNode(
            node_id="ch_node_a2",
            name="Unassigned Standby",
            org_id=org_a.id,
            group_id=None,
            tunnel_secret="secret_a2",
        )
        node_b = EnrolledNode(
            node_id="ch_node_b1",
            name="Radio B Master",
            org_id=org_b.id,
            group_id=group_b1.id,
            tunnel_secret="secret_b1",
        )
        self.db.add_all([node_a_grouped, node_a_ungrouped, node_b])
        self.db.commit()

        # Create Users
        superadmin = User(username="root", password_hash="hash", role="superadmin", org_id=None)
        org_a_admin = User(username="admin_a", password_hash="hash", role="org_admin", org_id=org_a.id)
        org_b_admin = User(username="admin_b", password_hash="hash", role="org_admin", org_id=org_b.id)
        operator_a1 = User(username="op_a1", password_hash="hash", role="group_operator", org_id=org_a.id)
        self.db.add_all([superadmin, org_a_admin, org_b_admin, operator_a1])
        self.db.commit()

        # Grant operator_a1 access ONLY to group_a1
        perm = UserGroupPermission(user_id=operator_a1.id, group_id=group_a1.id)
        self.db.add(perm)
        self.db.commit()

        # 1. Superadmin accesses everything
        self.assertTrue(AuthManager.can_user_access_node(self.db, superadmin, node_a_grouped))
        self.assertTrue(AuthManager.can_user_access_node(self.db, superadmin, node_a_ungrouped))
        self.assertTrue(AuthManager.can_user_access_node(self.db, superadmin, node_b))

        # 2. Org Admin accesses grouped and ungrouped nodes in own org, but NOT other orgs
        self.assertTrue(AuthManager.can_user_access_node(self.db, org_a_admin, node_a_grouped))
        self.assertTrue(AuthManager.can_user_access_node(self.db, org_a_admin, node_a_ungrouped))
        self.assertFalse(AuthManager.can_user_access_node(self.db, org_a_admin, node_b))
        self.assertFalse(AuthManager.can_user_access_node(self.db, org_b_admin, node_a_grouped))

        # 3. Group Operator accesses only assigned groups in own org
        self.assertTrue(AuthManager.can_user_access_node(self.db, operator_a1, node_a_grouped))
        # Denied on ungrouped nodes
        self.assertFalse(AuthManager.can_user_access_node(self.db, operator_a1, node_a_ungrouped))
        # Denied on nodes in another group
        node_a_trans = EnrolledNode(
            node_id="ch_node_a_trans",
            name="Transmitter 1",
            org_id=org_a.id,
            group_id=group_a2.id,
            tunnel_secret="secret_trans",
        )
        self.db.add(node_a_trans)
        self.db.commit()
        self.assertFalse(AuthManager.can_user_access_node(self.db, operator_a1, node_a_trans))
        # Denied on another org
        self.assertFalse(AuthManager.can_user_access_node(self.db, operator_a1, node_b))

    def test_sso_assertion_and_edge_handshake(self):
        node_id = "ch_node_1001"
        secret = "super_tunnel_secret_abc123"
        username = "sound_engineer"

        # Create SSO assertion
        assertion = AuthManager.create_sso_assertion(node_id, secret, username, ttl_seconds=60)
        parts = assertion.split(":")
        self.assertEqual(len(parts), 5)
        self.assertEqual(parts[0], node_id)
        self.assertEqual(parts[1], username)

        # Edge handshake verification
        now = str(int(time.time()))
        import hmac, hashlib
        sig = hmac.new(secret.encode("utf-8"), f"{node_id}:{now}".encode("utf-8"), hashlib.sha256).hexdigest()

        self.assertTrue(AuthManager.verify_edge_handshake(node_id, now, sig, secret))
        # Replay attack protection with stale timestamp
        stale_ts = str(int(time.time()) - 120)
        stale_sig = hmac.new(secret.encode("utf-8"), f"{node_id}:{stale_ts}".encode("utf-8"), hashlib.sha256).hexdigest()
        self.assertFalse(AuthManager.verify_edge_handshake(node_id, stale_ts, stale_sig, secret))

        # Invalid signature
        self.assertFalse(AuthManager.verify_edge_handshake(node_id, now, "bad_sig", secret))

    def test_security_guard_lockout_and_reset(self):
        guard = SecurityGuard(max_failures=3, lockout_duration_seconds=60)
        ip = "192.168.1.50"
        user = "admin"

        # Attempt 1 & 2
        locked, _ = guard.record_failure(ip, user)
        self.assertFalse(locked)
        locked, _ = guard.record_failure(ip, user)
        self.assertFalse(locked)

        # Attempt 3 -> Locked!
        locked, remaining = guard.record_failure(ip, user)
        self.assertTrue(locked)
        self.assertGreater(remaining, 50)

        is_locked, _ = guard.is_locked(ip, user)
        self.assertTrue(is_locked)

        # Reset lockouts
        cleared = guard.reset_lockouts(user)
        self.assertEqual(cleared, 1)

        is_locked_after, _ = guard.is_locked(ip, user)
        self.assertFalse(is_locked_after)

    def test_cli_reset_admin_password_and_create_superadmin(self):
        user = User(
            username="admin_rescue",
            password_hash=AuthManager.hash_password("OldPassword"),
            role="superadmin",
        )
        self.db.add(user)
        self.db.commit()

        # Reset password
        ok = reset_admin_password(self.db, "admin_rescue", "NewStrongPassword789!")
        self.assertTrue(ok)

        # Verify in DB
        updated = self.db.query(User).filter(User.username == "admin_rescue").first()
        self.assertTrue(AuthManager.verify_password("NewStrongPassword789!", updated.password_hash))

        # Create new superadmin
        ok_create = create_superadmin(self.db, "second_admin", "SecondPassword999!")
        self.assertTrue(ok_create)
        second = self.db.query(User).filter(User.username == "second_admin").first()
        self.assertIsNotNone(second)
        self.assertEqual(second.role, "superadmin")


if __name__ == "__main__":
    unittest.main()
