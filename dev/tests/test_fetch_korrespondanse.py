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
SCRIPT = ROOT / "scripts" / "fetch_korrespondanse.py"

spec = importlib.util.spec_from_file_location("fetch_korrespondanse", SCRIPT)
mod = importlib.util.module_from_spec(spec)
sys.modules["fetch_korrespondanse"] = mod
assert spec.loader is not None
spec.loader.exec_module(mod)


def journey(origin, dest, dep, arr, dates):
    return {
        "passingTimes": [
            {
                "quay": {"name": f"{origin} ferjekai"},
                "departure": {"time": dep},
                "arrival": None,
            },
            {
                "quay": {"name": f"{dest} ferjekai"},
                "departure": {"time": arr},
                "arrival": {"time": arr},
            },
        ],
        "activeDates": dates,
    }


def line(journeys, code="1069", operator="Norled"):
    return {
        "publicCode": code,
        "name": "Festøya-Solavågen",
        "operator": {"name": operator},
        "serviceJourneys": journeys,
    }


class CalendarTests(unittest.TestCase):
    def test_identical_date_sets_share_one_calendar(self):
        cal = mod.Calendars()
        first = cal.id_for(["2026-08-25", "2026-08-26"])
        second = cal.id_for(["2026-08-25", "2026-08-26"])
        third = cal.id_for(["2026-08-27"])
        self.assertEqual(first, second)
        self.assertNotEqual(first, third)
        self.assertEqual(len(cal.by_id), 2)


class PayloadTests(unittest.TestCase):
    def test_keeps_only_trips_touching_the_hub(self):
        spec_a = {"id": "solavagen", "lineId": "x", "label": "Solavågen"}
        payload = mod.build_payload(
            [
                (
                    spec_a,
                    line(
                        [
                            journey("Solavågen", "Festøya", "06:00:00", "06:20:00", ["2026-08-26"]),
                            journey("Ålesund", "Sula", "07:00:00", "07:20:00", ["2026-08-26"]),
                        ]
                    ),
                )
            ],
            fetched_at="2026-08-26T00:00:00+00:00",
        )
        trips = payload["lines"][0]["trips"]
        self.assertEqual(len(trips), 1)
        self.assertEqual(trips[0]["from"], "Solavågen")
        self.assertEqual(trips[0]["to"], "Festøya")

    def test_calendars_are_referenced_not_repeated(self):
        spec_a = {"id": "solavagen", "lineId": "x", "label": "Solavågen"}
        dates = ["2026-08-26", "2026-08-27"]
        payload = mod.build_payload(
            [
                (
                    spec_a,
                    line(
                        [
                            journey("Solavågen", "Festøya", "06:00:00", "06:20:00", dates),
                            journey("Festøya", "Solavågen", "06:30:00", "06:50:00", dates),
                        ]
                    ),
                )
            ],
            fetched_at="2026-08-26T00:00:00+00:00",
        )
        trips = payload["lines"][0]["trips"]
        self.assertEqual(trips[0]["cal"], trips[1]["cal"])
        self.assertEqual(len(payload["calendars"]), 1)
        self.assertEqual(payload["calendars"][trips[0]["cal"]], dates)

    def test_drive_time_is_published(self):
        payload = mod.build_payload([], fetched_at="2026-08-26T00:00:00+00:00")
        self.assertEqual(payload["hub"], "Festøya")
        self.assertEqual(payload["roadTo"], "Standal")
        self.assertGreater(payload["driveMinutes"], 0)
        self.assertGreaterEqual(payload["marginMinutes"], 0)

    def test_write_skipped_when_unchanged(self):
        spec_a = {"id": "solavagen", "lineId": "x", "label": "Solavågen"}
        data = [(spec_a, line([journey("Solavågen", "Festøya", "06:00:00", "06:20:00", ["2026-08-26"])]))]
        first = mod.build_payload(data, fetched_at="2026-08-26T00:00:00+00:00")
        second = mod.build_payload(data, fetched_at="2026-08-27T00:00:00+00:00")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "korrespondanse.json"
            self.assertTrue(mod.write_if_changed(first, path))
            self.assertFalse(mod.write_if_changed(second, path))


class FetchTests(unittest.TestCase):
    def test_main_writes_json(self):
        graphql = {"data": {"line": line([journey("Solavågen", "Festøya", "06:00:00", "06:20:00", ["2026-08-26"])])}}

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return json.dumps(graphql).encode("utf-8")

        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "korrespondanse.json"
            with patch.object(mod.urllib.request, "urlopen", return_value=FakeResponse()):
                with patch.object(sys, "argv", ["fetch_korrespondanse.py", str(out)]):
                    self.assertEqual(mod.main(), 0)
            data = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(len(data["lines"]), 3)
            self.assertEqual(data["lines"][0]["trips"][0]["departure"], "06:00:00")
            self.assertEqual(data["lines"][2]["id"], "oye")
            self.assertEqual(data["lines"][2]["hub"], "Leknes")
            self.assertEqual(data["lines"][2]["trips"], [])

    def test_oye_keeps_trips_via_leknes(self):
        spec = next(item for item in mod.LINES if item["id"] == "oye")
        self.assertEqual(spec["lineId"], "MOR:Line:133")
        self.assertEqual(spec["hub"], "Leknes")
        payload = mod.build_payload(
            [
                (
                    spec,
                    line(
                        [
                            journey("Øye", "Lekneset", "08:10:00", "08:25:00", ["2026-08-26"]),
                            journey("Ålesund", "Sula", "07:00:00", "07:20:00", ["2026-08-26"]),
                        ],
                        code="133",
                    ),
                )
            ],
            fetched_at="2026-08-26T00:00:00+00:00",
        )
        trips = payload["lines"][0]["trips"]
        self.assertEqual(len(trips), 1)
        self.assertEqual(trips[0]["to"], "Leknes")
        self.assertEqual(payload["lines"][0]["driveMinutes"], 0)


if __name__ == "__main__":
    unittest.main()
