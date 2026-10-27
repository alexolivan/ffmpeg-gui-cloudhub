"""Multiplexed reverse tunnel manager and WebSocket hub for edge nodes."""

import asyncio
import json
import uuid
import time
import logging
from typing import Dict, Any, Optional, Tuple, List
from fastapi import WebSocket, WebSocketDisconnect

from backend.core.tunnel_protocol import (
    TunnelMessageType,
    create_http_request_frame,
    create_ws_open_frame,
    create_ws_frame,
    create_ws_close_frame,
    decode_body,
)
from backend.core.telemetry_collector import telemetry_collector

logger = logging.getLogger("cloudhub.tunnel")


class ActiveTunnel:
    """Represents an active multiplexed WebSocket connection to an edge node."""

    def __init__(self, node_id: str, websocket: WebSocket):
        self.node_id = node_id
        self.websocket = websocket
        self.connected_at = time.time()
        self.pending_http: Dict[str, asyncio.Future] = {}
        self.active_ws_streams: Dict[str, WebSocket] = {}
        self._send_lock = asyncio.Lock()

    async def send_json(self, data: Dict[str, Any]) -> None:
        """Thread/coroutine safe send over the multiplexed tunnel socket."""
        async with self._send_lock:
            await self.websocket.send_text(json.dumps(data))


class TunnelServer:
    """Manages connected edge reverse tunnels, dispatching HTTP calls and WS bridges."""

    def __init__(self):
        self._tunnels: Dict[str, ActiveTunnel] = {}
        self._lock = asyncio.Lock()

    async def register_tunnel(self, node_id: str, websocket: WebSocket) -> ActiveTunnel:
        """Register a newly connected and authenticated edge appliance tunnel."""
        async with self._lock:
            old_tunnel = self._tunnels.get(node_id)
            if old_tunnel:
                logger.warning("Closing superseded tunnel connection for node '%s'", node_id)
                try:
                    await old_tunnel.websocket.close(code=1000, reason="Superseded by new connection")
                except Exception:
                    pass

            tunnel = ActiveTunnel(node_id, websocket)
            self._tunnels[node_id] = tunnel
            logger.info("Reverse tunnel registered for node '%s'", node_id)
            return tunnel

    async def unregister_tunnel(self, node_id: str) -> None:
        """Unregister tunnel and clean up all in-flight streams."""
        async with self._lock:
            tunnel = self._tunnels.pop(node_id, None)

        if tunnel:
            logger.info("Reverse tunnel unregistered for node '%s'", node_id)
            # Cancel pending HTTP requests
            for stream_id, fut in list(tunnel.pending_http.items()):
                if not fut.done():
                    fut.set_exception(
                        ConnectionError("Edge appliance disconnected while request was in-flight")
                    )
            tunnel.pending_http.clear()

            # Close active browser WebSocket bridges
            for stream_id, browser_ws in list(tunnel.active_ws_streams.items()):
                try:
                    await browser_ws.close(code=1001, reason="Edge node tunnel closed")
                except Exception:
                    pass
            tunnel.active_ws_streams.clear()

            # Update telemetry collector
            telemetry_collector.mark_disconnected(node_id)

    def is_connected(self, node_id: str) -> bool:
        """Check whether an active tunnel exists for the given node_id."""
        return node_id in self._tunnels

    async def forward_http(
        self,
        node_id: str,
        method: str,
        path: str,
        query: str,
        headers: Dict[str, str],
        body: Optional[bytes] = None,
        sso_assertion: Optional[str] = None,
        timeout: float = 30.0,
    ) -> Tuple[int, List[List[str]], bytes]:
        """
        Forward an HTTP request to edge node over the multiplexed reverse tunnel.
        Returns: (status_code, headers_list, body_bytes)
        """
        tunnel = self._tunnels.get(node_id)
        if not tunnel:
            raise ConnectionError(f"Node '{node_id}' is offline or reverse tunnel not connected")

        stream_id = uuid.uuid4().hex
        loop = asyncio.get_running_loop()
        future: asyncio.Future = loop.create_future()
        tunnel.pending_http[stream_id] = future

        frame = create_http_request_frame(
            stream_id=stream_id,
            method=method,
            path=path,
            query=query,
            headers=headers,
            body=body,
            sso_assertion=sso_assertion,
        )

        try:
            await tunnel.send_json(frame)
            resp_frame = await asyncio.wait_for(future, timeout=timeout)
            status_code = int(resp_frame.get("status_code", 502))
            resp_headers = resp_frame.get("headers", [])
            body_bytes = decode_body(resp_frame.get("body")) or b""
            return status_code, resp_headers, body_bytes
        except asyncio.TimeoutError:
            tunnel.pending_http.pop(stream_id, None)
            raise TimeoutError(f"Timed out waiting for edge node '{node_id}' response after {timeout}s")
        finally:
            tunnel.pending_http.pop(stream_id, None)

    async def handle_tunnel_message(self, node_id: str, message_text: str) -> None:
        """Process an incoming multiplexed frame received from edge appliance."""
        tunnel = self._tunnels.get(node_id)
        if not tunnel:
            return

        try:
            msg = json.loads(message_text)
            msg_type = msg.get("type")
            stream_id = msg.get("stream_id")

            if msg_type == TunnelMessageType.HTTP_RESP:
                fut = tunnel.pending_http.get(stream_id)
                if fut and not fut.done():
                    fut.set_result(msg)

            elif msg_type == TunnelMessageType.WS_FRAME:
                browser_ws = tunnel.active_ws_streams.get(stream_id)
                if browser_ws:
                    is_binary = msg.get("is_binary", False)
                    data = msg.get("data")
                    if is_binary:
                        bin_data = decode_body(data)
                        if bin_data is not None:
                            await browser_ws.send_bytes(bin_data)
                    else:
                        if data is not None:
                            await browser_ws.send_text(str(data))

            elif msg_type == TunnelMessageType.WS_CLOSE:
                browser_ws = tunnel.active_ws_streams.pop(stream_id, None)
                if browser_ws:
                    code = int(msg.get("code", 1000))
                    reason = msg.get("reason", "Edge node closed connection")
                    try:
                        await browser_ws.close(code=code, reason=reason)
                    except Exception:
                        pass

            elif msg_type == TunnelMessageType.PING:
                await tunnel.send_json({"type": TunnelMessageType.PONG, "timestamp": int(time.time())})

            elif msg_type == TunnelMessageType.HEARTBEAT:
                telemetry_collector.record_heartbeat(node_id, msg)

            elif msg_type == TunnelMessageType.AUDIT_EVENT:
                event_payload = msg.get("event") or {}
                self._persist_edge_audit_event(node_id, event_payload)

        except Exception as err:
            logger.error("Error processing tunnel frame from node '%s': %s", node_id, err)

    def _persist_edge_audit_event(self, node_id: str, event: Dict[str, Any]) -> None:
        """Persist an audit log event received from an edge node."""
        from backend.database.db import SessionLocal
        from backend.database.models import AuditLog, EnrolledNode
        import datetime

        try:
            with SessionLocal() as db:
                node = db.query(EnrolledNode).filter(EnrolledNode.node_id == node_id).first()
                org_id = node.org_id if node else None

                ts_raw = event.get("timestamp")
                ts = None
                if ts_raw:
                    try:
                        ts = datetime.datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
                    except Exception:
                        pass
                if not ts:
                    ts = datetime.datetime.now(datetime.timezone.utc)

                action = event.get("action", "UNKNOWN")
                target_type = event.get("target_type", "service")
                target_id = event.get("target_id")
                channel = event.get("channel", "cloudhub")
                username = event.get("username", "admin")
                ip_addr = event.get("ip_address")
                changes = event.get("changes")
                details = event.get("details")

                details_text = changes or details
                if changes and details and changes != details:
                    details_text = f"{details} | {changes}"

                entry = AuditLog(
                    timestamp=ts,
                    org_id=org_id,
                    node_id=node_id,
                    channel=channel,
                    username=username,
                    action=action,
                    target_type=target_type,
                    target_id=str(target_id) if target_id is not None else None,
                    ip_address=ip_addr,
                    details=details_text,
                )
                db.add(entry)
                db.commit()
                logger.info("Persisted audit event '%s' from edge node '%s' by '%s'", action, node_id, username)
        except Exception as e:
            logger.error("Failed to persist edge audit event for node '%s': %s", node_id, e)


    async def bridge_websocket(
        self,
        node_id: str,
        browser_ws: WebSocket,
        path: str,
        query: str,
        headers: Dict[str, str],
        sso_assertion: Optional[str] = None,
    ) -> None:
        """
        Bridge an incoming browser WebSocket connection into the edge node reverse tunnel.
        """
        tunnel = self._tunnels.get(node_id)
        if not tunnel:
            await browser_ws.close(code=1001, reason="Edge node is offline")
            return

        stream_id = uuid.uuid4().hex
        tunnel.active_ws_streams[stream_id] = browser_ws

        open_frame = create_ws_open_frame(
            stream_id=stream_id,
            path=path,
            query=query,
            headers=headers,
            sso_assertion=sso_assertion,
        )

        try:
            await tunnel.send_json(open_frame)

            # Pump frames from browser_ws to edge tunnel
            while True:
                message = await browser_ws.receive()
                if message.get("type") == "websocket.receive":
                    if "text" in message and message["text"] is not None:
                        frame = create_ws_frame(stream_id, message["text"], is_binary=False)
                        await tunnel.send_json(frame)
                    elif "bytes" in message and message["bytes"] is not None:
                        frame = create_ws_frame(stream_id, message["bytes"], is_binary=True)
                        await tunnel.send_json(frame)
                elif message.get("type") == "websocket.disconnect":
                    break
        except WebSocketDisconnect:
            pass
        except Exception as err:
            logger.debug("WS bridge error: %s", err)
        finally:
            tunnel.active_ws_streams.pop(stream_id, None)
            close_frame = create_ws_close_frame(stream_id)
            try:
                await tunnel.send_json(close_frame)
            except Exception:
                pass


tunnel_server = TunnelServer()
