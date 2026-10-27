"""Unit tests for i18n dictionary parity and FastAPI static file serving."""

import os
import json
import unittest
from fastapi.testclient import TestClient

from backend.main import app

FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../frontend"))
LOCALES_DIR = os.path.join(FRONTEND_DIR, "src/locales")


class TestI18nAndStatic(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def _get_flattened_keys(self, obj, prefix=""):
        keys = set()
        for k, v in obj.items():
            full_key = f"{prefix}.{k}" if prefix else k
            if isinstance(v, dict):
                keys.update(self._get_flattened_keys(v, full_key))
            else:
                keys.add(full_key)
        return keys

    def test_i18n_key_parity(self):
        en_path = os.path.join(LOCALES_DIR, "en.json")
        es_path = os.path.join(LOCALES_DIR, "es.json")
        ca_path = os.path.join(LOCALES_DIR, "ca.json")

        self.assertTrue(os.path.isfile(en_path), "en.json must exist")
        self.assertTrue(os.path.isfile(es_path), "es.json must exist")
        self.assertTrue(os.path.isfile(ca_path), "ca.json must exist")

        with open(en_path, "r", encoding="utf-8") as f:
            en_data = json.load(f)
        with open(es_path, "r", encoding="utf-8") as f:
            es_data = json.load(f)
        with open(ca_path, "r", encoding="utf-8") as f:
            ca_data = json.load(f)

        en_keys = self._get_flattened_keys(en_data)
        es_keys = self._get_flattened_keys(es_data)
        ca_keys = self._get_flattened_keys(ca_data)

        missing_in_es = en_keys - es_keys
        missing_in_ca = en_keys - ca_keys
        extra_in_es = es_keys - en_keys
        extra_in_ca = ca_keys - en_keys

        self.assertEqual(missing_in_es, set(), f"Keys missing in es.json: {missing_in_es}")
        self.assertEqual(missing_in_ca, set(), f"Keys missing in ca.json: {missing_in_ca}")
        self.assertEqual(extra_in_es, set(), f"Extra keys in es.json not in en.json: {extra_in_es}")
        self.assertEqual(extra_in_ca, set(), f"Extra keys in ca.json not in en.json: {extra_in_ca}")

    def test_static_files_and_spa_fallback(self):
        # GET / should return index.html
        resp = self.client.get("/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("<!doctype html>", resp.text.lower())

        # SPA client-side route fallback
        resp_spa = self.client.get("/tenants")
        self.assertEqual(resp_spa.status_code, 200)
        self.assertIn("<!doctype html>", resp_spa.text.lower())

        # Non-existent API route must NOT return SPA html
        resp_api = self.client.get("/api/nonexistent-route-404")
        self.assertEqual(resp_api.status_code, 404)
        self.assertEqual(resp_api.headers.get("content-type"), "application/json")


if __name__ == "__main__":
    unittest.main()
