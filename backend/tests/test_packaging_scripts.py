"""Tests for deployment scripts, systemd templates, and fail2ban filter regex."""

import os
import re
import subprocess
import unittest

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))


class TestPackagingScripts(unittest.TestCase):
    def test_bash_syntax_validity(self):
        scripts = [
            os.path.join(PROJECT_ROOT, "install.sh"),
            os.path.join(PROJECT_ROOT, "update.sh"),
            os.path.join(PROJECT_ROOT, "bin/ffmpeg-gui-cloudhub-admin"),
        ]
        for script in scripts:
            self.assertTrue(os.path.isfile(script), f"File {script} must exist")
            res = subprocess.run(["bash", "-n", script], capture_output=True, text=True)
            self.assertEqual(
                res.returncode,
                0,
                f"Bash syntax check failed for {script}: {res.stderr}",
            )

    def test_install_script_contains_systemd_directives(self):
        install_script = os.path.join(PROJECT_ROOT, "install.sh")
        with open(install_script, "r", encoding="utf-8") as f:
            content = f.read()

        self.assertIn("KillMode=process", content)
        self.assertIn("ExecReload=", content)
        self.assertIn("Restart=always", content)
        self.assertIn("ffmpeg-gui-cloudhub.service", content)

    def test_fail2ban_filter_regex(self):
        filter_conf = os.path.join(
            PROJECT_ROOT, "packaging/fail2ban/filter.d/ffmpeg-gui-cloudhub.conf"
        )
        self.assertTrue(os.path.isfile(filter_conf))

        with open(filter_conf, "r", encoding="utf-8") as f:
            conf_lines = f.readlines()

        failregex_lines = []
        in_failregex = False
        for raw_line in conf_lines:
            stripped = raw_line.strip()
            if stripped.startswith("failregex ="):
                in_failregex = True
                failregex_lines.append(raw_line.split("=", 1)[1].strip())
            elif in_failregex:
                if not stripped or stripped.startswith("#") or "=" in stripped.split()[0]:
                    in_failregex = False
                else:
                    failregex_lines.append(stripped)

        self.assertGreaterEqual(len(failregex_lines), 2, "failregex must define app log and access log rules")

        # Convert Fail2ban <HOST> pseudo-tag to python regex capture
        host_re = r"(?P<host>\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|[a-fA-F0-9:]+)"
        patterns = [re.compile(rx.replace("<HOST>", host_re)) for rx in failregex_lines]

        def match_any(line: str):
            for pat in patterns:
                m = pat.search(line)
                if m:
                    return m
            return None

        positive_samples = [
            (
                "2026-10-27 10:00:00,123 [WARNING] cloudhub.api.auth: "
                "[security] Failed CloudHub login attempt for non-existent user 'attacker' from 203.0.113.45 (locked=False)",
                "203.0.113.45",
            ),
            (
                "2026-10-27 10:00:01,456 [WARNING] cloudhub.api.auth: "
                "[security] Failed password attempt for valid user 'admin' from 198.51.100.22 (locked=True)",
                "198.51.100.22",
            ),
            (
                '203.0.113.77 - - [25/Nov/2026:14:10:00 +0000] "POST /api/hub/auth/login HTTP/1.1" 401 42 "-" "curl/8.5"',
                "203.0.113.77",
            ),
            (
                '198.51.100.88 - - [25/Nov/2026:14:10:05 +0000] "POST /api/hub/auth/login?next=/ HTTP/2.0" 429 90 "-" "Mozilla/5.0"',
                "198.51.100.88",
            ),
        ]
        for sample_log, expected_ip in positive_samples:
            match = match_any(sample_log)
            self.assertIsNotNone(match, f"Fail2ban regex must match log line: {sample_log}")
            self.assertEqual(match.group("host"), expected_ip)

        benign_log = '203.0.113.77 - - [25/Nov/2026:14:10:00 +0000] "POST /api/hub/auth/login HTTP/1.1" 200 512 "-" "Mozilla/5.0"'
        self.assertIsNone(match_any(benign_log), "Fail2ban regex must NOT match successful 200 login")


if __name__ == "__main__":
    unittest.main()
