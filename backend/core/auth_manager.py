"""Authentication, session validation, RBAC, and cryptographic SSO assertion manager."""

import os
import time
import hmac
import hashlib
import logging
from typing import Optional, Callable
from sqlalchemy.orm import Session

from backend.database.models import User, EnrolledNode, UserGroupPermission

logger = logging.getLogger("cloudhub.auth")

DEFAULT_SERVER_SECRET = os.environ.get(
    "CLOUDHUB_SECRET_KEY", "cloudhub-default-insecure-secret-key-change-me"
)
PBKDF2_ITERATIONS = 600_000


class AuthManager:
    """Handles password hashing, token validation, RBAC and SSO assertions."""

    @staticmethod
    def hash_password(plain: str) -> str:
        """Hash a plain text password with PBKDF2-HMAC-SHA256 and a random 16-byte salt."""
        salt = os.urandom(16)
        salt_hex = salt.hex()
        derived = hashlib.pbkdf2_hmac(
            "sha256",
            plain.encode("utf-8"),
            salt,
            PBKDF2_ITERATIONS,
        )
        hash_hex = derived.hex()
        return f"pbkdf2:sha256:{PBKDF2_ITERATIONS}${salt_hex}${hash_hex}"

    @staticmethod
    def verify_password(plain: str, stored_hash: str) -> bool:
        """Verify plain text against stored PBKDF2 hash using constant-time comparison."""
        try:
            if not stored_hash or not stored_hash.startswith("pbkdf2:sha256:"):
                return False
            algo_meta, salt_hex, hash_hex = stored_hash.split("$")
            iterations = int(algo_meta.split(":")[2])
            salt = bytes.fromhex(salt_hex)
            expected_hash = bytes.fromhex(hash_hex)

            computed_hash = hashlib.pbkdf2_hmac(
                "sha256",
                plain.encode("utf-8"),
                salt,
                iterations,
            )
            return hmac.compare_digest(computed_hash, expected_hash)
        except Exception as err:
            logger.error("Error verifying password hash: %s", err)
            return False

    @staticmethod
    def create_session(
        user_id: int,
        password_hash: str,
        expiry_seconds: int = 604800,
        server_secret: str = DEFAULT_SERVER_SECRET,
    ) -> str:
        """
        Generate a stateless HMAC-signed session token.
        The signature binds the user's password_hash: changing password immediately invalidates tokens.
        """
        expiry = int(time.time() + expiry_seconds)
        payload = f"{user_id}:{expiry}"
        secret_key = f"{server_secret}:{password_hash}".encode("utf-8")
        signature = hmac.new(
            secret_key, payload.encode("utf-8"), hashlib.sha256
        ).hexdigest()
        return f"{payload}:{signature}"

    @staticmethod
    def validate_session(
        token: str,
        lookup_user_fn: Callable[[int], Optional[User]],
        server_secret: str = DEFAULT_SERVER_SECRET,
    ) -> Optional[User]:
        """
        Parse and validate session token.
        Returns the User if valid and not expired, else None.
        """
        try:
            if not token or ":" not in token:
                return None
            parts = token.split(":")
            if len(parts) != 3:
                return None

            user_id_str, expiry_str, signature = parts
            user_id = int(user_id_str)
            expiry = int(expiry_str)

            if time.time() > expiry:
                return None

            user = lookup_user_fn(user_id)
            if not user or not user.password_hash:
                return None

            secret_key = f"{server_secret}:{user.password_hash}".encode("utf-8")
            payload = f"{user_id}:{expiry}"
            expected_sig = hmac.new(
                secret_key, payload.encode("utf-8"), hashlib.sha256
            ).hexdigest()

            if hmac.compare_digest(expected_sig, signature):
                return user
            return None
        except Exception as err:
            logger.debug("Session validation failed: %s", err)
            return None

    @staticmethod
    def can_user_access_node(db: Session, user: User, node: EnrolledNode) -> bool:
        """
        RBAC evaluator:
        - superadmin: accesses all nodes globally.
        - org_admin: accesses any node within user.org_id (both grouped and ungrouped).
        - group_operator: accesses node only if in the same org AND node.group_id is mapped in UserGroupPermission.
        """
        if not user or not node:
            return False

        if user.role == "superadmin":
            return True

        if user.org_id != node.org_id:
            return False

        if user.role == "org_admin":
            return True

        if user.role == "group_operator":
            if node.group_id is None:
                # Group operators cannot access ungrouped nodes
                return False

            perm = (
                db.query(UserGroupPermission)
                .filter(
                    UserGroupPermission.user_id == user.id,
                    UserGroupPermission.group_id == node.group_id,
                )
                .first()
            )
            return perm is not None

        return False

    @staticmethod
    def create_sso_assertion(
        node_id: str,
        tunnel_secret: str,
        username: str,
        ttl_seconds: int = 60,
    ) -> str:
        """
        Create a time-limited HMAC-SHA256 assertion for zero-knowledge SSO into edge node.
        Format: {node_id}:{username}:{timestamp}:{expiry}:{signature}
        """
        now = int(time.time())
        expiry = now + ttl_seconds
        payload = f"{node_id}:{username}:{now}:{expiry}"
        signature = hmac.new(
            tunnel_secret.encode("utf-8"),
            payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return f"{payload}:{signature}"

    @staticmethod
    def verify_edge_handshake(
        node_id: str,
        timestamp: str,
        signature: str,
        tunnel_secret: str,
        window_seconds: int = 60,
    ) -> bool:
        """
        Verify edge node reverse tunnel handshake signature and freshness to prevent replays.
        Payload signed: {node_id}:{timestamp}
        """
        try:
            ts = int(timestamp)
            now = int(time.time())
            if abs(now - ts) > window_seconds:
                return False

            payload = f"{node_id}:{timestamp}"
            expected_sig = hmac.new(
                tunnel_secret.encode("utf-8"),
                payload.encode("utf-8"),
                hashlib.sha256,
            ).hexdigest()

            return hmac.compare_digest(expected_sig, signature)
        except Exception as err:
            logger.debug("Edge handshake verification failed: %s", err)
            return False
