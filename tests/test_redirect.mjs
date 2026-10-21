import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");

test("index.html sender vidare til ruter.trandal.org med query og hash", () => {
  assert.match(html, /location\.replace\("https:\/\/ruter\.trandal\.org\/" \+ location\.search \+ location\.hash\)/);
  assert.match(html, /http-equiv="refresh"/);
  assert.match(html, /<a href="https:\/\/ruter\.trandal\.org\/">/);
});

test("sw.js tømer cachar, avregistrerer seg og sender klientar vidare", () => {
  for (const re of [/skipWaiting/, /caches\.delete/, /clients\.claim/, /registration\.unregister/, /client\.navigate/, /fetch\(event\.request\)/]) {
    assert.match(sw, re);
  }
});
