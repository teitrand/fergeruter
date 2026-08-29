#!/usr/bin/env python3
"""Skjema-sjekkar for kombirute-PDF-en.

Når FRAM legg ut ny tabell, oppdater PDF_ROWS og PDF_SIGNAL. Desse testane
skal framleis vere grøne: dei låser leseregelen, ikkje gjeldande klokkeslett.
"""
from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "build_kombirute.py"

# Kunstig fem-kolonne-tabell. Tidene er ikkje frå gjeldande PDF.
SCHEMA_ROWS = [
    ("0600", "0615", "", "", ""),
    ("0915", "", "", "0935", "0950"),
    ("", "", "", "1005", ""),
    ("1030", "1045", "", "", ""),
    ("1115", "1130", "1145", "", ""),
    ("", "1200", "", "", ""),
    ("1245", "1300", "", "", ""),
]

spec = importlib.util.spec_from_file_location("build_kombirute", SCRIPT)
mod = importlib.util.module_from_spec(spec)
sys.modules["build_kombirute"] = mod
assert spec.loader is not None
spec.loader.exec_module(mod)


def hhmm(value: str) -> str:
    return value[:2] + value[3:5] if ":" in value else value


def from_times(legs: list[dict], day: str) -> set[tuple[str, str]]:
    return {
        (leg["from"], hhmm(leg["departure"]))
        for leg in legs
        if day in leg["days"] and not leg.get("hideDeparture")
    }


def expected_from_cells(rows: list[tuple[str, str, str, str, str]]) -> list[tuple[str, str]]:
    return mod.filled_cells(rows)


class KombiruteSchemaTests(unittest.TestCase):
    def test_pdf_is_five_columns_and_three_day_groups(self):
        self.assertEqual(mod.QUAYS, ("Sæbø", "Leknes", "Skår", "Trandal", "Standal"))
        self.assertEqual(set(mod.PDF_ROWS), {"weekday", "saturday", "sunday"})
        for day, rows in mod.PDF_ROWS.items():
            self.assertTrue(rows, day)
            for row in rows:
                self.assertEqual(len(row), 5, day)
                for cell in row:
                    self.assertTrue(cell == "" or (len(cell) == 4 and cell.isdigit()), cell)

    def test_schema_reads_row_by_row_as_one_route(self):
        """Neste fylte celle er neste stopp. Ankomst = avgang + overfart."""
        cells = expected_from_cells(SCHEMA_ROWS)
        legs = list(mod.legs_from_rows("weekday", SCHEMA_ROWS))
        self.assertEqual(
            cells,
            [
                ("Sæbø", "0600"),
                ("Leknes", "0615"),
                ("Sæbø", "0915"),
                ("Trandal", "0935"),
                ("Standal", "0950"),
                ("Trandal", "1005"),
                ("Sæbø", "1030"),
                ("Leknes", "1045"),
                ("Sæbø", "1115"),
                ("Leknes", "1130"),
                ("Skår", "1145"),
                ("Leknes", "1200"),
                ("Sæbø", "1245"),
                ("Leknes", "1300"),
            ],
        )
        chained = legs[:-1]
        self.assertEqual(len(chained), len(cells) - 1)
        for index, ((origin, departure), (dest, _next_from)) in enumerate(zip(cells, cells[1:])):
            self.assertEqual(chained[index]["from"], origin)
            self.assertEqual(hhmm(chained[index]["departure"]), departure)
            self.assertEqual(chained[index]["to"], dest)
            self.assertEqual(
                hhmm(chained[index]["arrival"]),
                mod.arrival_at(origin, dest, departure),
            )
        leknes_1045 = next(leg for leg in legs if hhmm(leg["departure"]) == "1045")
        self.assertEqual(leknes_1045["to"], "Sæbø")
        self.assertEqual(hhmm(leknes_1045["arrival"]), "1100")
        leknes_1200 = next(leg for leg in legs if hhmm(leg["departure"]) == "1200")
        self.assertEqual(hhmm(leknes_1200["arrival"]), "1215")
        self.assertFalse(any(leg["from"] == "Sæbø" and leg["to"] == "Skår" for leg in legs))
        last = legs[-1]
        self.assertEqual((last["from"], hhmm(last["departure"])), cells[-1])
        self.assertEqual(hhmm(last["arrival"]), mod.arrival_at(last["from"], last["to"], cells[-1][1]))

    def test_live_table_follows_the_same_schema(self):
        payload = mod.build()
        stored = json.loads((ROOT / "data" / "kombirute.json").read_text(encoding="utf-8"))
        for source in (payload, stored):
            for day, rows in mod.PDF_ROWS.items():
                cells = expected_from_cells(rows)
                self.assertEqual(from_times(source["legs"], day), set(cells), day)
                day_legs = [
                    leg
                    for leg in sorted(
                        (leg for leg in source["legs"] if day in leg["days"]),
                        key=lambda item: (item["departure"], item["from"]),
                    )
                ]
                chained = day_legs[:-1]
                self.assertEqual(len(chained), len(cells) - 1, day)
                for (origin, departure), (dest, next_from) in zip(cells, cells[1:]):
                    match = next(
                        leg
                        for leg in chained
                        if leg["from"] == origin and hhmm(leg["departure"]) == departure
                    )
                    self.assertEqual(match["to"], dest, f"{day} {origin} {departure}")
                    expected_arr = mod.arrival_at(origin, dest, departure)
                    self.assertEqual(hhmm(match["arrival"]), expected_arr)
                    gap = (
                        int(next_from[:2]) * 60
                        + int(next_from[2:])
                        - (int(departure[:2]) * 60 + int(departure[2:]))
                    ) % (24 * 60)
                    self.assertLessEqual(
                        mod.crossing_minutes(origin, dest),
                        gap,
                        f"{day} {origin} {departure} overfart lengre enn hol til {dest} {next_from}",
                    )
                last_cell = cells[-1]
                last = next(
                    leg
                    for leg in day_legs
                    if leg["from"] == last_cell[0] and hhmm(leg["departure"]) == last_cell[1]
                )
                self.assertEqual(
                    hhmm(last["arrival"]),
                    mod.arrival_at(last["from"], last["to"], last_cell[1]),
                )
                for row in rows:
                    filled = [(quay, time) for quay, time in zip(mod.QUAYS, row) if time]
                    for (origin, departure), (dest, _next_from) in zip(filled, filled[1:]):
                        self.assertTrue(
                            any(
                                leg["from"] == origin
                                and hhmm(leg["departure"]) == departure
                                and leg["to"] == dest
                                for leg in day_legs
                            ),
                            f"{day} same rad {origin} {departure} → {dest}",
                        )

    def test_every_live_pair_has_a_crossing(self):
        pairs = {
            (leg["from"], leg["to"])
            for leg in mod.build()["legs"]
        }
        self.assertTrue(pairs)
        self.assertTrue(pairs <= set(mod.CROSSING))

    def test_one_from_per_quay_and_clock(self):
        payload = mod.build()
        for day in ("weekday", "saturday", "sunday"):
            visible = [
                (leg["from"], leg["departure"])
                for leg in payload["legs"]
                if day in leg["days"] and not leg.get("hideDeparture")
            ]
            self.assertEqual(len(visible), len(set(visible)), day)

    def test_kombi_quays_are_the_five_pdf_stops(self):
        payload = mod.build()
        quays = {quay for leg in payload["legs"] for quay in (leg["from"], leg["to"])}
        self.assertTrue({"Sæbø", "Leknes", "Skår", "Standal"} <= quays)
        self.assertNotIn("Valderøya", quays)
        self.assertNotIn("Store Kalvøy", quays)

    def test_stored_json_matches_builder(self):
        stored = json.loads((ROOT / "data" / "kombirute.json").read_text(encoding="utf-8"))
        built = mod.build()
        self.assertEqual(stored["source"], built["source"])
        self.assertEqual(stored["crossingMinutes"], built["crossingMinutes"])
        self.assertEqual(stored["legs"], built["legs"])

    def test_signal_is_per_from_cell(self):
        """Fotnote 1) er eit utval av Frå-celler, ikkje heile turen."""
        stored = json.loads((ROOT / "data" / "kombirute.json").read_text(encoding="utf-8"))
        for payload in (mod.build(), stored):
            for day, rows in mod.PDF_ROWS.items():
                cells = set(expected_from_cells(rows))
                marked = {
                    (quay, time)
                    for quay, times in mod.PDF_SIGNAL.get(day, {}).items()
                    for time in times
                }
                self.assertTrue(marked <= cells, f"signal utan Frå-celle {day}")
                got = {
                    (leg["from"], hhmm(leg["departure"]))
                    for leg in payload["legs"]
                    if day in leg["days"] and leg.get("signal")
                }
                self.assertEqual(got, marked, f"signal {day}")
                unmarked = cells - marked
                self.assertTrue(unmarked)
                for quay, time in unmarked:
                    leg = next(
                        item
                        for item in payload["legs"]
                        if day in item["days"]
                        and item["from"] == quay
                        and hhmm(item["departure"]) == time
                    )
                    self.assertIsNone(leg["signal"], f"{day} {quay} {time}")


if __name__ == "__main__":
    unittest.main()
