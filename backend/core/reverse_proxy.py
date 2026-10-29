"""Reverse proxy and multi-tab isolation router for edge nodes."""

import re
import logging
from typing import Optional, List, Tuple
from urllib.parse import urlparse
from fastapi import APIRouter, Request, Response, WebSocket, WebSocketDisconnect, HTTPException, status
from fastapi.responses import HTMLResponse, Response

from backend.database.db import SessionLocal
from backend.database.models import User, EnrolledNode, AuditLog
from backend.core.auth_manager import AuthManager
from backend.core.tunnel_server import tunnel_server

logger = logging.getLogger("cloudhub.proxy")
router = APIRouter(tags=["proxy"])

JS_SHIM_TEMPLATE = """
<script>
(function() {
  const prefix = '__PROXY_PREFIX__';
  window.__CLOUDHUB_PROXY_PREFIX__ = prefix;

  function rewriteUrl(url) {
    if (typeof url !== 'string') return url;
    if (url.startsWith('/') && !url.startsWith(prefix) && !url.startsWith('//')) {
      return prefix + url;
    }
    return url;
  }

  // 1. Fetch API Interceptor
  const origFetch = window.fetch;
  window.fetch = function(input, init) {
    if (typeof input === 'string') {
      input = rewriteUrl(input);
    } else if (input instanceof Request) {
      try {
        const u = new URL(input.url);
        if (u.pathname.startsWith('/') && !u.pathname.startsWith(prefix)) {
          u.pathname = prefix + u.pathname;
          input = new Request(u.toString(), input);
        }
      } catch(e) {}
    }
    return origFetch.call(this, input, init);
  };

  // 2. XMLHttpRequest Interceptor
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    if (typeof url === 'string') {
      arguments[1] = rewriteUrl(url);
    }
    return origOpen.apply(this, arguments);
  };

  // 3. WebSocket Interceptor
  const OrigWS = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    try {
      const parsed = new URL(url, window.location.href);
      if (parsed.pathname.startsWith('/') && !parsed.pathname.startsWith(prefix)) {
        parsed.pathname = prefix + parsed.pathname;
        url = parsed.toString();
      }
    } catch(e) {}
    return new OrigWS(url, protocols);
  };

  // 4. HTMLImageElement.prototype.src Interceptor (Logos & Program Icons)
  try {
    const origImgSrcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (origImgSrcDesc && origImgSrcDesc.set) {
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        set: function(val) {
          return origImgSrcDesc.set.call(this, rewriteUrl(val));
        },
        get: function() {
          return origImgSrcDesc.get.call(this);
        },
        configurable: true
      });
    }
  } catch(e) {}

  // 5. HTMLLinkElement.prototype.href Interceptor (Dynamic Favicons)
  try {
    const origLinkHrefDesc = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, 'href');
    if (origLinkHrefDesc && origLinkHrefDesc.set) {
      Object.defineProperty(HTMLLinkElement.prototype, 'href', {
        set: function(val) {
          return origLinkHrefDesc.set.call(this, rewriteUrl(val));
        },
        get: function() {
          return origLinkHrefDesc.get.call(this);
        },
        configurable: true
      });
    }
  } catch(e) {}

  // 6. Element.prototype.setAttribute Interceptor
  try {
    const origSetAttr = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, val) {
      if ((name === 'src' || name === 'href') && typeof val === 'string') {
        val = rewriteUrl(val);
      }
      return origSetAttr.call(this, name, val);
    };
  } catch(e) {}

  // 7. MutationObserver to catch inline or dynamically mounted DOM nodes
  try {
    const patchElement = function(el) {
      if (!el || el.nodeType !== 1) return;
      if (el.tagName === 'IMG') {
        const s = el.getAttribute('src');
        if (s && s.startsWith('/') && !s.startsWith(prefix) && !s.startsWith('//')) {
          el.setAttribute('src', prefix + s);
        }
      } else if (el.tagName === 'LINK') {
        const h = el.getAttribute('href');
        if (h && h.startsWith('/') && !h.startsWith(prefix) && !h.startsWith('//')) {
          el.setAttribute('href', prefix + h);
        }
      }
      if (el.querySelectorAll) {
        const imgs = el.querySelectorAll('img[src^="/"]');
        for (let i = 0; i < imgs.length; i++) {
          const s = imgs[i].getAttribute('src');
          if (s && !s.startsWith(prefix) && !s.startsWith('//')) {
            imgs[i].setAttribute('src', prefix + s);
          }
        }
        const links = el.querySelectorAll('link[href^="/"]');
        for (let i = 0; i < links.length; i++) {
          const h = links[i].getAttribute('href');
          if (h && !h.startsWith(prefix) && !h.startsWith('//')) {
            links[i].setAttribute('href', prefix + h);
          }
        }
      }
    };

    const observer = new MutationObserver(function(mutations) {
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        if (m.type === 'childList') {
          for (let j = 0; j < m.addedNodes.length; j++) {
            patchElement(m.addedNodes[j]);
          }
        }
      }
    });

    if (document.documentElement) {
      observer.observe(document.documentElement, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', function() {
        observer.observe(document.documentElement, { childList: true, subtree: true });
      });
    }
  } catch(e) {}
})();
</script>
"""


def authenticate_user_from_request(request: Request, db) -> Optional[User]:
    """Extract and validate user session from Bearer header or ch_session cookie."""
    token = None
    auth = request.headers.get("authorization")
    if auth and auth.lower().startswith("bearer "):
        token = auth[7:].strip()
    elif "ch_session" in request.cookies:
        token = request.cookies.get("ch_session")

    if not token:
        return None

    def lookup(uid: int):
        return db.query(User).filter(User.id == uid).first()

    return AuthManager.validate_session(token, lookup)


def authenticate_user_from_ws(websocket: WebSocket, db) -> Optional[User]:
    """Extract and validate user session for WebSocket upgrade requests."""
    token = None
    auth = websocket.headers.get("authorization")
    if auth and auth.lower().startswith("bearer "):
        token = auth[7:].strip()
    elif "ch_session" in websocket.cookies:
        token = websocket.cookies.get("ch_session")

    if not token:
        # Check query string fallback for WebSocket
        token = websocket.query_params.get("session_token")

    if not token:
        return None

    def lookup(uid: int):
        return db.query(User).filter(User.id == uid).first()

    return AuthManager.validate_session(token, lookup)


@router.websocket("/proxy/{node_id}/{subpath:path}")
@router.websocket("/proxy/{node_id}")
async def proxy_websocket_endpoint(
    websocket: WebSocket,
    node_id: str,
    subpath: str = "",
):
    """
    WebSocket reverse proxy tunneling browser WebSocket connections to edge appliance.
    """
    await websocket.accept()
    with SessionLocal() as db:
        user = authenticate_user_from_ws(websocket, db)
        if not user:
            await websocket.close(code=4001, reason="Authentication required")
            return

        node = db.query(EnrolledNode).filter(EnrolledNode.node_id == node_id).first()
        if not node:
            await websocket.close(code=4004, reason="Appliance not found")
            return

        if not AuthManager.can_user_access_node(db, user, node):
            await websocket.close(code=4003, reason="Access denied to this appliance")
            return

        sso_assertion = AuthManager.create_sso_assertion(
            node_id=node.node_id,
            tunnel_secret=node.tunnel_secret,
            username=user.username,
            ttl_seconds=60,
        )

    # Bridge into edge reverse tunnel
    target_path = "/" + subpath.lstrip("/")
    query_str = str(websocket.url.query) if websocket.url.query else ""
    headers = dict(websocket.headers)

    await tunnel_server.bridge_websocket(
        node_id=node_id,
        browser_ws=websocket,
        path=target_path,
        query=query_str,
        headers=headers,
        sso_assertion=sso_assertion,
    )


@router.api_route("/proxy/{node_id}/{subpath:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])
@router.api_route("/proxy/{node_id}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])
async def proxy_http_endpoint(
    request: Request,
    node_id: str,
    subpath: str = "",
):
    """
    HTTP reverse proxy forwarding requests to edge appliance over multiplexed reverse tunnel.
    Rewrites HTML and cookies for multi-tab single-domain isolation.
    """
    with SessionLocal() as db:
        user = authenticate_user_from_request(request, db)
        if not user:
            # Check sso_assertion parameter from query if clicking direct link
            sso_param = request.query_params.get("sso_assertion")
            if not sso_param:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Authentication required to access node",
                )

        node = db.query(EnrolledNode).filter(EnrolledNode.node_id == node_id).first()
        if not node:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Node '{node_id}' not enrolled",
            )

        if user and not AuthManager.can_user_access_node(db, user, node):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied to this node",
            )

        username = user.username if user else "anonymous"
        sso_assertion = AuthManager.create_sso_assertion(
            node_id=node.node_id,
            tunnel_secret=node.tunnel_secret,
            username=username,
            ttl_seconds=60,
        )

    target_path = "/" + subpath.lstrip("/")
    query_str = str(request.url.query) if request.url.query else ""
    req_body = await request.body()
    req_headers = dict(request.headers)

    # Audit remote session termination if operator logs out or disconnects
    if request.method == "POST" and target_path in ("/logout", "/api/auth/logout", "/api/logout"):
        try:
            with SessionLocal() as db_audit:
                appliance_label = node.name or node.node_id
                client_ip = request.client.host if request.client else None
                db_audit.add(
                    AuditLog(
                        username=username,
                        org_id=node.org_id,
                        node_id=node.node_id,
                        channel="cloudhub",
                        action="NODE_SESSION_END",
                        target_type="node",
                        target_id=node.node_id,
                        ip_address=client_ip,
                        details=f"Operator '{username}' closed remote session to appliance '{appliance_label}'",
                    )
                )
                db_audit.commit()
        except Exception as audit_err:
            logger.debug("Failed to record NODE_SESSION_END audit log: %s", audit_err)

    try:
        status_code, resp_headers, body_bytes = await tunnel_server.forward_http(
            node_id=node_id,
            method=request.method,
            path=target_path,
            query=query_str,
            headers=req_headers,
            body=req_body,
            sso_assertion=sso_assertion,
        )
    except ConnectionError as conn_err:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Edge node '{node_id}' is offline or tunnel disconnected",
        )
    except TimeoutError as timeout_err:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=str(timeout_err),
        )

    response_headers = []
    content_type = ""
    proxy_prefix = f"/proxy/{node_id}"

    for k, v in resp_headers:
        k_lower = k.lower()
        if k_lower == "content-type":
            content_type = v
            response_headers.append((k, v))
        elif k_lower == "set-cookie":
            # Multi-tab cookie isolation: rewrite Path=/ to Path=/proxy/{node_id}/
            rewritten_cookie = re.sub(
                r"Path=/([;,\s]|$)",
                f"Path={proxy_prefix}/\\1",
                v,
                flags=re.IGNORECASE,
            )
            response_headers.append((k, rewritten_cookie))
        elif k_lower in ("content-length", "transfer-encoding", "content-encoding"):
            # Omit hop-by-hop or sizing headers since body may be rewritten
            continue
        else:
            response_headers.append((k, v))

    # Single-Domain HTML Rewriting
    if "text/html" in content_type.lower() and body_bytes:
        try:
            html_text = body_bytes.decode("utf-8")
            shim = JS_SHIM_TEMPLATE.replace("__PROXY_PREFIX__", proxy_prefix)

            # Inject shim in <head>
            if "<head>" in html_text:
                html_text = html_text.replace("<head>", f"<head>{shim}", 1)
            else:
                html_text = shim + html_text

            # Rewrite static asset references
            html_text = re.sub(r'href="/assets/', f'href="{proxy_prefix}/assets/', html_text)
            html_text = re.sub(r'src="/assets/', f'src="{proxy_prefix}/assets/', html_text)
            html_text = re.sub(r'href="/api/', f'href="{proxy_prefix}/api/', html_text)
            html_text = re.sub(r'src="/api/', f'src="{proxy_prefix}/api/', html_text)
            html_text = re.sub(r'href="/uploads/', f'href="{proxy_prefix}/uploads/', html_text)
            html_text = re.sub(r'src="/uploads/', f'src="{proxy_prefix}/uploads/', html_text)
            html_text = re.sub(r'href="/favicon', f'href="{proxy_prefix}/favicon', html_text)
            html_text = re.sub(r'src="/favicon', f'src="{proxy_prefix}/favicon', html_text)

            body_bytes = html_text.encode("utf-8")
        except Exception as err:
            logger.debug("HTML rewrite error: %s", err)

    return Response(
        content=body_bytes,
        status_code=status_code,
        headers=dict(response_headers),
    )
