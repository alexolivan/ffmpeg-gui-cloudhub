import os
import tempfile
import unittest
import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import backend.database.db as db_mod
from backend.database.models import Base, AuditLog, EnrolledNode
from backend.core.tunnel_server import tunnel_server
from backend.core.tunnel_protocol import TunnelMessageType


class TestAuditTunnelRelay(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.db_path = os.path.join(cls.temp_dir.name, "test_audit.db")
        cls.engine = create_engine(
            f"sqlite:///{cls.db_path}",
            connect_args={"check_same_thread": False},
        )
        cls.TestingSessionLocal = sessionmaker(
            autocommit=False, autoflush=False, bind=cls.engine
        )
        Base.metadata.create_all(bind=cls.engine)
        cls.orig_SessionLocal = db_mod.SessionLocal
        db_mod.SessionLocal = cls.TestingSessionLocal

    @classmethod
    def tearDownClass(cls):
        db_mod.SessionLocal = cls.orig_SessionLocal
        cls.temp_dir.cleanup()

    def setUp(self):
        with db_mod.SessionLocal() as db:
            db.query(AuditLog).delete()
            db.commit()

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
        with db_mod.SessionLocal() as db:
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
