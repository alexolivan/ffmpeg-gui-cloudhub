"""Telemetry collector, node vitality evaluator, and GitHub release radar."""

import time
import logging
import threading
from typing import Dict, Any, Optional
import requests

logger = logging.getLogger("cloudhub.telemetry")

GITHUB_REPO = "alexolivan/ffmpeg-gui"
GITHUB_RELEASES_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
GITHUB_TAGS_URL = f"https://api.github.com/repos/{GITHUB_REPO}/tags"
CACHE_TTL_SECONDS = 21600  # 6 hours


class TelemetryCollector:
    """Stores in-memory telemetry from edge appliances and computes online/degraded status."""

    def __init__(self, offline_threshold_seconds: int = 30):
        self.offline_threshold = offline_threshold_seconds
        self._lock = threading.Lock()
        # node_id -> {"timestamp": float, "payload": dict}
        self._vitality_cache: Dict[str, Dict[str, Any]] = {}
        # GitHub latest version cache
        self._latest_version: Optional[str] = None
        self._latest_version_cached_at: float = 0.0

    def record_heartbeat(self, node_id: str, payload: dict) -> dict:
        """Store edge node telemetry and return vitality status."""
        now = time.time()
        with self._lock:
            self._vitality_cache[node_id] = {
                "timestamp": now,
                "payload": payload,
                "disconnected": False,
            }
        return self.get_node_vitality(node_id, payload.get("current_version"))

    def mark_disconnected(self, node_id: str) -> None:
        """Explicitly mark node as disconnected upon WebSocket or tunnel closure."""
        with self._lock:
            if node_id in self._vitality_cache:
                self._vitality_cache[node_id]["disconnected"] = True

    def get_latest_payload(self, node_id: str) -> Optional[dict]:
        """Retrieve most recent raw telemetry payload for a given node."""
        with self._lock:
            rec = self._vitality_cache.get(node_id)
            return rec.get("payload") if rec else None

    def get_latest_upstream_version(self) -> Optional[str]:
        """Fetch latest ffmpeg-gui version from GitHub, cached for 6 hours."""
        now = time.time()
        with self._lock:
            if self._latest_version and (now - self._latest_version_cached_at < CACHE_TTL_SECONDS):
                return self._latest_version

        # Fetch outside lock
        fetched_version = None
        try:
            resp = requests.get(GITHUB_RELEASES_URL, timeout=4)
            if resp.status_code == 200:
                data = resp.json()
                fetched_version = data.get("tag_name", "").lstrip("v")
            elif resp.status_code == 404:
                # Fallback to tags if releases are not published as formal releases
                tags_resp = requests.get(GITHUB_TAGS_URL, timeout=4)
                if tags_resp.status_code == 200:
                    tags_data = tags_resp.json()
                    if tags_data and isinstance(tags_data, list):
                        fetched_version = tags_data[0].get("name", "").lstrip("v")
        except Exception as err:
            logger.debug("Failed to fetch upstream GitHub release: %s", err)

        if fetched_version:
            with self._lock:
                self._latest_version = fetched_version
                self._latest_version_cached_at = now
            return fetched_version

        with self._lock:
            return self._latest_version

    def get_node_vitality(
        self, node_id: str, current_version: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Evaluate node health:
        - status: 'online' | 'degraded' | 'offline'
        - system: cpu, memory, disk, uptime
        - workload: services, errors
        - version: current, update_available
        """
        now = time.time()
        with self._lock:
            record = self._vitality_cache.get(node_id)

        if not record or record.get("disconnected"):
            return {
                "status": "offline",
                "last_seen_seconds_ago": None if not record else int(now - record["timestamp"]),
                "system": {},
                "workload": {},
                "version": {
                    "current": current_version,
                    "update_available": False,
                },
            }

        elapsed = now - record["timestamp"]
        if elapsed > self.offline_threshold:
            return {
                "status": "offline",
                "last_seen_seconds_ago": int(elapsed),
                "system": {},
                "workload": {},
                "version": {
                    "current": current_version,
                    "update_available": False,
                },
            }

        payload = record.get("payload", {})
        sys_data = payload.get("system", {})
        work_data = payload.get("workload", {})

        cpu = float(sys_data.get("cpu_percent", 0.0))
        ram = float(sys_data.get("memory_percent", 0.0))
        errors = int(work_data.get("services_error", 0))

        is_degraded = errors > 0 or cpu > 90.0 or ram > 90.0
        status = "degraded" if is_degraded else "online"

        node_ver = current_version or payload.get("current_version")
        latest_ver = self.get_latest_upstream_version()
        update_available = False
        if node_ver and latest_ver and node_ver != latest_ver:
            try:
                # Compare semantic versions if applicable
                v_node = [int(p) for p in node_ver.split(".") if p.isdigit()]
                v_latest = [int(p) for p in latest_ver.split(".") if p.isdigit()]
                if v_latest > v_node:
                    update_available = True
            except Exception:
                update_available = node_ver != latest_ver

        return {
            "status": status,
            "last_seen_seconds_ago": int(elapsed),
            "system": {
                "cpu_percent": cpu,
                "memory_percent": ram,
                "disk_percent": float(sys_data.get("disk_percent", 0.0)),
                "uptime_seconds": int(sys_data.get("uptime_seconds", 0)),
            },
            "workload": {
                "total_services": int(work_data.get("total_services", 0)),
                "services_running": int(work_data.get("services_running", 0)),
                "services_error": errors,
                "total_tasks": int(work_data.get("total_tasks", 0)),
                "tasks_running": int(work_data.get("tasks_running", 0)),
            },
            "version": {
                "current": node_ver,
                "latest_upstream": latest_ver,
                "update_available": update_available,
            },
        }


# Singleton collector
telemetry_collector = TelemetryCollector()
