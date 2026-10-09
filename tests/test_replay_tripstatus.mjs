// Avspeling 2.–8. oktober 2026: tripStatus skal gje same status som den gamle koden
// (fasit frå vanilla-dev-2026-10-08), bortsett frå signalturar utan bevis etter avgang,
// som no står som «Ukjent» i staden for «Gått». Køyrer via test_status.mjs.
// Full avspeling mot gammal kode: node tests/replay_tripstatus.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as app from "../assets/app.js";
import { departureStateKey } from "../packages/core/index.js";
import { GOLDEN_GRID, compareReplays, runReplay, unpackGolden } from "./helpers/replay.mjs";

const golden = JSON.parse(
  readFileSync(new URL("./fixtures/tripstatus_replay_golden.json", import.meta.url), "utf8")
);

test("avspeling 2.–8. oktober: same status som før, berre «Gått» utan bevis blir «Ukjent»", () => {
  assert.deepEqual(golden.grid, GOLDEN_GRID);
  const records = runReplay(app, (mod, leg, ctx) => departureStateKey(mod.tripStatusFor(leg), ctx), GOLDEN_GRID);
  assert.equal(records.length, golden.count);
  const result = compareReplays(unpackGolden(golden, records), records);
  const sample = result.other.slice(0, 3).map((item) => `${item.where}\n før: ${JSON.stringify(item.old)}\n no:  ${JSON.stringify(item.new)}`);
  assert.equal(result.other.length, 0, sample.join("\n"));
  assert.ok(result.unknown.length > 0, "avspelinga skal ha signalturar utan bevis");
  app.resetTestState();
});
