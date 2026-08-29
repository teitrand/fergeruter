#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "build_kombirute.py"

# FRAM kombinasjonsrute 18.11.2025, «Frå»-kolonnar (Sæbø–Leknes–Skår–Trandal–Standal).
# Bbox-sjekka på nytt 29.08.26 mot original-PDF.
FRAM_PDF_FROM = {
    "weekday": {
        "Sæbø": "0600 0630 0715 0815 0845 0915 1030 1115 1245 1345 1445 1515 1630 1700 1730 1830 1900 2030 2100 2215",
        "Leknes": "0615 0645 0730 0830 0900 1045 1130 1200 1300 1400 1500 1645 1715 1745 1845 2045 2115 2230",
        "Skår": "1145 1800",
        "Trandal": "0935 1005 1535 1605 1925 2005 2140",
        "Standal": "0950 1550 1945",
    },
    "saturday": {
        "Sæbø": "0630 0700 0815 0845 0915 1030 1115 1245 1345 1445 1515 1630 1700 1730 1830 1900 2030 2100 2215",
        "Leknes": "0645 0830 0900 1045 1130 1200 1300 1400 1500 1645 1715 1745 1845 2045 2115 2230",
        "Skår": "1145 1800",
        "Trandal": "0725 0755 0935 1005 1535 1605 1935 2005 2140",
        "Standal": "0740 0950 1550 1950",
    },
    "sunday": {
        "Sæbø": "0730 0815 0845 0915 1030 1115 1245 1345 1445 1515 1630 1730 1830 1930 2000 2130 2215",
        "Leknes": "0745 0830 0900 1045 1130 1200 1300 1400 1500 1645 1745 1845 1945 2115 2145 2230",
        "Skår": "1145 1900",
        "Trandal": "0935 1005 1535 1605 2020 2050",
        "Standal": "0950 1550 2035",
    },
}

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
        self.assertEqual(stored["legs"], built["legs"])
        self.assertTrue(any("1 time" in (leg.get("signal") or {}).get("text", "") for leg in built["legs"]))

    def test_from_times_match_fram_pdf(self):
        """Frå-kolonnane i FRAM-PDF 18.11.25 (bbox-avlest frå originalfila)."""
        stored = json.loads((ROOT / "data" / "kombirute.json").read_text(encoding="utf-8"))
        for payload in (mod.build(), stored):
            for day, stops in FRAM_PDF_FROM.items():
                for quay, times in stops.items():
                    expected = set(times.split())
                    got = {
                        leg["departure"][:2] + leg["departure"][3:5]
                        for leg in payload["legs"]
                        if quay == leg["from"] and day in leg["days"]
                    }
                    self.assertEqual(got, expected, f"{day} {quay}")

    def test_one_from_row_per_quay_and_clock(self):
        """Overlappande PDF-rad skal ikkje gje to «Frå Sæbø» same minutt."""
        payload = mod.build()
        for day in ("weekday", "saturday", "sunday"):
            visible = [
                (leg["from"], leg["departure"])
                for leg in payload["legs"]
                if day in leg["days"] and not leg.get("hideDeparture")
            ]
            self.assertEqual(len(visible), len(set(visible)), day)
            saebo_1115 = [
                leg
                for leg in payload["legs"]
                if day in leg["days"]
                and leg["from"] == "Sæbø"
                and leg["departure"] == "11:15:00"
                and not leg.get("hideDeparture")
            ]
            self.assertEqual(len(saebo_1115), 1, day)
            self.assertEqual(saebo_1115[0]["to"], "Leknes")

    def test_no_invented_from_on_overlapping_row(self):
        """Same PDF-rad (t.d. 11:15 / 11:30 / 11:45) er fem Frå-kolonnar, ikkje to Sæbø-avgangar."""
        payload = mod.build()
        weekday = [leg for leg in payload["legs"] if "weekday" in leg["days"]]
        self.assertFalse(
            any(leg["from"] == "Sæbø" and leg["to"] == "Skår" for leg in weekday)
        )
        self.assertTrue(
            any(
                leg["from"] == "Skår" and leg["departure"] == "11:45:00"
                for leg in weekday
            )
        )

    def test_signal_matches_fram_pdf_footnote(self):
        """Berre 1)-cellene i PDF-en skal vere merkte som signal."""
        stored = json.loads((ROOT / "data" / "kombirute.json").read_text(encoding="utf-8"))
        for payload in (mod.build(), stored):
            for day, stops in mod.PDF_SIGNAL.items():
                for quay, times in stops.items():
                    got = {
                        leg["departure"][:2] + leg["departure"][3:5]
                        for leg in payload["legs"]
                        if quay == leg["from"] and day in leg["days"] and leg.get("signal")
                    }
                    self.assertEqual(got, times, f"signal {day} {quay}")
            extras = [
                (day, leg["from"], leg["departure"])
                for day in ("weekday", "saturday", "sunday")
                for leg in payload["legs"]
                if day in leg["days"]
                and leg.get("signal")
                and (leg["departure"][:2] + leg["departure"][3:5])
                not in mod.PDF_SIGNAL.get(day, {}).get(leg["from"], set())
            ]
            self.assertEqual(extras, [])
            weekday = [leg for leg in payload["legs"] if "weekday" in leg["days"]]
            standal_0950 = next(
                leg
                for leg in weekday
                if leg["from"] == "Standal" and leg["departure"] == "09:50:00"
            )
            self.assertIsNone(standal_0950["signal"])
            trandal_1005 = next(
                leg
                for leg in weekday
                if leg["from"] == "Trandal" and leg["departure"] == "10:05:00"
            )
            self.assertIsNotNone(trandal_1005["signal"])


if __name__ == "__main__":
    unittest.main()
