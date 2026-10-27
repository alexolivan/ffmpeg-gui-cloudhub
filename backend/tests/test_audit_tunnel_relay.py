import unittest
import datetime
from backend.database.db import SessionLocal, init_db
from backend.database.models import AuditLog, EnrolledNode
from backend.core.tunnel_server import tunnel_server
from backend.core.tunnel_protocol import TunnelMessageType


class TestAuditTunnelRelay(unittest.TestCase):

    def setUp(self):
        init_db()

    def test_persist_edge_audit_event(self):
        test_node_id = "test-encoder-node-01"
        event_payload = {
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "channel": "local_gui",
            "username": "carlos_admin",
            "ip_address": "192.168.1.55",
            "action": "SERVICE_UPDATE",
            "target_type": "service",
            "target_id": "7",
            "target_name": "Canal Principal HLS",
            "changes": "bitrate: 2500k -> 4500k",
            "details": "Operator adjustment",
        }

        # Simulate receiving audit event from tunnel
        tunnel_server._persist_edge_audit_event(test_node_id, event_payload)

        # Verify entry in CloudHub DB
        with SessionLocal() as db:
            entry = (
                db.query(AuditLog)
                .filter(AuditLog.node_id == test_node_id, AuditLog.action == "SERVICE_UPDATE")
                .first()
            )
            self.assertIsNotNone(entry)
            self.assertEqual(entry.node_id, test_node_id)
            self.assertEqual(entry.channel, "local_gui")
            self.assertEqual(entry.username, "carlos_admin")
            self.assertEqual(entry.target_id, "7")
            self.assertIn("bitrate: 2500k -> 4500k", entry.details)


if __name__ == "__main__":
    unittest.main()
