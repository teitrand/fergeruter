#!/usr/bin/env python3
"""Hent trafikkmeldingar frå Fjord1 GraphQL og lagre som JSON."""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

GRAPHQL_URL = "https://www.fjord1.no/graphql"
SOURCE_URL = "https://www.fjord1.no/trafikkmeldingar"
OSLO = ZoneInfo("Europe/Oslo")
ROUTE_RE = re.compile(r"\b1136\b|trandal|standal|valderøy|store kalvøy|sæbø|skår", re.I)
# Hjørundfjorden (1136 Standal-Trandal-Sæbø-Skår, 1135 Sæbø-Leknes) pluss
# 1049 Festøya-Hundeidvika, som er vegen ut av fjorden.
LOCAL_ROUTE_RE = re.compile(r"\b(1136|1135|1049)\b", re.I)
LOCAL_PLACE_RE = re.compile(
    r"trandal|standal|sæbø|skår|store kalvøy|valderøy|bjørke|urke|festøy|hundeidvik",
    re.I,
)
NORMAL_RE = re.compile(r"normal drift", re.I)
CANCEL_RE = re.compile(r"innstilt|innstilling", re.I)
DELAY_RE = re.compile(r"forsink", re.I)
CAPACITY_RE = re.compile(r"kapasitet|kapasistet|farleg last|farlig last", re.I)

QUERY = """
{
  content {
    trafficMessages(first: 50, sortBy: [_datePublished, _desc]) {
      pageInfo { hasNextPage }
      edges {
        node {
          id
          heading
          countyNumber
          connectionNumber
          date
          content
          importantMessage
          validFrom { timestamp }
          validTo { timestamp }
        }
      }
    }
  }
}
"""

# Fjord1 sitt interne sambandsnummer for rute 1136.
ROUTE_1136_CONNECTION = 132


def classify(text: str) -> str:
    """Klassifiser meldingstekst: normal, cancelled, delay, capacity eller info."""
    if not text:
        return "info"
    has_normal = bool(NORMAL_RE.search(text))
    has_cancel = bool(CANCEL_RE.search(text))
    has_delay = bool(DELAY_RE.search(text))
    has_capacity = bool(CAPACITY_RE.search(text))
    if has_cancel and has_normal:
        return "delay" if has_delay else "normal"
    if has_cancel:
        return "cancelled"
    if has_delay:
        return "delay"
    if has_normal:
        return "normal"
    if has_capacity:
        return "capacity"
    return "info"


def is_route_1136(heading: str, text: str, connection_number: int | None) -> bool:
    if connection_number == ROUTE_1136_CONNECTION:
        return True
    blob = f"{heading or ''} {text or ''}"
    return bool(ROUTE_RE.search(blob))


def is_local(heading: str, text: str, connection_number: int | None) -> bool:
    """Meldingar frå Hjørundfjorden og Festøya-Hundeidvika."""
    if is_route_1136(heading, text, connection_number):
        return True
    blob = f"{heading or ''} {text or ''}"
    return bool(LOCAL_ROUTE_RE.search(blob) or LOCAL_PLACE_RE.search(blob))


def parse_published(date_str: str, fallback_ts: int | None) -> str | None:
    if date_str:
        try:
            local = datetime.strptime(date_str.strip(), "%d.%m.%Y %H:%M:%S").replace(
                tzinfo=OSLO
            )
            return local.isoformat()
        except ValueError:
            try:
                local = datetime.strptime(date_str.strip(), "%d.%m.%Y %H:%M").replace(
                    tzinfo=OSLO
                )
                return local.isoformat()
            except ValueError:
                pass
    if fallback_ts:
        return datetime.fromtimestamp(fallback_ts, tz=timezone.utc).isoformat()
    return None


def iso_from_ts(ts: int | None) -> str | None:
    if not ts:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def normalize_node(node: dict) -> dict:
    heading = (node.get("heading") or "").strip()
    text = (node.get("content") or "").strip()
    connection = node.get("connectionNumber")
    valid_from_ts = (node.get("validFrom") or {}).get("timestamp")
    valid_to_ts = (node.get("validTo") or {}).get("timestamp")
    return {
        "id": node.get("id"),
        "heading": heading,
        "text": text,
        "publishedAt": parse_published(node.get("date") or "", valid_from_ts),
        "validFrom": iso_from_ts(valid_from_ts),
        "validTo": iso_from_ts(valid_to_ts),
        "countyNumber": node.get("countyNumber"),
        "connectionNumber": connection,
        "important": bool(node.get("importantMessage")),
        "severity": classify(text),
        "isRoute1136": is_route_1136(heading, text, connection),
        "isLocal": is_local(heading, text, connection),
    }


def fetch_messages(timeout: int = 30) -> list[dict]:
    payload = json.dumps({"query": QUERY}).encode("utf-8")
    req = urllib.request.Request(
        GRAPHQL_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Fergeruter/1.0 (+https://github.com/teitrand/fergeruter)",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        body = json.loads(response.read().decode("utf-8"))
    if body.get("errors"):
        raise RuntimeError(f"Fjord1 GraphQL-feil: {body['errors']}")
    edges = (
        body.get("data", {})
        .get("content", {})
        .get("trafficMessages", {})
        .get("edges")
        or []
    )
    return [normalize_node(edge["node"]) for edge in edges if edge.get("node")]


def build_payload(messages: list[dict]) -> dict:
    return {
        "source": SOURCE_URL,
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "messages": messages,
    }


def default_output_path() -> Path:
    return Path(__file__).resolve().parents[1] / "data" / "trafikkmeldinger.json"


def main() -> int:
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else default_output_path()
    try:
        messages = fetch_messages()
    except (urllib.error.URLError, TimeoutError, RuntimeError, json.JSONDecodeError) as exc:
        print(f"Kunne ikkje hente trafikkmeldingar: {exc}", file=sys.stderr)
        return 1
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = build_payload(messages)
    output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Skreiv {len(messages)} meldingar til {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
