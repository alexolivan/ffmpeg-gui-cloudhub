"""Unit and integration tests for chunked HTTP streaming over the CloudHub reverse tunnel."""

import json
import asyncio
import unittest
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.database.models import Base, User, Organization, NodeGroup, EnrolledNode
from backend.database.db import get_db
from backend.core.auth_manager import AuthManager
from backend.core.tunnel_server import tunnel_server
from backend.core.tunnel_protocol import (
    TunnelMessageType,
    create_http_response_frame,
    encode_body,
)
from backend.main import app


class StreamingMockEdgeSocket:
    """Simulates an edge tunnel WebSocket handling both monolithic and chunked HTTP responses."""

    def __init__(self, node_id: str, mode: str = "stream", chunks=None):
        self.node_id = node_id
        self.mode = mode
        self.chunks = chunks or [b"chunk-1-", b"chunk-2-", b"chunk-3"]
        self.received_frames = []
        self.closed = False

    async def send_text(self, data: str):
        frame = json.loads(data)
        self.received_frames.append(frame)
        if frame.get("type") != TunnelMessageType.HTTP_REQ:
            return

        stream_id = frame["stream_id"]
        if self.mode == "legacy":
            resp = create_http_response_frame(
                stream_id=stream_id,
                status_code=200,
                headers=[["content-type", "application/json"]],
                body=b'{"legacy":true}',
            )
            asyncio.create_task(
                tunnel_server.handle_tunnel_message(self.node_id, json.dumps(resp))
            )
        elif self.mode == "stream":
            async def _pump():
                await tunnel_server.handle_tunnel_message(
                    self.node_id,
                    json.dumps({
                        "type": TunnelMessageType.HTTP_RESP_START,
                        "stream_id": stream_id,
                        "status_code": 200,
                        "headers": [["content-type", "audio/mpeg"]],
                    }),
                )
                for chunk in self.chunks:
                    await tunnel_server.handle_tunnel_message(
                        self.node_id,
                        json.dumps({
                            "type": TunnelMessageType.HTTP_RESP_CHUNK,
                            "stream_id": stream_id,
                            "data_b64": encode_body(chunk),
                        }),
                    )
                await tunnel_server.handle_tunnel_message(
                    self.node_id,
                    json.dumps({
                        "type": TunnelMessageType.HTTP_RESP_END,
                        "stream_id": stream_id,
                    }),
                )

            asyncio.create_task(_pump())
        elif self.mode == "infinite":
            async def _start_only():
                await tunnel_server.handle_tunnel_message(
                    self.node_id,
                    json.dumps({
                        "type": TunnelMessageType.HTTP_RESP_START,
                        "stream_id": stream_id,
                        "status_code": 200,
                        "headers": [["content-type", "audio/mpeg"]],
                    }),
                )
                await tunnel_server.handle_tunnel_message(
                    self.node_id,
                    json.dumps({
                        "type": TunnelMessageType.HTTP_RESP_CHUNK,
                        "stream_id": stream_id,
                        "data_b64": encode_body(b"first-audio-frame"),
                    }),
                )

            asyncio.create_task(_start_only())

    async def close(self, code: int = 1000, reason: str = ""):
        self.closed = True


class TestHttpStreamTunnel(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.SessionFactory = sessionmaker(
            autocommit=False, autoflush=False, bind=self.engine
        )

        def override_get_db():
            db = self.SessionFactory()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        import backend.core.reverse_proxy as rp
        self._orig_rp_session = rp.SessionLocal
        rp.SessionLocal = self.SessionFactory

        self.client = TestClient(app)

        with self.SessionFactory() as db:
            org = Organization(name="Broadcast Org", slug="bcast")
            db.add(org)
            db.flush()

            grp = NodeGroup(org_id=org.id, name="Rack A")
            db.add(grp)
            db.flush()

            self.node_secret = "stream_secret_123456"
            node = EnrolledNode(
                node_id="ch_node_stream",
                name="Icecast Box",
                org_id=org.id,
                group_id=grp.id,
                tunnel_secret=self.node_secret,
                last_seen_at=datetime.now(timezone.utc),
            )
            admin = User(
                username="admin_bcast",
                password_hash=AuthManager.hash_password("Pass123!"),
                role="org_admin",
                org_id=org.id,
            )
            db.add_all([node, admin])
            db.commit()
            db.refresh(admin)
            self.admin_token = AuthManager.create_session(admin.id, admin.password_hash)

    def tearDown(self):
        import backend.core.reverse_proxy as rp
        rp.SessionLocal = self._orig_rp_session
        app.dependency_overrides.clear()
        tunnel_server._tunnels.clear()
        self.engine.dispose()

    def test_legacy_monolithic_http_resp_compatibility(self):
        async def scenario():
            mock_ws = StreamingMockEdgeSocket("ch_node_stream", mode="legacy")
            await tunnel_server.register_tunnel("ch_node_stream", mock_ws)
            status_code, _headers, is_stream, body = await tunnel_server.forward_http_stream(
                node_id="ch_node_stream",
                method="GET",
                path="/api/status",
                query="",
                headers={},
            )
            self.assertEqual(status_code, 200)
            self.assertFalse(is_stream)
            self.assertEqual(body, b'{"legacy":true}')
            self.assertTrue(mock_ws.received_frames[0].get("supports_stream"))

        asyncio.run(scenario())

    def test_chunked_audio_stream_via_reverse_proxy(self):
        mock_ws = StreamingMockEdgeSocket(
            "ch_node_stream",
            mode="stream",
            chunks=[b"ID3", b"audio-frame-1", b"audio-frame-2"],
        )
        asyncio.run(tunnel_server.register_tunnel("ch_node_stream", mock_ws))

        headers = {"Authorization": f"Bearer {self.admin_token}"}
        with self.client.stream("GET", "/proxy/ch_node_stream/api/processes/1/icecast-proxy/live.mp3", headers=headers) as resp:
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.headers.get("content-type"), "audio/mpeg")
            payload = b"".join(resp.iter_bytes())

        self.assertEqual(payload, b"ID3audio-frame-1audio-frame-2")

    def test_early_client_disconnect_sends_http_req_cancel(self):
        async def scenario():
            mock_ws = StreamingMockEdgeSocket("ch_node_stream", mode="infinite")
            await tunnel_server.register_tunnel("ch_node_stream", mock_ws)
            status_code, _headers, is_stream, stream_iter = await tunnel_server.forward_http_stream(
                node_id="ch_node_stream",
                method="GET",
                path="/api/processes/1/icecast-proxy/live.mp3",
                query="",
                headers={},
            )
            self.assertEqual(status_code, 200)
            self.assertTrue(is_stream)

            first_chunk = await stream_iter.__anext__()
            self.assertEqual(first_chunk, b"first-audio-frame")

            # Simulate browser closing audio player before HTTP_RESP_END
            await stream_iter.aclose()

            self.assertTrue(
                any(f.get("type") == TunnelMessageType.HTTP_REQ_CANCEL for f in mock_ws.received_frames)
            )

        asyncio.run(scenario())


if __name__ == "__main__":
    unittest.main()
