"""Main entry point for ffmpeg-gui-cloudhub FastAPI server."""

import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.version import __version__
from backend.database.version import DB_SCHEMA_VERSION
from backend.database.db import init_db
from backend.routers import auth_routes, tenant_routes, edge_routes, settings_routes
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
    logger.info("Initializing ffmpeg-gui-cloudhub v%s (DB v%s)...", __version__, DB_SCHEMA_VERSION)
    init_db()
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

# Include API routers
app.include_router(auth_routes.router)
app.include_router(tenant_routes.router)
app.include_router(edge_routes.router)
app.include_router(settings_routes.router)
app.include_router(reverse_proxy.router)


@app.get("/api/health")
def health():
    return {
        "status": "healthy",
        "service": "ffmpeg-gui-cloudhub",
        "version": __version__,
        "db_schema_version": DB_SCHEMA_VERSION,
    }


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
