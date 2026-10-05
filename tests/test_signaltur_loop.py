import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "signaltur_loop.py"
spec = importlib.util.spec_from_file_location("signaltur_loop", SCRIPT)
mod = importlib.util.module_from_spec(spec)
sys.modules["signaltur_loop"] = mod
assert spec.loader is not None
spec.loader.exec_module(mod)

UTC = timezone.utc


def at(*parts):
    return datetime(*parts, tzinfo=UTC)


def run_in(started, budget=None):
    state = {"now": started, "logs": [], "sleeps": [], "handoffs": 0, "errors": 0}

    def now_fn():
        return state["now"]

    def sleep_fn(seconds):
        state["sleeps"].append(seconds)
        state["now"] += timedelta(seconds=seconds)

    def log_fn():
        state["logs"].append(state["now"])
        if state.get("fail_first") and len(state["logs"]) == 1:
            raise SystemExit(1)

    def handoff_fn():
        state["handoffs"] += 1
        return True

    kwargs = dict(
        started=started,
        now_fn=now_fn,
        sleep_fn=sleep_fn,
        log_fn=log_fn,
        handoff_fn=handoff_fn,
    )
    if budget is not None:
        kwargs["budget"] = budget
    ok = mod.run_loop(**kwargs)
    state["ok"] = ok
    return state


def run_git(cwd, *args, check=True):
    proc = subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=False,
        text=True,
        capture_output=True,
    )
    if check and proc.returncode != 0:
        raise AssertionError((proc.stderr or proc.stdout or "").strip())
    return proc


def git_identity(cwd):
    run_git(cwd, "config", "user.email", "test@example.com")
    run_git(cwd, "config", "user.name", "Test")
    run_git(cwd, "config", "commit.gpgsign", "false")


def write_log(cwd, updated):
    path = Path(cwd) / "data" / "signalturar.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"updatedAt": updated}) + "\n", encoding="utf-8")


class PlanTests(unittest.TestCase):
    def test_vaktvindauget_er_0400_til_2240(self):
        def decision(moment):
            return mod.plan(moment, moment, None).action

        self.assertEqual(decision(at(2026, 10, 5, 3, 59)), "sleep")
        self.assertEqual(decision(at(2026, 10, 5, 4, 0)), "log")
        self.assertEqual(decision(at(2026, 10, 5, 22, 40)), "log")
        self.assertEqual(decision(at(2026, 10, 5, 22, 41)), "sleep")

    def test_søv_tretti_minutt_mellom_logging(self):
        started = at(2026, 10, 5, 8, 0)
        now = at(2026, 10, 5, 10, 0, 10)
        decision = mod.plan(now, started, at(2026, 10, 5, 10, 0, 0))
        self.assertEqual(decision.action, "sleep")
        self.assertAlmostEqual(decision.sleep_seconds, 30 * 60 - 10, places=0)

    def test_loggar_att_etter_tretti_minutt(self):
        started = at(2026, 10, 5, 8, 0)
        now = at(2026, 10, 5, 10, 30)
        self.assertEqual(mod.plan(now, started, at(2026, 10, 5, 10, 0)).action, "log")

    def test_vidarefører_når_neste_logg_er_etter_taket(self):
        started = at(2026, 10, 5, 4, 0)
        now = at(2026, 10, 5, 9, 0, 5)
        decision = mod.plan(now, started, at(2026, 10, 5, 9, 0, 0))
        self.assertEqual(decision.action, "handoff")

    def test_loggar_sjølv_nær_taket(self):
        started = at(2026, 10, 5, 4, 0)
        self.assertEqual(mod.plan(at(2026, 10, 5, 9, 29), started, None).action, "log")

    def test_taket_er_vidareførings(self):
        started = at(2026, 10, 5, 4, 0)
        now = started + mod.LOOP_BUDGET
        self.assertEqual(mod.plan(now, started, None).action, "handoff")

    def test_natt_søv_til_0400_om_budsjettet_rekk(self):
        started = at(2026, 10, 5, 23, 0)
        decision = mod.plan(started, started, None)
        self.assertEqual(decision.action, "sleep")
        self.assertEqual(decision.sleep_seconds, 5 * 3600)

    def test_natt_utan_tid_til_morgon_søv_til_taket(self):
        started = at(2026, 10, 5, 20, 0)
        now = at(2026, 10, 5, 22, 50)
        decision = mod.plan(now, started, at(2026, 10, 5, 22, 30))
        self.assertEqual(decision.action, "sleep")
        self.assertEqual(int(decision.sleep_seconds), 2 * 3600 + 40 * 60)

    def test_rett_etter_vindauget_søv_til_morgon(self):
        started = at(2026, 10, 5, 22, 41)
        decision = mod.plan(started, started, None)
        self.assertEqual(decision.action, "sleep")
        self.assertEqual(int(decision.sleep_seconds), 5 * 3600 + 19 * 60)


class LoopTests(unittest.TestCase):
    def test_dag_loggar_kvart_halvtime_og_vidarefører(self):
        state = run_in(at(2026, 10, 5, 4, 0))
        self.assertTrue(state["ok"])
        self.assertEqual(state["handoffs"], 1)
        self.assertEqual(state["logs"][0], at(2026, 10, 5, 4, 0))
        self.assertEqual(state["logs"][-1], at(2026, 10, 5, 9, 0))
        self.assertEqual(len(state["logs"]), 11)
        gaps = [
            state["logs"][i + 1] - state["logs"][i] for i in range(len(state["logs"]) - 1)
        ]
        self.assertTrue(all(gap == timedelta(minutes=30) for gap in gaps))

    def test_sein_loggesteg_stoppar_ikkje_loekka(self):
        started = at(2026, 10, 5, 4, 0)
        state = {"now": started, "logs": 0}

        def log_fn():
            state["logs"] += 1
            if state["logs"] == 1:
                raise SystemExit(1)

        ok = mod.run_loop(
            started=started,
            now_fn=lambda: state["now"],
            sleep_fn=lambda seconds: state.__setitem__(
                "now", state["now"] + timedelta(seconds=seconds)
            ),
            log_fn=log_fn,
            handoff_fn=lambda: True,
        )
        self.assertTrue(ok)
        self.assertGreater(state["logs"], 1)

    def test_kveld_søv_til_taket_før_vidareførings(self):
        state = run_in(at(2026, 10, 5, 20, 0))
        self.assertEqual(
            state["logs"],
            [
                at(2026, 10, 5, 20, 0),
                at(2026, 10, 5, 20, 30),
                at(2026, 10, 5, 21, 0),
                at(2026, 10, 5, 21, 30),
                at(2026, 10, 5, 22, 0),
                at(2026, 10, 5, 22, 30),
            ],
        )
        self.assertEqual(state["now"], at(2026, 10, 6, 1, 30))
        self.assertEqual(state["handoffs"], 1)

    def test_nattstart_søv_til_0400_og_loggar(self):
        state = run_in(at(2026, 10, 5, 23, 0))
        self.assertEqual(state["logs"], [at(2026, 10, 6, 4, 0)])
        self.assertEqual(state["handoffs"], 1)
        self.assertEqual(state["now"], at(2026, 10, 6, 4, 0))


def active(age, now, database_id=2, branch="main", status="in_progress", started=True):
    moment = now - age
    payload = {
        "databaseId": database_id,
        "status": status,
        "headBranch": branch,
        "event": "workflow_dispatch",
    }
    if started:
        payload["startedAt"] = moment.isoformat()
    else:
        payload["createdAt"] = moment.isoformat()
    return payload


class GateTests(unittest.TestCase):
    def setUp(self):
        self.now = at(2026, 10, 5, 12, 0)

    def test_cron_vik_for_levande_loekke(self):
        runs = [active(timedelta(hours=2), self.now)]
        self.assertTrue(
            mod.should_exit_as_duplicate("schedule", False, runs, self.now, self_id=1)
        )

    def test_cron_vik_for_forelder_som_er_i_ferd_med_å_vidareføre(self):
        runs = [active(timedelta(hours=5, minutes=30), self.now)]
        self.assertTrue(
            mod.should_exit_as_duplicate("schedule", False, runs, self.now, self_id=1)
        )

    def test_cron_held_fram_om_resten_er_eldre_enn_jobbtaket(self):
        runs = [active(timedelta(hours=6, minutes=30), self.now)]
        self.assertFalse(
            mod.should_exit_as_duplicate("schedule", False, runs, self.now, self_id=1)
        )

    def test_vidareførings_held_fram_sjølv_om_forelderen_står(self):
        runs = [active(timedelta(hours=5, minutes=30), self.now)]
        self.assertFalse(
            mod.should_exit_as_duplicate("workflow_dispatch", True, runs, self.now, self_id=9)
        )

    def test_vidareførings_vik_for_ei_ung_loekke(self):
        runs = [active(timedelta(hours=1), self.now)]
        self.assertTrue(
            mod.should_exit_as_duplicate("workflow_dispatch", True, runs, self.now, self_id=9)
        )

    def test_manuell_start_vik_om_ei_loekke_går(self):
        runs = [active(timedelta(minutes=20), self.now)]
        self.assertTrue(
            mod.should_exit_as_duplicate("workflow_dispatch", False, runs, self.now, self_id=3)
        )

    def test_manuell_start_held_fram_om_resten_er_daud(self):
        runs = [active(timedelta(hours=7), self.now, started=False)]
        self.assertFalse(
            mod.should_exit_as_duplicate("workflow_dispatch", False, runs, self.now, self_id=3)
        )

    def test_eige_køyrd_blokkerer_ikkje(self):
        runs = [active(timedelta(minutes=5), self.now, database_id=5)]
        self.assertFalse(
            mod.should_exit_as_duplicate("schedule", False, runs, self.now, self_id="5")
        )

    def test_uleseleg_tid_blokkerer_ikkje(self):
        runs = [
            {
                "databaseId": 2,
                "status": "in_progress",
                "headBranch": "main",
                "startedAt": "ikkje-ei-tid",
            }
        ]
        self.assertFalse(
            mod.should_exit_as_duplicate("schedule", False, runs, self.now, self_id=1)
        )

    def test_oppslag_som_feilar_held_fram(self):
        def fetch():
            raise RuntimeError("gh nede")

        decision, error = mod.gate_decision("schedule", False, "1", fetch, self.now)
        self.assertEqual(decision, "continue")
        self.assertIsInstance(error, RuntimeError)

    def test_anna_grein_blokkerer_ikkje(self):
        runs = [active(timedelta(minutes=10), self.now, branch="dev")]
        self.assertFalse(
            mod.should_exit_as_duplicate("schedule", False, runs, self.now, self_id=1)
        )


class PublishTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.origin = root / "origin"
        self.worker = root / "worker"
        self.other = root / "other"
        self.origin.mkdir()
        run_git(self.origin, "init", "-b", "main")
        git_identity(self.origin)
        run_git(self.origin, "config", "receive.denyCurrentBranch", "ignore")
        write_log(self.origin, "2026-10-05T09:50:00Z")
        run_git(self.origin, "add", "data/signalturar.json")
        run_git(self.origin, "commit", "-m", "init")
        run_git(root, "clone", str(self.origin), "worker")
        run_git(root, "clone", str(self.origin), "other")
        git_identity(self.worker)
        git_identity(self.other)
        run_git(self.worker, "checkout", "--detach")

    def published(self):
        proc = run_git(self.origin, "show", "main:data/signalturar.json")
        return json.loads(proc.stdout)

    def test_push_landar_på_main(self):
        def run_logger():
            write_log(self.worker, "2026-10-05T10:00:00Z")
            return None

        result, late = mod.publish_log(
            self.worker,
            run_logger,
            now=at(2026, 10, 5, 10, 0),
            sleep_fn=lambda _seconds: None,
        )
        self.assertEqual(result, "pushed")
        self.assertFalse(late)
        self.assertEqual(self.published()["updatedAt"], "2026-10-05T10:00:00Z")

    def test_sein_logg_blir_likevel_pusha(self):
        def run_logger():
            write_log(self.worker, "2026-10-05T12:00:00Z")
            return None

        result, late = mod.publish_log(
            self.worker,
            run_logger,
            now=at(2026, 10, 5, 12, 0),
            sleep_fn=lambda _seconds: None,
        )
        self.assertEqual(result, "pushed")
        self.assertTrue(late)
        self.assertEqual(self.published()["updatedAt"], "2026-10-05T12:00:00Z")

    def test_rebase_når_main_har_flytta_seg(self):
        calls = {"n": 0}

        def run_logger():
            calls["n"] += 1
            write_log(self.worker, "2026-10-05T10:30:00Z")
            if calls["n"] == 1:
                note = self.other / "data" / "merknad.txt"
                note.write_text("frå den andre jobben\n", encoding="utf-8")
                run_git(self.other, "add", "data/merknad.txt")
                run_git(self.other, "commit", "-m", "anna fil")
                run_git(self.other, "push", "origin", "HEAD:main")
            return None

        result, _late = mod.publish_log(
            self.worker,
            run_logger,
            now=at(2026, 10, 5, 10, 30),
            sleep_fn=lambda _seconds: None,
        )
        self.assertEqual(result, "pushed")
        self.assertEqual(self.published()["updatedAt"], "2026-10-05T10:30:00Z")
        note_on_main = run_git(self.origin, "show", "main:data/merknad.txt")
        self.assertIn("andre jobben", note_on_main.stdout)

    def test_kollisjon_blir_skriven_om(self):
        calls = {"n": 0}

        def run_logger():
            calls["n"] += 1
            write_log(self.worker, f"v{calls['n']}")
            if calls["n"] == 1:
                write_log(self.other, "frå den andre løkka")
                run_git(self.other, "add", "data/signalturar.json")
                run_git(self.other, "commit", "-m", "konkurrent")
                run_git(self.other, "push", "origin", "HEAD:main")
            return None

        result, _late = mod.publish_log(
            self.worker,
            run_logger,
            now=at(2026, 10, 5, 11, 0),
            sleep_fn=lambda _seconds: None,
        )
        self.assertEqual(result, "pushed")
        self.assertGreaterEqual(calls["n"], 2)
        self.assertEqual(self.published()["updatedAt"], "v2")
        self.assertNotIn("<<<", run_git(self.origin, "show", "main:data/signalturar.json").stdout)

    def test_logger_som_feilar_commit_ikkje(self):
        class Failed:
            returncode = 1

        def run_logger():
            write_log(self.worker, "skal ikkje inn")
            return Failed()

        before = run_git(self.origin, "rev-parse", "main").stdout.strip()
        result, _late = mod.publish_log(
            self.worker,
            run_logger,
            now=at(2026, 10, 5, 10, 0),
            sleep_fn=lambda _seconds: None,
        )
        self.assertEqual(result, "logger-failed")
        after = run_git(self.origin, "rev-parse", "main").stdout.strip()
        self.assertEqual(before, after)


class WorkflowContractTests(unittest.TestCase):
    def test_workflow_held_cron_og_kan_starte_seg_sjølv(self):
        text = (ROOT / ".github" / "workflows" / "log-signalturar.yml").read_text(encoding="utf-8")
        script = SCRIPT.read_text(encoding="utf-8")
        self.assertIn('cron: "*/30 4-21 * * *"', text)
        self.assertIn("workflow_dispatch:", text)
        self.assertIn("actions: write", text)
        self.assertIn("contents: write", text)
        self.assertIn("timeout-minutes: 360", text)
        self.assertIn("github.token", text)
        self.assertIn("scripts/signaltur_loop.py", text)
        self.assertNotIn("--require-recent", text)
        self.assertIn("refs/heads/main", text)
        self.assertIn('"workflow"', script)
        self.assertIn('"run"', script)
        self.assertIn("handoff=true", script)
        self.assertIn("HEAD:main", script)


if __name__ == "__main__":
    unittest.main()
