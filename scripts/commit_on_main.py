#!/usr/bin/env python3
"""Commit filer og push til main, med rebase når ein annan jobb rakk først.

Bot-jobbane skriv ulike filer til same grein. `git push` blir avvist med
«fetch first» når to av dei committer samstundes. Då hentar vi main, rebasar,
og prøver push på nytt. Kollisjon blir kasta: fila blir laga på nytt oppå
siste main, og push prøvd om att.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

BOT_NAME = "github-actions[bot]"
BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com"
DEFAULT_ATTEMPTS = 5


def say(message):
    print(message, flush=True)


def git(cwd, *args, check=True):
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    env.setdefault("GIT_AUTHOR_NAME", BOT_NAME)
    env.setdefault("GIT_AUTHOR_EMAIL", BOT_EMAIL)
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
    git(cwd, "config", "user.name", BOT_NAME)
    git(cwd, "config", "user.email", BOT_EMAIL)
    git(cwd, "config", "commit.gpgsign", "false")


def head_branch(cwd):
    name = git(cwd, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
    if not name or name == "HEAD":
        return "main"
    return name


def ref_from_refspec(refspec):
    if ":" not in refspec:
        raise RuntimeError(f"refspec må vere HEAD:<grein>, fekk {refspec}")
    return refspec.split(":", 1)[1]


def commit_paths(cwd, paths, message):
    """Returner True når ein ny commit ligg klar. False om ingenting er endra."""
    git(cwd, "add", "--", *paths)
    staged = git(cwd, "diff", "--staged", "--quiet", check=False)
    if staged.returncode == 0:
        return False
    if staged.returncode != 1:
        detail = (staged.stderr or staged.stdout or "").strip()
        raise RuntimeError(detail or "git diff feila")
    git(cwd, "commit", "-m", message)
    return True


def run_refresh(cwd, refresh):
    if refresh is None:
        return
    if callable(refresh):
        refresh()
        return
    proc = subprocess.run(
        refresh,
        cwd=cwd,
        shell=True,
        check=False,
        text=True,
        capture_output=True,
    )
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(detail or "oppfrisking feila")
    if proc.stdout:
        sys.stdout.write(proc.stdout)
        if not proc.stdout.endswith("\n"):
            sys.stdout.write("\n")


def _same_commit(cwd, ref):
    head = git(cwd, "rev-parse", "HEAD").stdout.strip()
    remote = git(cwd, "rev-parse", f"origin/{ref}").stdout.strip()
    return head == remote


def push_committed(
    cwd,
    refspec="HEAD:main",
    attempts=DEFAULT_ATTEMPTS,
    sleep_fn=None,
    rebuild=None,
    fail_message="Fekk ikkje pusha.",
):
    """Push ein ferdig commit. Rebase ved kappløp, `rebuild` ved kollisjon.

    `rebuild` skal lage ein ny commit oppå siste `origin/<grein>` og returnere
    False om det ikkje er noko å sende. Returnerer `pushed`, `unchanged`
    eller `push-failed`.
    """
    if sleep_fn is None:
        sleep_fn = __import__("time").sleep
    ref = ref_from_refspec(refspec)
    for attempt in range(1, attempts + 1):
        push = git(cwd, "push", "origin", refspec, check=False)
        if push.returncode == 0:
            return "pushed"
        detail = (push.stderr or push.stdout or "").strip()
        say(f"Push feila, prøver rebase (forsøk {attempt}).")
        if detail:
            say(detail)
        fetched = git(cwd, "fetch", "origin", ref, check=False)
        if fetched.returncode != 0:
            fetched_detail = (fetched.stderr or fetched.stdout or "").strip()
            say(fetched_detail or "git fetch feila")
            sleep_fn(min(2**attempt, 15))
            continue
        rebase = git(cwd, "rebase", f"origin/{ref}", check=False)
        if rebase.returncode != 0:
            git(cwd, "rebase", "--abort", check=False)
            git(cwd, "reset", "--hard", f"origin/{ref}")
            if rebuild is None or not rebuild():
                say("Ingenting att å sende etter kollisjon.")
                return "unchanged"
        elif _same_commit(cwd, ref):
            say("Committen låg alt på main.")
            return "unchanged"
        sleep_fn(min(2**attempt, 15))
    say(fail_message)
    return "push-failed"


def publish(
    cwd,
    paths,
    message,
    refresh=None,
    refspec=None,
    attempts=DEFAULT_ATTEMPTS,
    sleep_fn=None,
):
    """Køyr `refresh`, commit `paths`, og push. Prøv om att ved kappløp."""
    cwd = Path(cwd)
    ensure_identity(cwd)
    if refspec is None:
        refspec = f"HEAD:{head_branch(cwd)}"
    run_refresh(cwd, refresh)
    if not commit_paths(cwd, paths, message):
        say("Ingen endringar")
        return "unchanged"

    def rebuild():
        run_refresh(cwd, refresh)
        return commit_paths(cwd, paths, message)

    return push_committed(
        cwd,
        refspec=refspec,
        attempts=attempts,
        sleep_fn=sleep_fn,
        rebuild=rebuild if refresh is not None else None,
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description="Commit og push til main med retry.")
    parser.add_argument("--repo", default=".", help="Git-arbeidskatalog")
    parser.add_argument("--message", required=True)
    parser.add_argument("--refresh", default="", help="Kommando som lagar filene på nytt")
    parser.add_argument("--to", default="", help="Grein å pushe til. Tomt = gjeldande grein.")
    parser.add_argument("paths", nargs="+")
    args = parser.parse_args(argv)
    repo = Path(args.repo)
    refspec = f"HEAD:{args.to}" if args.to else None
    try:
        result = publish(
            repo,
            args.paths,
            args.message,
            refresh=args.refresh or None,
            refspec=refspec,
        )
    except RuntimeError as error:
        say(str(error) or "commit feila")
        return 1
    if result in {"pushed", "unchanged"}:
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
