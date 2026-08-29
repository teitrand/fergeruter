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
  nextArrivalAt,
  quayPlace,
  quaysInDay,
  resetTestState,
  routeModeFromMessages,
  routeOverride,
  setTestState,
  vesselFromText,
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

test("driftsmelding seier kva ferje som køyrer kombiruta", () => {
  assert.equal(vesselFromText("Ruta blir utført av MF Geiranger."), "Geiranger");
  assert.equal(vesselFromText("Ruta blir utført av M/F Kvernes"), "Kvernes");
  assert.equal(vesselFromText("M/F Geiranger og M/F Kvernes kan brukast."), null);
});

const FRAM_PDF_FROM = {
  weekday: {
    Sæbø: ["06:00", "06:30", "07:15", "08:15", "08:45", "09:15", "10:30", "11:15", "12:45", "13:45", "14:45", "15:15", "16:30", "17:00", "17:30", "18:30", "19:00", "20:30", "21:00", "22:15"],
    Leknes: ["06:15", "06:45", "07:30", "08:30", "09:00", "10:45", "11:30", "12:00", "13:00", "14:00", "15:00", "16:45", "17:15", "17:45", "18:45", "20:45", "21:15", "22:30"],
    Skår: ["11:45", "18:00"],
    Trandal: ["09:35", "10:05", "15:35", "16:05", "19:25", "20:05", "21:40"],
    Standal: ["09:50", "15:50", "19:45"],
  },
  saturday: {
    Sæbø: ["06:30", "07:00", "08:15", "08:45", "09:15", "10:30", "11:15", "12:45", "13:45", "14:45", "15:15", "16:30", "17:00", "17:30", "18:30", "19:00", "20:30", "21:00", "22:15"],
    Leknes: ["06:45", "08:30", "09:00", "10:45", "11:30", "12:00", "13:00", "14:00", "15:00", "16:45", "17:15", "17:45", "18:45", "20:45", "21:15", "22:30"],
    Skår: ["11:45", "18:00"],
    Trandal: ["07:25", "07:55", "09:35", "10:05", "15:35", "16:05", "19:35", "20:05", "21:40"],
    Standal: ["07:40", "09:50", "15:50", "19:50"],
  },
  sunday: {
    Sæbø: ["07:30", "08:15", "08:45", "09:15", "10:30", "11:15", "12:45", "13:45", "14:45", "15:15", "16:30", "17:30", "18:30", "19:30", "20:00", "21:30", "22:15"],
    Leknes: ["07:45", "08:30", "09:00", "10:45", "11:30", "12:00", "13:00", "14:00", "15:00", "16:45", "17:45", "18:45", "19:45", "21:15", "21:45", "22:30"],
    Skår: ["11:45", "19:00"],
    Trandal: ["09:35", "10:05", "15:35", "16:05", "20:20", "20:50"],
    Standal: ["09:50", "15:50", "20:35"],
  },
};

test("appen viser same Frå-tid som FRAM-PDF for kvardag, laurdag og søndag", () => {
  setTestState({
    routes: ruter,
    kombirute: kombi,
    messages: {
      messages: [{ isLocal: true, text: SMS, routeMode: "kombi", validTo: "2099-01-01T00:00:00Z" }],
    },
  });
  const dates = { weekday: WEEKDAY, saturday: "2026-08-29", sunday: "2026-08-30" };
  for (const [kind, iso] of Object.entries(dates)) {
    assert.equal(dayType(iso), kind);
    const legs = legsForDate(iso);
    for (const [quay, times] of Object.entries(FRAM_PDF_FROM[kind])) {
      const got = [
        ...new Set(
          legs.filter((leg) => leg.from === quay).map((leg) => leg.departure.slice(0, 5))
        ),
      ].sort();
      assert.deepEqual(got, times, `${kind} ${quay}`);
    }
    assert.ok(!legs.some((leg) => leg.from === "Standal" && leg.departure === "21:25:00"), kind);
    assert.ok(!legs.some((leg) => leg.from === "Standal" && kind === "weekday" && leg.departure === "19:50:00"));
  }
  const sunday = legsForDate(dates.sunday);
  assert.ok(sunday.some((leg) => leg.from === "Leknes" && leg.departure === "21:15:00"));
  assert.ok(!sunday.some((leg) => leg.from === "Sæbø" && leg.departure === "21:15:00"));
});

test("kombirute har éi hending per Frå-celle, ikkje ankomst same minutt", () => {
  setTestState({
    routes: ruter,
    kombirute: kombi,
    messages: {
      messages: [{ isLocal: true, text: SMS, routeMode: "kombi", validTo: "2099-01-01T00:00:00Z" }],
    },
  });
  const legs = legsForDate(WEEKDAY);
  const events = buildEvents(legs, null);
  const saebo1100 = events.filter(
    (event) => event.quays.includes("Sæbø") && event.at === 11 * 60
  );
  assert.deepEqual(saebo1100, []);
  const saebo1115 = events.filter(
    (event) => event.kind === "dep" && event.quays.includes("Sæbø") && event.at === 11 * 60 + 15
  );
  assert.equal(saebo1115.length, 1);
  assert.equal(
    legs.filter((leg) => leg.from === "Sæbø" && leg.departure === "11:15:00").length,
    1
  );
  const skar = events.filter((event) => event.quays?.includes("Skår") && event.at === 11 * 60 + 45);
  assert.deepEqual(
    skar.map((event) => event.kind),
    ["dep"]
  );
  const leknes = events.filter(
    (event) => event.quays?.includes("Leknes") && event.at === 6 * 60 + 15
  );
  assert.deepEqual(
    leknes.map((event) => event.kind),
    ["dep"]
  );
  const doubles = [];
  const byKey = new Map();
  for (const event of events) {
    const quay = event.quays?.[0];
    if (!quay || (event.kind !== "arr" && event.kind !== "dep")) continue;
    const key = `${quay}|${event.at}`;
    const prev = byKey.get(key);
    if (prev && prev !== event.kind) doubles.push(key);
    byKey.set(key, event.kind);
  }
  assert.deepEqual(doubles, []);
});

test("1136 merkar berre PDF-fotnote 1) og 3) som signal", () => {
  setTestState({ routes: ruter, kombirute: kombi, messages: { messages: [] } });
  const friday = legsForDate("2026-08-28");
  const standal0740 = friday.find((leg) => leg.from === "Standal" && leg.departure === "07:40:00");
  const saebo0835 = friday.find((leg) => leg.from === "Sæbø" && leg.departure === "08:35:00");
  const standal0645 = friday.find((leg) => leg.from === "Standal" && leg.departure === "06:45:00");
  assert.ok(standal0740);
  assert.equal(standal0740.signal, null);
  assert.ok(saebo0835?.signal);
  assert.equal(saebo0835.signal.minutesBefore, 60);
  assert.ok(standal0645?.signal);

  const saturday = legsForDate("2026-08-29");
  const satStandal = saturday.find((leg) => leg.from === "Standal" && leg.departure === "07:40:00");
  const satTrandal = saturday.find((leg) => leg.from === "Trandal" && leg.departure === "08:00:00");
  assert.equal(satStandal?.signal, null);
  assert.ok(satTrandal?.signal);

  const wednesday = legsForDate("2026-09-02");
  const valderoya = wednesday.find(
    (leg) => leg.from === "Valderøya" && leg.departure === "11:10:00"
  );
  assert.ok(valderoya?.signal);
  assert.equal(valderoya.signal.minutesBefore, 180);
});

test("1135 har inga PDF-fotnote og inga signalmerke", () => {
  setTestState({
    routes: ruter,
    kombirute: kombi,
    messages: {
      messages: [
        {
          isLocal: true,
          text: "Rute 1136 Standal-Trandal er innstilt inntil vidare.",
          routeMode: "1135",
          validTo: "2099-01-01T00:00:00Z",
        },
      ],
    },
  });
  const legs = legsForDate(WEEKDAY);
  assert.ok(legs.length > 0);
  assert.ok(legs.every((leg) => !leg.signal));
});

test("kombirute merkar berre PDF-fotnote 1) som signal", () => {
  setTestState({
    routes: ruter,
    kombirute: kombi,
    messages: {
      messages: [{ isLocal: true, text: SMS, routeMode: "kombi", validTo: "2099-01-01T00:00:00Z" }],
    },
  });
  const legs = legsForDate(WEEKDAY);
  const standal = legs.find((leg) => leg.from === "Standal" && leg.departure === "09:50:00");
  const trandal = legs.find((leg) => leg.from === "Trandal" && leg.departure === "10:05:00");
  assert.ok(standal);
  assert.equal(standal.signal, null);
  assert.ok(trandal?.signal);
  assert.ok(legs.find((leg) => leg.from === "Skår" && leg.departure === "11:45:00")?.signal);
  assert.ok(!legs.find((leg) => leg.from === "Sæbø" && leg.departure === "11:15:00" && leg.to === "Skår")?.signal);
});

test("kombirute er éi samanhengande rute utan tomflytting", () => {
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
    legs.every((a, i) => !legs[i + 1] || a.to === legs[i + 1].from),
    "neste Frå-celle er neste anløp"
  );
  assert.ok(events.every((event) => event.kind !== "transfer"));
  const stretch = events
    .filter((event) => event.at >= 10 * 60 + 45 && event.at <= 12 * 60 + 15)
    .map((event) => `${String(Math.floor(event.at / 60)).padStart(2, "0")}:${String(event.at % 60).padStart(2, "0")} ${event.kind} ${event.quays[0]}`);
  assert.deepEqual(stretch, [
    "10:45 dep Leknes",
    "11:15 dep Sæbø",
    "11:30 dep Leknes",
    "11:45 dep Skår",
    "12:00 dep Leknes",
  ]);
  const status = ferryStatus(legs, 10 * 60 + 20, legs);
  assert.doesNotMatch(status?.text || "", /utan passasjerar/);
  assert.doesNotMatch(status?.short || "", /utan passasjerar/);
});
