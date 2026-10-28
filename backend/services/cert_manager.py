"""SSL/TLS Certificate Manager for Let's Encrypt ACME and custom SSL certs."""

import os
import json
import ssl
import datetime
import logging
from typing import Dict, Any, Optional, Tuple

from cryptography import x509
from cryptography.x509.oid import NameOID, ExtensionOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa

logger = logging.getLogger("cloudhub.cert_manager")

DEFAULT_CERTS_DIR = os.environ.get(
    "CLOUDHUB_CERTS_DIR",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "../../data/certs/live")),
)


class CertificateManager:
    """Manages active SSL certificates, renewal health, and ACME orchestration."""

    def __init__(self, certs_dir: Optional[str] = None):
        self.certs_dir = certs_dir or os.environ.get("CLOUDHUB_CERTS_DIR") or DEFAULT_CERTS_DIR
        self.fullchain_path = os.path.join(self.certs_dir, "fullchain.pem")
        self.privkey_path = os.path.join(self.certs_dir, "privkey.pem")
        self.metadata_path = os.path.join(self.certs_dir, "metadata.json")
        try:
            self._ensure_dir()
        except OSError:
            pass

    def _ensure_dir(self):
        os.makedirs(self.certs_dir, mode=0o700, exist_ok=True)

    def get_cert_status(self) -> Dict[str, Any]:
        """Evaluates active certificate status in self.certs_dir using cryptography.x509."""
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
            with open(self.fullchain_path, "rb") as f:
                cert_bytes = f.read()
            cert = x509.load_pem_x509_certificate(cert_bytes)

            # 1. Extract Domain Name (Common Name or Subject Alternative Names)
            domain = None
            cns = cert.subject.get_attributes_for_oid(NameOID.COMMON_NAME)
            if cns:
                domain = str(cns[0].value).strip()

            if not domain:
                try:
                    san_ext = cert.extensions.get_extension_for_oid(ExtensionOID.SUBJECT_ALTERNATIVE_NAME)
                    dns_names = san_ext.value.get_values_for_type(x509.DNSName)
                    if dns_names:
                        domain = dns_names[0].strip()
                except Exception:
                    pass

            # 2. Extract Issuer
            issuer_cns = cert.issuer.get_attributes_for_oid(NameOID.COMMON_NAME)
            if issuer_cns:
                issuer_str = str(issuer_cns[0].value).strip()
            else:
                issuer_str = cert.issuer.rfc4514_string()

            # 3. Check Metadata
            mode = "custom"
            is_staging_cert = False
            if os.path.exists(self.metadata_path):
                try:
                    with open(self.metadata_path, "r", encoding="utf-8") as f:
                        meta = json.load(f)
                        mode = meta.get("mode", "custom")
                        if not domain and meta.get("domain"):
                            domain = meta.get("domain")
                        if meta.get("staging") is True:
                            is_staging_cert = True
                except Exception:
                    pass

            # 4. Check Staging / Dry-run indicators
            if "(staging)" in issuer_str.lower() or "fake le" in issuer_str.lower():
                is_staging_cert = True

            if is_staging_cert:
                logger.warning(
                    "Detected Let's Encrypt Staging (dry-run) certificate in live storage; purging so it is not used in production."
                )
                self.delete_cert()
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

            # 5. Expiration & Status calculation
            expires_at_dt = cert.not_valid_after_utc
            now_dt = datetime.datetime.now(datetime.timezone.utc)
            days_remaining = (expires_at_dt - now_dt).days
            expires_at_iso = expires_at_dt.isoformat()

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

    def get_or_create_fallback_cert(self, host: str = "localhost") -> Tuple[str, str]:
        """Returns paths (fullchain.pem, privkey.pem) for a persistent self-signed fallback certificate."""
        fallback_dir = os.path.abspath(os.path.join(self.certs_dir, "../fallback"))
        os.makedirs(fallback_dir, mode=0o700, exist_ok=True)
        fb_cert = os.path.join(fallback_dir, "fullchain.pem")
        fb_key = os.path.join(fallback_dir, "privkey.pem")

        if os.path.exists(fb_cert) and os.path.exists(fb_key):
            try:
                with open(fb_cert, "rb") as f:
                    c = x509.load_pem_x509_certificate(f.read())
                now = datetime.datetime.now(datetime.timezone.utc)
                if c.not_valid_after_utc > now:
                    return fb_cert, fb_key
            except Exception:
                pass

        import ipaddress

        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cn = host if host and host not in ("0.0.0.0", "::") else "localhost"
        subject = issuer = x509.Name([
            x509.NameAttribute(NameOID.COMMON_NAME, cn),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "ffmpeg-gui CloudHub Fallback"),
        ])

        san_list = [x509.DNSName("localhost")]
        if cn != "localhost":
            try:
                ip = ipaddress.ip_address(cn)
                san_list.append(x509.IPAddress(ip))
            except ValueError:
                san_list.append(x509.DNSName(cn))

        now = datetime.datetime.now(datetime.timezone.utc)
        cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(issuer)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(days=1))
            .not_valid_after(now + datetime.timedelta(days=3650))
            .add_extension(x509.SubjectAlternativeName(san_list), critical=False)
            .sign(key, hashes.SHA256())
        )

        with open(fb_cert, "wb") as f:
            f.write(cert.public_bytes(serialization.Encoding.PEM))
        with open(fb_key, "wb") as f:
            f.write(key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.TraditionalOpenSSL,
                encryption_algorithm=serialization.NoEncryption(),
            ))
        os.chmod(fb_cert, 0o644)
        os.chmod(fb_key, 0o600)
        return fb_cert, fb_key

    def save_custom_cert(
        self, cert_pem_bytes: bytes, key_pem_bytes: bytes, mode: str = "custom", extra_meta: Optional[Dict[str, Any]] = None
    ) -> Tuple[bool, Optional[str]]:
        """Validates and persists certificate and private key in PEM format."""
        try:
            from cryptography import x509
            from cryptography.hazmat.primitives import serialization

            # 1. Validate Certificate
            cert = x509.load_pem_x509_certificate(cert_pem_bytes)

            # 2. Validate Private Key
            key = serialization.load_pem_private_key(key_pem_bytes, password=None)

            # 3. Check public key matching
            if cert.public_key().public_numbers() != key.public_key().public_numbers():
                return False, "Certificate and private key public numbers do not match."

            self._ensure_dir()

            # 4. Atomic write of fullchain.pem and privkey.pem
            tmp_cert = f"{self.fullchain_path}.tmp"
            tmp_key = f"{self.privkey_path}.tmp"

            with open(tmp_cert, "wb") as f:
                f.write(cert_pem_bytes)
            with open(tmp_key, "wb") as f:
                f.write(key_pem_bytes)

            os.chmod(tmp_cert, 0o644)
            os.chmod(tmp_key, 0o600)

            os.replace(tmp_cert, self.fullchain_path)
            os.replace(tmp_key, self.privkey_path)

            # 5. Metadata write
            meta_payload = {
                "mode": mode,
                "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            }
            if extra_meta:
                meta_payload.update(extra_meta)

            with open(self.metadata_path, "w", encoding="utf-8") as f:
                json.dump(meta_payload, f, indent=2)

            logger.info("Successfully updated SSL certificate in mode '%s'", mode)
            return True, None
        except Exception as e:
            logger.error("Failed to save custom certificate: %s", e)
            return False, f"Invalid certificate or key: {str(e)}"

    def delete_cert(self) -> Tuple[bool, Optional[str]]:
        """Removes existing certificates and metadata."""
        try:
            for p in [self.fullchain_path, self.privkey_path, self.metadata_path]:
                if os.path.exists(p):
                    os.remove(p)
            logger.info("Active SSL certificates removed from %s", self.certs_dir)
            return True, None
        except Exception as e:
            logger.error("Failed to delete certificate files: %s", e)
            return False, str(e)

    def renew_acme_certificate(
        self, domain: str, email: str, staging: bool = False, log_info=None, log_error=None
    ) -> Tuple[bool, str]:
        """Executes ACME Let's Encrypt certificate renewal via pure Python `acme` library."""
        def _info(msg: str):
            if log_info:
                log_info(msg)
            logger.info(msg)

        def _err(msg: str):
            if log_error:
                log_error(msg)
            logger.error(msg)

        if not domain or domain == "localhost" or not email:
            msg = "A valid public Domain Name (FQDN) and ACME contact email are required for Let's Encrypt renewal."
            _err(msg)
            return False, msg

        _info(f"Starting ACME Let's Encrypt renewal for domain '{domain}' (staging={staging})...")

        try:
            import http.server
            import threading
            import josepy as jose
            from acme import client as acme_client
            from acme import messages, challenges, crypto_util
            from cryptography.hazmat.primitives import serialization
            from cryptography.hazmat.primitives.asymmetric import rsa

            # 1. Generate ACME Account Private Key & Domain Key
            account_key = jose.JWKRSA(key=rsa.generate_private_key(public_exponent=65537, key_size=2048))
            domain_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

            # 2. Generate CSR for requested domain
            csr_pem = crypto_util.make_csr(
                domain_key.private_bytes(
                    encoding=serialization.Encoding.PEM,
                    format=serialization.PrivateFormat.TraditionalOpenSSL,
                    encryption_algorithm=serialization.NoEncryption(),
                ),
                [domain],
            )

            # 3. Network Client Session
            net = acme_client.ClientNetwork(account_key, user_agent="CloudHub-ACME/1.2.0")
            directory_url = (
                "https://acme-staging-v02.api.letsencrypt.org/directory"
                if staging
                else "https://acme-v02.api.letsencrypt.org/directory"
            )
            directory = acme_client.ClientV2.get_directory(directory_url, net)
            acme_c = acme_client.ClientV2(directory, net=net)

            # 4. Register Account with Let's Encrypt
            _info("Registering ACME account with Let's Encrypt...")
            acme_c.new_account(messages.NewRegistration.from_data(email=email, terms_of_service_agreed=True))

            # 5. Create Order with CSR
            _info(f"Creating ACME certificate order for '{domain}'...")
            orderr = acme_c.new_order(csr_pem)

            # 6. Extract HTTP-01 Challenge
            authz = orderr.authorizations[0]
            http_challenge = None
            for chall_body in authz.body.challenges:
                if isinstance(chall_body.chall, challenges.HTTP01):
                    http_challenge = chall_body
                    break

            if not http_challenge:
                msg = "Let's Encrypt server did not offer an HTTP-01 challenge."
                _err(msg)
                return False, msg

            response, validation = http_challenge.response_and_validation(account_key)
            token_str = http_challenge.chall.encode("token")

            # Temporary port 80 listener for HTTP-01 challenge
            temp_server = None

            class AcmePort80Handler(http.server.BaseHTTPRequestHandler):
                def do_GET(self):
                    if "/.well-known/acme-challenge/" in self.path:
                        t = self.path.split("/")[-1]
                        val = validation if t == token_str else None
                        if val:
                            self.send_response(200)
                            self.send_header("Content-Type", "text/plain")
                            self.end_headers()
                            self.wfile.write(val.encode("utf-8"))
                            return
                    self.send_response(404)
                    self.end_headers()

                def log_message(self, format, *args):
                    pass

            try:
                temp_server = http.server.HTTPServer(("0.0.0.0", 80), AcmePort80Handler)
                temp_thread = threading.Thread(target=temp_server.serve_forever, daemon=True)
                temp_thread.start()
                _info("Started temporary HTTP-01 challenge listener on TCP Port 80...")
            except Exception as e:
                _info(f"Port 80 temporary listener note (may already be bound): {e}")

            try:
                # 7. Answer Challenge
                _info("Answering ACME HTTP-01 challenge...")
                acme_c.answer_challenge(http_challenge, response)

                # 8. Poll Order Finalization
                _info("Polling ACME challenge validation status...")
                finalized_order = acme_c.poll_and_finalize(orderr)
            finally:
                if temp_server:
                    try:
                        temp_server.shutdown()
                        temp_server.server_close()
                        _info("Closed temporary Port 80 HTTP listener.")
                    except Exception:
                        pass

            cert_pem_bytes = finalized_order.fullchain_pem.encode("utf-8")
            key_pem_bytes = domain_key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.TraditionalOpenSSL,
                encryption_algorithm=serialization.NoEncryption(),
            )

            if staging:
                _info(
                    f"ACME Dry-Run (Staging) validation succeeded for '{domain}'. Skipping disk installation."
                )
                return (
                    True,
                    f"Dry-run (Staging) validation succeeded for '{domain}'! Port 80 HTTP-01 challenge verified. Uncheck Dry-Run and click Issue / Renew to install the production certificate.",
                )

            # Save production certificate & private key
            saved, save_err = self.save_custom_cert(
                cert_pem_bytes,
                key_pem_bytes,
                mode="acme",
                extra_meta={"domain": domain, "email": email, "staging": False},
            )
            if not saved:
                _err(f"Failed to save issued certificate: {save_err}")
                return False, f"Failed to save certificate: {save_err}"

            _info("ACME production certificate successfully issued and persisted.")
            return True, f"Production SSL certificate for '{domain}' issued and installed successfully."
        except Exception as e:
            _err(f"ACME renewal failed: {e}")
            return False, f"ACME renewal failed: {str(e)}"


cert_manager = CertificateManager()
