// Avspeling: gammal statuslogikk mot tripStatus for kvar avgang 2.–8. oktober 2026.
// Køyr: node tests/replay_tripstatus.mjs [git-ref]   (standard: vanilla-dev-2026-10-08)
// Med --golden blir fasiten tests/fixtures/tripstatus_replay_golden.json skriven frå git-ref-en.
// Hentar assets/ frå git-ref-en til ei mellombels mappe og importerer begge versjonane.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { GOLDEN_GRID, compareReplays, legacyRowKey, packGolden, runReplay, tripStatusRowKey } from "./helpers/replay.mjs";

const args = process.argv.slice(2);
const golden = args.includes("--golden");
const ref = args.find((arg) => !arg.startsWith("--")) || "vanilla-dev-2026-10-08";
const root = new URL("..", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "fergeruter-replay-"));
try {
  const paths = execFileSync("git", ["-C", root, "ls-tree", "--name-only", ref, "assets", "packages"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  const tar = execFileSync("git", ["-C", root, "archive", ref, ...paths]);
  execFileSync("tar", ["-x", "-C", dir], { input: tar });
  const oldApp = await import(pathToFileURL(join(dir, "assets/app.js")).href);
  if (golden) {
    const records = runReplay(oldApp, legacyRowKey, GOLDEN_GRID);
    const file = new URL("./fixtures/tripstatus_replay_golden.json", import.meta.url);
    writeFileSync(file, `${JSON.stringify(packGolden(records, ref))}\n`);
    console.log(`Skreiv fasit frå ${ref}: ${records.length} rader.`);
    process.exit(0);
  }
  const newApp = await import("../assets/app.js");
  const oldRecords = runReplay(oldApp, legacyRowKey);
  const newRecords = runReplay(newApp, tripStatusRowKey);
  const result = compareReplays(oldRecords, newRecords);
  const departures = new Set(oldRecords.filter((r) => r.leg !== "(statuslinja)").map((r) => `${r.day} ${r.leg}`));
  console.log(`Gammal kode: ${ref}`);
  console.log(`Samanlikna: ${result.compared} rader (${departures.size} avgangar, ${oldRecords.filter((r) => r.signal).length} av radene er signalturar).`);
  console.log(`Skilnader som blir «Ukjent»: ${result.unknown.length}`);
  console.log(`Tomtur med avgangsbevis, detalj «ukjent» → «gått» (rada «Gått» som før): ${result.proven.length}`);
  console.log(`Andre skilnader: ${result.other.length}`);
  const byDay = {};
  for (const item of result.unknown) {
    const key = `${item.record.scenario} | ${item.record.day}`;
    byDay[key] = (byDay[key] || 0) + 1;
  }
  for (const [key, n] of Object.entries(byDay)) console.log(`  «Ukjent» ${key}: ${n}`);
  const provenByDay = {};
  for (const item of result.proven) {
    const key = `${item.record.scenario} | ${item.record.day}`;
    provenByDay[key] = (provenByDay[key] || 0) + 1;
  }
  for (const [key, n] of Object.entries(provenByDay)) console.log(`  tomtur ${key}: ${n}`);
  for (const item of result.proven.slice(0, 5)) console.log(`  døme tomtur: ${item.where} (${item.record.fields.row})`);
  for (const item of result.unknown.slice(0, 5)) console.log(`  døme: ${item.where}: «Gått» → «Ukjent»`);
  for (const item of result.other.slice(0, 10)) console.log(`  ANNA: ${item.where}\n    før: ${JSON.stringify(item.old)}\n    no:  ${JSON.stringify(item.new)}`);
  process.exitCode = result.other.length ? 1 : 0;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
