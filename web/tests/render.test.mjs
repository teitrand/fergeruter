// Røykjetest for React-skalet: teiknar <App> på tenarsida med fast data og fast klokke,
// utan nett. Lastar komponentane gjennom Vite (same tillegg som byggjet, inkl. ?v=-fjerninga).
// Køyr: npm test -w web (krev npm ci).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const repo = new URL("../../", import.meta.url);
const json = (path) => JSON.parse(readFileSync(new URL(path, repo), "utf8"));
const ROUTES = json("tests/fixtures/ruter.json");
const LOG = json("tests/fixtures/signalturar_2026-10-02_08.json");
const KOMBI = json("data/kombirute.json");

// 8. oktober 2026 kl. 20:30 i Oslo (UTC+2).
const FIXED = Date.UTC(2026, 9, 8, 18, 30);
const RealDate = Date;

let server;
let App;
let memoryOnly;

before(async () => {
  server = await createServer({
    root,
    configFile: fileURLToPath(new URL("../vite.config.js", import.meta.url)),
    logLevel: "error",
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  ({ App } = await server.ssrLoadModule("/src/App.jsx"));
  ({ memoryOnly } = await server.ssrLoadModule("/src/model/context.js"));
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [FIXED]));
    }
    static now() {
      return FIXED;
    }
  };
});

after(async () => {
  globalThis.Date = RealDate;
  await server?.close();
});

function render({ lang = "nn", override = null, kombirute = null, date = null } = {}) {
  const initialData = { routes: ROUTES, kombirute, messages: null, signalLog: { days: { "2026-10-08": LOG.days["2026-10-08"] } } };
  const initialState = { routeChoice: "1136", lang, override, date, showPast: true };
  const html = renderToString(createElement(App, { initialData, initialState, memory: memoryOnly() }));
  return html.replace(/<!-- -->/g, "");
}

const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("skalet teiknar 1136 på nynorsk med statuslinje, dag og «Ukjent»", () => {
  const html = render();
  const plain = text(html);
  assert.match(plain, /Torsdag 8\. oktober/);
  assert.match(html, /id="route-title">Standal–Trandal–Sæbø–Skår–Valderøya–Store Kalvøy</);
  assert.match(html, /class="lede" id="lede-status">Ferja [^<]+\./, "statuslinja har tekst");
  assert.match(html, /class="stop-state" data-signal="unknown">Ukjent</);
  assert.match(plain, /Gått/);
  assert.match(html, /class="chip is-active" aria-pressed="true">Standal–Trandal</);
  assert.ok((html.match(/class="stop stop-dep/g) || []).length > 10, "mange avgangar");
});

test("engelsk: core og komponentane deler éin i18n-modul", () => {
  const plain = text(render({ lang: "en" }));
  // headingDay og countdown kjem frå core; «Unknown» og «Choose route» frå komponentane.
  assert.match(plain, /Thursday 8 October/);
  assert.match(plain, /Unknown/);
  assert.match(plain, /Choose route/);
  assert.doesNotMatch(plain, /Torsdag|Ukjent|Vel samband/);
});

test("kombirute med ?rute=kombi og ein annan dag", () => {
  const html = render({ override: "kombi", kombirute: KOMBI, date: "2026-10-09" });
  assert.match(html, /id="route-badge" class="route-badge">Kombirute</);
  assert.match(html, /id="route-title">Sæbø–Leknes–Skår–Trandal–Standal</);
  assert.match(text(html), /Fredag 9\. oktober/);
  assert.doesNotMatch(html, /data-signal="unknown"/, "andre dagar har ikkje «Ukjent»");
});
