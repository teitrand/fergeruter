import importlib.util
import sys
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "log_signalturar.py"
spec = importlib.util.spec_from_file_location("log_signalturar", SCRIPT)
mod = importlib.util.module_from_spec(spec)
sys.modules["log_signalturar"] = mod
assert spec.loader is not None
spec.loader.exec_module(mod)

apply_observations = mod.apply_observations
journey_ids_from_payload = mod.journey_ids_from_payload
observe_signal_trips = mod.observe_signal_trips
prune_days = mod.prune_days
update_log = mod.update_log

OSLO = ZoneInfo("Europe/Oslo")


def leg(journey, departure, minutes_before=60):
    return {
        "id": f"{journey}#0",
        "from": "Standal",
        "to": "Trandal",
        "departure": departure,
        "arrival": "13:15:00",
        "signal": {"minutesBefore": minutes_before},
        "activeDates": ["2026-10-01"],
    }


class SignalLogTests(unittest.TestCase):
    def test_frist_som_ikkje_er_ute_blir_ikkje_logga(self):
        trips = observe_signal_trips(
            [leg("MOR:ServiceJourney:1136_a", "13:00:00")],
            now_minutes=11 * 60,
            cancelled_ids=set(),
            seen_ids={"MOR:ServiceJourney:1136_a"},
        )
        self.assertEqual(trips, [])

    def test_avlyst_etter_frist_er_ikkje_utført_og_elles_bestilt(self):
        trips = observe_signal_trips(
            [
                leg("MOR:ServiceJourney:1136_a", "13:00:00"),
                leg("MOR:ServiceJourney:1136_b", "14:00:00"),
            ],
            now_minutes=13 * 60 + 30,
            cancelled_ids={"MOR:ServiceJourney:1136_a"},
            seen_ids={"MOR:ServiceJourney:1136_a", "MOR:ServiceJourney:1136_b"},
        )
        self.assertEqual(trips[0]["status"], "skipped")
        self.assertEqual(trips[1]["status"], "booked")

    def test_avlyst_blir_ikkje_skriven_om_til_bestilt(self):
        merged = apply_observations(
            [{"id": "MOR:ServiceJourney:1136_a", "status": "skipped", "departure": "13:00:00"}],
            [
                {
                    "id": "MOR:ServiceJourney:1136_a",
                    "from": "Standal",
                    "to": "Trandal",
                    "departure": "13:00:00",
                    "status": "booked",
                }
            ],
        )
        self.assertEqual(merged[0]["status"], "skipped")

    def test_fyrste_observasjon_held_tidspunktet(self):
        first = apply_observations(
            [],
            [
                {
                    "id": "MOR:ServiceJourney:1136_a",
                    "from": "Standal",
                    "to": "Trandal",
                    "departure": "13:00:00",
                    "status": "booked",
                }
            ],
            "2026-10-02T06:50:00+02:00",
        )
        self.assertEqual(first[0]["observedAt"], "2026-10-02T06:50:00+02:00")
        again = apply_observations(
            first,
            [
                {
                    "id": "MOR:ServiceJourney:1136_a",
                    "from": "Standal",
                    "to": "Trandal",
                    "departure": "13:00:00",
                    "status": "skipped",
                }
            ],
            "2026-10-02T07:20:00+02:00",
        )
        self.assertEqual(again[0]["status"], "skipped")
        self.assertEqual(again[0]["observedAt"], "2026-10-02T06:50:00+02:00")
        self.assertEqual(again[0]["skippedAt"], "2026-10-02T07:20:00+02:00")

    def test_loggen_held_sju_dagar(self):
        days = {f"2026-09-{day:02d}": [] for day in range(20, 31)}
        days["2026-10-01"] = []
        kept = prune_days(days, datetime(2026, 10, 1, tzinfo=OSLO).date(), kept_days=7)
        self.assertIn("2026-09-25", kept)
        self.assertNotIn("2026-09-24", kept)
        self.assertIn("2026-10-01", kept)

    def test_update_log_skriv_dagen_og_klipper(self):
        routes = {"lines": {"1136": {"legs": [leg("MOR:ServiceJourney:1136_a", "13:00:00")]}}}
        existing = {"days": {"2026-09-01": [{"id": "MOR:ServiceJourney:old", "status": "booked"}]}}
        moment = datetime(2026, 10, 1, 13, 30, tzinfo=OSLO)
        payload = update_log(existing, routes, moment, {"MOR:ServiceJourney:1136_a"})
        self.assertEqual(payload["keptDays"], 7)
        self.assertEqual(payload["days"]["2026-10-01"][0]["status"], "skipped")
        self.assertNotIn("2026-09-01", payload["days"])

    def test_tur_som_har_dette_ut_av_feeden_blir_ikkje_gjetta_bestilt(self):
        trips = observe_signal_trips(
            [leg("MOR:ServiceJourney:1136_a", "13:00:00")],
            now_minutes=20 * 60,
            cancelled_ids=set(),
            seen_ids=set(),
        )
        self.assertEqual(trips, [])

    def test_cancelled_ids_les_berre_avlyste(self):
        cancelled, seen = journey_ids_from_payload(
            {
                "data": {
                    "standal": {
                        "estimatedCalls": [
                            {
                                "cancellation": False,
                                "serviceJourney": {"id": "MOR:ServiceJourney:1136_open"},
                            },
                            {
                                "cancellation": True,
                                "serviceJourney": {"id": "MOR:ServiceJourney:1136_a#0"},
                            },
                        ]
                    }
                }
            }
        )
        self.assertEqual(cancelled, {"MOR:ServiceJourney:1136_a"})
        self.assertEqual(seen, {"MOR:ServiceJourney:1136_open", "MOR:ServiceJourney:1136_a"})


if __name__ == "__main__":
    unittest.main()
