"""Integration tests for Multi-Tenant REST API, Enrollment, and Telemetry."""

import time
import hmac
import hashlib
import unittest
from datetime import datetime, timedelta, timezone
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.database.models import (
    Base,
    User,
    Organization,
    NodeGroup,
    EnrolledNode,
    EnrollmentToken,
)
from backend.database.db import get_db
from backend.core.auth_manager import AuthManager
from backend.core.telemetry_collector import telemetry_collector
from backend.main import app


class TestHubApiAndEnrollment(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        self.SessionFactory = sessionmaker(bind=self.engine)

        def override_get_db():
            db = self.SessionFactory()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)

        # Seed superadmin
        with self.SessionFactory() as db:
            self.superadmin = User(
                username="superadmin",
                password_hash=AuthManager.hash_password("SuperSecret123!"),
                role="superadmin",
            )
            db.add(self.superadmin)
            db.commit()
            db.refresh(self.superadmin)
            self.superadmin_id = self.superadmin.id
            self.superadmin_hash = self.superadmin.password_hash

        # Superadmin session token
        self.superadmin_token = AuthManager.create_session(
            self.superadmin_id, self.superadmin_hash
        )

    def tearDown(self):
        app.dependency_overrides.clear()
        self.engine.dispose()

    def test_health_endpoint(self):
        from backend.version import __version__
        resp = self.client.get("/api/health")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "healthy")
        self.assertEqual(data["version"], __version__)

    def test_create_organization_atomic_admin(self):
        # 1. Superadmin creates organization
        headers = {"Authorization": f"Bearer {self.superadmin_token}"}
        payload = {
            "name": "Radio Delta",
            "slug": "radio-delta",
            "admin_username": "admin_delta",
            "admin_password": "DeltaPassword123!",
        }
        resp = self.client.post("/api/hub/orgs", json=payload, headers=headers)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["organization"]["slug"], "radio-delta")
        self.assertEqual(data["admin_user"]["username"], "admin_delta")

        # 2. Login with newly created org_admin
        login_resp = self.client.post(
            "/api/hub/auth/login",
            json={"username": "admin_delta", "password": "DeltaPassword123!"},
        )
        self.assertEqual(login_resp.status_code, 200)
        login_data = login_resp.json()
        self.assertEqual(login_data["user"]["role"], "org_admin")
        self.assertEqual(login_data["user"]["org_id"], data["organization"]["id"])

    def test_strict_tenant_isolation(self):
        # Setup Radio A and Radio B
        headers_root = {"Authorization": f"Bearer {self.superadmin_token}"}
        resp_a = self.client.post(
            "/api/hub/orgs",
            json={"name": "Radio A", "slug": "radio-a", "admin_password": "PasswordA123!"},
            headers=headers_root,
        )
        org_a_id = resp_a.json()["organization"]["id"]

        resp_b = self.client.post(
            "/api/hub/orgs",
            json={"name": "Radio B", "slug": "radio-b", "admin_password": "PasswordB123!"},
            headers=headers_root,
        )
        org_b_id = resp_b.json()["organization"]["id"]

        # Login as Admin A
        login_a = self.client.post(
            "/api/hub/auth/login",
            json={"username": "admin_radio-a", "password": "PasswordA123!"},
        )
        token_a = login_a.json()["token"]
        headers_a = {"Authorization": f"Bearer {token_a}"}

        # Admin A tries to create a group in Radio B -> 403 Forbidden!
        bad_group_resp = self.client.post(
            f"/api/hub/orgs/{org_b_id}/groups",
            json={"name": "Hacked Group"},
            headers=headers_a,
        )
        self.assertEqual(bad_group_resp.status_code, 403)

        # Admin A creates group in Radio A -> 200 OK
        good_group_resp = self.client.post(
            f"/api/hub/orgs/{org_a_id}/groups",
            json={"name": "Main Studio"},
            headers=headers_a,
        )
        self.assertEqual(good_group_resp.status_code, 200)

    def test_enrollment_ceremony_and_single_use_token(self):
        headers_root = {"Authorization": f"Bearer {self.superadmin_token}"}
        resp_org = self.client.post(
            "/api/hub/orgs",
            json={"name": "Tenant One", "slug": "tenant-one", "admin_password": "Password123!"},
            headers=headers_root,
        )
        org_id = resp_org.json()["organization"]["id"]

        # Generate enrollment token
        token_resp = self.client.post(
            "/api/hub/enrollment-tokens",
            json={"org_id": org_id, "validity_hours": 2},
            headers=headers_root,
        )
        self.assertEqual(token_resp.status_code, 200)
        token_str = token_resp.json()["token"]

        # 1. Edge calls enroll -> 200 OK
        enroll_payload = {
            "token": token_str,
            "name": "Edge Playout Node 1",
            "current_version": "2.50.0",
        }
        enroll_resp = self.client.post("/api/edge/enroll", json=enroll_payload)
        self.assertEqual(enroll_resp.status_code, 200)
        enroll_data = enroll_resp.json()
        self.assertTrue(enroll_data["node_id"].startswith("ch_node_"))
        self.assertIn("tunnel_secret", enroll_data)

        # 2. Second attempt with same token -> 409 Conflict
        second_resp = self.client.post("/api/edge/enroll", json=enroll_payload)
        self.assertEqual(second_resp.status_code, 409)

        # 3. Test expired token
        with self.SessionFactory() as db:
            exp_token = EnrollmentToken(
                token="ch_enr_expired_test",
                org_id=org_id,
                expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
                used=False,
            )
            db.add(exp_token)
            db.commit()

        exp_resp = self.client.post(
            "/api/edge/enroll",
            json={"token": "ch_enr_expired_test", "name": "Expired Node"},
        )
        self.assertEqual(exp_resp.status_code, 401)

    def test_telemetry_collector_and_vitality_states(self):
        # Direct TelemetryCollector checks
        node_id = "ch_node_test_vitality"

        # 1. Online: Normal CPU, 0 errors, <30s ago
        heartbeat_payload = {
            "current_version": "2.50.0",
            "system": {"cpu_percent": 15.2, "memory_percent": 42.0},
            "workload": {"total_services": 3, "services_running": 3, "services_error": 0},
        }
        v_online = telemetry_collector.record_heartbeat(node_id, heartbeat_payload)
        self.assertEqual(v_online["status"], "online")

        # 2. Degraded: 1 service in error
        heartbeat_payload["workload"]["services_error"] = 1
        v_deg = telemetry_collector.record_heartbeat(node_id, heartbeat_payload)
        self.assertEqual(v_deg["status"], "degraded")

        # 3. Degraded: CPU > 90%
        heartbeat_payload["workload"]["services_error"] = 0
        heartbeat_payload["system"]["cpu_percent"] = 94.5
        v_deg_cpu = telemetry_collector.record_heartbeat(node_id, heartbeat_payload)
        self.assertEqual(v_deg_cpu["status"], "degraded")

        # 4. Offline: explicitly marked disconnected
        telemetry_collector.mark_disconnected(node_id)
        v_off = telemetry_collector.get_node_vitality(node_id)
        self.assertEqual(v_off["status"], "offline")

    def test_edge_heartbeat_api_and_handshake(self):
        # Create enrolled node in DB
        with self.SessionFactory() as db:
            org = Organization(name="Org Heartbeat", slug="org-hb")
            db.add(org)
            db.flush()
            node = EnrolledNode(
                node_id="ch_node_hb_1",
                name="Node HB 1",
                org_id=org.id,
                tunnel_secret="secret_hb_key_12345",
            )
            db.add(node)
            db.commit()

        # Send valid heartbeat
        now_ts = str(int(time.time()))
        sig = hmac.new(
            b"secret_hb_key_12345",
            f"ch_node_hb_1:{now_ts}".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

        hb_headers = {
            "X-Node-ID": "ch_node_hb_1",
            "X-Timestamp": now_ts,
            "X-Signature": sig,
        }
        hb_body = {
            "current_version": "2.50.0",
            "system": {"cpu_percent": 25.0, "memory_percent": 50.0},
            "workload": {"services_error": 0},
        }

        resp = self.client.post("/api/edge/heartbeat", json=hb_body, headers=hb_headers)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["vitality"]["status"], "online")

        # Replay / bad signature fails
        bad_headers = {
            "X-Node-ID": "ch_node_hb_1",
            "X-Timestamp": now_ts,
            "X-Signature": "bad_sig_12345",
        }
        resp_bad = self.client.post("/api/edge/heartbeat", json=hb_body, headers=bad_headers)
        self.assertEqual(resp_bad.status_code, 401)

    def test_org_update_and_user_endpoints(self):
        token = self.superadmin_token
        headers = {"Authorization": f"Bearer {token}"}

        # 1. Create Org with icon_data
        create_org_resp = self.client.post(
            "/api/hub/orgs",
            json={
                "name": "Channel Alpha",
                "slug": "channel-alpha",
                "icon_data": "CA",
                "admin_password": "AlphaPassword123!",
            },
            headers=headers,
        )
        self.assertEqual(create_org_resp.status_code, 200)
        org_id = create_org_resp.json()["organization"]["id"]

        # 2. Update Org (Name and icon_data)
        update_org_resp = self.client.put(
            f"/api/hub/orgs/{org_id}",
            json={"name": "Channel Alpha HD", "icon_data": "data:image/png;base64,iVBORw0KGgo="},
            headers=headers,
        )
        self.assertEqual(update_org_resp.status_code, 200)
        self.assertEqual(update_org_resp.json()["organization"]["name"], "Channel Alpha HD")
        self.assertEqual(update_org_resp.json()["organization"]["icon_data"], "data:image/png;base64,iVBORw0KGgo=")

        # 3. Create global user via POST /api/hub/users
        create_user_resp = self.client.post(
            "/api/hub/users",
            json={
                "username": "alpha_operator_1",
                "password": "OperatorSecret123!",
                "role": "group_operator",
                "org_id": org_id,
            },
            headers=headers,
        )
        self.assertEqual(create_user_resp.status_code, 200)

        # 4. Attempting to create superadmin via user endpoint fails validation
        bad_role_resp = self.client.post(
            "/api/hub/users",
            json={
                "username": "rogue_superadmin",
                "password": "Password123!",
                "role": "superadmin",
                "org_id": org_id,
            },
            headers=headers,
        )
        self.assertEqual(bad_role_resp.status_code, 422)

        # 5. List users via GET /api/hub/users
        list_users_resp = self.client.get(f"/api/hub/users?org_id={org_id}", headers=headers)
        self.assertEqual(list_users_resp.status_code, 200)
        users = list_users_resp.json()
        usernames = [u["username"] for u in users]
        self.assertIn("alpha_operator_1", usernames)
        op_user = next(u for u in users if u["username"] == "alpha_operator_1")

        # 6. Update user (rename username) via PUT /api/hub/users/{id}
        rename_resp = self.client.put(
            f"/api/hub/users/{op_user['id']}",
            json={"username": "alpha_operator_renamed"},
            headers=headers,
        )
        self.assertEqual(rename_resp.status_code, 200)

        # 7. Verify updated username is reflected
        verify_resp = self.client.get(f"/api/hub/users?org_id={org_id}", headers=headers)
        renamed_users = [u["username"] for u in verify_resp.json()]
        self.assertIn("alpha_operator_renamed", renamed_users)
        self.assertNotIn("alpha_operator_1", renamed_users)

        # 8. Duplicate username conflict check -> 409
        admin_id = create_org_resp.json()["admin_user"]["id"]
        dup_resp = self.client.put(
            f"/api/hub/users/{admin_id}",
            json={"username": "alpha_operator_renamed"},
            headers=headers,
        )
        self.assertEqual(dup_resp.status_code, 409)

        # 9. Prepare users for tenant slug cascade rename test
        self.client.put(
            f"/api/hub/users/{op_user['id']}",
            json={"username": "channel-alpha_op1"},
            headers=headers,
        )

        # 10. Create second org to test slug collision
        create_beta_resp = self.client.post(
            "/api/hub/orgs",
            json={
                "name": "Channel Beta",
                "slug": "channel-beta",
                "admin_password": "BetaPassword123!",
            },
            headers=headers,
        )
        self.assertEqual(create_beta_resp.status_code, 200)

        # 11. Slug collision check: trying to set existing slug -> 409
        collision_resp = self.client.put(
            f"/api/hub/orgs/{org_id}",
            json={"slug": "channel-beta"},
            headers=headers,
        )
        self.assertEqual(collision_resp.status_code, 409)

        # 12. Cannot modify default org slug -> 400
        with self.SessionFactory() as db:
            default_org = Organization(name="Default Virtual", slug="default")
            db.add(default_org)
            db.commit()
            default_org_id = default_org.id

        default_org_resp = self.client.put(
            f"/api/hub/orgs/{default_org_id}",
            json={"slug": "new-default"},
            headers=headers,
        )
        self.assertEqual(default_org_resp.status_code, 400)

        # 13. Tenant Admin cannot modify slug -> 403
        beta_admin_token = create_beta_resp.json()["admin_user"]
        # Login as beta admin to get token
        login_resp = self.client.post(
            "/api/hub/auth/login",
            json={"username": "admin_channel-beta", "password": "BetaPassword123!"},
        )
        self.assertEqual(login_resp.status_code, 200)
        beta_headers = {"Authorization": f"Bearer {login_resp.json()['token']}"}
        beta_org_id = create_beta_resp.json()["organization"]["id"]
        forbidden_slug_resp = self.client.put(
            f"/api/hub/orgs/{beta_org_id}",
            json={"slug": "hacked-slug"},
            headers=beta_headers,
        )
        self.assertEqual(forbidden_slug_resp.status_code, 403)

        # 14. Superadmin successfully updates tenant slug with cascade to users
        cascade_slug_resp = self.client.put(
            f"/api/hub/orgs/{org_id}",
            json={"slug": "channel-prime"},
            headers=headers,
        )
        self.assertEqual(cascade_slug_resp.status_code, 200)
        self.assertEqual(cascade_slug_resp.json()["organization"]["slug"], "channel-prime")

        # Verify users in this org cascaded
        after_users_resp = self.client.get(f"/api/hub/users?org_id={org_id}", headers=headers)
        after_usernames = [u["username"] for u in after_users_resp.json()]
        self.assertIn("admin_channel-prime", after_usernames)
        self.assertIn("channel-prime_op1", after_usernames)
        self.assertNotIn("admin_channel-alpha", after_usernames)
        self.assertNotIn("channel-alpha_op1", after_usernames)

    def test_groups_api_and_duplicate_prevention(self):
        headers = {"Authorization": f"Bearer {self.superadmin_token}"}

        # 1. Create tenant for testing groups
        create_org_resp = self.client.post(
            "/api/hub/orgs",
            json={
                "name": "Group Studio Org",
                "slug": "group-studio-org",
                "admin_password": "StudioPassword123!",
            },
            headers=headers,
        )
        self.assertEqual(create_org_resp.status_code, 200)
        org_id = create_org_resp.json()["organization"]["id"]

        # 2. Create first group
        grp1_resp = self.client.post(
            f"/api/hub/orgs/{org_id}/groups",
            json={"name": "Master Control", "icon_data": "MC"},
            headers=headers,
        )
        self.assertEqual(grp1_resp.status_code, 200)
        grp1_id = grp1_resp.json()["group"]["id"]

        # 3. Create duplicate group with same name -> 409 Conflict
        dup_resp = self.client.post(
            f"/api/hub/orgs/{org_id}/groups",
            json={"name": "Master Control", "icon_data": "DUP"},
            headers=headers,
        )
        self.assertEqual(dup_resp.status_code, 409)
        self.assertIn("already exists", dup_resp.json()["detail"])

        # 4. Create second group with different name
        grp2_resp = self.client.post(
            f"/api/hub/orgs/{org_id}/groups",
            json={"name": "Studio B", "icon_data": "STB"},
            headers=headers,
        )
        self.assertEqual(grp2_resp.status_code, 200)
        grp2_id = grp2_resp.json()["group"]["id"]

        # 5. Update second group to have same name as first group -> 409 Conflict
        update_dup_resp = self.client.put(
            f"/api/hub/groups/{grp2_id}",
            json={"name": "Master Control"},
            headers=headers,
        )
        self.assertEqual(update_dup_resp.status_code, 409)

        # 6. Unified list GET /api/hub/groups
        all_groups_resp = self.client.get("/api/hub/groups", headers=headers)
        self.assertEqual(all_groups_resp.status_code, 200)
        all_groups = all_groups_resp.json()
        names = [g["name"] for g in all_groups]
        self.assertIn("Master Control", names)
        self.assertIn("Studio B", names)

        target_g = next(g for g in all_groups if g["id"] == grp1_id)
        self.assertEqual(target_g["org_name"], "Group Studio Org")

        # 7. Scoped list GET /api/hub/groups?org_id={org_id}
        scoped_resp = self.client.get(f"/api/hub/groups?org_id={org_id}", headers=headers)
        self.assertEqual(scoped_resp.status_code, 200)
        scoped_groups = scoped_resp.json()
        self.assertEqual(len(scoped_groups), 2)
        for g in scoped_groups:
            self.assertEqual(g["org_id"], org_id)

        # 8. Check Default tenant fallback in GET /api/hub/orgs
        orgs_resp = self.client.get("/api/hub/orgs", headers=headers)
        self.assertEqual(orgs_resp.status_code, 200)
        orgs = orgs_resp.json()
        def_org = next((o for o in orgs if o["id"] == 1 or o["slug"] == "default"), None)
        if def_org:
            # Icon data should be platform monogram or logo URL, not null
            self.assertIsNotNone(def_org["icon_data"])

    def test_cannot_assign_user_to_default_tenant(self):
        token = self.superadmin_token
        headers = {"Authorization": f"Bearer {token}"}

        with self.SessionFactory() as db:
            default_org = Organization(name="Default Virtual Org", slug="default")
            db.add(default_org)
            db.commit()
            db.refresh(default_org)
            def_org_id = default_org.id

        # 1. POST /api/hub/users with default org fails
        resp = self.client.post(
            "/api/hub/users",
            json={
                "username": "illegal_op",
                "password": "Password123!",
                "role": "group_operator",
                "org_id": def_org_id,
            },
            headers=headers,
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("virtual Default tenant", resp.json()["detail"])

        # 2. POST /api/hub/orgs/{id}/users with default org fails
        resp2 = self.client.post(
            f"/api/hub/orgs/{def_org_id}/users",
            json={
                "username": "illegal_op2",
                "password": "Password123!",
                "role": "group_operator",
            },
            headers=headers,
        )
        self.assertEqual(resp2.status_code, 400)
        self.assertIn("virtual Default tenant", resp2.json()["detail"])


if __name__ == "__main__":
    unittest.main()
