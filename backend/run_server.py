"""Uvicorn server launcher with SSL/TLS autodetect and SIGHUP reload support."""

import os
import sys
import argparse
import logging
import uvicorn

from backend.services.cert_manager import cert_manager
from backend.services.maintenance_scheduler import setup_cloudhub_logging

logger = logging.getLogger("cloudhub.server")


def main():
    parser = argparse.ArgumentParser(description="Run ffmpeg-gui-cloudhub server")
    parser.add_argument(
        "--host",
        default=os.environ.get("CLOUDHUB_HOST", "0.0.0.0"),
        help="Host to bind (default: 0.0.0.0)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("CLOUDHUB_PORT", "9000")),
        help="Port to bind (default: 9000)",
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

    setup_cloudhub_logging()

    # Determine SSL paths
    ssl_cert = args.ssl_cert
    ssl_key = args.ssl_key

    if not ssl_cert or not ssl_key:
        if os.path.exists(cert_manager.fullchain_path) and os.path.exists(
            cert_manager.privkey_path
        ):
            ssl_cert = cert_manager.fullchain_path
            ssl_key = cert_manager.privkey_path
            logger.info("Auto-detected SSL certificates in %s", cert_manager.certs_dir)

    scheme = "https" if (ssl_cert and ssl_key) else "http"
    print(
        f"Starting ffmpeg-gui-cloudhub on {scheme}://{args.host}:{args.port} (reload={args.reload})"
    )

    uvicorn.run(
        "backend.main:app",
        host=args.host,
        port=args.port,
        ssl_certfile=ssl_cert,
        ssl_keyfile=ssl_key,
        reload=args.reload,
        proxy_headers=True,
        forwarded_allow_ips="*",
    )


if __name__ == "__main__":
    main()
