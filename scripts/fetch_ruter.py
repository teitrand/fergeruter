#!/usr/bin/env python3
"""Hent rutetabellen for samband 1136 frå Entur.

Køyr berre når rutetabellen er endra. Nettlesaren les den lagra fila og byter
visning mellom dei to Standal-alternativa utan nye API-kall.
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

STANDAL = "Standal"
TRANDAL = "Trandal"

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

ALTERNATIVES = (
    {
        "id": "fra-trandal",
        "label": "Frå Trandal",
        "from": TRANDAL,
        "to": STANDAL,
    },
    {
        "id": "fra-standal",
        "label": "Frå Standal",
        "from": STANDAL,
        "to": TRANDAL,
    },
)


def quay_place(name: str | None) -> str:
    if not name:
        return ""
    return name.removesuffix(" ferjekai").strip()


def clock(value: str | None) -> str | None:
    if not value:
        return None
    return value[:8]


def trip_from_journey(journey: dict, origin: str, destination: str) -> dict | None:
    times = journey.get("passingTimes") or []
    if len(times) < 2:
        return None
    first, last = times[0], times[-1]
    if quay_place(first.get("quay", {}).get("name")) != origin:
        return None
    if quay_place(last.get("quay", {}).get("name")) != destination:
        return None
    departure = clock((first.get("departure") or {}).get("time"))
    arrival = clock((last.get("arrival") or {}).get("time")) or clock(
        (last.get("departure") or {}).get("time")
    )
    if not departure:
        return None
    dates = sorted(set(journey.get("activeDates") or []))
    return {
        "id": journey.get("id"),
        "departure": departure,
        "arrival": arrival,
        "requestStop": bool(first.get("requestStop")),
        "activeDates": dates,
    }


def build_alternatives(journeys: list[dict]) -> list[dict]:
    alternatives = []
    for spec in ALTERNATIVES:
        trips = []
        for journey in journeys:
            trip = trip_from_journey(journey, spec["from"], spec["to"])
            if trip:
                trips.append(trip)
        trips.sort(key=lambda item: (item["departure"], item["id"] or ""))
        alternatives.append({**spec, "trips": trips})
    return alternatives


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
    journeys = line.get("serviceJourneys") or []
    return {
        "source": ENTUR_URL,
        "lineId": line.get("id") or LINE_ID,
        "publicCode": line.get("publicCode") or "1136",
        "lineName": line.get("name") or "Standal-Trandal",
        "fetchedAt": fetched_at or datetime.now(timezone.utc).isoformat(),
        "alternatives": build_alternatives(journeys),
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
    trips = sum(len(alt["trips"]) for alt in payload["alternatives"])
    if changed:
        print(f"Skreiv {trips} turar til {output}")
    else:
        print(f"Rutetabellen er uendra ({trips} turar)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
