"""In-memory brute-force protection and lockout manager."""

import time
import threading
from typing import Tuple, Optional, Dict


class SecurityGuard:
    """Tracks failed login attempts and imposes exponential or fixed lockout windows."""

    def __init__(
        self,
        max_failures: int = 5,
        lockout_duration_seconds: int = 900,
    ):
        self.max_failures = max_failures
        self.lockout_duration = lockout_duration_seconds
        self._lock = threading.Lock()
        # Key: (ip, username_lower) -> dict(failures=int, locked_until=float)
        self._attempts: Dict[Tuple[str, str], Dict[str, float]] = {}

    def _normalize_key(self, ip: str, username: str) -> Tuple[str, str]:
        return (ip.strip() if ip else "0.0.0.0", username.strip().lower() if username else "")

    def is_locked(self, ip: str, username: str) -> Tuple[bool, int]:
        """Check if an IP / username pair is currently locked out."""
        key = self._normalize_key(ip, username)
        now = time.time()
        with self._lock:
            record = self._attempts.get(key)
            if not record:
                return False, 0

            locked_until = record.get("locked_until", 0.0)
            if locked_until > now:
                remaining = int(locked_until - now)
                return True, remaining
            elif locked_until > 0.0 and locked_until <= now:
                # Lockout period has elapsed, reset counter
                record["failures"] = 0
                record["locked_until"] = 0.0
                return False, 0

            return False, 0

    def record_failure(self, ip: str, username: str) -> Tuple[bool, int]:
        """Record a failed login attempt. Returns (is_locked, remaining_seconds)."""
        key = self._normalize_key(ip, username)
        now = time.time()
        with self._lock:
            record = self._attempts.setdefault(key, {"failures": 0, "locked_until": 0.0})

            # If existing lock had expired, reset
            if record["locked_until"] > 0 and record["locked_until"] <= now:
                record["failures"] = 0
                record["locked_until"] = 0.0

            record["failures"] = int(record["failures"]) + 1

            if record["failures"] >= self.max_failures:
                record["locked_until"] = now + self.lockout_duration
                remaining = self.lockout_duration
                return True, remaining

            return False, 0

    def record_success(self, ip: str, username: str) -> None:
        """Clear failed attempts upon successful login."""
        key = self._normalize_key(ip, username)
        with self._lock:
            if key in self._attempts:
                self._attempts.pop(key, None)

    def reset_lockouts(self, username: Optional[str] = None) -> int:
        """Clear lockout records for a specific username or all records if None."""
        cleared = 0
        with self._lock:
            if username is None:
                cleared = len(self._attempts)
                self._attempts.clear()
            else:
                target_user = username.strip().lower()
                to_delete = [
                    k for k in self._attempts.keys() if k[1] == target_user
                ]
                for k in to_delete:
                    self._attempts.pop(k, None)
                    cleared += 1
        return cleared


# Singleton security guard instance for the application
security_guard = SecurityGuard()
