#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "fetch_trafikkmeldinger.py"

spec = importlib.util.spec_from_file_location("fetch_trafikkmeldinger", SCRIPT)
mod = importlib.util.module_from_spec(spec)
sys.modules["fetch_trafikkmeldinger"] = mod
assert spec.loader is not None
spec.loader.exec_module(mod)


class ClassifyTests(unittest.TestCase):
    def test_normal_overrides_false_innstilt(self):
        text = (
            "Rute 1136 Standal-Trandal-Valderøya-Store Kalvøy: Pga ein feil i "
            "rutesøket på sambandet i dag vise at det er innstilt, men det er "
            "normal drift."
        )
        self.assertEqual(mod.classify(text), "normal")

    def test_cancelled(self):
        text = (
            "Rute 1038 Stårheim - Isane: Grunna driftsproblem vert følgjande "
            "avgangar innstilt: 0600 fra Stårheim"
        )
        self.assertEqual(mod.classify(text), "cancelled")

    def test_delay(self):
        text = "Det er normal drift, men en på påregne noe forsinkelser fram til 0820"
        self.assertEqual(mod.classify(text), "delay")
        self.assertEqual(
            mod.classify("må påregnes forsinkelser på fergesambandet"),
            "delay",
        )

    def test_capacity(self):
        text = "Grunna transport av farlig last vert det redusert kapasistet (maks 12 passasjerar)"
        self.assertEqual(mod.classify(text), "capacity")

    def test_empty_is_info(self):
        self.assertEqual(mod.classify(""), "info")


class RouteDetectionTests(unittest.TestCase):
    def test_connection_number(self):
        self.assertTrue(mod.is_route_1136("Anna rute", "noko", 132))

    def test_route_code_in_text(self):
        self.assertTrue(
            mod.is_route_1136(
                "Standal-Trandal-Valderøya-Store Kalvøy",
                "Rute 1136 Standal-Trandal",
                999,
            )
        )

    def test_unrelated_route(self):
        self.assertFalse(
            mod.is_route_1136("Eidsdal-Linge", "Rute 1054 Eidsdal - Linge", 251)
        )


class LocalAreaTests(unittest.TestCase):
    def test_route_1136_is_local(self):
        self.assertTrue(
            mod.is_local("Standal-Trandal", "Rute 1136 Standal-Trandal", 132)
        )

    def test_saebo_leknes_is_local(self):
        self.assertTrue(mod.is_local("Sæbø - Leknes", "Rute 1135 Sæbø - Leknes", 900))

    def test_festoy_hundeidvika_is_local(self):
        self.assertTrue(
            mod.is_local("Festøya - Hundeidvika", "Rute 1049 Festøya - Hundeidvika", 901)
        )

    def test_far_away_routes_are_not_local(self):
        for heading, text, conn in [
            ("Eidsdal-Linge", "Rute 1054 Eidsdal - Linge: normal drift", 251),
            ("Drag - Kjøpsvik", "Rute 1071 Drag - Kjøpsvik", 700),
            ("Jondal - Tørvikbygd", "Rute 1026 Jondal - Tørvikbygd", 1143),
            ("Hareid-Sulesund", "Rute 1010 Hareid - Sulesund", 500),
        ]:
            self.assertFalse(mod.is_local(heading, text, conn), heading)

    def test_local_flag_on_normalized_message(self):
        node = {
            "id": "1",
            "heading": "Festøya - Hundeidvika",
            "countyNumber": 15,
            "connectionNumber": 901,
            "date": "25.08.2026 08:00:00",
            "content": "Rute 1049 Festøya - Hundeidvika: normal drift.",
            "importantMessage": False,
            "validFrom": {"timestamp": 1787568366},
            "validTo": {"timestamp": 1787654704},
        }
        msg = mod.normalize_node(node)
        self.assertTrue(msg["isLocal"])
        self.assertFalse(msg["isRoute1136"])


class ParseTests(unittest.TestCase):
    def test_parse_published_oslo(self):
        iso = mod.parse_published("24.08.2026 12:46:06", None)
        self.assertTrue(iso.startswith("2026-08-24T12:46:06+02:00") or iso.startswith("2026-08-24T12:46:06+01:00"))

    def test_normalize_node(self):
        node = {
            "id": "abc",
            "heading": "Standal-Trandal-Valderøya-Store Kalvøy",
            "countyNumber": 15,
            "connectionNumber": 132,
            "date": "24.08.2026 12:46:06",
            "content": "Rute 1136: Fortsatt normal drift i sambandet.",
            "importantMessage": False,
            "validFrom": {"timestamp": 1787568366},
            "validTo": {"timestamp": 1787654704},
        }
        msg = mod.normalize_node(node)
        self.assertEqual(msg["severity"], "normal")
        self.assertTrue(msg["isRoute1136"])
        self.assertEqual(msg["heading"], node["heading"])


class FetchTests(unittest.TestCase):
    def test_fetch_writes_json(self):
        graphql = {
            "data": {
                "content": {
                    "trafficMessages": {
                        "edges": [
                            {
                                "node": {
                                    "id": "1",
                                    "heading": "Standal-Trandal-Valderøya-Store Kalvøy",
                                    "countyNumber": 15,
                                    "connectionNumber": 132,
                                    "date": "24.08.2026 12:46:06",
                                    "content": "Rute 1136: normal drift.",
                                    "importantMessage": False,
                                    "validFrom": {"timestamp": 1787568366},
                                    "validTo": {"timestamp": 1787654704},
                                }
                            }
                        ]
                    }
                }
            }
        }

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return json.dumps(graphql).encode("utf-8")

        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "trafikkmeldinger.json"
            with patch.object(mod.urllib.request, "urlopen", return_value=FakeResponse()):
                with patch.object(sys, "argv", ["fetch_trafikkmeldinger.py", str(out)]):
                    self.assertEqual(mod.main(), 0)
            data = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(len(data["messages"]), 1)
            self.assertTrue(data["messages"][0]["isRoute1136"])
            self.assertIn("fjord1.no", data["source"])


if __name__ == "__main__":
    unittest.main()
