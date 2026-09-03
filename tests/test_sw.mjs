import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const app = readFileSync(new URL("../assets/app.js", import.meta.url), "utf8");

function isTimetableJson(url) {
  return /\/data\/(ruter|kombirute|korrespondanse)\.json$/.test(url.pathname);
}

function isMessagesJson(url) {
  return url.pathname.endsWith("/trafikkmeldinger.json");
}

test("rutetabell-JSON brukar stale-while-revalidate, meldingar og skall brukar network-first", () => {
  assert.match(sw, /fergeruter-dev-v24/);
  assert.match(sw, /function isTimetableJson/);
  assert.match(sw, /function isMessagesJson/);
  assert.match(sw, /staleWhileRevalidate\(request,\s*\{\s*notify: true/);
  assert.match(sw, /isMessagesJson\(url\) \|\| shell/);
  assert.match(sw, /event\.respondWith\(networkFirst\(request\)\)/);
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

test("trafikkmeldingar blir henta med cache-buster, rutetabellen ikkje", () => {
  assert.match(app, /MESSAGES_URL\}\?t=\$\{Date\.now\(\)\}/);
  assert.match(app, /fetch\(ROUTES_URL\)/);
  assert.match(app, /TIMETABLE_CACHE_KEY/);
  assert.doesNotMatch(app, /ROUTES_URL\}\?t=/);
  assert.doesNotMatch(app, /KOMBI_URL\}\?t=/);
});
