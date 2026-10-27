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

        failregex_line = None
        for line in conf_lines:
            if line.strip().startswith("failregex ="):
                failregex_line = line.split("=", 1)[1].strip()
                break

        self.assertIsNotNone(failregex_line, "failregex must be defined")

        # Convert Fail2ban <HOST> pseudo-tag to python regex capture
        py_regex_str = failregex_line.replace("<HOST>", r"(?P<host>\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|[a-fA-F0-9:]+)")
        pattern = re.compile(py_regex_str)

        sample_log = (
            "2026-10-27 10:00:00,123 [WARNING] cloudhub.api.auth: "
            "[security] Failed CloudHub login attempt for 'attacker' from 203.0.113.45 (locked=False)"
        )

        match = pattern.search(sample_log)
        self.assertIsNotNone(match, "Fail2ban regex must match sample security log line")
        self.assertEqual(match.group("host"), "203.0.113.45")


if __name__ == "__main__":
    unittest.main()
