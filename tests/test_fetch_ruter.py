#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "fetch_ruter.py"

spec = importlib.util.spec_from_file_location("fetch_ruter", SCRIPT)
mod = importlib.util.module_from_spec(spec)
sys.modules["fetch_ruter"] = mod
assert spec.loader is not None
spec.loader.exec_module(mod)


def journey(origin: str, dest: str, dep: str, arr: str, dates: list[str], sid="sj-1"):
    return {
        "id": sid,
        "passingTimes": [
            {
                "requestStop": False,
                "quay": {"id": "q1", "name": f"{origin} ferjekai"},
                "departure": {"time": dep},
                "arrival": {"time": None},
            },
            {
                "requestStop": False,
                "quay": {"id": "q2", "name": f"{dest} ferjekai"},
                "departure": {"time": arr},
                "arrival": {"time": arr},
            },
        ],
        "activeDates": dates,
    }


class GroupingTests(unittest.TestCase):
    def test_splits_standal_route_into_two_alternatives(self):
        line = {
            "id": "MOR:Line:1136",
            "publicCode": "1136",
            "name": "Standal-Trandal",
            "serviceJourneys": [
                journey("Standal", "Trandal", "07:40:00", "07:55:00", ["2026-08-24"], "a"),
                journey("Trandal", "Standal", "09:45:00", "10:00:00", ["2026-08-24"], "b"),
                journey("Sæbø", "Skår", "11:00:00", "11:20:00", ["2026-08-24"], "c"),
            ],
        }
        payload = mod.build_payload(line, fetched_at="2026-08-24T00:00:00+00:00")
        by_id = {alt["id"]: alt for alt in payload["alternatives"]}
        self.assertEqual(list(by_id), ["fra-trandal", "fra-standal"])
        self.assertEqual(by_id["fra-standal"]["trips"][0]["departure"], "07:40:00")
        self.assertEqual(by_id["fra-trandal"]["trips"][0]["arrival"], "10:00:00")
        self.assertEqual(len(by_id["fra-standal"]["trips"]), 1)
        self.assertEqual(len(by_id["fra-trandal"]["trips"]), 1)

    def test_write_skipped_when_timetable_unchanged(self):
        line = {
            "id": "MOR:Line:1136",
            "publicCode": "1136",
            "name": "Standal-Trandal",
            "serviceJourneys": [
                journey("Trandal", "Standal", "09:45:00", "10:00:00", ["2026-08-24"]),
            ],
        }
        first = mod.build_payload(line, fetched_at="2026-08-24T00:00:00+00:00")
        second = mod.build_payload(line, fetched_at="2026-08-25T00:00:00+00:00")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "ruter.json"
            self.assertTrue(mod.write_if_changed(first, path))
            self.assertFalse(mod.write_if_changed(second, path))
            stored = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(stored["fetchedAt"], "2026-08-24T00:00:00+00:00")


class FetchTests(unittest.TestCase):
    def test_main_writes_json(self):
        graphql = {
            "data": {
                "line": {
                    "id": "MOR:Line:1136",
                    "publicCode": "1136",
                    "name": "Standal-Trandal",
                    "serviceJourneys": [
                        journey("Standal", "Trandal", "07:40:00", "07:55:00", ["2026-08-24"]),
                    ],
                }
            }
        }

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return json.dumps(graphql).encode("utf-8")

        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "ruter.json"
            with patch.object(mod.urllib.request, "urlopen", return_value=FakeResponse()):
                with patch.object(sys, "argv", ["fetch_ruter.py", str(out)]):
                    self.assertEqual(mod.main(), 0)
            data = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(data["alternatives"][1]["id"], "fra-standal")
            self.assertEqual(len(data["alternatives"][1]["trips"]), 1)


if __name__ == "__main__":
    unittest.main()
