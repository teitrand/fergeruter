import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, test } from "node:test";
import {
  buildEvents,
  dayType,
  ferryStatus,
  isPreview,
  legsForDate,
  modeFromText,
  quayPlace,
  quaysInDay,
  resetTestState,
  routeModeFromMessages,
  routeOverride,
  setTestState,
  visibleConnectionLines,
} from "../assets/app.js";

const ruter = JSON.parse(readFileSync(new URL("../data/ruter.json", import.meta.url), "utf8"));
const kombi = JSON.parse(
  readFileSync(new URL("../data/kombirute.json", import.meta.url), "utf8")
);

const SMS =
  "Grunna driftsproblem så er ferjerutene 1135 og 1136 innstilt, det blir utført kombinasjonsrute med MF Kvernes. Første avgang frå Sæbø ca. 08:15. Sjå rutetabell på frammr.no.";

const WEEKDAY = "2026-08-28";

beforeEach(() => resetTestState());

test("SMS-døme blir kombi", () => {
  assert.equal(modeFromText(SMS), "kombi");
});

test("normal drift med falsk innstilt blir 1136", () => {
  assert.equal(
    modeFromText(
      "Rute 1136 Standal-Trandal: Pga ein feil i rutesøket vise at det er innstilt, men det er normal drift."
    ),
    "1136"
  );
});

test("berre 1136 innstilt blir 1135", () => {
  assert.equal(modeFromText("Rute 1136 Standal-Trandal er innstilt inntil vidare."), "1135");
});

test("nyaste lokale melding styrer modus", () => {
  assert.equal(
    routeModeFromMessages(
      [
        {
          isLocal: true,
          text: SMS,
          routeMode: "kombi",
          validTo: "2099-01-01T00:00:00Z",
        },
      ],
      Date.parse("2026-08-28T10:00:00Z")
    ),
    "kombi"
  );
  assert.equal(
    routeModeFromMessages(
      [
        {
          isLocal: true,
          text: "normal drift",
          routeMode: "1136",
          validTo: "2099-01-01T00:00:00Z",
        },
      ],
      Date.parse("2026-08-28T10:00:00Z")
    ),
    "1136"
  );
});

test("kombirute kvardag har Sæbø 08:15 og Leknes i stopplista", () => {
  setTestState({
    routes: ruter,
    kombirute: kombi,
    messages: {
      messages: [
        {
          isLocal: true,
          text: SMS,
          routeMode: "kombi",
          validTo: "2099-01-01T00:00:00Z",
        },
      ],
    },
  });
  assert.equal(dayType(WEEKDAY), "weekday");
  const legs = legsForDate(WEEKDAY);
  assert.ok(
    legs.some((leg) => leg.from === "Sæbø" && leg.to === "Leknes" && leg.departure === "08:15:00")
  );
  const quays = quaysInDay(legs);
  assert.ok(quays.includes("Leknes"));
  assert.ok(!quays.includes("Valderøya"));
  assert.ok(!quays.includes("Store Kalvøy"));
});

test("1136-modus har ikkje Leknes-bein", () => {
  setTestState({ routes: ruter, kombirute: kombi, messages: { messages: [] } });
  const legs = legsForDate(WEEKDAY);
  assert.ok(legs.length > 0);
  assert.ok(legs.every((leg) => leg.from !== "Leknes" && leg.to !== "Leknes"));
});

test("Øye-korrespondanse visest berre når Leknes er i tabellen", () => {
  const connections = {
    hub: "Festøya",
    roadTo: "Standal",
    lines: [
      { id: "solavagen", label: "Solavågen", hub: "Festøya", roadTo: "Standal" },
      { id: "oye", label: "Øye", hub: "Leknes", roadTo: "Leknes" },
    ],
  };
  setTestState({
    routes: ruter,
    kombirute: kombi,
    connections,
    messages: { messages: [] },
  });
  const ids1136 = visibleConnectionLines(legsForDate(WEEKDAY)).map((line) => line.id);
  assert.deepEqual(ids1136, ["solavagen"]);

  setTestState({ connections: null });
  const defaultKombi = visibleConnectionLines([
    { from: "Sæbø", to: "Leknes", departure: "08:15:00", arrival: "08:30:00" },
  ]).map((line) => line.id);
  assert.ok(defaultKombi.includes("oye"));

  setTestState({
    messages: {
      messages: [
        { isLocal: true, text: SMS, routeMode: "kombi", validTo: "2099-01-01T00:00:00Z" },
      ],
    },
  });
  const idsKombi = visibleConnectionLines(legsForDate(WEEKDAY)).map((line) => line.id);
  assert.ok(idsKombi.includes("oye"));
  assert.ok(idsKombi.includes("solavagen"));
});

test("?rute= verkar berre på /dev/ og localhost", () => {
  assert.equal(
    isPreview({ hostname: "localhost", pathname: "/", href: "http://localhost:8080/?rute=kombi" }),
    true
  );
  assert.equal(
    routeOverride({
      hostname: "localhost",
      pathname: "/",
      href: "http://localhost:8080/?rute=kombi",
    }),
    "kombi"
  );
  assert.equal(
    routeOverride({
      hostname: "teitrand.github.io",
      pathname: "/fergeruter/dev/",
      href: "https://teitrand.github.io/fergeruter/dev/?rute=1135",
    }),
    "1135"
  );
  assert.equal(
    routeOverride({
      hostname: "teitrand.github.io",
      pathname: "/fergeruter/",
      href: "https://teitrand.github.io/fergeruter/?rute=kombi",
    }),
    null
  );
});

test("quayPlace normaliserer Lekneset", () => {
  assert.equal(quayPlace("Lekneset ferjekai"), "Leknes");
});

test("kombirute finn ikkje opp tomflytting mellom overlappande rader", () => {
  setTestState({
    routes: ruter,
    kombirute: kombi,
    messages: {
      messages: [
        { isLocal: true, text: SMS, routeMode: "kombi", validTo: "2099-01-01T00:00:00Z" },
      ],
    },
  });
  const legs = legsForDate(WEEKDAY);
  const events = buildEvents(legs, null);
  assert.ok(legs.some((leg) => leg.to === "Leknes"));
  assert.ok(
    legs.some((a, i) => legs[i + 1] && a.to !== legs[i + 1].from),
    "tabellen har rader som ikkje heng saman geografisk"
  );
  assert.ok(events.every((event) => event.kind !== "transfer"));
  const status = ferryStatus(legs, 10 * 60 + 20, legs);
  assert.doesNotMatch(status?.text || "", /utan passasjerar/);
  assert.doesNotMatch(status?.short || "", /utan passasjerar/);
});
