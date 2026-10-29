"""Main entry point for ffmpeg-gui-cloudhub FastAPI server."""

import os
import logging
import datetime
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.version import __version__
from backend.database.version import DB_SCHEMA_VERSION
from backend.database.db import init_db
from backend.routers import auth_routes, tenant_routes, edge_routes, settings_routes, backup_routes
from backend.core import reverse_proxy
from backend.services.maintenance_scheduler import setup_cloudhub_logging, maintenance_scheduler

setup_cloudhub_logging()
logger = logging.getLogger("cloudhub.main")

FRONTEND_DIST_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../frontend/dist")
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager running schema creation on startup and starting maintenance."""
    init_db()
    try:
        from backend.database.db import SessionLocal
        from backend.database.models import SystemSettings
        import json
        with SessionLocal() as db:
            records = (
                db.query(SystemSettings)
                .filter(
                    SystemSettings.key.in_(
                        [
                            "logging_mode",
                            "logging_path",
                            "logging_timestamp_tz",
                            "logging_rotation_enabled",
                            "logging_rotation_max_bytes",
                            "logging_rotation_backup_count",
                        ]
                    )
                )
                .all()
            )
            cfg = {}
            for r in records:
                try:
                    cfg[r.key] = json.loads(r.value)
                except Exception:
                    cfg[r.key] = r.value

            setup_cloudhub_logging(
                log_dir=str(cfg.get("logging_path", "data/logs")),
                max_bytes=int(cfg.get("logging_rotation_max_bytes", 10485760)),
                backup_count=int(cfg.get("logging_rotation_backup_count", 5)),
                mode=str(cfg.get("logging_mode", "both")),
                timestamp_tz=str(cfg.get("logging_timestamp_tz", "utc")),
                rotation_enabled=bool(cfg.get("logging_rotation_enabled", True)),
            )
    except Exception as exc:
        logger.debug("Could not initialize logging from DB: %s", exc)

    logger.info("Initializing ffmpeg-gui-cloudhub v%s (DB v%s)...", __version__, DB_SCHEMA_VERSION)
    maintenance_scheduler.start()
    yield
    maintenance_scheduler.stop()
    logger.info("CloudHub server shutting down.")


app = FastAPI(
    title="ffmpeg-gui-cloudhub",
    version=__version__,
    description="Multi-tenant reverse tunnel bastion and telemetry control plane for ffmpeg-gui appliances",
    lifespan=lifespan,
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AccessLogMiddleware:
    """ASGI Middleware emitting W3C / Nginx Combined Log Format lines for all HTTP traffic."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        status_code = [200]
        content_length = ["-"]

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                status_code[0] = message["status"]
                headers = message.get("headers", [])
                for key, val in headers:
                    if key.lower() == b"content-length":
                        content_length[0] = val.decode("utf-8", errors="ignore")
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            path = scope.get("path", "-")
            status = status_code[0]

            # Suppress static assets from access log for successful requests
            ignore_static = os.getenv("ACCESS_LOG_IGNORE_STATIC", "true").lower() == "true"
            if ignore_static and status < 400:
                clean_path = path.split("?")[0].lower()
                if clean_path.startswith("/assets/") or clean_path in ("/favicon.ico", "/favicon.svg"):
                    return

            client = scope.get("client")
            client_host = client[0] if client else "-"
            remote_user = "-"

            headers = scope.get("headers", [])
            referer = "-"
            user_agent = "-"
            for key, val in headers:
                key_lower = key.lower()
                if key_lower == b"referer":
                    referer = val.decode("utf-8", errors="ignore")
                elif key_lower == b"user-agent":
                    user_agent = val.decode("utf-8", errors="ignore")
                elif key_lower == b"x-forwarded-for":
                    xff_val = val.decode("utf-8", errors="ignore").strip()
                    if xff_val:
                        client_host = xff_val.split(",")[0].strip()
                elif key_lower == b"x-real-ip" and client_host in ("-", "127.0.0.1", "::1", "localhost"):
                    x_real_val = val.decode("utf-8", errors="ignore").strip()
                    if x_real_val:
                        client_host = x_real_val

            now = datetime.datetime.now(datetime.timezone.utc)
            time_local = now.strftime("%d/%b/%Y:%H:%M:%S +0000")

            method = scope.get("method", "-")
            query_string = scope.get("query_string", b"").decode("utf-8", errors="ignore")
            full_path = f"{path}?{query_string}" if query_string else path
            http_version = scope.get("http_version", "1.1")
            request_line = f"{method} {full_path} HTTP/{http_version}"

            access_log_path = os.getenv("ACCESS_LOG_PATH")
            if access_log_path:
                try:
                    nginx_line = f'{client_host} - {remote_user} [{time_local}] "{request_line}" {status_code[0]} {content_length[0]} "{referer}" "{user_agent}"'
                    with open(access_log_path, "a", encoding="utf-8") as f:
                        f.write(nginx_line + "\n")
                except Exception:
                    pass


app.add_middleware(AccessLogMiddleware)


@app.middleware("http")
async def force_https_middleware(request: Request, call_next):
    """Enforces HTTP -> HTTPS (307) redirection to https_port when ssl_enabled and force_https_redirect are active."""
    if request.url.path.startswith("/.well-known/acme-challenge/"):
        return await call_next(request)

    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    if proto == "http":
        try:
            from backend.database.db import SessionLocal
            from backend.database.models import SystemSettings
            from backend.services.cert_manager import cert_manager
            import json

            with SessionLocal() as db:
                records = (
                    db.query(SystemSettings)
                    .filter(
                        SystemSettings.key.in_(
                            ["ssl_enabled", "force_https_redirect", "force_https", "https_port"]
                        )
                    )
                    .all()
                )
                cfg = {}
                for r in records:
                    try:
                        cfg[r.key] = json.loads(r.value)
                    except Exception:
                        cfg[r.key] = r.value

                ssl_enabled = bool(cfg.get("ssl_enabled", False))
                force_redirect = bool(
                    cfg.get("force_https_redirect", cfg.get("force_https", False))
                )
                https_port = int(
                    cfg.get("https_port", os.environ.get("CLOUDHUB_HTTPS_PORT", "9443"))
                )

                if ssl_enabled and force_redirect and cert_manager.get_cert_status().get("valid"):
                    hostname = request.url.hostname or "localhost"
                    hub_domain = str(cfg.get("hub_domain") or "").strip()

                    # Detect if request arrived via numerical IP or localhost
                    is_ip = False
                    try:
                        import ipaddress
                        ipaddress.ip_address(hostname)
                        is_ip = True
                    except ValueError:
                        is_ip = False

                    # If request used IP/localhost but a public FQDN domain is configured, redirect to the domain
                    # so the browser validates the SSL/TLS certificate subject/SAN without ERR_CERT_COMMON_NAME_INVALID
                    target_host = hostname
                    if hub_domain and hub_domain != "localhost" and (is_ip or hostname == "localhost"):
                        target_host = hub_domain

                    target_netloc = (
                        target_host if https_port == 443 else f"{target_host}:{https_port}"
                    )
                    url = request.url.replace(scheme="https", netloc=target_netloc)
                    from fastapi.responses import RedirectResponse

                    return RedirectResponse(url=str(url), status_code=307)
        except Exception:
            pass

    return await call_next(request)

# Include API routers
app.include_router(auth_routes.router)
app.include_router(tenant_routes.router)
app.include_router(edge_routes.router)
app.include_router(settings_routes.router)
app.include_router(backup_routes.router)
app.include_router(reverse_proxy.router)


@app.get("/api/health")
def health():
    return {
        "status": "healthy",
        "service": "ffmpeg-gui-cloudhub",
        "version": __version__,
        "db_schema_version": DB_SCHEMA_VERSION,
    }


# Appliance Reverse Proxy Fallback for un-shimmed or dynamic browser requests (uploads, icons, favicon)
@app.get("/uploads/{subpath:path}")
@app.post("/uploads/{subpath:path}")
@app.get("/api/settings/software/{subpath:path}")
@app.post("/api/settings/software/{subpath:path}")
@app.get("/api/software/{subpath:path}")
@app.get("/favicon.ico")
@app.get("/favicon.svg")
@app.get("/favicon.png")
async def proxy_referer_fallback(request: Request):
    """
    Recovers appliance assets (logos, software engine icons, favicons) requested by
    a proxied appliance web session when raw absolute paths bypass the JS shim.
    Inspects Referer header to identify originating node_id and redirects (307).
    """
    import re
    from fastapi.responses import RedirectResponse
    referer = request.headers.get("referer", "")
    match = re.search(r"/proxy/([^/?#]+)", referer)
    if match:
        node_id = match.group(1)
        rel_path = request.url.path.lstrip("/")
        query = f"?{request.url.query}" if request.url.query else ""
        return RedirectResponse(url=f"/proxy/{node_id}/{rel_path}{query}", status_code=307)

    return JSONResponse(status_code=404, content={"detail": "Not Found"})


# Serve SPA frontend if build exists
if os.path.isdir(FRONTEND_DIST_DIR):
    assets_dir = os.path.join(FRONTEND_DIST_DIR, "assets")
    if os.path.isdir(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(request: Request, full_path: str):
        # Do not catch API or tunnel proxy paths
        if full_path.startswith("api/") or full_path.startswith("proxy/") or full_path.startswith("ws/"):
            return JSONResponse(status_code=404, content={"detail": "Not Found"})

        file_path = os.path.join(FRONTEND_DIST_DIR, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)

        index_file = os.path.join(FRONTEND_DIST_DIR, "index.html")
        if os.path.isfile(index_file):
            return FileResponse(index_file)

        return JSONResponse(status_code=404, content={"detail": "Frontend assets not compiled"})
