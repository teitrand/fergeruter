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

function cronFields(expr) {
  return expr.trim().split(/\s+/);
}

function expandField(field) {
  const values = [];
  for (const part of field.split(",")) {
    if (part.includes("-")) {
      const [from, to] = part.split("-").map(Number);
      for (let value = from; value <= to; value += 1) values.push(value);
    } else {
      values.push(Number(part));
    }
  }
  return values;
}

function cronsFromToml(toml) {
  const block = toml.match(/crons\s*=\s*\[([^\]]*)\]/);
  assert.ok(block, toml);
  return [...block[1].matchAll(/"([^"]+)"/g)].map((hit) => hit[1]);
}

function cronMatches(expr, date) {
  const [minuteField, hourField, day, month, weekday] = cronFields(expr);
  if (day !== "*" || month !== "*" || weekday !== "*") return false;
  return (
    expandField(minuteField).includes(date.getUTCMinutes()) &&
    expandField(hourField).includes(date.getUTCHours())
  );
}

function osloClock(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type).value;
  return {
    date: `${pick("year")}-${pick("month")}-${pick("day")}`,
    hour: Number(pick("hour")),
    minute: Number(pick("minute")),
  };
}

function nextCronAfter(crons, instant) {
  const start = instant.getTime();
  for (let step = 60 * 1000; step <= 6 * 60 * 60 * 1000; step += 60 * 1000) {
    const candidate = new Date(start + step);
    candidate.setUTCSeconds(0, 0);
    if (candidate.getTime() <= start) continue;
    if (crons.some((expr) => cronMatches(expr, candidate))) return candidate;
  }
  return null;
}

test("wrangler har kveldskøyring som ikkje blir midnatt i Oslo", () => {
  const toml = readFileSync(new URL("../cloudflare/signaltur-cron/wrangler.toml", import.meta.url), "utf8");
  const workflow = readFileSync(new URL("../.github/workflows/log-signalturar.yml", import.meta.url), "utf8");
  const crons = cronsFromToml(toml);
  assert.deepEqual(crons, ["7,37 4-21 * * *"]);
  assert.equal(toml.includes("7 22"), false);
  assert.match(workflow, /cron: "7,37 4-21 \* \* \*"/);
  assert.equal(workflow.includes('cron: "7 22 * * *"'), false);

  const summerArrival = new Date("2026-07-15T20:35:00+02:00");
  const winterArrival = new Date("2026-01-14T20:35:00+01:00");
  for (const arrival of [summerArrival, winterArrival]) {
    const next = nextCronAfter(crons, arrival);
    assert.ok(next, arrival.toISOString());
    assert.ok(next.getTime() - arrival.getTime() <= 30 * 60 * 1000, next.toISOString());
    assert.equal(osloClock(next).date, osloClock(arrival).date);
  }

  const summerLast = new Date(Date.UTC(2026, 6, 15, 21, 37));
  const winterLast = new Date(Date.UTC(2026, 0, 14, 21, 37));
  assert.equal(crons.some((expr) => cronMatches(expr, summerLast)), true);
  assert.equal(crons.some((expr) => cronMatches(expr, winterLast)), true);
  assert.equal(osloClock(summerLast).hour, 23);
  assert.equal(osloClock(summerLast).date, "2026-07-15");
  assert.equal(osloClock(winterLast).hour, 22);
  assert.equal(osloClock(winterLast).date, "2026-01-14");
  const summerMidnight = new Date(Date.UTC(2026, 6, 15, 22, 7));
  assert.equal(osloClock(summerMidnight).date, "2026-07-16");
  assert.equal(crons.some((expr) => cronMatches(expr, summerMidnight)), false);
});
