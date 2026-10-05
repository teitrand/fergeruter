import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import worker, { dispatchWorkflow } from "../cloudflare/signaltur-cron/src/index.js";

const DISPATCH_URL =
  "https://api.github.com/repos/teitrand/fergeruter/actions/workflows/log-signalturar.yml/dispatches";

test("prøver om att og godtek 204", async () => {
  const calls = [];
  let n = 0;
  const logs = [];
  const ok = await dispatchWorkflow({
    token: "ghp_test",
    fetchImpl: async (url, init) => {
      n += 1;
      calls.push({ url, init });
      if (n < 3) return { status: 500, text: async () => "nei" };
      return { status: 204, text: async () => "" };
    },
    log: (line) => logs.push(line),
    sleep: async () => {},
  });
  assert.equal(ok, true);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, DISPATCH_URL);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer ghp_test");
  assert.equal(calls[0].init.headers["User-Agent"], "fergeruter-signaltur-cron");
  assert.deepEqual(JSON.parse(calls[0].init.body), { ref: "main" });
  assert.equal(logs.join("\n").includes("ghp_test"), false);
});

test("manglande token hentar ikkje", async () => {
  let called = false;
  const logs = [];
  const ok = await dispatchWorkflow({
    token: "",
    fetchImpl: async () => {
      called = true;
      return { status: 204, text: async () => "" };
    },
    log: (line) => logs.push(line),
    sleep: async () => {},
  });
  assert.equal(ok, false);
  assert.equal(called, false);
  assert.match(logs.join("\n"), /npx wrangler secret put GITHUB_TOKEN/);
});

test("gir opp etter tre forsøk når nettet feilar", async () => {
  let n = 0;
  const ok = await dispatchWorkflow({
    token: "tok",
    fetchImpl: async () => {
      n += 1;
      throw new Error("nett");
    },
    log: () => {},
    sleep: async () => {},
  });
  assert.equal(ok, false);
  assert.equal(n, 3);
});

test("scheduled kastar når dispatch feilar", async () => {
  await assert.rejects(() => worker.scheduled({ cron: "7 4 * * *" }, {}, {}), /log-signalturar/);
});

test("wrangler har same cron som workeren skal fyre", () => {
  const toml = readFileSync(new URL("../cloudflare/signaltur-cron/wrangler.toml", import.meta.url), "utf8");
  assert.match(toml, /7,37 4-21 \* \* \*/);
  assert.match(toml, /7 22 \* \* \*/);
});
