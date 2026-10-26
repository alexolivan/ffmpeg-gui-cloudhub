"""Unit and integration tests for multiplexed reverse tunnel server and reverse proxy."""

import time
import json
import hmac
import hashlib
import asyncio
import unittest
from datetime import datetime, timezone
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
)
from backend.database.db import get_db, SessionLocal
from backend.core.auth_manager import AuthManager
from backend.core.tunnel_server import tunnel_server, ActiveTunnel
from backend.core.tunnel_protocol import (
    TunnelMessageType,
    create_http_response_frame,
    create_ws_frame,
    encode_body,
)
from backend.main import app


class MockEdgeTunnelClient:
    """Simulates an edge appliance maintaining a reverse tunnel socket."""

    def __init__(self, node_id: str, tunnel_secret: str, handler=None):
        self.node_id = node_id
        self.tunnel_secret = tunnel_secret
        self.handler = handler
        self.received_frames = []
        self.closed = False

    async def send_text(self, data: str):
        msg = json.loads(data)
        self.received_frames.append(msg)
        if self.handler:
            resp = self.handler(msg)
            if resp:
                await tunnel_server.handle_tunnel_message(self.node_id, json.dumps(resp))

    async def close(self, code: int = 1000, reason: str = ""):
        self.closed = True


class TestTunnelAndProxy(unittest.TestCase):
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
        # Also monkeypatch SessionLocal for reverse_proxy background lookups
        self._orig_session_local = SessionLocal
        import backend.core.reverse_proxy as rp
        rp.SessionLocal = self.SessionFactory
        import backend.routers.edge_routes as er
        er.SessionLocal = self.SessionFactory

        self.client = TestClient(app)

        # Create Org, Group, and Nodes in DB
        with self.SessionFactory() as db:
            self.org = Organization(name="Radio Alpha", slug="radio-alpha")
            db.add(self.org)
            db.flush()

            self.group = NodeGroup(name="Studio 1", org_id=self.org.id)
            db.add(self.group)
            db.flush()

            self.node_secret = "tunnel_secret_key_9999"
            self.node = EnrolledNode(
                node_id="ch_node_alpha",
                name="Alpha Master",
                org_id=self.org.id,
                group_id=self.group.id,
                tunnel_secret=self.node_secret,
            )
            db.add(self.node)

            # Superadmin user
            self.admin = User(
                username="admin_alpha",
                password_hash=AuthManager.hash_password("Pass123!"),
                role="org_admin",
                org_id=self.org.id,
            )
            # Operator user
            self.operator = User(
                username="op_alpha",
                password_hash=AuthManager.hash_password("Pass123!"),
                role="group_operator",
                org_id=self.org.id,
            )
            db.add_all([self.admin, self.operator])
            db.commit()

            db.refresh(self.admin)
            db.refresh(self.operator)
            self.admin_id = self.admin.id
            self.admin_hash = self.admin.password_hash
            self.op_id = self.operator.id
            self.op_hash = self.operator.password_hash

            # Grant operator permission to group
            self.perm = UserGroupPermission(user_id=self.op_id, group_id=self.group.id)
            db.add(self.perm)
            db.commit()

        self.admin_token = AuthManager.create_session(self.admin_id, self.admin_hash)
        self.op_token = AuthManager.create_session(self.op_id, self.op_hash)

    def tearDown(self):
        import backend.core.reverse_proxy as rp
        rp.SessionLocal = self._orig_session_local
        import backend.routers.edge_routes as er
        er.SessionLocal = self._orig_session_local

        app.dependency_overrides.clear()
        self.engine.dispose()
        # Clean up in-memory tunnels
        tunnel_server._tunnels.clear()

    def test_offline_node_returns_502(self):
        # Node has no connected tunnel
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        resp = self.client.get("/proxy/ch_node_alpha/api/processes", headers=headers)
        self.assertEqual(resp.status_code, 502)
        self.assertIn("offline", resp.json()["detail"].lower())

    def test_http_forwarding_and_sso_assertion(self):
        def reply_processes(frame):
            self.assertIsNotNone(frame["sso_assertion"])
            self.assertEqual(frame["method"], "GET")
            self.assertEqual(frame["path"], "/api/processes")
            return create_http_response_frame(
                stream_id=frame["stream_id"],
                status_code=200,
                headers=[["Content-Type", "application/json"], ["X-Edge-Node", "alpha"]],
                body=b'{"processes": [{"id": 1, "name": "Playout"}]}',
            )

        mock_ws = MockEdgeTunnelClient("ch_node_alpha", self.node_secret, handler=reply_processes)
        active_tunnel = ActiveTunnel("ch_node_alpha", mock_ws)
        tunnel_server._tunnels["ch_node_alpha"] = active_tunnel

        headers = {"Authorization": f"Bearer {self.admin_token}"}
        resp = self.client.get("/proxy/ch_node_alpha/api/processes", headers=headers)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["processes"][0]["name"], "Playout")

    def test_multi_tab_isolation_html_and_cookie_rewriting(self):
        def reply_html(frame):
            html_content = b'<html><head><title>Appliance</title><link href="/assets/main.css"></head><body><script src="/assets/main.js"></script></body></html>'
            return create_http_response_frame(
                stream_id=frame["stream_id"],
                status_code=200,
                headers=[
                    ["Content-Type", "text/html; charset=utf-8"],
                    ["Set-Cookie", "gui_session=xyz123; Path=/; HttpOnly"],
                ],
                body=html_content,
            )

        mock_ws = MockEdgeTunnelClient("ch_node_alpha", self.node_secret, handler=reply_html)
        active_tunnel = ActiveTunnel("ch_node_alpha", mock_ws)
        tunnel_server._tunnels["ch_node_alpha"] = active_tunnel

        headers = {"Authorization": f"Bearer {self.admin_token}"}
        resp = self.client.get("/proxy/ch_node_alpha/", headers=headers)
        self.assertEqual(resp.status_code, 200)

        # 1. Verify JS shim injected
        self.assertIn("/proxy/ch_node_alpha", resp.text)

        # 2. Verify static links rewritten
        self.assertIn('href="/proxy/ch_node_alpha/assets/main.css"', resp.text)
        self.assertIn('src="/proxy/ch_node_alpha/assets/main.js"', resp.text)

        # 3. Verify Set-Cookie Path rewritten from Path=/ to Path=/proxy/ch_node_alpha/
        cookie_header = resp.headers.get("set-cookie", "")
        self.assertIn("Path=/proxy/ch_node_alpha/", cookie_header)
        self.assertNotIn("Path=/;", cookie_header)

    def test_hot_revocation_enforcement(self):
        # Group operator currently has permission
        mock_ws = MockEdgeTunnelClient("ch_node_alpha", self.node_secret)
        active_tunnel = ActiveTunnel("ch_node_alpha", mock_ws)
        tunnel_server._tunnels["ch_node_alpha"] = active_tunnel

        headers = {"Authorization": f"Bearer {self.op_token}"}

        # Revoke permission in DB
        with self.SessionFactory() as db:
            db.query(UserGroupPermission).filter(
                UserGroupPermission.user_id == self.op_id
            ).delete()
            db.commit()

        # Immediate next request MUST be rejected with 403 Forbidden!
        resp = self.client.get("/proxy/ch_node_alpha/api/status", headers=headers)
        self.assertEqual(resp.status_code, 403)


if __name__ == "__main__":
    unittest.main()
