import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "sync_dev_data.py"
spec = importlib.util.spec_from_file_location("sync_dev_data", SCRIPT)
mod = importlib.util.module_from_spec(spec)
sys.modules["sync_dev_data"] = mod
assert spec.loader is not None
spec.loader.exec_module(mod)


def run_git(cwd, *args):
    proc = subprocess.run(["git", *args], cwd=cwd, check=False, text=True, capture_output=True)
    if proc.returncode != 0:
        raise AssertionError((proc.stderr or proc.stdout or "").strip())
    return proc


def init_repo(path):
    path.mkdir()
    run_git(path, "init", "-b", "main")
    run_git(path, "config", "user.email", "test@example.com")
    run_git(path, "config", "user.name", "Test")
    run_git(path, "config", "commit.gpgsign", "false")


def commit(cwd, files, message):
    for name, text in files.items():
        path = Path(cwd) / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    run_git(cwd, "add", "-A")
    run_git(cwd, "commit", "-m", message)


class SyncDevDataTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.main = root / "dest"
        self.dev = root / "src"
        init_repo(self.main)
        init_repo(self.dev)
        commit(self.main, {"data/ruter.json": "gammal\n", "data/signalturar.json": "s1\n"}, "data")
        commit(self.main, {"data/ruter.json": "fersk\n", "data/signalturar.json": "s2\n"}, "data")
        self.out = self.main / "dev" / "data"

    def read_out(self, name):
        return (self.out / name).read_text(encoding="utf-8")

    def test_gammal_kopi_på_dev_blir_bytt_med_main(self):
        commit(self.dev, {"data/ruter.json": "gammal\n", "data/signalturar.json": "s1\n"}, "kopi")
        copied, kept = mod.sync(self.main, self.dev, self.out)
        self.assertEqual(kept, [])
        self.assertEqual(copied, ["data/ruter.json", "data/signalturar.json"])
        self.assertEqual(self.read_out("ruter.json"), "fersk\n")
        self.assertEqual(self.read_out("signalturar.json"), "s2\n")

    def test_fil_endra_på_dev_blir_ståande(self):
        commit(self.dev, {"data/ruter.json": "nytt format\n", "data/signalturar.json": "s1\n"}, "dev")
        self.out.mkdir(parents=True)
        (self.out / "ruter.json").write_text("nytt format\n", encoding="utf-8")
        copied, kept = mod.sync(self.main, self.dev, self.out)
        self.assertEqual(kept, ["data/ruter.json"])
        self.assertEqual(copied, ["data/signalturar.json"])
        self.assertEqual(self.read_out("ruter.json"), "nytt format\n")
        self.assertEqual(self.read_out("signalturar.json"), "s2\n")

    def test_fil_berre_på_main_blir_kopiert(self):
        commit(self.dev, {"README.md": "dev\n"}, "dev")
        copied, kept = mod.sync(self.main, self.dev, self.out)
        self.assertEqual(kept, [])
        self.assertEqual(self.read_out("ruter.json"), "fersk\n")


if __name__ == "__main__":
    unittest.main()
