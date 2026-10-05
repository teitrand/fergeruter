#!/usr/bin/env python3
"""Logg om signalturar vart bestilte, og ta vare på ei veke."""

from __future__ import annotations

import json
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ENTUR_URL = "https://api.entur.io/journey-planner/v3/graphql"
ENTUR_CLIENT = "teitrand-fergeruter"
KEPT_DAYS = 7
OSLO = ZoneInfo("Europe/Oslo")
# Cron `*/30 4-21 * * *` UTC. 70 minutt er eitt uteblitt køyrd pluss litt kø.
# Vaktvindauget varer til 22:40, så den siste lovlege forseinkinga blir fanga.
# Nattpausen tel ikkje med i alderen.
SIGNAL_LOG_MAX_AGE = timedelta(minutes=70)
SIGNAL_LOG_WATCH_START = 4 * 60
SIGNAL_LOG_WATCH_END = 22 * 60 + 40
ROOT = Path(__file__).resolve().parents[1]
ROUTES_PATH = ROOT / "data" / "ruter.json"
LOG_PATH = ROOT / "data" / "signalturar.json"
JOURNEY_RE = re.compile(r"MOR:ServiceJourney:[^#\s]+")
STOPS = {
    "Standal": "NSR:StopPlace:39713",
    "Trandal": "NSR:StopPlace:58521",
    "Sæbø": "NSR:StopPlace:58765",
    "Skår": "NSR:StopPlace:41385",
    "Leknes": "NSR:StopPlace:58766",
    "Valderøya": "NSR:StopPlace:61752",
    "Store Kalvøy": "NSR:StopPlace:58525",
}


def service_journey_id(value):
    match = JOURNEY_RE.search(str(value or ""))
    return match.group(0) if match else ""


def clock_minutes(value):
    hours, minutes, *_rest = str(value).split(":")
    return int(hours) * 60 + int(minutes)


def signal_legs(routes, date_iso):
    found = []
    for line in (routes.get("lines") or {}).values():
        for leg in line.get("legs") or []:
            if not leg.get("signal"):
                continue
            if date_iso not in (leg.get("activeDates") or []):
                continue
            found.append(leg)
    return found


def observe_signal_trips(legs, now_minutes, cancelled_ids, seen_ids):
    observations = []
    for leg in legs:
        deadline = clock_minutes(leg["departure"]) - int(leg["signal"].get("minutesBefore") or 60)
        if now_minutes < deadline:
            continue
        journey = service_journey_id(leg.get("id"))
        if not journey:
            continue
        if journey in cancelled_ids:
            status = "skipped"
        elif journey in seen_ids:
            # Avlysinga dett ut etter ankomst. Då ser ein utinga ut som ein tinga tur.
            limit = leg.get("arrival") or leg.get("departure")
            if limit and now_minutes > clock_minutes(limit):
                continue
            status = "booked"
        else:
            continue
        observations.append(
            {
                "id": journey,
                "from": leg.get("from"),
                "to": leg.get("to"),
                "departure": leg.get("departure"),
                "status": status,
            }
        )
    return observations


def apply_observations(existing, observations, observed_at=None):
    by_id = {}
    for trip in existing or []:
        journey = service_journey_id(trip.get("id"))
        if journey:
            by_id[journey] = {**trip, "id": journey}
    for obs in observations:
        journey = service_journey_id(obs.get("id"))
        if not journey:
            continue
        prev = by_id.get(journey)
        status = obs["status"]
        if prev and prev.get("status") == "skipped":
            status = "skipped"
        elif prev and prev.get("status") == "booked" and status != "skipped":
            status = "booked"
        record = {**obs, "id": journey, "status": status}
        observed = (prev or {}).get("observedAt") or observed_at
        if observed:
            record["observedAt"] = observed
        if status == "skipped":
            skipped = (prev or {}).get("skippedAt") or observed_at
            if skipped:
                record["skippedAt"] = skipped
        by_id[journey] = record
    return sorted(by_id.values(), key=lambda trip: (trip.get("departure") or "", trip.get("from") or ""))


def prune_days(days, today, kept_days=KEPT_DAYS):
    oldest = (today - timedelta(days=kept_days - 1)).isoformat()
    return {iso: trips for iso, trips in (days or {}).items() if iso >= oldest}


def journey_ids_from_payload(payload):
    data = (payload or {}).get("data") or {}
    cancelled = set()
    seen = set()
    for place in data.values():
        if not isinstance(place, dict):
            continue
        for call in place.get("estimatedCalls") or []:
            journey = service_journey_id((call.get("serviceJourney") or {}).get("id"))
            if not journey:
                continue
            seen.add(journey)
            if call.get("cancellation"):
                cancelled.add(journey)
    return cancelled, seen


def cancellation_query(stop_ids):
    fields = []
    for index, stop_id in enumerate(stop_ids):
        fields.append(
            f's{index}: stopPlace(id: "{stop_id}") {{'
            " estimatedCalls(startTime: $start, timeRange: 86400, numberOfDepartures: 40,"
            " includeCancelledTrips: true,"
            ' whiteListed: { lines: ["MOR:Line:1136", "MOR:Line:1135"] })'
            " { cancellation serviceJourney { id } } }"
        )
    return "query Cancelled($start: DateTime!) { " + " ".join(fields) + " }"


def oslo_midnight_iso(moment):
    local = moment.astimezone(OSLO)
    start = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return start.isoformat()


def fetch_cancelled(moment, stop_ids):
    if not stop_ids:
        return set(), set()
    body = json.dumps(
        {
            "query": cancellation_query(stop_ids),
            "variables": {"start": oslo_midnight_iso(moment)},
        }
    ).encode()
    request = urllib.request.Request(
        ENTUR_URL,
        data=body,
        headers={
            "ET-Client-Name": ENTUR_CLIENT,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode())
    if payload.get("errors") and not payload.get("data"):
        raise RuntimeError("Entur")
    return journey_ids_from_payload(payload)


def update_log(existing, routes, moment, cancelled_ids, seen_ids=None, kept_days=KEPT_DAYS):
    local = moment.astimezone(OSLO)
    today = local.date()
    date_iso = today.isoformat()
    now_minutes = local.hour * 60 + local.minute
    legs = signal_legs(routes, date_iso)
    observations = observe_signal_trips(legs, now_minutes, cancelled_ids, seen_ids or set())
    days = dict((existing or {}).get("days") or {})
    days[date_iso] = apply_observations(
        days.get(date_iso) or [], observations, local.isoformat()
    )
    days = prune_days(days, today, kept_days)
    return {
        "keptDays": kept_days,
        "updatedAt": local.isoformat(),
        "days": days,
    }


def _as_utc(moment):
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


def log_check_expected(moment):
    utc = _as_utc(moment)
    minutes = utc.hour * 60 + utc.minute
    return SIGNAL_LOG_WATCH_START <= minutes <= SIGNAL_LOG_WATCH_END


def _parse_updated(previous):
    text = (previous or "").strip()
    if not text:
        return None
    try:
        updated = datetime.fromisoformat(text)
    except ValueError:
        return None
    if updated.tzinfo is None:
        updated = updated.replace(tzinfo=OSLO)
    return updated.astimezone(timezone.utc)


def log_age_minutes(previous, moment):
    """Minutt sidan siste hjarteslag, rekna frå 04:00 UTC om det er nyare."""
    updated = _parse_updated(previous)
    if updated is None:
        return None
    utc = _as_utc(moment)
    window_start = utc.replace(hour=4, minute=0, second=0, microsecond=0)
    baseline = max(updated, window_start)
    return (utc - baseline).total_seconds() / 60


def log_is_late(previous, moment=None):
    moment = moment or datetime.now(timezone.utc)
    if not log_check_expected(moment):
        return False
    age = log_age_minutes(previous, moment)
    if age is None:
        return True
    return age > SIGNAL_LOG_MAX_AGE.total_seconds() / 60


def require_recent(previous):
    if log_is_late(previous):
        print("Signalloggen er for gammal", file=sys.stderr)
        return 1
    return 0


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] == "--require-recent":
        previous = argv[1] if len(argv) > 1 else ""
        return require_recent(previous)
    routes = json.loads(ROUTES_PATH.read_text(encoding="utf-8"))
    existing = {}
    if LOG_PATH.exists():
        existing = json.loads(LOG_PATH.read_text(encoding="utf-8"))
    moment = datetime.now(OSLO)
    today = moment.date().isoformat()
    names = {leg.get("from") for leg in signal_legs(routes, today)}
    stop_ids = [STOPS[name] for name in names if name in STOPS]
    cancelled, seen = fetch_cancelled(moment, stop_ids)
    payload = update_log(existing, routes, moment, cancelled, seen)
    LOG_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
