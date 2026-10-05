#!/usr/bin/env python3
"""Skriv signaltur-loggen éin gong og push til main.

Cloudflare-workeren er klokka. GitHub-cron på same minutt er reserve.
Er loggen skriven dei siste 20 minutta, hoppar jobben over, så dei to
ikkje skriv dobbelt. Ein sein `updatedAt` blir varsla, og logginga held fram.
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

FRESH_SKIP = timedelta(minutes=20)
LOG_REL = Path("data/signalturar.json")
ROOT = Path(__file__).resolve().parents[1]
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


def log_is_fresh(previous, moment, window=FRESH_SKIP):
    parsed = parse_time(previous)
    if parsed is None:
        return False
    return as_utc(moment) - parsed < window


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


def publish_log(cwd, run_logger, attempts=5, sleep_fn=None, now=None, skip_if_fresh=False):
    """Hent main, logg, commit og push. Rebase ved kappløp, skriv om ved kollisjon.

    Ein sein `updatedAt` blir varsla og logginga held fram. Er loggen fersk
    og `skip_if_fresh` er sett, blir loggeren ikkje køyrt.
    """
    if sleep_fn is None:
        sleep_fn = time.sleep
    ensure_identity(cwd)
    prepare_worktree(cwd)
    moment = as_utc(now or datetime.now(timezone.utc))
    previous = read_updated_at(cwd)
    if skip_if_fresh and log_is_fresh(previous, moment):
        say("Loggen er fersk. Hoppar over.")
        return "fresh", False
    late = logger().log_is_late(previous, moment)
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


def run_production_logger():
    script = ROOT / "scripts" / "log_signalturar.py"
    return subprocess.run([sys.executable, str(script)], cwd=ROOT, check=False)


def main():
    force = env_flag("FORCE")
    say(f"Loggar signalturar (force={force}).")
    result, _late = publish_log(
        ROOT,
        run_production_logger,
        skip_if_fresh=not force,
    )
    if result in {"pushed", "unchanged", "fresh"}:
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
