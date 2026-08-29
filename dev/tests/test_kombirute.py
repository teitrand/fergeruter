#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "build_kombirute.py"

spec = importlib.util.spec_from_file_location("build_kombirute", SCRIPT)
mod = importlib.util.module_from_spec(spec)
sys.modules["build_kombirute"] = mod
assert spec.loader is not None
spec.loader.exec_module(mod)


class KombiruteTests(unittest.TestCase):
    def test_weekday_has_saebo_0815_and_leknes(self):
        payload = mod.build()
        weekday = [leg for leg in payload["legs"] if "weekday" in leg["days"]]
        self.assertTrue(
            any(
                leg["from"] == "Sæbø"
                and leg["to"] == "Leknes"
                and leg["departure"] == "08:15:00"
                for leg in weekday
            )
        )
        quays = {quay for leg in weekday for quay in (leg["from"], leg["to"])}
        self.assertIn("Leknes", quays)
        self.assertIn("Standal", quays)
        self.assertNotIn("Valderøya", quays)
        self.assertNotIn("Store Kalvøy", quays)

    def test_stored_json_matches_builder(self):
        stored = json.loads((ROOT / "data" / "kombirute.json").read_text(encoding="utf-8"))
        built = mod.build()
        self.assertEqual(stored["source"], built["source"])
        self.assertEqual(len(stored["legs"]), len(built["legs"]))
        self.assertTrue(any("1 time" in (leg.get("signal") or {}).get("text", "") for leg in built["legs"]))


if __name__ == "__main__":
    unittest.main()
