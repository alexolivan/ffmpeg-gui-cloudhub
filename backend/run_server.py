"""Uvicorn dual-server launcher (HTTP + HTTPS) with fail-safe bind resolver and SIGHUP warm reload."""

import os
import sys
import json
import signal
import asyncio
import argparse
import logging
import uvicorn

from backend.database.db import init_db, SessionLocal
from backend.database.models import SystemSettings
from backend.services.cert_manager import cert_manager
from backend.services.maintenance_scheduler import setup_cloudhub_logging
from backend.core.network_inspector import resolve_bind_address

logger = logging.getLogger("cloudhub.server")


def _load_runtime_config(args) -> dict:
    """Reads network, SSL, and logging settings from DB with CLI/env fallbacks."""
    host = os.environ.get("CLOUDHUB_HOST", "0.0.0.0")
    http_port = int(os.environ.get("CLOUDHUB_PORT", "9000"))
    https_port = int(os.environ.get("CLOUDHUB_HTTPS_PORT", "9443"))
    ssl_enabled = False

    logging_mode = "both"
    logging_path = "data/logs"
    logging_timestamp_tz = "utc"
    logging_rotation_enabled = True
    logging_rotation_max_bytes = 10 * 1024 * 1024
    logging_rotation_backup_count = 5

    try:
        init_db()
        with SessionLocal() as db:
            records = (
                db.query(SystemSettings)
                .filter(
                    SystemSettings.key.in_(
                        [
                            "bind_address",
                            "http_port",
                            "https_port",
                            "ssl_enabled",
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

            if cfg.get("bind_address"):
                host = str(cfg["bind_address"])
            if cfg.get("http_port") is not None:
                http_port = int(cfg["http_port"])
            if cfg.get("https_port") is not None:
                https_port = int(cfg["https_port"])
            if cfg.get("ssl_enabled") is not None:
                ssl_enabled = bool(cfg["ssl_enabled"])

            if cfg.get("logging_mode"):
                logging_mode = str(cfg["logging_mode"])
            if cfg.get("logging_path"):
                logging_path = str(cfg["logging_path"])
            if cfg.get("logging_timestamp_tz"):
                logging_timestamp_tz = str(cfg["logging_timestamp_tz"])
            if cfg.get("logging_rotation_enabled") is not None:
                logging_rotation_enabled = bool(cfg["logging_rotation_enabled"])
            if cfg.get("logging_rotation_max_bytes") is not None:
                logging_rotation_max_bytes = int(cfg["logging_rotation_max_bytes"])
            if cfg.get("logging_rotation_backup_count") is not None:
                logging_rotation_backup_count = int(cfg["logging_rotation_backup_count"])
    except Exception as exc:
        logger.warning("Could not read settings from DB, using defaults: %s", exc)

    # Explicit CLI overrides take precedence when supplied
    if args.host is not None:
        host = args.host
    if args.port is not None:
        http_port = args.port
    if args.https_port is not None:
        https_port = args.https_port

    return {
        "host": host,
        "http_port": http_port,
        "https_port": https_port,
        "ssl_enabled": ssl_enabled,
        "logging_mode": logging_mode,
        "logging_path": logging_path,
        "logging_timestamp_tz": logging_timestamp_tz,
        "logging_rotation_enabled": logging_rotation_enabled,
        "logging_rotation_max_bytes": logging_rotation_max_bytes,
        "logging_rotation_backup_count": logging_rotation_backup_count,
    }


def main():
    parser = argparse.ArgumentParser(description="Run ffmpeg-gui-cloudhub server")
    parser.add_argument(
        "--host",
        default=None,
        help="Host to bind (overrides DB setting, default: 0.0.0.0)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=None,
        help="HTTP Port to bind (overrides DB setting, default: 9000)",
    )
    parser.add_argument(
        "--https-port",
        type=int,
        default=None,
        help="HTTPS Port to bind when SSL is enabled (overrides DB setting, default: 9443)",
    )
    parser.add_argument(
        "--ssl-cert",
        default=os.environ.get("CLOUDHUB_SSL_CERT"),
        help="Path to SSL certificate fullchain.pem",
    )
    parser.add_argument(
        "--ssl-key",
        default=os.environ.get("CLOUDHUB_SSL_KEY"),
        help="Path to SSL private key privkey.pem",
    )
    parser.add_argument(
        "--reload",
        action="store_true",
        help="Enable auto-reload for development",
    )

    args = parser.parse_args()
    cfg = _load_runtime_config(args)
    setup_cloudhub_logging(
        log_dir=cfg["logging_path"],
        max_bytes=cfg["logging_rotation_max_bytes"],
        backup_count=cfg["logging_rotation_backup_count"],
        mode=cfg["logging_mode"],
        timestamp_tz=cfg["logging_timestamp_tz"],
        rotation_enabled=cfg["logging_rotation_enabled"],
    )

    if args.reload:
        uvicorn.run(
            "backend.main:app",
            host=cfg["host"],
            port=cfg["http_port"],
            reload=True,
            proxy_headers=True,
            forwarded_allow_ips="*",
            log_config=None,
        )
        return

    while True:
        cfg = _load_runtime_config(args)
        setup_cloudhub_logging(
            log_dir=cfg["logging_path"],
            max_bytes=cfg["logging_rotation_max_bytes"],
            backup_count=cfg["logging_rotation_backup_count"],
            mode=cfg["logging_mode"],
            timestamp_tz=cfg["logging_timestamp_tz"],
            rotation_enabled=cfg["logging_rotation_enabled"],
        )
        host = cfg["host"]
        http_port = cfg["http_port"]
        https_port = cfg["https_port"]
        ssl_enabled = cfg["ssl_enabled"]

        # 1. Fail-Safe Host Resolver (prevent admin lockout on DHCP renewal or interface change)
        effective_host, fell_back, reason = resolve_bind_address(host)
        if fell_back:
            logger.warning("[NETWORK FAIL-SAFE WARNING] %s", reason)
            logger.warning(
                "[NETWORK FAIL-SAFE] Binding server to '%s' to prevent administrative lockout.",
                effective_host,
            )
            host = effective_host

        # 2. Check SSL Certificate Availability (only activate HTTPS when ssl_enabled=True or explicit CLI cert)
        ssl_certfile = args.ssl_cert
        ssl_keyfile = args.ssl_key
        if ssl_certfile and ssl_keyfile:
            ssl_enabled = True
        elif ssl_enabled:
            cert_status = cert_manager.get_cert_status()
            if cert_status.get("valid"):
                ssl_certfile = cert_manager.fullchain_path
                ssl_keyfile = cert_manager.privkey_path
                logger.info(
                    "SSL/TLS Certificate verified! Key: %s, Cert: %s",
                    ssl_keyfile,
                    ssl_certfile,
                )
            else:
                logger.warning(
                    "ssl_enabled=True in config, but no valid production SSL certificate was found in storage. "
                    "Activating fallback self-signed certificate to keep HTTPS port %s accessible without administrative lockout.",
                    https_port,
                )
                ssl_certfile, ssl_keyfile = cert_manager.get_or_create_fallback_cert(host=effective_host)

        active_servers = []
        if ssl_enabled and ssl_certfile and ssl_keyfile:
            logger.info(
                "Configuring CloudHub HTTPS Server on https://%s:%s...",
                host,
                https_port,
            )
            https_config = uvicorn.Config(
                "backend.main:app",
                host=host,
                port=https_port,
                ssl_keyfile=ssl_keyfile,
                ssl_certfile=ssl_certfile,
                proxy_headers=True,
                forwarded_allow_ips="*",
                log_config=None,
            )
            active_servers.append(uvicorn.Server(https_config))

            if http_port != https_port:
                logger.info(
                    "Configuring CloudHub HTTP Server on http://%s:%s...",
                    host,
                    http_port,
                )
                http_config = uvicorn.Config(
                    "backend.main:app",
                    host=host,
                    port=http_port,
                    proxy_headers=True,
                    forwarded_allow_ips="*",
                    log_config=None,
                )
                active_servers.append(uvicorn.Server(http_config))
        else:
            logger.info(
                "Configuring CloudHub HTTP Server on http://%s:%s...",
                host,
                http_port,
            )
            http_config = uvicorn.Config(
                "backend.main:app",
                host=host,
                port=http_port,
                proxy_headers=True,
                forwarded_allow_ips="*",
                log_config=None,
            )
            active_servers.append(uvicorn.Server(http_config))

        reload_requested = False

        async def _serve_all():
            nonlocal reload_requested
            loop = asyncio.get_running_loop()

            def _handle_reload(signum):
                nonlocal reload_requested
                logger.info(
                    "[CLOUDHUB] Received SIGHUP signal -> Initiating Warm Reload of HTTP/HTTPS listeners..."
                )
                reload_requested = True
                for s in active_servers:
                    s.should_exit = True

            def _handle_exit(signum):
                nonlocal reload_requested
                sig_name = "SIGTERM" if signum == signal.SIGTERM else "SIGINT"
                logger.info(
                    "[CLOUDHUB] Received %s signal -> Initiating Clean Shutdown...",
                    sig_name,
                )
                reload_requested = False
                for s in active_servers:
                    s.should_exit = True

            for sig in (getattr(signal, "SIGHUP", None), getattr(signal, "SIGUSR1", None)):
                if sig is not None:
                    try:
                        loop.add_signal_handler(sig, lambda s=sig: _handle_reload(s))
                    except (ValueError, RuntimeError, AttributeError):
                        pass

            for sig in (signal.SIGTERM, signal.SIGINT):
                try:
                    loop.add_signal_handler(sig, lambda s=sig: _handle_exit(s))
                except (ValueError, RuntimeError, AttributeError):
                    pass

            for s in active_servers:
                s.install_signal_handlers = lambda: None

            await asyncio.gather(*(s.serve() for s in active_servers))

        asyncio.run(_serve_all())

        if not reload_requested:
            break
        logger.info("[CLOUDHUB] Warm reload cycle restarting listeners...")


if __name__ == "__main__":
    main()
