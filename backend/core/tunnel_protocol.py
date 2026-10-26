"""Multiplexed reverse tunnel message types and framing protocol."""

import base64
from typing import Dict, Any, Optional, List


class TunnelMessageType:
    HTTP_REQ = "http_req"
    HTTP_RESP = "http_resp"
    WS_OPEN = "ws_open"
    WS_FRAME = "ws_frame"
    WS_CLOSE = "ws_close"
    PING = "ping"
    PONG = "pong"


def encode_body(data: Optional[bytes]) -> Optional[str]:
    """Encode binary payload to base64 string."""
    if data is None:
        return None
    return base64.b64encode(data).decode("ascii")


def decode_body(data_b64: Optional[str]) -> Optional[bytes]:
    """Decode base64 string back to binary payload."""
    if data_b64 is None:
        return None
    return base64.b64decode(data_b64.encode("ascii"))


def create_http_request_frame(
    stream_id: str,
    method: str,
    path: str,
    query: str,
    headers: Dict[str, str],
    body: Optional[bytes] = None,
    sso_assertion: Optional[str] = None,
) -> Dict[str, Any]:
    """Construct a multiplexed HTTP request frame to be forwarded to edge node."""
    return {
        "type": TunnelMessageType.HTTP_REQ,
        "stream_id": stream_id,
        "method": method.upper(),
        "path": path,
        "query": query,
        "headers": headers,
        "body": encode_body(body),
        "sso_assertion": sso_assertion,
    }


def create_http_response_frame(
    stream_id: str,
    status_code: int,
    headers: List[List[str]],
    body: Optional[bytes] = None,
) -> Dict[str, Any]:
    """Construct an HTTP response frame sent back from edge node."""
    return {
        "type": TunnelMessageType.HTTP_RESP,
        "stream_id": stream_id,
        "status_code": status_code,
        "headers": headers,
        "body": encode_body(body),
    }


def create_ws_open_frame(
    stream_id: str,
    path: str,
    query: str,
    headers: Dict[str, str],
    sso_assertion: Optional[str] = None,
) -> Dict[str, Any]:
    """Construct a WebSocket open frame forwarding browser connection to edge node."""
    return {
        "type": TunnelMessageType.WS_OPEN,
        "stream_id": stream_id,
        "path": path,
        "query": query,
        "headers": headers,
        "sso_assertion": sso_assertion,
    }


def create_ws_frame(
    stream_id: str,
    data: Any,
    is_binary: bool = False,
) -> Dict[str, Any]:
    """Construct a multiplexed WebSocket data frame."""
    payload = encode_body(data) if is_binary else str(data)
    return {
        "type": TunnelMessageType.WS_FRAME,
        "stream_id": stream_id,
        "is_binary": is_binary,
        "data": payload,
    }


def create_ws_close_frame(
    stream_id: str,
    code: int = 1000,
    reason: str = "Normal Closure",
) -> Dict[str, Any]:
    """Construct a WebSocket close frame."""
    return {
        "type": TunnelMessageType.WS_CLOSE,
        "stream_id": stream_id,
        "code": code,
        "reason": reason,
    }
