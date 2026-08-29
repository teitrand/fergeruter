#!/usr/bin/env python3
"""Bygg data/kombirute.json frå FRAM si kombinasjonstabell.

Kjelde (byt URL og køyr på nytt når FRAM legg ut ny PDF):
https://frammr.no/_f/p2/i2e02cdba-2cdc-4a23-b9bf-f6a6bd437bbe/kombinasjonsrute-sabo-leknes-skar-trandal-standal-20251118.pdf

PDF-en er fem Frå-kolonnar (Sæbø, Leknes, Skår, Trandal, Standal) for
måndag–fredag, så laurdag, så søndag. Les linje for linje som éi
samanhengande rute: neste fylte celle er neste anløp (ankomst = den Frå-tida).
"""

from __future__ import annotations

import json
from pathlib import Path

SOURCE = (
    "https://frammr.no/_f/p2/i2e02cdba-2cdc-4a23-b9bf-f6a6bd437bbe/"
    "kombinasjonsrute-sabo-leknes-skar-trandal-standal-20251118.pdf"
)
SIGNAL = {
    "minutesBefore": 60,
    "text": "Berre på signal seinast 1 time før avgang",
    "phone": None,
}
QUAYS = ("Sæbø", "Leknes", "Skår", "Trandal", "Standal")

# Fotnote 1) i FRAM-PDF, per Frå-celle.
PDF_SIGNAL = {
    "weekday": {
        "Leknes": {"1130"},
        "Skår": {"1145", "1800"},
        "Trandal": {"1005", "2140"},
    },
    "saturday": {
        "Sæbø": {"0700"},
        "Leknes": {"1130"},
        "Skår": {"1145", "1800"},
        "Trandal": {"0725", "0755", "1005", "2140"},
        "Standal": {"0740"},
    },
    "sunday": {
        "Leknes": {"1130"},
        "Skår": {"1145", "1900"},
        "Trandal": {"1005"},
    },
}

# Tom streng = tom celle. Rekkjefølgje: Sæbø, Leknes, Skår, Trandal, Standal.
PDF_ROWS = {
    "weekday": [
        ("0600", "0615", "", "", ""),
        ("0630", "0645", "", "", ""),
        ("0715", "0730", "", "", ""),
        ("0815", "0830", "", "", ""),
        ("0845", "0900", "", "", ""),
        ("0915", "", "", "0935", "0950"),
        ("", "", "", "1005", ""),
        ("1030", "1045", "", "", ""),
        ("1115", "1130", "1145", "", ""),
        ("", "1200", "", "", ""),
        ("1245", "1300", "", "", ""),
        ("1345", "1400", "", "", ""),
        ("1445", "1500", "", "", ""),
        ("1515", "", "", "1535", "1550"),
        ("", "", "", "1605", ""),
        ("1630", "1645", "", "", ""),
        ("1700", "1715", "", "", ""),
        ("1730", "1745", "1800", "", ""),
        ("1830", "1845", "", "", ""),
        ("1900", "", "", "1925", "1945"),
        ("", "", "", "2005", ""),
        ("2030", "2045", "", "", ""),
        ("2100", "2115", "", "2140", ""),
        ("2215", "2230", "", "", ""),
    ],
    "saturday": [
        ("0630", "0645", "", "", ""),
        ("0700", "", "", "0725", "0740"),
        ("", "", "", "0755", ""),
        ("0815", "0830", "", "", ""),
        ("0845", "0900", "", "", ""),
        ("0915", "", "", "0935", "0950"),
        ("", "", "", "1005", ""),
        ("1030", "1045", "", "", ""),
        ("1115", "1130", "1145", "", ""),
        ("", "1200", "", "", ""),
        ("1245", "1300", "", "", ""),
        ("1345", "1400", "", "", ""),
        ("1445", "1500", "", "", ""),
        ("1515", "", "", "1535", "1550"),
        ("", "", "", "1605", ""),
        ("1630", "1645", "", "", ""),
        ("1700", "1715", "", "", ""),
        ("1730", "1745", "1800", "", ""),
        ("1830", "1845", "", "", ""),
        ("1900", "", "", "1935", "1950"),
        ("", "", "", "2005", ""),
        ("2030", "2045", "", "", ""),
        ("2100", "2115", "", "2140", ""),
        ("2215", "2230", "", "", ""),
    ],
    "sunday": [
        ("0730", "0745", "", "", ""),
        ("0815", "0830", "", "", ""),
        ("0845", "0900", "", "", ""),
        ("0915", "", "", "0935", "0950"),
        ("", "", "", "1005", ""),
        ("1030", "1045", "", "", ""),
        ("1115", "1130", "1145", "", ""),
        ("", "1200", "", "", ""),
        ("1245", "1300", "", "", ""),
        ("1345", "1400", "", "", ""),
        ("1445", "1500", "", "", ""),
        ("1515", "", "", "1535", "1550"),
        ("", "", "", "1605", ""),
        ("1630", "1645", "", "", ""),
        ("1730", "1745", "", "", ""),
        ("1830", "1845", "1900", "", ""),
        ("1930", "1945", "", "", ""),
        ("2000", "", "", "2020", "2035"),
        ("", "", "", "2050", ""),
        ("", "2115", "", "", ""),
        ("2130", "2145", "", "", ""),
        ("2215", "2230", "", "", ""),
    ],
}


def clock(hhmm: str) -> str:
    return f"{hhmm[:2]}:{hhmm[2:]}:00"


def plus_minutes(hhmm: str, minutes: int) -> str:
    total = int(hhmm[:2]) * 60 + int(hhmm[2:]) + minutes
    total %= 24 * 60
    return f"{total // 60:02d}{total % 60:02d}"


def hhmm_key(value: str) -> str:
    return value[:2] + value[3:5] if ":" in value else value


def is_pdf_signal(quay: str, departure: str, days: list[str]) -> bool:
    time = hhmm_key(departure)
    return bool(days) and all(time in PDF_SIGNAL.get(day, {}).get(quay, set()) for day in days)


def apply_pdf_signal(legs: list[dict]) -> None:
    for item in legs:
        marked = is_pdf_signal(item["from"], item["departure"], item["days"])
        item["signal"] = SIGNAL if marked else None
        item["requestStop"] = marked


def filled_cells(rows: list[tuple[str, str, str, str, str]]) -> list[tuple[str, str]]:
    """Frå-celler i leserekkjefølgje: venstre mot høgre, så neste linje."""
    cells = []
    for row in rows:
        for quay, time in zip(QUAYS, row):
            if time:
                cells.append((quay, time))
    return cells


def legs_from_rows(day: str, rows: list[tuple[str, str, str, str, str]]) -> list[dict]:
    cells = filled_cells(rows)
    days = [day]
    legs = []
    for index, ((origin, departure), (dest, arrival)) in enumerate(zip(cells, cells[1:])):
        item = {
            "from": origin,
            "to": dest,
            "departure": clock(departure),
            "arrival": clock(arrival),
            "requestStop": False,
            "signal": None,
            "days": days,
            "id": f"kombi-{origin}-{departure}-{dest}-{day}-{index}",
        }
        legs.append(item)
    # Siste Frå-celle har inga neste celle; ho skal likevel vere ein Frå-tid.
    if cells:
        origin, departure = cells[-1]
        dest = "Sæbø" if origin != "Sæbø" else "Leknes"
        arrival = plus_minutes(departure, 15)
        legs.append(
            {
                "from": origin,
                "to": dest,
                "departure": clock(departure),
                "arrival": clock(arrival),
                "requestStop": False,
                "signal": None,
                "days": days,
                "id": f"kombi-{origin}-{departure}-{dest}-{day}-{len(cells)}",
            }
        )
    return legs


def build() -> dict:
    legs: list[dict] = []
    for day, rows in PDF_ROWS.items():
        legs.extend(legs_from_rows(day, rows))
    apply_pdf_signal(legs)
    legs.sort(key=lambda item: (item["days"][0], item["departure"], item["from"], item["to"]))
    return {
        "source": SOURCE,
        "validFrom": "2025-11-18",
        "publicCode": "kombi",
        "lineName": "Kombinasjonsrute Sæbø–Leknes–Skår–Trandal–Standal",
        "vessels": [
            {"name": "M/F Geiranger", "phone": "916 69 321"},
            {"name": "M/F Kvernes", "phone": "916 69 340"},
        ],
        "note": (
            "Éi ferje, éi samanhengande rute. PDF-en har fem Frå-kolonnar "
            "(Sæbø, Leknes, Skår, Trandal, Standal) for måndag–fredag, laurdag "
            "og søndag. Neste fylte celle er neste anløp. "
            "Berre på signal seinast 1 time før avgang. PDF frå FRAM, ikkje Entur."
        ),
        "legs": legs,
    }


def main() -> int:
    output = Path(__file__).resolve().parents[1] / "data" / "kombirute.json"
    payload = build()
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Skreiv {len(payload['legs'])} strekningar til {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
