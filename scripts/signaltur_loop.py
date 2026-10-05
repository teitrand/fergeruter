#!/usr/bin/env python3
"""Hald signaltur-loggen i live utan å stole på at GitHub startar cron i tide.

Éi køyring loggar minst kvart 30. minutt mellom 04:00 og 22:40 UTC, søv
mellom rundane, og varer opptil 5 timar og 30 minutt. Før ho sluttar, startar
ho seg sjølv på nytt med `workflow_dispatch`. Cron på :07 og :37 er vakt:
ho startar løkka på nytt om ingen køyring er aktiv.
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

LOG_INTERVAL = timedelta(minutes=30)
LOOP_BUDGET = timedelta(hours=5, minutes=30)
# GitHub drep jobben etter 6 timar. Eldre køyringar er ein daud rest.
JOB_LIMIT = timedelta(hours=6)
# Vakta skal ikkje starte ei ny løkke medan ei anna ventar på løpar.
ACTIVE_STATUSES = {"in_progress", "queued", "waiting", "pending", "requested"}
# Løkka vidarefører seg ved LOOP_BUDGET. Ein forelder er då eldre enn dette,
# så barnet ikkje går av fordi forelderen enno står som in_progress.
HANDOFF_AGE = timedelta(hours=5)
LOG_REL = Path("data/signalturar.json")
ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_FILE = "log-signalturar.yml"
COMMIT_MESSAGE = "data: logg signalturar"

_LOGGER = None


def say(message):
    print(message, flush=True)


def logger():
    global _LOGGER
    if _LOGGER is None:
        path = Path(__file__).with_name("log_signalturar.py")
        spec = importlib.util.spec_from_file_location("log_signalturar_loopimpl", path)
        mod = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(mod)
        _LOGGER = mod
    return _LOGGER


def as_utc(moment):
    if moment.tzinfo is None:
        return moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


def in_window(moment):
    return logger().log_check_expected(moment)


def next_window_start(moment):
    utc = as_utc(moment)
    hour, minute = divmod(logger().SIGNAL_LOG_WATCH_START, 60)
    start = utc.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if utc < start:
        return start
    return start + timedelta(days=1)


class Plan:
    def __init__(self, action, sleep_seconds=0):
        self.action = action
        self.sleep_seconds = sleep_seconds

    def __repr__(self):
        return f"Plan({self.action!r}, {self.sleep_seconds!r})"


def plan(now, started, last_log, budget=LOOP_BUDGET):
    """Neste steg: logg, søv, eller start neste køyrd."""
    now = as_utc(now)
    started = as_utc(started)
    deadline = started + budget
    if now >= deadline:
        return Plan("handoff")

    if in_window(now):
        due = last_log is None or now - as_utc(last_log) >= LOG_INTERVAL
        if due:
            return Plan("log")
        wake = as_utc(last_log) + LOG_INTERVAL
        if wake >= deadline:
            return Plan("handoff")
        return Plan("sleep", (wake - now).total_seconds())

    nxt = next_window_start(now)
    if nxt <= deadline:
        return Plan("sleep", (nxt - now).total_seconds())
    remaining = (deadline - now).total_seconds()
    if remaining <= 1:
        return Plan("handoff")
    return Plan("sleep", remaining)


def parse_time(value):
    if not value or not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def run_age(run, now):
    if run.get("status") == "in_progress":
        started = parse_time(run.get("startedAt")) or parse_time(run.get("createdAt"))
    else:
        started = parse_time(run.get("createdAt")) or parse_time(run.get("startedAt"))
    if started is None:
        return None
    return as_utc(now) - started


def should_exit_as_duplicate(event, handoff, runs, now, self_id):
    """True berre når ei verkeleg løkke alt går eller ventar på løpar.

    Cron-vakta skal vike, og dermed ikkje starte ei dobbel løkke. Vidareførings-
    køyret skal ikkje vike for forelderen, som enno er in_progress dei siste
    minutta. Køyringar eldre enn jobbtaket, ferdige køyringar, og svar vi ikkje
    kan lese, blokkerer ikkje. Då kan vakta starte løkka på nytt.
    """
    self_id = str(self_id or "")
    if event == "schedule":
        limit = JOB_LIMIT
    elif handoff:
        limit = HANDOFF_AGE
    else:
        limit = JOB_LIMIT
    for run in runs or []:
        if str(run.get("databaseId", "")) == self_id and self_id:
            continue
        branch = run.get("headBranch")
        if branch not in (None, "", "main"):
            continue
        if run.get("status") not in ACTIVE_STATUSES:
            continue
        age = run_age(run, now)
        if age is None:
            continue
        if age < limit:
            return True
    return False


def gate_decision(event, handoff, self_id, fetch, now):
    try:
        runs = fetch()
    except Exception as exc:
        return "continue", exc
    if should_exit_as_duplicate(event, handoff, runs, now, self_id):
        return "exit", None
    return "continue", None


def env_flag(name):
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes"}


def git(cwd, *args, check=True):
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    env.setdefault("GIT_AUTHOR_NAME", "github-actions[bot]")
    env.setdefault("GIT_AUTHOR_EMAIL", "41898282+github-actions[bot]@users.noreply.github.com")
    env.setdefault("GIT_COMMITTER_NAME", env["GIT_AUTHOR_NAME"])
    env.setdefault("GIT_COMMITTER_EMAIL", env["GIT_AUTHOR_EMAIL"])
    proc = subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=False,
        text=True,
        capture_output=True,
        env=env,
    )
    if check and proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(detail or f"git {args[0]} feila")
    return proc


def ensure_identity(cwd):
    git(cwd, "config", "user.name", "github-actions[bot]")
    git(cwd, "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com")
    git(cwd, "config", "commit.gpgsign", "false")


def prepare_worktree(cwd):
    fetched = git(cwd, "fetch", "origin", "main", check=False)
    if fetched.returncode != 0:
        detail = (fetched.stderr or fetched.stdout or "").strip()
        raise RuntimeError(detail or "git fetch feila")
    git(cwd, "reset", "--hard", "origin/main")


def read_updated_at(cwd):
    path = Path(cwd) / LOG_REL
    if not path.exists():
        return ""
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ""
    return payload.get("updatedAt") or ""


def stage_and_commit(cwd):
    git(cwd, "add", "--", str(LOG_REL))
    staged = git(cwd, "diff", "--staged", "--quiet", check=False)
    if staged.returncode == 0:
        say("Ingen endringar")
        return False
    if staged.returncode != 1:
        detail = (staged.stderr or staged.stdout or "").strip()
        raise RuntimeError(detail or "git diff feila")
    git(cwd, "commit", "-m", COMMIT_MESSAGE)
    return True


def publish_log(cwd, run_logger, attempts=5, sleep_fn=None, now=None):
    """Hent main, logg, commit og push. Rebase ved kappløp, skriv om ved kollisjon.

    Ein sein `updatedAt` blir varsla og logginga held fram.
    """
    if sleep_fn is None:
        sleep_fn = time.sleep
    ensure_identity(cwd)
    prepare_worktree(cwd)
    moment = as_utc(now or datetime.now(timezone.utc))
    late = logger().log_is_late(read_updated_at(cwd), moment)
    if late:
        say("::warning title=Signallogg::Signalloggen var for gammal. Logginga held fram.")
    proc = run_logger()
    if proc is not None and getattr(proc, "returncode", 0) != 0:
        say("Logger feila. Prøver att neste runde.")
        return "logger-failed", late
    if not stage_and_commit(cwd):
        return "unchanged", late
    for attempt in range(1, attempts + 1):
        push = git(cwd, "push", "origin", "HEAD:main", check=False)
        if push.returncode == 0:
            return "pushed", late
        say(f"Push feila, prøver rebase (forsøk {attempt}).")
        git(cwd, "fetch", "origin", "main", check=False)
        rebase = git(cwd, "rebase", "origin/main", check=False)
        if rebase.returncode != 0:
            git(cwd, "rebase", "--abort", check=False)
            git(cwd, "reset", "--hard", "origin/main")
            proc = run_logger()
            if proc is not None and getattr(proc, "returncode", 0) != 0:
                say("Logger feila etter rebase. Prøver att neste runde.")
                return "logger-failed", late
            if not stage_and_commit(cwd):
                return "unchanged", late
        sleep_fn(min(2**attempt, 15))
    say("Fekk ikkje pusha loggen.")
    return "push-failed", late


def production_sleep(seconds):
    remaining = seconds
    while remaining > 0:
        chunk = min(remaining, 300)
        minutes = max(1, round(remaining / 60))
        say(f"Søv, om lag {minutes} minutt att.")
        time.sleep(chunk)
        remaining -= chunk


def run_production_logger():
    script = ROOT / "scripts" / "log_signalturar.py"
    return subprocess.run([sys.executable, str(script)], cwd=ROOT, check=False)


def dispatch_next():
    cmd = [
        "gh",
        "workflow",
        "run",
        WORKFLOW_FILE,
        "--ref",
        "main",
        "-f",
        "handoff=true",
    ]
    for attempt in range(1, 4):
        proc = subprocess.run(cmd, check=False, text=True, capture_output=True)
        if proc.returncode == 0:
            say("Starta neste løkke.")
            return True
        detail = (proc.stderr or proc.stdout or "").strip()
        say(f"Fekk ikkje starta neste løkke (forsøk {attempt}): {detail}")
        time.sleep(min(2**attempt, 10))
    return False


def run_loop(*, started, now_fn, sleep_fn, log_fn, handoff_fn, budget=LOOP_BUDGET):
    """Logg til budsjettet er brukt. SystemExit i loggesteg stoppar ikkje løkka."""
    last_log = None
    while True:
        now = as_utc(now_fn())
        decision = plan(now, started, last_log, budget)
        if decision.action == "handoff":
            try:
                return bool(handoff_fn())
            except (Exception, SystemExit) as exc:
                say(f"Vidareføringsfeil: {exc}")
                return False
        if decision.action == "log":
            scheduled = now
            try:
                log_fn()
            except (Exception, SystemExit) as exc:
                say(f"Loggesteg feila ({exc}). Logginga held fram.")
            last_log = scheduled
            continue
        if decision.sleep_seconds <= 0:
            try:
                return bool(handoff_fn())
            except (Exception, SystemExit) as exc:
                say(f"Vidareføringsfeil: {exc}")
                return False
        sleep_fn(decision.sleep_seconds)


def fetch_recent_runs():
    proc = subprocess.run(
        [
            "gh",
            "run",
            "list",
            "--workflow",
            WORKFLOW_FILE,
            "--json",
            "databaseId,status,startedAt,createdAt,headBranch,event",
            "--limit",
            "30",
        ],
        check=False,
        text=True,
        capture_output=True,
    )
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(detail or "gh feila")
    data = json.loads(proc.stdout or "[]")
    if not isinstance(data, list):
        raise RuntimeError("uventa svar frå gh")
    return data


def main():
    event = os.environ.get("EVENT_NAME", "")
    handoff = env_flag("HANDOFF")
    self_id = os.environ.get("RUN_ID", "")
    say(f"Signaltur-løkke startar (event={event or 'ukjend'}, handoff={handoff}).")
    decision, error = gate_decision(
        event,
        handoff,
        self_id,
        fetch_recent_runs,
        datetime.now(timezone.utc),
    )
    if error is not None:
        say(f"Klarte ikkje å sjå om ei løkke alt går ({error}). Logginga held fram.")
    if decision == "exit":
        say("Ei anna løkke køyrer allereie. Avsluttar.")
        return 0

    started = datetime.now(timezone.utc)

    def log_fn():
        publish_log(ROOT, run_production_logger)

    ok = run_loop(
        started=started,
        now_fn=lambda: datetime.now(timezone.utc),
        sleep_fn=production_sleep,
        log_fn=log_fn,
        handoff_fn=dispatch_next,
    )
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
