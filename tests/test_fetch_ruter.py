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


def point(quay: str, dep: str | None, arr: str | None, request_stop=False):
    return {
        "requestStop": request_stop,
        "quay": {"id": quay, "name": f"{quay} ferjekai"},
        "departure": {"time": dep} if dep else None,
        "arrival": {"time": arr} if arr else None,
    }


def journey(points: list[dict], dates: list[str], sid="sj-1"):
    return {"id": sid, "passingTimes": points, "activeDates": dates}


class QuayNameTests(unittest.TestCase):
    def test_strips_quay_suffixes(self):
        self.assertEqual(mod.quay_place("Trandal ferjekai"), "Trandal")
        self.assertEqual(mod.quay_place("Store Kalvøy kai"), "Store Kalvøy")
        self.assertEqual(mod.quay_place("Sæbø"), "Sæbø")


class LegTests(unittest.TestCase):
    def test_two_stop_journey_gives_one_leg(self):
        j = journey(
            [
                point("Trandal", "07:05:00", None),
                point("Standal", None, "07:20:00"),
            ],
            ["2026-08-25"],
        )
        legs = mod.legs_from_journey(j)
        self.assertEqual(len(legs), 1)
        self.assertEqual(legs[0]["from"], "Trandal")
        self.assertEqual(legs[0]["to"], "Standal")
        self.assertEqual(legs[0]["departure"], "07:05:00")
        self.assertEqual(legs[0]["arrival"], "07:20:00")

    def test_multi_stop_journey_is_split_per_leg(self):
        j = journey(
            [
                point("Standal", "08:00:00", None),
                point("Trandal", "08:20:00", "08:15:00"),
                point("Sæbø", None, "08:45:00"),
            ],
            ["2026-08-25"],
        )
        legs = mod.legs_from_journey(j)
        self.assertEqual([(l["from"], l["to"]) for l in legs], [("Standal", "Trandal"), ("Trandal", "Sæbø")])
        self.assertEqual(legs[0]["arrival"], "08:15:00")
        self.assertEqual(legs[1]["departure"], "08:20:00")

    def test_request_stop_is_kept(self):
        j = journey(
            [
                point("Trandal", "07:05:00", None, request_stop=True),
                point("Standal", None, "07:20:00"),
            ],
            ["2026-08-25"],
        )
        self.assertTrue(mod.legs_from_journey(j)[0]["requestStop"])


class PayloadTests(unittest.TestCase):
    def test_legs_are_sorted_by_departure(self):
        line = {
            "id": "MOR:Line:1136",
            "publicCode": "1136",
            "name": "Standal-Trandal",
            "serviceJourneys": [
                journey(
                    [point("Sæbø", "09:20:00", None), point("Trandal", None, "09:45:00")],
                    ["2026-08-25"],
                    "b",
                ),
                journey(
                    [point("Standal", "06:45:00", None), point("Trandal", None, "07:00:00")],
                    ["2026-08-25"],
                    "a",
                ),
            ],
        }
        payload = mod.build_payload(line, fetched_at="2026-08-25T00:00:00+00:00")
        self.assertEqual(
            [leg["departure"] for leg in payload["legs"]], ["06:45:00", "09:20:00"]
        )

    def test_write_skipped_when_timetable_unchanged(self):
        line = {
            "id": "MOR:Line:1136",
            "publicCode": "1136",
            "name": "Standal-Trandal",
            "serviceJourneys": [
                journey(
                    [point("Trandal", "09:45:00", None), point("Standal", None, "10:00:00")],
                    ["2026-08-25"],
                )
            ],
        }
        first = mod.build_payload(line, fetched_at="2026-08-25T00:00:00+00:00")
        second = mod.build_payload(line, fetched_at="2026-08-26T00:00:00+00:00")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "ruter.json"
            self.assertTrue(mod.write_if_changed(first, path))
            self.assertFalse(mod.write_if_changed(second, path))
            stored = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(stored["fetchedAt"], "2026-08-25T00:00:00+00:00")


class FetchTests(unittest.TestCase):
    def test_main_writes_json(self):
        graphql = {
            "data": {
                "line": {
                    "id": "MOR:Line:1136",
                    "publicCode": "1136",
                    "name": "Standal-Trandal",
                    "serviceJourneys": [
                        journey(
                            [
                                point("Standal", "07:40:00", None),
                                point("Trandal", None, "07:55:00"),
                            ],
                            ["2026-08-25"],
                        )
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
            self.assertEqual(len(data["legs"]), 1)
            self.assertEqual(data["legs"][0]["to"], "Trandal")


if __name__ == "__main__":
    unittest.main()
