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
  assert.match(sw, /fergeruter-dev-v30/);
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
