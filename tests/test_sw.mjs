import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { appVersion } from "./helpers/version.mjs";

const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const app = readFileSync(new URL("../assets/app.js", import.meta.url), "utf8");

function isTimetableJson(url) {
  return /\/data\/(ruter|kombirute|korrespondanse)\.json$/.test(url.pathname);
}

function isMessagesJson(url) {
  return url.pathname.endsWith("/trafikkmeldinger.json");
}

test("rutetabell-JSON brukar stale-while-revalidate, meldingar og skall brukar network-first", () => {
  assert.match(sw, new RegExp(`fergeruter-dev-v${appVersion()}"`));
  assert.match(sw, /signalturar\.json/);
  assert.match(sw, new RegExp(`i18n\\.js\\?v=${appVersion()}"`));
  assert.match(sw, /function isTimetableJson/);
  assert.match(sw, /function isMessagesJson/);
  assert.match(sw, /staleWhileRevalidate\(request,\s*\{\s*notify: true/);
  assert.match(sw, /notifyType: "messages-updated"/);
  assert.match(sw, /url\.search = ""/);
});

test("berre rute, kombi og korrespondanse tel som rutetabell", () => {
  const files = {
    "/fergeruter/data/ruter.json": true,
    "/fergeruter/dev/data/kombirute.json": true,
    "/fergeruter/data/korrespondanse.json": true,
    "/fergeruter/data/trafikkmeldinger.json": false,
    "/fergeruter/assets/app.js": false,
  };
  for (const [pathname, expected] of Object.entries(files)) {
    assert.equal(isTimetableJson({ pathname }), expected, pathname);
    assert.equal(isMessagesJson({ pathname }), pathname.endsWith("trafikkmeldinger.json"), pathname);
  }
});

test("trafikkmeldingar blir revaliderte utan cache-buster, rutetabellen ikkje", () => {
  assert.match(app, /fetch\(messagesUrl\(\), \{ cache: "no-cache" \}\)/);
  assert.match(app, /fetchFjord1Messages/);
  assert.match(app, /fetchFjord1Api/);
  assert.match(app, /FJORD1_MESSAGES_API/);
  assert.match(app, /FJORD1_HTML_READER/);
  assert.doesNotMatch(app, /fjord1\.no\/graphql/);
  assert.doesNotMatch(app, /FJORD1_GRAPHQL/);
  const liveFn = app.slice(app.indexOf("async function fetchFjord1Messages"));
  assert.ok(liveFn.indexOf("fetchFjord1Api") < liveFn.indexOf("fetchFjord1Html"));
  assert.match(app, /MESSAGES_STALE_MS = 8 \* 60 \* 1000/);
  assert.match(app, /fetch\(ROUTES_URL\)/);
  assert.match(app, /TIMETABLE_CACHE_KEY/);
  assert.match(app, /MESSAGES_POLL_MS = 3 \* 60 \* 1000/);
  assert.match(app, /messages-updated/);
  assert.match(app, /shouldFetchLive/);
  assert.match(app, /noteLiveFailure/);
  assert.match(app, /requestWake/);
  assert.doesNotMatch(app, /ROUTES_URL\}\?t=/);
  assert.doesNotMatch(app, /KOMBI_URL\}\?t=/);
  assert.doesNotMatch(app, /MESSAGES_URL\}\?t=/);
  assert.doesNotMatch(app, /setInterval\(loadMessages/);
});

test("versjonsnummeret er likt i index.html, sw.js og app.js", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const found = [];
  const collect = (file, text, re) => {
    for (const match of text.matchAll(re)) found.push({ file, what: match[0], version: match[1] });
  };
  const assetRe = /(?:app|i18n)\.js\?v=(\d+)|styles\.css\?v=(\d+)/g;
  const assetVersions = (file, text) => {
    for (const match of text.matchAll(assetRe)) {
      found.push({ file, what: match[0], version: match[1] || match[2] });
    }
  };
  assetVersions("index.html", html);
  assetVersions("sw.js", sw);
  assetVersions("assets/app.js", app);
  collect("sw.js", sw, /"fergeruter-(?:dev-)?v(\d+)"/g);
  const where = (file, re) => found.filter((item) => item.file === file && re.test(item.what));
  // Kvar av desse skal finnast, elles kan testen bli grøn utan å sjekke noko.
  assert.equal(where("index.html", /^app\.js/).length, 1, "app.js i index.html");
  assert.equal(where("index.html", /^styles\.css/).length, 1, "styles.css i index.html");
  assert.equal(where("sw.js", /^app\.js/).length, 1, "app.js i sw.js");
  assert.equal(where("sw.js", /^i18n\.js/).length, 1, "i18n.js i sw.js");
  assert.equal(where("sw.js", /^styles\.css/).length, 1, "styles.css i sw.js");
  assert.equal(where("assets/app.js", /^i18n\.js/).length, 1, "i18n.js-importen i app.js");
  assert.equal(where("sw.js", /fergeruter-v/).length, 1, "prod-cachen i sw.js");
  assert.equal(where("sw.js", /fergeruter-dev-v/).length, 1, "dev-cachen i sw.js");
  const versions = new Set(found.map((item) => item.version));
  assert.equal(
    versions.size,
    1,
    `ulike versjonar: ${found.map((item) => `${item.file} ${item.what}`).join(", ")}`
  );
  assert.equal([...versions][0], appVersion());
});
