#!/usr/bin/env python3
"""Hent rutetabellen for samband 1136 frå Entur.

Køyr berre når rutetabellen er endra. Nettlesaren les den lagra fila og byggjer
seilingsplanen for dagen utan nye API-kall.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ENTUR_URL = "https://api.entur.io/journey-planner/v3/graphql"
LINE_ID = "MOR:Line:1136"
CLIENT_NAME = "teitrand-fergeruter"

QUAY_SUFFIXES = (" ferjekai", " kai")

QUERY = """
{
  line(id: "MOR:Line:1136") {
    id
    publicCode
    name
    serviceJourneys {
      id
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


def legs_from_journey(journey: dict) -> list[dict]:
    """Ein del per strekning mellom to påfølgjande anløp."""
    times = journey.get("passingTimes") or []
    if len(times) < 2:
        return []
    dates = sorted(set(journey.get("activeDates") or []))
    journey_id = journey.get("id") or ""
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
