// Testar for React-skalet i web/ som ikkje treng node_modules: modellen (web/src/model),
// UI-reduceren, Vite-tillegget for ?v= og byggjeskriptet for service workeren.
// Køyrer via test_status.mjs, sidan arbeidsflyta listar testfilene ein og ein.
// Sjølve React-teikninga blir testa i web/tests (npm test -w web).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as app from "../assets/app.js";
import { departureStateKey } from "../packages/core/index.js";
import { stripVersionQuery } from "../web/build/strip-version-query.js";
import { renderServiceWorker } from "../web/scripts/build-sw.mjs";
import { memoryOnly, planContext, routeOverride, statusEvidence } from "../web/src/model/context.js";
import { dataBase, fetchAppData } from "../web/src/model/data.js";
import { ledeModel, routeChrome } from "../web/src/model/header.js";
import { buildTimeline } from "../web/src/model/timeline.js";
import { initialUi, uiReducer } from "../web/src/state.js";
import { DAYS, LOG, ROUTES, osloMs } from "./helpers/replay.mjs";
import { appVersion } from "./helpers/version.mjs";

const { setLang } = await import(`../assets/i18n.js?v=${appVersion()}`);
const KOMBI = JSON.parse(readFileSync(new URL("../data/kombirute.json", import.meta.url), "utf8"));

const RealDate = Date;
function atOslo(day, minutes, fn) {
  const fixed = osloMs(day, minutes);
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixed]));
    }
    static now() {
      return fixed;
    }
  };
  try {
    return fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

const clock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Det vanilla-appen viser for kvar avgang den dagen: klokke, strekning og status. */
function vanillaRows(date, today, now) {
  const rows = [];
  const seen = new Set();
  for (const leg of app.legsForDate(date)) {
    const key = `${leg.from}|${leg.departure}`;
    if (leg.hideDeparture || seen.has(key)) continue;
    seen.add(key);
    const status = app.tripStatusFor(leg);
    const signalDone = leg.signal && today && status.verdict === "skipped";
    const done = signalDone ? leg.departure : leg.arrival || leg.departure;
    const toMin = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
    const past = today && toMin(done) <= now;
    const departed = today && now >= toMin(leg.departure);
    rows.push(`${leg.departure.slice(0, 5)} ${leg.from}–${leg.to}${past ? " (tidlegare)" : ""}: ${departureStateKey(status, { past, departed, today })}`);
  }
  return rows;
}

function modelRows(timeline) {
  return timeline.rows
    .filter((row) => row.kind === "dep")
    .map((row) => `${row.time} ${row.from}–${row.to}${row.past ? " (tidlegare)" : ""}: ${row.state}`);
}

test("web-modellen gjev same avgangar og status som vanilla-appen, 2.–8. oktober", () => {
  setLang("nn", { persist: false });
  let compared = 0;
  let unknown = 0;
  let notRunning = 0;
  for (const day of DAYS) {
    // Avlyst hos Entur = «skipped» i loggen, som i replayen. Då blir signalturen «ikkje utført».
    const cancelledJourneys = new Set(LOG.days[day].filter((entry) => entry.status === "skipped").map((entry) => entry.id));
    for (let minutes = 6 * 60; minutes < 24 * 60; minutes += 47) {
      atOslo(day, minutes, () => {
        const signalLog = { days: { [day]: LOG.days[day] } };
        app.resetTestState();
        app.setTestState({ routes: ROUTES, kombirute: null, messages: null, routeChoice: "1136", signalLog, cancelledJourneys, date: null });
        const data = { routes: ROUTES, kombirute: null, messages: null, signalLog, cancelledJourneys };
        const ui = { ...initialUi(), showPast: true };
        const timeline = buildTimeline(data, ui, memoryOnly(), { now: minutes });
        const expected = vanillaRows(day, true, minutes);
        assert.deepEqual(modelRows(timeline), expected, `${day} kl. ${clock(minutes)}`);
        compared += expected.length;
        unknown += expected.filter((row) => row.endsWith(": unknown")).length;
        notRunning += expected.filter((row) => row.endsWith(": notRunning")).length;
        // Statuslinja: same tekst som currentStatus i vanilla-appen.
        const lede = ledeModel(data, ui, memoryOnly(), minutes);
        const status = app.currentStatus(app.legsForDate(day));
        assert.equal(lede.status, status ? status.short || status.text.replace(/\.$/, "") : null);
      });
    }
  }
  assert.ok(compared > 1000, `samanlikna ${compared} rader`);
  assert.ok(unknown > 0, "minst éin «Ukjent»-rad");
  assert.ok(notRunning > 0, "minst éin «Ikkje utført»-rad");
  app.resetTestState();
});

test("web-modellen: kombirute og ein annan dag gjev same rader som vanilla-appen", () => {
  setLang("en", { persist: false });
  try {
    atOslo("2026-10-08", 9 * 60, () => {
      for (const date of [null, "2026-10-09", "2026-10-07"]) {
        app.resetTestState();
        app.setTestState({ routes: ROUTES, kombirute: KOMBI, messages: null, routeChoice: "1136", date });
        const realLocation = globalThis.location;
        globalThis.location = { hostname: "localhost", pathname: "/", href: "http://localhost/?rute=kombi" };
        try {
          const data = { routes: ROUTES, kombirute: KOMBI, messages: null, signalLog: null };
          const ui = { ...initialUi({ override: "kombi", date }), showPast: true };
          assert.equal(routeChrome(data, ui).mode, "kombi");
          const timeline = buildTimeline(data, ui, memoryOnly(), { now: 9 * 60 });
          const day = date || "2026-10-08";
          assert.deepEqual(modelRows(timeline), vanillaRows(day, date === null, 9 * 60), `kombi ${day}`);
        } finally {
          globalThis.location = realLocation;
        }
      }
    });
  } finally {
    setLang("nn", { persist: false });
    app.resetTestState();
  }
});

test("web-modellen: tom data og dag utan turar", () => {
  const empty = buildTimeline({ routes: null, kombirute: null }, initialUi(), memoryOnly());
  assert.equal(empty.empty, "empty.noTimetable");
  const none = buildTimeline({ routes: { lines: {} }, kombirute: null }, initialUi({ date: "2026-10-08" }), memoryOnly());
  assert.equal(none.empty, "empty.noTripsDay");
});

test("web-modellen: ev og ctx har same felt som i vanilla-appen", () => {
  const data = { routes: ROUTES, kombirute: null, messages: null, signalLog: null };
  const ui = initialUi({ routeChoice: "1135", date: "2026-10-08" });
  const ctx = planContext(data, ui, 0);
  assert.deepEqual(Object.keys(ctx).sort(), ["date", "fromQuery", "kombirute", "messages", "nowMs", "override", "routeChoice", "routes", "today"]);
  assert.equal(ctx.routeChoice, "1135");
  const ev = statusEvidence(data, ui, memoryOnly(), ctx);
  assert.deepEqual(
    Object.keys(Object.getOwnPropertyDescriptors(ev)).sort(),
    ["actualDepartures", "cancelledJourneys", "clockNow", "confirmedBooked", "date", "dateLegs", "dayLegs", "live", "log", "messageCancelled", "sailedJourneys", "today"]
  );
});

test("web: ?rute= berre på localhost og /dev/", () => {
  assert.equal(routeOverride({ hostname: "localhost", pathname: "/", href: "http://localhost/?rute=kombi" }), "kombi");
  assert.equal(routeOverride({ hostname: "x.github.io", pathname: "/fergeruter/dev/web/", href: "https://x.github.io/fergeruter/dev/web/?rute=1135" }), "1135");
  assert.equal(routeOverride({ hostname: "x.github.io", pathname: "/fergeruter/", href: "https://x.github.io/fergeruter/?rute=kombi" }), null);
  assert.equal(routeOverride({ hostname: "localhost", pathname: "/", href: "http://localhost/?rute=tull" }), null);
});

test("web: UI-reduceren", () => {
  let ui = initialUi();
  assert.equal(uiReducer(ui, { type: "route", route: "1136" }), ui, "same samband gjev same objekt");
  ui = uiReducer(ui, { type: "route", route: "1135" });
  assert.equal(ui.routeChoice, "1135");
  assert.equal(uiReducer(ui, { type: "route", route: "kombi" }).routeChoice, "1136", "kombi kan ikkje veljast");
  ui = uiReducer({ ...ui, showPast: true, date: "2026-10-08" }, { type: "day", days: 1 });
  assert.deepEqual([ui.date, ui.showPast], ["2026-10-09", false]);
  assert.equal(uiReducer(ui, { type: "lang", lang: "en" }).lang, "en");
  assert.equal(uiReducer(ui, { type: "togglePast" }).showPast, true);
  assert.throws(() => uiReducer(ui, { type: "tull" }));
});

test("web: datakjelde og henting", async () => {
  assert.equal(dataBase({}), "./data/");
  assert.equal(dataBase({ VITE_DATA_BASE: "../data" }), "../data/");
  const asked = [];
  const files = { "x/ruter.json": ROUTES, "x/signalturar.json": { days: {} } };
  const fakeFetch = async (url) => {
    asked.push(url);
    return url in files ? { ok: true, json: async () => files[url] } : { ok: false, status: 404 };
  };
  const loaded = await fetchAppData(fakeFetch, "x/");
  assert.equal(loaded.routes, ROUTES);
  assert.equal(loaded.kombirute, null);
  assert.equal(loaded.messages, null);
  assert.deepEqual(loaded.signalLog, { days: {} });
  assert.deepEqual(asked.sort(), ["x/kombirute.json", "x/ruter.json", "x/signalturar.json", "x/trafikkmeldinger.json"]);
  await assert.rejects(fetchAppData(async () => ({ ok: false, status: 500 }), "y/"));
});

test("web: Vite-tillegget fjernar berre ?v=<tal> på relative importar", async () => {
  const plugin = stripVersionQuery();
  const calls = [];
  const ctx = { resolve: async (source, importer, options) => (calls.push([source, importer, options.skipSelf]), { id: source }) };
  assert.deepEqual(await plugin.resolveId.call(ctx, "../../assets/i18n.js?v=81", "/r/packages/core/time.js", {}), { id: "../../assets/i18n.js" });
  assert.deepEqual(calls, [["../../assets/i18n.js", "/r/packages/core/time.js", true]]);
  assert.equal(await plugin.resolveId.call(ctx, "./time.js?raw", "/r/x.js", {}), null);
  assert.equal(await plugin.resolveId.call(ctx, "react?v=81", "/r/x.js", {}), null);
  assert.equal(await plugin.resolveId.call(ctx, "./time.js", "/r/x.js", {}), null);
});

test("web: service workeren for skalet kjem frå sw.js og rører ikkje vanilla-cachane", () => {
  const template = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  const out = renderServiceWorker(template, { version: "abc123", files: ["assets/index-x.js", "index.html", "data/ruter.json"] });
  assert.match(out, /const CACHE = IS_DEV \? "fergeruter-web-dev-abc123" : "fergeruter-web-abc123";/);
  assert.ok(out.includes('"./assets/index-x.js"') && out.includes('"./"'));
  assert.ok(!out.includes("?v="), "ingen ?v= i precache");
  assert.ok(out.includes('self.addEventListener("fetch"'), "strategiane frå malen er med");
  const isOwnCache = (dev) =>
    new Function("self", `${out.match(/^const IS_DEV.*$/m)[0]}\n${out.match(/^function isOwnCache[\s\S]*?^\}$/m)[0]}\nreturn isOwnCache;`)({
      location: { pathname: dev ? "/fergeruter/dev/web/sw.js" : "/fergeruter/web/sw.js" },
    });
  for (const dev of [false, true]) {
    const own = isOwnCache(dev);
    assert.equal(own(`fergeruter-v${appVersion()}`), false);
    assert.equal(own(`fergeruter-dev-v${appVersion()}`), false);
    assert.equal(own("fergeruter-web-old"), !dev);
    assert.equal(own("fergeruter-web-dev-old"), dev);
  }
  assert.throws(() => renderServiceWorker("const X = 1;", { version: "x", files: [] }), /CACHE/);
});
