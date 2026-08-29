#!/usr/bin/env python3
"""Bygg data/kombirute.json frå FRAM si kombinasjonstabell.

Kjelde (byt URL og køyr på nytt når FRAM legg ut ny PDF):
https://frammr.no/_f/p2/i2e02cdba-2cdc-4a23-b9bf-f6a6bd437bbe/kombinasjonsrute-sabo-leknes-skar-trandal-standal-20251118.pdf
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

# Fotnote 1) i FRAM-PDF, per Frå-celle. Ikkje heile turen (t.d. Standal 09:50
# er vanleg, Trandal 10:05 på same retur er på signal).
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


def clock(hhmm: str) -> str:
    return f"{hhmm[:2]}:{hhmm[2:]}:00"


def plus(hhmm: str, minutes: int = 15) -> str:
    total = int(hhmm[:2]) * 60 + int(hhmm[2:]) + minutes
    return f"{total // 60:02d}{total % 60:02d}"


def leg(from_quay, to_quay, dep, arr, days, signal=False, request=False):
    item = {
        "from": from_quay,
        "to": to_quay,
        "departure": clock(dep),
        "arrival": clock(arr),
        "requestStop": bool(request or signal),
        "signal": SIGNAL if signal else None,
        "days": days,
    }
    item["id"] = f"kombi-{from_quay}-{dep}-{to_quay}-{','.join(days)}"
    return item


def shuttle(days, saebo, leknes, signal_s=False, signal_l=False):
    return [
        leg("Sæbø", "Leknes", saebo, leknes, days, signal=signal_s),
        leg("Leknes", "Sæbø", leknes, plus(leknes), days, signal=signal_l),
    ]


def fjord_out(days, saebo, trandal, standal, signal=False):
    return [
        leg("Sæbø", "Trandal", saebo, trandal, days, signal=signal),
        leg("Trandal", "Standal", trandal, standal, days, signal=signal),
    ]


def hhmm_key(value: str) -> str:
    return value[:2] + value[3:5] if ":" in value else value


def is_pdf_signal(quay: str, departure: str, days: list[str]) -> bool:
    time = hhmm_key(departure)
    return bool(days) and all(time in PDF_SIGNAL.get(day, {}).get(quay, set()) for day in days)


def apply_pdf_signal(legs: list[dict]) -> None:
    """Berre cellene med 1) i PDF-en får signal-merke."""
    for item in legs:
        marked = is_pdf_signal(item["from"], item["departure"], item["days"])
        item["signal"] = SIGNAL if marked else None
        item["requestStop"] = marked


def hide_duplicate_departures(legs: list[dict]) -> None:
    """PDF har éi Frå-celle per kai og klokke.

    Innbound til Skår/Trandal brukar same Sæbø-tid som pendelen, og skal
    berre gje ankomst — ikkje ei ekstra «Frå Sæbø»-rad.
    """
    seen: set[tuple[str, str, str]] = set()
    for item in legs:
        hidden = False
        for day in item["days"]:
            key = (day, item["from"], item["departure"])
            if key in seen:
                hidden = True
            else:
                seen.add(key)
        if hidden:
            item["hideDeparture"] = True


def fjord_back(days, trandal, saebo_arr=None, standal=None, signal=False):
    """Retur. Standal-avgang berre når PDF-en har «Frå Standal»."""
    items = []
    if standal:
        items.append(leg("Standal", "Trandal", standal, trandal, days, signal=signal))
    arrive = saebo_arr or plus(trandal, 25)
    items.append(leg("Trandal", "Sæbø", trandal, arrive, days, signal=signal))
    return items


def skar_roundtrip(days, saebo, skar):
    """Sæbø–Skår. Berre Frå Skår er 1) i PDF-en; apply_pdf_signal set merket."""
    return [
        leg("Sæbø", "Skår", saebo, skar, days),
        leg("Skår", "Sæbø", skar, plus(skar, 20), days),
    ]


def build() -> dict:
    wd, sa, su = ["weekday"], ["saturday"], ["sunday"]
    all_days = wd + sa + su
    legs: list[dict] = []

    # Sæbø–Leknes-pendel (same rader som PDF).
    for days, pairs in [
        (wd, [
            ("0600", "0615"), ("0630", "0645"), ("0715", "0730"),
            ("0815", "0830"), ("0845", "0900"), ("1030", "1045"),
            ("1245", "1300"), ("1345", "1400"), ("1445", "1500"),
            ("1630", "1645"), ("1700", "1715"), ("1730", "1745"),
            ("1830", "1845"), ("2030", "2045"), ("2100", "2115"),
            ("2215", "2230"),
        ]),
        (sa, [
            ("0630", "0645"), ("0815", "0830"), ("0845", "0900"),
            ("1030", "1045"), ("1245", "1300"), ("1345", "1400"),
            ("1445", "1500"), ("1630", "1645"), ("1700", "1715"),
            ("1730", "1745"), ("1830", "1845"), ("2030", "2045"),
            ("2100", "2115"), ("2215", "2230"),
        ]),
        (su, [
            ("0730", "0745"), ("0815", "0830"), ("0845", "0900"),
            ("1030", "1045"), ("1245", "1300"), ("1345", "1400"),
            ("1445", "1500"), ("1630", "1645"), ("1730", "1745"),
            ("1830", "1845"), ("1930", "1945"), ("2130", "2145"),
            ("2215", "2230"),
        ]),
    ]:
        for saebo, leknes in pairs:
            legs.extend(shuttle(days, saebo, leknes))

    legs.extend(shuttle(wd, "1115", "1130", signal_l=True))
    legs.extend(shuttle(sa, "1115", "1130", signal_l=True))
    legs.extend(shuttle(su, "1115", "1130", signal_l=True))
    for days in (wd, sa, su):
        legs.append(leg("Leknes", "Sæbø", "1200", "1215", days))

    # Inn fjorden: Sæbø–Trandal–Standal (PDF-rader 0915 / 1515 / 1900).
    for days, saebo, trandal, standal in [
        (all_days, "0915", "0935", "0950"),
        (all_days, "1515", "1535", "1550"),
        (wd, "1900", "1925", "1945"),
        (sa, "1900", "1935", "1950"),
        (su, "2000", "2020", "2035"),
    ]:
        legs.extend(fjord_out(days, saebo, trandal, standal))

    # Retur. Standal-tid frå PDF-kolonnen «Frå Standal»; 2140 er berre Trandal.
    for spec in [
        (all_days, "1005", "1030", "0950"),
        (all_days, "1605", "1630", "1550"),
        (wd, "2005", "2030", "1945"),
        (sa, "2005", "2030", "1950"),
        (su, "2050", "2110", "2035"),
        (wd + sa, "2140", "2215", None),
    ]:
        days, trandal, saebo_arr, standal = spec
        legs.extend(fjord_back(days, trandal, saebo_arr, standal=standal))

    # Søndag: PDF har «Frå Leknes» 21:15 etter kveldsreturen (ikkje Sæbø-ankomst).
    legs.append(leg("Leknes", "Sæbø", "2115", "2130", su))

    # Signalturar Skår. Same PDF-rad som Sæbø 1115 / 1730 / 1830; innbound
    # slik at tidslinja får anløp før «Frå Skår» (som på 1136).
    for days, saebo, skar in [
        (all_days, "1115", "1145"),
        (wd + sa, "1730", "1800"),
        (su, "1830", "1900"),
    ]:
        legs.extend(skar_roundtrip(days, saebo, skar))

    # 2140 er berre Trandal i PDF-en; same rad som Sæbø 2100.
    legs.append(leg("Sæbø", "Trandal", "2100", "2140", wd + sa, signal=True))

    # Laurdag morgon inn fjorden på signal.
    legs.extend(fjord_out(sa, "0700", "0725", "0740", signal=True))
    legs.append(leg("Standal", "Trandal", "0740", "0755", sa, signal=True))
    legs.append(leg("Trandal", "Sæbø", "0755", "0815", sa, signal=True))

    apply_pdf_signal(legs)
    hide_duplicate_departures(legs)
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
            "Éi ferje køyrer både Sæbø–Leknes og Standal–Trandal–Sæbø–Skår som "
            "éi kombinasjonsrute (det andre sambandsfartøyet er ute). "
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
