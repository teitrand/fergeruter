#!/usr/bin/env python3
"""Legg ferske `data/`-filer frå main inn i testhosten (`dev/data/`).

Dei daglege dataoppdateringane går berre til main. Testhosten blir kopiert frå
dev-greina og ville difor vist gammal rutetabell. Etter kopien legg vi main sine
`data/`-filer over, men berre når dev-greina har ein versjon som òg har lege på
main ein gong (altså ein gammal kopi). Har dev ein versjon main aldri har hatt,
er fila endra med vilje på dev (t.d. nytt format), og då står dev sin versjon.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path

ZERO = "0" * 40


def git(cwd, *args):
    proc = subprocess.run(["git", *args], cwd=cwd, check=False, text=True, capture_output=True)
    return proc.stdout.strip() if proc.returncode == 0 else None


def blob_on_dev(dev_repo, rel):
    """Blob-id for fila i HEAD på dev-greina, eller None om ho ikkje finst der."""
    return git(dev_repo, "rev-parse", "--verify", "--quiet", f"HEAD:{rel}")


def blobs_on_main(main_repo, rel):
    """Alle versjonar fila har hatt i historikken til main."""
    out = git(main_repo, "log", "-m", "--format=", "--raw", "--no-abbrev", "HEAD", "--", rel) or ""
    blobs = set()
    for line in out.splitlines():
        if not line.startswith(":"):
            continue
        fields = line[1:].split("\t", 1)[0].split()
        if len(fields) >= 4:
            blobs.update(sha for sha in fields[2:4] if sha != ZERO)
    return blobs


def sync(main_repo, dev_repo, out_dir):
    """Kopier main/data/* til out_dir. Returner (kopierte, haldne) som lister."""
    main_repo, dev_repo, out_dir = Path(main_repo), Path(dev_repo), Path(out_dir)
    copied, kept = [], []
    source = main_repo / "data"
    if not source.is_dir():
        return copied, kept
    for path in sorted(p for p in source.rglob("*") if p.is_file()):
        rel = path.relative_to(main_repo).as_posix()
        dev_blob = blob_on_dev(dev_repo, rel)
        if dev_blob and dev_blob not in blobs_on_main(main_repo, rel):
            kept.append(rel)
            continue
        target = out_dir / path.relative_to(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
        copied.append(rel)
    return copied, kept


def main(argv=None):
    parser = argparse.ArgumentParser(description="Kopier ferske data frå main til testhosten.")
    parser.add_argument("--main", default=".", help="Arbeidskatalog for main (full historikk)")
    parser.add_argument("--dev", required=True, help="Arbeidskatalog for dev-greina")
    parser.add_argument("--out", default="dev/data", help="Målmappe for testhosten sine data")
    args = parser.parse_args(argv)
    copied, kept = sync(args.main, args.dev, args.out)
    for rel in copied:
        print(f"Fersk frå main: {rel}")
    for rel in kept:
        print(f"Endra på dev, held på dev sin versjon: {rel}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
