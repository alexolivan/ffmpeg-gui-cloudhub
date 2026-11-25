"""Unit and integration tests for Teams, conservative defaults, claims compiler, and RBAC API."""

import json
import asyncio
import unittest
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
    UserGroupPermission,
    Team,
    TeamMember,
)
from backend.database.db import get_db, SessionLocal, ensure_default_team_for_org
from backend.core.auth_manager import AuthManager
from backend.core.permissions_compiler import compile_effective_claims
from backend.core.telemetry_collector import telemetry_collector
from backend.core.tunnel_server import tunnel_server, ActiveTunnel
from backend.core.tunnel_protocol import create_http_response_frame
from backend.main import app


class MockCatalogEdgeWS:
    def __init__(self, node_id: str, catalog_payload: dict):
        self.node_id = node_id
        self.catalog_payload = catalog_payload
        self.received_frames = []
        self.closed = False

    async def send_text(self, data: str):
        frame = json.loads(data)
        self.received_frames.append(frame)
        if frame.get("type") == "http_req":
            resp = create_http_response_frame(
                stream_id=frame["stream_id"],
                status_code=200,
                headers=[["content-type", "application/json"]],
                body=json.dumps(self.catalog_payload).encode("utf-8"),
            )
            await tunnel_server.handle_tunnel_message(self.node_id, json.dumps(resp))

    async def close(self, code: int = 1000, reason: str = ""):
        self.closed = True


class TestTeamsAndClaims(unittest.TestCase):
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
        self._orig_session_local = SessionLocal
        import backend.core.reverse_proxy as rp
        import backend.routers.tenant_routes as tr
        import backend.routers.permissions_routes as pr
        rp.SessionLocal = self.SessionFactory
        tr.SessionLocal = self.SessionFactory
        pr.SessionLocal = self.SessionFactory
        pr._NODE_CATALOG_CACHE.clear()

        self.client = TestClient(app)

        with self.SessionFactory() as db:
            self.org1 = Organization(name="Org One", slug="org-one")
            self.org2 = Organization(name="Org Two", slug="org-two")
            db.add_all([self.org1, self.org2])
            db.flush()

            self.group1 = NodeGroup(name="Rack 1", org_id=self.org1.id)
            self.group2 = NodeGroup(name="Rack 2", org_id=self.org2.id)
            db.add_all([self.group1, self.group2])
            db.flush()

            self.node_secret = "secret_node_123456"
            self.node1 = EnrolledNode(
                node_id="ch_node_one",
                name="Encoder 1",
                org_id=self.org1.id,
                group_id=self.group1.id,
                tunnel_secret=self.node_secret,
            )
            self.node2 = EnrolledNode(
                node_id="ch_node_two",
                name="Encoder 2",
                org_id=self.org2.id,
                group_id=self.group2.id,
                tunnel_secret="other_secret",
            )
            db.add_all([self.node1, self.node2])

            self.superadmin = User(
                username="super",
                password_hash=AuthManager.hash_password("Pass123!"),
                role="superadmin",
                org_id=None,
            )
            self.org1_admin = User(
                username="admin_org1",
                password_hash=AuthManager.hash_password("Pass123!"),
                role="org_admin",
                org_id=self.org1.id,
            )
            self.op1 = User(
                username="op1",
                password_hash=AuthManager.hash_password("Pass123!"),
                role="group_operator",
                org_id=self.org1.id,
            )
            self.op1_nogroup = User(
                username="op1_nogroup",
                password_hash=AuthManager.hash_password("Pass123!"),
                role="group_operator",
                org_id=self.org1.id,
            )
            db.add_all([self.superadmin, self.org1_admin, self.op1, self.op1_nogroup])
            db.flush()

            db.add(UserGroupPermission(user_id=self.op1.id, group_id=self.group1.id))
            ensure_default_team_for_org(db, self.org1.id)
            ensure_default_team_for_org(db, self.org2.id)
            db.commit()

            for u in (self.superadmin, self.org1_admin, self.op1, self.op1_nogroup):
                db.refresh(u)
            self.super_token = AuthManager.create_session(self.superadmin.id, self.superadmin.password_hash)
            self.admin1_token = AuthManager.create_session(self.org1_admin.id, self.org1_admin.password_hash)
            self.op1_token = AuthManager.create_session(self.op1.id, self.op1.password_hash)
            self.org1_id = self.org1.id
            self.org2_id = self.org2.id
            self.op1_id = self.op1.id
            self.op1_nogroup_id = self.op1_nogroup.id

    def tearDown(self):
        import backend.core.reverse_proxy as rp
        import backend.routers.tenant_routes as tr
        import backend.routers.permissions_routes as pr
        rp.SessionLocal = self._orig_session_local
        tr.SessionLocal = self._orig_session_local
        pr.SessionLocal = self._orig_session_local
        pr._NODE_CATALOG_CACHE.clear()
        app.dependency_overrides.clear()
        tunnel_server._tunnels.clear()
        with telemetry_collector._lock:
            telemetry_collector._vitality_cache.clear()
        self.engine.dispose()

    def test_default_team_bootstrap_and_immutable_delete_guard(self):
        headers = {"Authorization": f"Bearer {self.admin1_token}"}
        res = self.client.get(f"/api/hub/orgs/{self.org1_id}/teams", headers=headers)
        self.assertEqual(res.status_code, 200)
        teams = res.json()
        self.assertEqual(len(teams), 1)
        default_team = teams[0]
        self.assertTrue(default_team["is_default_template"])
        self.assertEqual(default_team["default_claims"]["dashboard"], "monitor")
        self.assertEqual(default_team["default_claims"]["settings"], "none")
        self.assertEqual(default_team["default_claims"]["processes"]["default"], "none")

        # Cannot delete default template
        del_res = self.client.delete(f"/api/hub/teams/{default_team['id']}", headers=headers)
        self.assertEqual(del_res.status_code, 400)

        # Operator cannot access RBAC API
        op_res = self.client.get(
            f"/api/hub/orgs/{self.org1_id}/teams",
            headers={"Authorization": f"Bearer {self.op1_token}"},
        )
        self.assertEqual(op_res.status_code, 403)

        # Org1 admin cannot access Org2 teams (cross-tenant isolation)
        cross_res = self.client.get(f"/api/hub/orgs/{self.org2_id}/teams", headers=headers)
        self.assertEqual(cross_res.status_code, 403)

    def test_precedence_and_authz_assertion_compilation(self):
        headers = {"Authorization": f"Bearer {self.admin1_token}"}
        # Create two teams for op1 to test max_level merge + per-node overrides
        res_t1 = self.client.post(
            f"/api/hub/orgs/{self.org1_id}/teams",
            headers=headers,
            json={
                "name": "Sound Ops",
                "default_claims": {
                    "dashboard": "monitor",
                    "hardware": "operate",
                    "settings": "none",
                    "processes": {"default": "none", "by_type": {"ffmpeg_stream": "monitor"}},
                },
                "member_user_ids": [self.op1_id],
            },
        )
        self.assertEqual(res_t1.status_code, 200)
        team1_id = res_t1.json()["team"]["id"]

        res_t2 = self.client.post(
            f"/api/hub/orgs/{self.org1_id}/teams",
            headers=headers,
            json={
                "name": "Playout Leads",
                "default_claims": {
                    "dashboard": "monitor",
                    "hardware": "monitor",
                    "processes": {"default": "none", "by_type": {"ffmpeg_stream": "operate"}},
                },
                "member_user_ids": [self.op1_id],
            },
        )
        self.assertEqual(res_t2.status_code, 200)

        # Team node override on ch_node_one: service 1 -> manage
        put_team_ov = self.client.put(
            "/api/hub/nodes/ch_node_one/permissions",
            headers=headers,
            json={
                "team_id": team1_id,
                "overrides": [
                    {"scope_type": "service", "target_key": "1", "level": "manage"},
                    {"scope_type": "service", "target_key": "2", "level": "operate"},
                ],
            },
        )
        self.assertEqual(put_team_ov.status_code, 200)

        # Direct User override takes precedence over team (downgrade service 2 to monitor, grant forge monitor)
        put_user_ov = self.client.put(
            "/api/hub/nodes/ch_node_one/permissions",
            headers=headers,
            json={
                "user_id": self.op1_id,
                "overrides": [
                    {"scope_type": "service", "target_key": "2", "level": "monitor"},
                    {"scope_type": "domain", "target_key": "forge", "level": "monitor"},
                ],
            },
        )
        self.assertEqual(put_user_ov.status_code, 200)

        perm_res = self.client.get(
            f"/api/hub/nodes/ch_node_one/permissions?user_id={self.op1_id}",
            headers=headers,
        )
        self.assertEqual(perm_res.status_code, 200)
        perm_json = perm_res.json()
        self.assertEqual(perm_json["inherited_preview"]["scopes"]["processes"]["services"]["2"], "operate")
        self.assertEqual(perm_json["compiled_preview"]["scopes"]["processes"]["services"]["2"], "monitor")
        self.assertEqual(perm_json["inherited_preview"]["scopes"]["forge"], "none")
        self.assertEqual(perm_json["compiled_preview"]["scopes"]["forge"], "monitor")
        team_names = {tm["name"] for tm in perm_json["subject_teams"]}
        self.assertTrue({"Sound Ops", "Playout Leads"}.issubset(team_names))
        self.assertEqual(perm_json["override_counts"]["users"][str(self.op1_id)], 2)
        self.assertEqual(perm_json["override_counts"]["teams"][str(team1_id)], 2)

        with self.SessionFactory() as db:
            node1 = db.query(EnrolledNode).filter(EnrolledNode.node_id == "ch_node_one").first()
            op1 = db.query(User).filter(User.id == self.op1_id).first()
            op_nogrp = db.query(User).filter(User.id == self.op1_nogroup_id).first()
            org1_admin = db.query(User).filter(User.username == "admin_org1").first()

            claims_op = compile_effective_claims(db, op1, node1)
            scopes = claims_op["scopes"]
            self.assertEqual(scopes["hardware"], "operate")  # max(operate, monitor)
            self.assertEqual(scopes["forge"], "monitor")  # user override
            self.assertEqual(scopes["settings"], "none")
            self.assertEqual(scopes["processes"]["by_type"]["ffmpeg_stream"], "operate")
            self.assertEqual(scopes["processes"]["services"]["1"], "manage")
            self.assertEqual(scopes["processes"]["services"]["2"], "monitor")  # user override beats team

            # Unreachable operator gets all none (Layer 1 gate)
            claims_blocked = compile_effective_claims(db, op_nogrp, node1)
            self.assertEqual(claims_blocked["scopes"]["dashboard"], "none")

            # org_admin gets full admin
            claims_admin = compile_effective_claims(db, org1_admin, node1)
            self.assertEqual(claims_admin["scopes"]["settings"], "admin")

            # Sign & verify authz_assertion roundtrip
            token = AuthManager.create_authz_assertion("ch_node_one", self.node_secret, op1.username, claims_op)
            verified = AuthManager.verify_authz_assertion(token, self.node_secret, expected_node_id="ch_node_one")
            self.assertEqual(verified["scopes"]["processes"]["services"]["1"], "manage")
            self.assertIsNone(AuthManager.verify_authz_assertion(token, "wrong_secret"))

    def test_legacy_node_blocked_for_restricted_operator_and_live_catalog_orphans(self):
        async def setup_tunnel():
            ws = MockCatalogEdgeWS(
                "ch_node_one",
                {
                    "services": [
                        {"id": 1, "name": "Encoder A", "service_type": "ffmpeg_stream", "dependencies": [5]},
                        {"id": 5, "name": "Icecast Main", "service_type": "icecast_server", "dependencies": []},
                    ],
                    "tasks": [{"id": 10, "name": "Daily Rec", "task_type": "ffmpeg_record"}],
                },
            )
            await tunnel_server.register_tunnel("ch_node_one", ws)
            return ws

        ws = asyncio.run(setup_tunnel())

        # Record heartbeat WITHOUT authz_claims -> restricted operator MUST receive 426
        telemetry_collector.record_heartbeat("ch_node_one", {"capabilities": {"http_stream": True}})
        res_legacy = self.client.get(
            "/proxy/ch_node_one/api/processes",
            headers={"Authorization": f"Bearer {self.op1_token}"},
        )
        self.assertEqual(res_legacy.status_code, 426)

        # Record heartbeat WITH authz_claims -> restricted operator succeeds and assertion is attached
        telemetry_collector.record_heartbeat(
            "ch_node_one", {"capabilities": {"http_stream": True, "authz_claims": True}}
        )
        # Create an orphan override for deleted service 999
        headers_admin = {"Authorization": f"Bearer {self.admin1_token}"}
        self.client.put(
            "/api/hub/nodes/ch_node_one/permissions",
            headers=headers_admin,
            json={
                "user_id": self.op1_id,
                "overrides": [{"scope_type": "service", "target_key": "999", "level": "operate"}],
            },
        )

        cat_res = self.client.get("/api/hub/nodes/ch_node_one/catalog", headers=headers_admin)
        self.assertEqual(cat_res.status_code, 200)
        cat = cat_res.json()
        self.assertFalse(cat["offline"])
        self.assertEqual(cat["implicit_monitors"]["5"], ["Encoder A"])
        self.assertEqual(len(cat["orphaned_overrides"]), 1)
        self.assertEqual(cat["orphaned_overrides"][0]["target_key"], "999")

        purge_res = self.client.delete("/api/hub/nodes/ch_node_one/permissions/orphans", headers=headers_admin)
        self.assertEqual(purge_res.status_code, 200)
        self.assertEqual(purge_res.json()["deleted"], 1)

    def test_update_user_enrolls_default_team_and_cleans_on_admin_promotion(self):
        from backend.database.models import Team, TeamMember

        headers = {"Authorization": f"Bearer {self.super_token}"}
        # Create an org_admin in org1 as superadmin, then demote to group_operator via PUT /users/{id}
        create_res = self.client.post(
            f"/api/hub/orgs/{self.org1_id}/users",
            headers=headers,
            json={"username": "promoted_tmp", "password": "Password123!", "role": "org_admin"},
        )
        self.assertEqual(create_res.status_code, 200)
        uid = create_res.json()["user"]["id"]

        put_op = self.client.put(
            f"/api/hub/users/{uid}",
            headers=headers,
            json={"role": "group_operator"},
        )
        self.assertEqual(put_op.status_code, 200)

        with self.SessionFactory() as db:
            default_team = (
                db.query(Team)
                .filter(Team.org_id == self.org1_id, Team.is_default_template == True)
                .first()
            )
            self.assertIsNotNone(default_team)
            membership = (
                db.query(TeamMember)
                .filter(TeamMember.team_id == default_team.id, TeamMember.user_id == uid)
                .first()
            )
            self.assertIsNotNone(membership)

        # Promoting back to org_admin removes team memberships
        put_adm = self.client.put(
            f"/api/hub/users/{uid}",
            headers=headers,
            json={"role": "org_admin"},
        )
        self.assertEqual(put_adm.status_code, 200)
        with self.SessionFactory() as db:
            remaining = db.query(TeamMember).filter(TeamMember.user_id == uid).all()
            self.assertEqual(remaining, [])


if __name__ == "__main__":
    unittest.main()
