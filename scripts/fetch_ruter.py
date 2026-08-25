#!/usr/bin/env python3
"""Hent rutetabellen for samband 1136 frå Entur.

Køyr berre når rutetabellen er endra. Nettlesaren les den lagra fila og byggjer
seilingsplanen for dagen utan nye API-kall.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ENTUR_URL = "https://api.entur.io/journey-planner/v3/graphql"
LINE_ID = "MOR:Line:1136"
CLIENT_NAME = "teitrand-fergeruter"

QUAY_SUFFIXES = (" ferjekai", " kai")

# Kaiane i Hjørundfjorden. Turar mellom desse og Valderøya/Store Kalvøy er
# forflytting utan passasjerar, jf. fotnote 4 i ruteheftet.
HJORUNDFJORD_QUAYS = ("Standal", "Trandal", "Sæbø", "Skår", "Leknes", "Bjørke", "Urke")

SIGNAL_RE = re.compile(r"min\.?\s*(\d+)\s*(timar|time|minutt|min)", re.I)
PHONE_RE = re.compile(r"tlf\.?\s*([\d\s]{6,})", re.I)

QUERY = """
{
  line(id: "MOR:Line:1136") {
    id
    publicCode
    name
    serviceJourneys {
      id
      notices { text }
      passingTimes {
        requestStop
        quay { id name }
        departure { time }
        arrival { time }
      }
      activeDates
    }
  }
}
"""


def quay_place(name: str | None) -> str:
    if not name:
        return ""
    place = name.strip()
    for suffix in QUAY_SUFFIXES:
        if place.endswith(suffix):
            return place[: -len(suffix)].strip()
    return place


def clock(value: str | None) -> str | None:
    if not value:
        return None
    return value[:8]


def passing_departure(point: dict) -> str | None:
    return clock((point.get("departure") or {}).get("time"))


def passing_arrival(point: dict) -> str | None:
    return clock((point.get("arrival") or {}).get("time")) or passing_departure(point)


def parse_signal(notices: list[dict]) -> dict | None:
    """Gjer fotnoten om til minutt varsling, t.d. 'min. 1 time før' -> 60."""
    for notice in notices or []:
        text = (notice.get("text") or "").strip()
        match = SIGNAL_RE.search(text)
        if not match:
            continue
        amount = int(match.group(1))
        unit = match.group(2).lower()
        minutes = amount * 60 if unit.startswith("tim") else amount
        phone = None
        phone_match = PHONE_RE.search(text)
        if phone_match:
            phone = " ".join(phone_match.group(1).split())
        return {"minutesBefore": minutes, "text": text, "phone": phone}
    return None


def is_hjorundfjord(quay: str) -> bool:
    return quay in HJORUNDFJORD_QUAYS


def legs_from_journey(journey: dict) -> list[dict]:
    """Ein del per strekning mellom to påfølgjande anløp."""
    times = journey.get("passingTimes") or []
    if len(times) < 2:
        return []
    dates = sorted(set(journey.get("activeDates") or []))
    journey_id = journey.get("id") or ""
    notices = journey.get("notices") or []
    signal = parse_signal(notices)
    notice_texts = [n["text"].strip() for n in notices if (n.get("text") or "").strip()]
    legs = []
    for index, (start, end) in enumerate(zip(times, times[1:])):
        departure = passing_departure(start)
        arrival = passing_arrival(end)
        origin = quay_place(start.get("quay", {}).get("name"))
        destination = quay_place(end.get("quay", {}).get("name"))
        if not departure or not origin or not destination:
            continue
        legs.append(
            {
                "id": f"{journey_id}#{index}",
                "from": origin,
                "to": destination,
                "departure": departure,
                "arrival": arrival,
                "requestStop": bool(start.get("requestStop")),
                "signal": signal,
                "notices": notice_texts,
                "activeDates": dates,
            }
        )
    return legs


def build_legs(journeys: list[dict]) -> list[dict]:
    legs = []
    for journey in journeys:
        legs.extend(legs_from_journey(journey))
    legs.sort(key=lambda leg: (leg["departure"], leg["id"]))
    return legs


def timetable_body(payload: dict) -> dict:
    return {key: value for key, value in payload.items() if key != "fetchedAt"}


def fetch_line(timeout: int = 60) -> dict:
    req = urllib.request.Request(
        ENTUR_URL,
        data=json.dumps({"query": QUERY}).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "ET-Client-Name": CLIENT_NAME,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        body = json.loads(response.read().decode("utf-8"))
    if body.get("errors"):
        raise RuntimeError(f"Entur GraphQL-feil: {body['errors']}")
    line = (body.get("data") or {}).get("line")
    if not line:
        raise RuntimeError("Entur gav ikkje noka linje 1136.")
    return line


def build_payload(line: dict, fetched_at: str | None = None) -> dict:
    return {
        "source": ENTUR_URL,
        "lineId": line.get("id") or LINE_ID,
        "publicCode": line.get("publicCode") or "1136",
        "lineName": line.get("name") or "Standal-Trandal",
        "fetchedAt": fetched_at or datetime.now(timezone.utc).isoformat(),
        "hjorundfjordQuays": list(HJORUNDFJORD_QUAYS),
        "legs": build_legs(line.get("serviceJourneys") or []),
    }


def default_output_path() -> Path:
    return Path(__file__).resolve().parents[1] / "data" / "ruter.json"


def write_if_changed(payload: dict, output: Path) -> bool:
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        existing = json.loads(output.read_text(encoding="utf-8"))
        if timetable_body(existing) == timetable_body(payload):
            return False
    output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return True


def main() -> int:
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else default_output_path()
    try:
        payload = build_payload(fetch_line())
    except (urllib.error.URLError, TimeoutError, RuntimeError, json.JSONDecodeError) as exc:
        print(f"Kunne ikkje hente rutetabell: {exc}", file=sys.stderr)
        return 1
    changed = write_if_changed(payload, output)
    count = len(payload["legs"])
    if changed:
        print(f"Skreiv {count} strekningar til {output}")
    else:
        print(f"Rutetabellen er uendra ({count} strekningar)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
