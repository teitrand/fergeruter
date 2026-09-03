import assert from "node:assert/strict";
import test from "node:test";
import { ferryStatus, messageTimeLines } from "../assets/app.js";
import {
  SUPPORTED,
  STORAGE_KEY,
  detectLang,
  matchSupportedLang,
  setLang,
  stringKeys,
  stringsFor,
  t,
} from "../assets/i18n.js";

function leg(from, to, departure, arrival, dates = ["2026-08-26"]) {
  return { from, to, departure, arrival, activeDates: dates };
}

const wednesday = [
  leg("Standal", "Trandal", "07:40:00", "07:55:00"),
  leg("Trandal", "Sæbø", "08:00:00", "08:30:00"),
];

test("same i18n keys in nn, en and de", () => {
  const nn = stringKeys();
  assert.ok(nn.length > 50);
  for (const code of SUPPORTED) {
    assert.deepEqual(Object.keys(stringsFor(code)), nn);
  }
});

test("tingefrist utan om", () => {
  setLang("nn");
  const text = t("signal.leftToBook", { duration: "3 t 15 min" });
  assert.equal(text, "3 t 15 min igjen å tinge");
  assert.doesNotMatch(text, /\bom\b/);
  assert.equal(t("countdown.in", { duration: "3 t 15 min" }), "om 3 t 15 min");
  setLang("nn");
});

test("engelsk og tysk tinge-frist", () => {
  setLang("en");
  assert.equal(t("signal.leftToBook", { duration: "3 h 15 min" }), "3 h 15 min left to book");
  setLang("de");
  assert.equal(
    t("signal.leftToBook", { duration: "3 Std. 15 Min." }),
    "noch 3 Std. 15 Min. zum Anmelden"
  );
  setLang("nn");
});

test("statusfølgjer valt språk", () => {
  setLang("en");
  const en = ferryStatus(wednesday, 7 * 60 + 10, wednesday);
  assert.equal(en.short, "The ferry is at Standal");
  setLang("de");
  const de = ferryStatus(wednesday, 7 * 60 + 10, wednesday);
  assert.equal(de.short, "Die Fähre liegt am Anleger Standal");
  setLang("nn");
  const nn = ferryStatus(wednesday, 7 * 60 + 10, wednesday);
  assert.equal(nn.short, "Ferja ligg til kai på Standal");
});

test("matchSupportedLang les locale-taggar", () => {
  assert.equal(matchSupportedLang("nb-NO"), "nn");
  assert.equal(matchSupportedLang("no-NO"), "nn");
  assert.equal(matchSupportedLang("nn-NO"), "nn");
  assert.equal(matchSupportedLang("de-AT"), "de");
  assert.equal(matchSupportedLang("en-GB"), "en");
  assert.equal(matchSupportedLang("en_US"), "en");
  assert.equal(matchSupportedLang("fr-FR"), null);
  assert.equal(matchSupportedLang(""), null);
});

test("detectLang følgjer nettlesarspråk til fyrste treff", () => {
  assert.equal(detectLang({ languages: ["de-DE"], storage: new MapStorage() }), "de");
  assert.equal(detectLang({ languages: ["fr-FR", "en-GB"], storage: new MapStorage() }), "en");
  assert.equal(detectLang({ languages: ["nb-NO"], storage: new MapStorage() }), "nn");
  assert.equal(detectLang({ languages: ["no-NO"], storage: new MapStorage() }), "nn");
  assert.equal(detectLang({ languages: ["sv-SE"], storage: new MapStorage() }), "nn");
});

test("lagra språkval overstyrer nettlesaren", () => {
  const storage = new MapStorage();
  storage.setItem(STORAGE_KEY, "de");
  assert.equal(detectLang({ languages: ["en-US"], storage }), "de");
});

test("setLang lagrar berre når persist er på", () => {
  const storage = new MapStorage();
  setLang("en", { persist: false, storage });
  assert.equal(storage.getItem(STORAGE_KEY), null);
  setLang("de", { persist: true, storage });
  assert.equal(storage.getItem(STORAGE_KEY), "de");
  setLang("nn");
});

test("meldingar viser publisert-tid og gyldig til med klokkeslett", () => {
  setLang("nn");
  const lines = messageTimeLines({
    publishedAt: "2026-09-02T21:38:15+02:00",
    validTo: "2026-09-03T19:37:31+00:00",
  });
  assert.equal(lines.length, 2);
  assert.match(lines[0].text, /^Publisert /);
  assert.match(lines[0].text, /21:38/);
  assert.equal(lines[0].iso, "2026-09-02T21:38:15+02:00");
  assert.match(lines[1].text, /^Gyldig til /);
  assert.match(lines[1].text, /21:37/);
  assert.equal(lines[1].iso, "2026-09-03T19:37:31+00:00");

  setLang("en");
  const en = messageTimeLines({
    publishedAt: "2026-09-02T21:38:15+02:00",
    validTo: "2026-09-03T19:37:31+00:00",
  });
  assert.match(en[0].text, /^Published /);
  assert.match(en[1].text, /^Valid until /);

  setLang("de");
  const de = messageTimeLines({
    publishedAt: "2026-09-02T21:38:15+02:00",
    validTo: "2026-09-03T19:37:31+00:00",
  });
  assert.match(de[0].text, /^Veröffentlicht /);
  assert.match(de[1].text, /^Gültig bis /);
  setLang("nn");
});

test("melding utan validTo viser berre publisert-tid", () => {
  setLang("nn");
  const lines = messageTimeLines({
    publishedAt: "2026-09-02T21:38:15+02:00",
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0].text, /^Publisert /);
  assert.match(lines[0].text, /21:38/);
});

test("melding utan publishedAt brukar validFrom", () => {
  setLang("nn");
  const lines = messageTimeLines({
    validFrom: "2026-09-02T19:38:15+00:00",
    validTo: "2026-09-03T19:37:31+00:00",
  });
  assert.equal(lines.length, 2);
  assert.match(lines[0].text, /21:38/);
  assert.match(lines[1].text, /21:37/);
});

class MapStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(key, String(value));
  }
}
