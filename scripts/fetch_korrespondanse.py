#!/usr/bin/env python3
"""Hent korresponderande ruter frå Entur.

Solavågen (1069) og Hundeidvika (1049) landar på Festøya, med bilveg til
Standal. Buss 133 Leknes–Øye gjeld når aktiv tabell har Leknes (kombirute
eller 1135). Køyr berre når rutetabellane er endra; nettlesaren les den
lagra fila.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ENTUR_URL = "https://api.entur.io/journey-planner/v3/graphql"
CLIENT_NAME = "teitrand-fergeruter"

HUB = "Festøya"
ROAD_TO = "Standal"

# Køyretid Festøya-Standal målt med OSRM: 14,7 km på 14 minutt. Margin på
# fem minutt dekkjer av- og pålasting.
DRIVE_MINUTES = 14
MARGIN_MINUTES = 5

LINES = (
    {
        "id": "solavagen",
        "lineId": "MOR:Line:1069",
        "label": "Solavågen",
        "hub": "Festøya",
        "roadTo": "Standal",
        "driveMinutes": 14,
        "marginMinutes": 5,
    },
    {
        "id": "hundeidvika",
        "lineId": "MOR:Line:1049",
        "label": "Hundeidvika",
        "hub": "Festøya",
        "roadTo": "Standal",
        "driveMinutes": 14,
        "marginMinutes": 5,
    },
    {
        "id": "oye",
        "lineId": "MOR:Line:133",
        "label": "Øye",
        "hub": "Leknes",
        "roadTo": "Leknes",
        "driveMinutes": 0,
        "marginMinutes": 2,
    },
)
QUAY_ALIASES = {"Lekneset": "Leknes"}

QUAY_SUFFIXES = (" ferjekai", " kai")

QUERY = """
query ($id: ID!) {
  line(id: $id) {
    id
    publicCode
    name
    operator { name }
    serviceJourneys {
      passingTimes {
        quay { name }
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
            place = place[: -len(suffix)].strip()
            break
    return QUAY_ALIASES.get(place, place)


def clock(value: str | None) -> str | None:
    return value[:8] if value else None


def trip_from_journey(journey: dict) -> dict | None:
    times = journey.get("passingTimes") or []
    if len(times) < 2:
        return None
    first, last = times[0], times[-1]
    departure = clock((first.get("departure") or {}).get("time"))
    arrival = clock((last.get("arrival") or {}).get("time")) or clock(
        (last.get("departure") or {}).get("time")
    )
    origin = quay_place(first.get("quay", {}).get("name"))
    destination = quay_place(last.get("quay", {}).get("name"))
    if not departure or not arrival or not origin or not destination:
        return None
    return {
        "from": origin,
        "to": destination,
        "departure": departure,
        "arrival": arrival,
        "dates": sorted(set(journey.get("activeDates") or [])),
    }


class Calendars:
    """Turane deler få datosett, så vi lagrar kvart sett éin gong."""

    def __init__(self) -> None:
        self._ids: dict[tuple[str, ...], str] = {}
        self.by_id: dict[str, list[str]] = {}

    def id_for(self, dates: list[str]) -> str:
        key = tuple(dates)
        if key not in self._ids:
            name = str(len(self._ids) + 1)
            self._ids[key] = name
            self.by_id[name] = dates
        return self._ids[key]


def fetch_line(line_id: str, timeout: int = 90) -> dict:
    req = urllib.request.Request(
        ENTUR_URL,
        data=json.dumps({"query": QUERY, "variables": {"id": line_id}}).encode("utf-8"),
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
        raise RuntimeError(f"Entur gav ikkje linje {line_id}.")
    return line


def build_payload(lines: list[tuple[dict, dict]], fetched_at: str | None = None) -> dict:
    calendars = Calendars()
    out_lines = []
    for spec, line in lines:
        trips = []
        for journey in line.get("serviceJourneys") or []:
            trip = trip_from_journey(journey)
            if not trip:
                continue
            hub = spec.get("hub") or HUB
            # Berre turar som rører knutepunktet er interessante.
            if hub not in (trip["from"], trip["to"]):
                continue
            trips.append(
                {
                    "from": trip["from"],
                    "to": trip["to"],
                    "departure": trip["departure"],
                    "arrival": trip["arrival"],
                    "cal": calendars.id_for(trip["dates"]),
                }
            )
        trips.sort(key=lambda t: (t["departure"], t["from"]))
        out_lines.append(
            {
                "id": spec["id"],
                "label": spec["label"],
                "publicCode": line.get("publicCode") or "",
                "operator": (line.get("operator") or {}).get("name") or "",
                "hub": spec.get("hub") or HUB,
                "roadTo": spec.get("roadTo") or ROAD_TO,
                "driveMinutes": spec.get("driveMinutes", DRIVE_MINUTES),
                "marginMinutes": spec.get("marginMinutes", MARGIN_MINUTES),
                "trips": trips,
            }
        )
    return {
        "source": ENTUR_URL,
        "fetchedAt": fetched_at or datetime.now(timezone.utc).isoformat(),
        "hub": HUB,
        "roadTo": ROAD_TO,
        "driveMinutes": DRIVE_MINUTES,
        "marginMinutes": MARGIN_MINUTES,
        "calendars": calendars.by_id,
        "lines": out_lines,
    }


def timetable_body(payload: dict) -> dict:
    return {key: value for key, value in payload.items() if key != "fetchedAt"}


def default_output_path() -> Path:
    return Path(__file__).resolve().parents[1] / "data" / "korrespondanse.json"


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
        fetched = [(spec, fetch_line(spec["lineId"])) for spec in LINES]
        payload = build_payload(fetched)
    except (urllib.error.URLError, TimeoutError, RuntimeError, json.JSONDecodeError) as exc:
        print(f"Kunne ikkje hente korrespondansar: {exc}", file=sys.stderr)
        return 1
    changed = write_if_changed(payload, output)
    total = sum(len(line["trips"]) for line in payload["lines"])
    if changed:
        print(f"Skreiv {total} turar til {output}")
    else:
        print(f"Korrespondansane er uendra ({total} turar)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
