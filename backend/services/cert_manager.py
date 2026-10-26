"""SSL/TLS Certificate Manager for Let's Encrypt and custom SSL certs."""

import os
import json
import ssl
import datetime
import subprocess
import logging
from typing import Dict, Any, Optional, Tuple

logger = logging.getLogger("cloudhub.cert_manager")

DEFAULT_CERTS_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../data/certs/live")
)


class CertificateManager:
    """Manages active SSL certificates, renewal health, and certbot orchestration."""

    def __init__(self, certs_dir: Optional[str] = None):
        self.certs_dir = certs_dir or DEFAULT_CERTS_DIR
        self.fullchain_path = os.path.join(self.certs_dir, "fullchain.pem")
        self.privkey_path = os.path.join(self.certs_dir, "privkey.pem")
        self.metadata_path = os.path.join(self.certs_dir, "metadata.json")
        self._ensure_dir()

    def _ensure_dir(self):
        os.makedirs(self.certs_dir, mode=0o700, exist_ok=True)

    def get_cert_status(self) -> Dict[str, Any]:
        """Evaluates active certificate status in self.certs_dir."""
        if not os.path.exists(self.fullchain_path) or not os.path.exists(self.privkey_path):
            return {
                "status": "missing",
                "valid": False,
                "days_remaining": 0,
                "domain": None,
                "issuer": None,
                "expires_at": None,
                "mode": "disabled",
                "error": "No SSL certificate or private key found in storage.",
            }

        try:
            cmd = [
                "openssl",
                "x509",
                "-in",
                self.fullchain_path,
                "-noout",
                "-dates",
                "-subject",
                "-issuer",
            ]
            res = subprocess.run(cmd, capture_output=True, text=True, check=True)
            output = res.stdout

            details = {}
            for line in output.splitlines():
                if "=" in line:
                    k, v = line.split("=", 1)
                    details[k.strip().lower()] = v.strip()

            not_after_str = details.get("notafter")
            subject_str = details.get("subject", "")
            issuer_str = details.get("issuer", "")

            domain = None
            if "CN" in subject_str:
                for part in subject_str.split("/"):
                    if part.startswith("CN=") or part.startswith("CN ="):
                        domain = part.split("=", 1)[1].strip()
                        break

            expires_at_dt = None
            if not_after_str:
                try:
                    expires_at_dt = datetime.datetime.strptime(
                        not_after_str, "%b %d %H:%M:%S %Y GMT"
                    ).replace(tzinfo=datetime.timezone.utc)
                except ValueError:
                    pass

            now_dt = datetime.datetime.now(datetime.timezone.utc)
            if expires_at_dt:
                days_remaining = (expires_at_dt - now_dt).days
                expires_at_iso = expires_at_dt.isoformat()
            else:
                days_remaining = 0
                expires_at_iso = None

            if days_remaining <= 0:
                status_code = "expired"
                is_valid = False
            elif days_remaining < 15:
                status_code = "critical"
                is_valid = True
            elif days_remaining <= 30:
                status_code = "warning"
                is_valid = True
            else:
                status_code = "valid"
                is_valid = True

            mode = "custom"
            if os.path.exists(self.metadata_path):
                try:
                    with open(self.metadata_path, "r", encoding="utf-8") as f:
                        meta = json.load(f)
                        mode = meta.get("mode", "custom")
                except Exception:
                    pass

            return {
                "status": status_code,
                "valid": is_valid,
                "days_remaining": max(0, days_remaining),
                "domain": domain,
                "issuer": issuer_str,
                "expires_at": expires_at_iso,
                "mode": mode,
                "error": None,
            }
        except Exception as err:
            logger.error("Failed to read SSL certificate info: %s", err)
            return {
                "status": "error",
                "valid": False,
                "days_remaining": 0,
                "domain": None,
                "issuer": None,
                "expires_at": None,
                "mode": "disabled",
                "error": str(err),
            }


cert_manager = CertificateManager()
