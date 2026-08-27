import assert from "node:assert/strict";
import test from "node:test";
import { ferryStatus } from "../assets/app.js";
import {
  SUPPORTED,
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
