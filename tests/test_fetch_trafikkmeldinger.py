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
        self.assertEqual(msg["routeMode"], "1136")


class RouteModeTests(unittest.TestCase):
    SMS = (
        "Grunna driftsproblem så er ferjerutene 1135 og 1136 innstilt, det blir "
        "utført kombinasjonsrute med MF Kvernes. Første avgang frå Sæbø ca. 08:15. "
        "Sjå rutetabell på frammr.no."
    )

    def test_sms_example_is_kombi(self):
        self.assertEqual(mod.route_mode_from_text(self.SMS), "kombi")
        self.assertIsNone(mod.switch_from_text(self.SMS))

    def test_switch_from_clock_and_quay(self):
        text = "Kombirute vert utført frå klokka 08:15."
        self.assertEqual(
            mod.switch_from_text(text),
            {"time": "08:15:00", "quay": None, "before": "1136", "after": "kombi"},
        )
        node = {
            "id": "1",
            "heading": "Standal-Trandal",
            "content": text,
            "connectionNumber": 132,
            "date": "29.08.2026 12:00:00",
            "validFrom": {"timestamp": 1788000000},
            "validTo": {"timestamp": 1788086400},
        }
        self.assertEqual(mod.normalize_node(node)["routeSwitch"]["time"], "08:15:00")

    def test_normal_drift_overrides_false_innstilt(self):
        text = (
            "Rute 1136 Standal-Trandal: Pga ein feil i rutesøket vise at det er "
            "innstilt, men det er normal drift."
        )
        self.assertEqual(mod.classify(text), "normal")
        self.assertEqual(mod.route_mode_from_text(text), "1136")

    def test_only_1136_cancelled_uses_1135(self):
        text = "Rute 1136 Standal-Trandal er innstilt inntil vidare."
        self.assertEqual(mod.route_mode_from_text(text), "1135")

    def test_both_lines_cancelled_without_kombi_word_is_kombi(self):
        text = "1135 og 1136 innstilt på grunn av driftsproblem."
        self.assertEqual(mod.route_mode_from_text(text), "kombi")

    def test_vessel_from_utfort_av(self):
        self.assertEqual(
            mod.vessel_from_text("kombinasjonsrute. Ruta blir utført av MF Geiranger."),
            "Geiranger",
        )
        self.assertEqual(
            mod.vessel_from_text("kombinasjonsrute. Ruta blir utført av M/F Kvernes."),
            "Kvernes",
        )

    def test_vessel_ignores_both_names_without_utfort(self):
        self.assertIsNone(
            mod.vessel_from_text("M/F Geiranger og M/F Kvernes kan brukast.")
        )

    def test_date_range_is_read(self):
        text = (
            "Grunna verkstadopphald vert det køyrt kombinert rute frå 14.06 til 18.06. "
            "Det blir MF Kvernes i rute."
        )
        self.assertEqual(
            mod.window_from_text(text, "2026-06-12T10:00:00+02:00"),
            {"from": "2026-06-14", "to": "2026-06-18"},
        )
        self.assertEqual(mod.route_mode_from_text(text), "kombi")
        self.assertIsNone(mod.switch_from_text(text))

    def test_rutestart_date_is_read(self):
        text = "Det vert normal drift i sambandet frå rutestart fredag 05.06."
        self.assertEqual(
            mod.window_from_text(text, "2026-06-04T22:40:00+02:00"),
            {"from": "2026-06-05", "to": None},
        )

    def test_1049_is_local_but_not_route_control(self):
        heading = "Hundeidvika – Festøya"
        text = (
            "Rute 1049 Hundeidvika – Festøya: Grunna arbeid på kai vert sambandet "
            "innstilt frå kl. 10:30 til 13:25."
        )
        self.assertTrue(mod.is_local(heading, text, 901))
        self.assertTrue(mod.is_1049_only(heading, text))
        self.assertFalse(mod.is_route_control(heading, text, True))
        self.assertIsNone(mod.switch_from_text(f"{heading} {text}"))

    def test_normal_clock_is_activation_not_switch(self):
        text = "Det vert normal drift i sambandet frå kl. 21:00."
        self.assertEqual(mod.activate_at_from_text(text), "21:00:00")
        self.assertIsNone(mod.switch_from_text(text))
        self.assertIsNone(mod.window_from_text(text, "2026-04-07T12:00:00+02:00"))

    def test_single_cancelled_sailing_does_not_switch(self):
        text = (
            "Rute 1136: Grunna arbeid på Skår blir avgang kl. 14:25 frå Trandal "
            "kansellert. Normal drift frå kl. 14:50."
        )
        self.assertEqual(mod.route_mode_from_text(text), "1136")
        self.assertIsNone(mod.switch_from_text(text))
        self.assertEqual(mod.activate_at_from_text(text), "14:50:00")


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

    def test_write_skipped_when_messages_unchanged(self):
        messages = [
            {
                "id": "1",
                "heading": "Standal-Trandal",
                "text": "normal drift",
                "isLocal": True,
            }
        ]
        first = mod.build_payload(messages, fetched_at="2026-09-03T00:00:00+00:00")
        second = mod.build_payload(messages, fetched_at="2026-09-03T00:05:00+00:00")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "trafikkmeldinger.json"
            self.assertTrue(mod.write_if_changed(first, path))
            self.assertFalse(mod.write_if_changed(second, path))
            stored = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(stored["fetchedAt"], "2026-09-03T00:00:00+00:00")


if __name__ == "__main__":
    unittest.main()
