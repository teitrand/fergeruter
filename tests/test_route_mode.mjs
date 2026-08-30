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
  quayAtStart,
  switchFromText,
  switchOverride,
  setTestState,
  vesselFromText,
  visibleConnectionLines,
  readHideArrivals,
  showArrivals,
  writeHideArrivals,
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

function useKombi() {
  setTestState({
    routes: ruter,
    kombirute: kombi,
    messages: {
      messages: [{ isLocal: true, text: SMS, routeMode: "kombi", validTo: "2099-01-01T00:00:00Z" }],
    },
  });
}

function clockMin(time) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

function jsonFromKeys(kind) {
  return new Set(
    kombi.legs
      .filter((leg) => leg.days.includes(kind))
      .map((leg) => `${leg.from}|${clockMin(leg.departure)}`)
  );
}

const KOMBI_DATES = { weekday: WEEKDAY, saturday: "2026-08-29", sunday: "2026-08-30" };

test("kombirute har dei fem PDF-stoppa, ikkje 1136-kaiar", () => {
  useKombi();
  assert.equal(dayType(WEEKDAY), "weekday");
  const quays = quaysInDay(legsForDate(WEEKDAY));
  assert.ok(quays.includes("Leknes"));
  assert.ok(quays.includes("Sæbø"));
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

test("frå klokka skøyt to tabellar, kai kjem frå tabellen", () => {
  const text = "Kombirute vert utført frå klokka 08:15. 1135 og 1136 innstilt etter det.";
  assert.deepEqual(switchFromText(text), {
    time: "08:15:00",
    quay: null,
    before: "1136",
    after: "kombi",
    acute: null,
  });
  assert.equal(switchFromText(SMS), null);
  setTestState({
    routes: ruter,
    kombirute: kombi,
    date: WEEKDAY,
    messages: {
      messages: [
        {
          isLocal: true,
          text,
          routeMode: "kombi",
          routeSwitch: switchFromText(text),
          validTo: "2099-01-01T00:00:00Z",
        },
      ],
    },
  });
  assert.equal(quayAtStart("kombi", WEEKDAY, "08:15:00"), "Sæbø");
  const legs = legsForDate(WEEKDAY);
  assert.ok(legs.some((leg) => leg.table === "1136" && leg.departure === "07:40:00"));
  assert.ok(legs.every((leg) => !(leg.table === "1136" && leg.departure >= "08:15:00")));
  assert.ok(legs.every((leg) => !(leg.table === "kombi" && leg.departure < "08:15:00")));
  const start = legs.find(
    (leg) => leg.table === "kombi" && leg.from === "Sæbø" && leg.departure === "08:15:00"
  );
  assert.ok(start);
  assert.equal(start.to, "Leknes");
  const events = buildEvents(legs, null);
  const split = events.filter((event) => event.kind === "split");
  assert.equal(split.length, 1);
  assert.equal(split[0].at, 8 * 60 + 15);
  assert.ok(events.every((event) => event.kind !== "transfer"));
});

test("usikre avgangar er berre hol mellom melding og start", () => {
  const text = "Kombirute vert utført frå klokka 08:15.";
  setTestState({
    routes: ruter,
    kombirute: kombi,
    date: WEEKDAY,
    messages: {
      messages: [
        {
          isLocal: true,
          text,
          routeMode: "kombi",
          routeSwitch: switchFromText(text),
          publishedAt: "2026-08-28T07:00:00+02:00",
          validTo: "2099-01-01T00:00:00Z",
        },
      ],
    },
  });
  const legs = legsForDate(WEEKDAY);
  assert.ok(legs.some((leg) => leg.table === "1136" && leg.departure === "06:45:00"));
  assert.ok(legs.every((leg) => !(leg.table === "1136" && leg.departure > "07:00:00")));
  assert.ok(legs.every((leg) => !(leg.table === "kombi" && leg.departure < "08:15:00")));
  assert.ok(legs.some((leg) => leg.from === "Sæbø" && leg.departure === "08:15:00"));
  assert.equal(buildEvents(legs, null).filter((event) => event.kind === "split").length, 1);
});

test("melding dagen før gjev heile fyrste tabellen", () => {
  const text = "Kombirute vert utført frå klokka 08:15.";
  setTestState({
    routes: ruter,
    kombirute: kombi,
    date: WEEKDAY,
    messages: {
      messages: [
        {
          isLocal: true,
          text,
          routeMode: "kombi",
          routeSwitch: switchFromText(text),
          publishedAt: "2026-08-27T20:00:00+02:00",
          validTo: "2099-01-01T00:00:00Z",
        },
      ],
    },
  });
  const legs = legsForDate(WEEKDAY);
  assert.ok(legs.some((leg) => leg.table === "1136" && leg.departure === "07:40:00"));
});

test("?frå= på /dev/ set skøyt utan melding", () => {
  assert.deepEqual(
    switchOverride({
      hostname: "localhost",
      pathname: "/",
      href: "http://localhost:8080/?rute=kombi&frå=14:00&kai=Standal",
    }),
    { time: "14:00:00", quay: null, before: "1136", after: "kombi", notice: null, acute: null }
  );
  assert.equal(
    switchOverride({
      hostname: "teitrand.github.io",
      pathname: "/fergeruter/",
      href: "https://teitrand.github.io/fergeruter/?rute=kombi&frå=14:00",
    }),
    null
  );
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

test("appen viser same Frå-tid som kombirute-tabellen for alle daggrupper", () => {
  useKombi();
  for (const [kind, iso] of Object.entries(KOMBI_DATES)) {
    assert.equal(dayType(iso), kind);
    const legs = legsForDate(iso);
    const got = new Set(legs.map((leg) => `${leg.from}|${clockMin(leg.departure)}`));
    assert.deepEqual([...got].sort(), [...jsonFromKeys(kind)].sort(), kind);
  }
});

test("val kan skjule ankomsttider", () => {
  useKombi();
  const legs = legsForDate(WEEKDAY);
  assert.equal(showArrivals(), true);
  assert.ok(buildEvents(legs, null).some((event) => event.kind === "arr"));
  setTestState({ hideArrivals: true });
  assert.equal(showArrivals(), false);
  assert.ok(buildEvents(legs, null).every((event) => event.kind !== "arr"));
  assert.ok(buildEvents(legs, null).some((event) => event.kind === "dep"));
});

test("valet om ankomsttider vert hugsa", () => {
  const store = new Map();
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  assert.equal(readHideArrivals(storage), false);
  writeHideArrivals(true, storage);
  assert.equal(readHideArrivals(storage), true);
  writeHideArrivals(false, storage);
  assert.equal(readHideArrivals(storage), false);
});

test("kombirute viser alle ankomstar frå overfartstid", () => {
  useKombi();
  assert.equal(kombi.crossingMinutes["Leknes–Trandal"], 20);
  assert.equal(kombi.crossingMinutes["Trandal–Leknes"], 20);
  for (const [kind, iso] of Object.entries(KOMBI_DATES)) {
    const legs = legsForDate(iso);
    const events = buildEvents(legs, null);
    const fromKeys = jsonFromKeys(kind);
    const deps = events
      .filter((event) => event.kind === "dep")
      .map((event) => `${event.quays[0]}|${event.at}`);
    assert.deepEqual([...new Set(deps)].sort(), [...fromKeys].sort(), kind);
    const expectedArr = new Set(legs.map((leg) => `${leg.to}|${clockMin(leg.arrival)}`));
    const arrs = events
      .filter((event) => event.kind === "arr")
      .map((event) => `${event.quays[0]}|${event.at}`);
    assert.deepEqual([...new Set(arrs)].sort(), [...expectedArr].sort(), kind);
    for (const leg of legs) {
      const key = `${leg.from}–${leg.to}`;
      const sailing = kombi.crossingMinutes[key];
      assert.equal(typeof sailing, "number", key);
      assert.equal(clockMin(leg.arrival), (clockMin(leg.departure) + sailing) % (24 * 60), key);
    }
  }
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

function fromClockMap(legs) {
  const got = {};
  for (const leg of legs) {
    if (leg.hideDeparture) continue;
    const clock = `${leg.departure.slice(0, 2)}${leg.departure.slice(3, 5)}`;
    (got[leg.from] ||= []).push(clock);
  }
  for (const quay of Object.keys(got)) {
    got[quay] = [...new Set(got[quay])].sort().join(" ");
  }
  return got;
}

test("appen viser same Frå-tider som FRAM-PDF-ane", () => {
  const pdf1136 = {
    "2026-08-28": {
      Standal: "0645 0740 1310 1545 1845 2000",
      Trandal: "0705 0800 0945 1425 1515 1625 1810 1940 2020",
      Sæbø: "0835 0920 1450 1650 1745",
      Skår: "0855 1710",
    },
    "2026-09-02": {
      Standal: "0740 1440 1610",
      Trandal: "0800 1500 1550 1630",
      Sæbø: "0835 1525",
      Valderøya: "1110 1900",
      "Store Kalvøy": "1210 1925",
    },
    "2026-08-29": {
      Standal: "0740 1605 1845 2000",
      Trandal: "0800 0945 1625 1810 1940 2020",
      Sæbø: "0835 0920 1650 1745",
      Skår: "0855 1710",
      Valderøya: "1215",
      "Store Kalvøy": "1315",
    },
    "2026-08-30": {
      Standal: "0900 1000 1530 1655 2000 2040",
      Trandal: "0920 1020 1215 1550 1715 1900 2020 2100",
      Sæbø: "1050 1150 1750 1835",
      Skår: "1120 1815",
    },
  };
  setTestState({ routes: ruter, kombirute: kombi, messages: { messages: [] } });
  for (const [iso, expected] of Object.entries(pdf1136)) {
    assert.deepEqual(fromClockMap(legsForDate(iso)), expected, `1136 ${iso}`);
  }

  setTestState({
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
  assert.deepEqual(fromClockMap(legsForDate("2026-08-28")), {
    Sæbø: "0600 0630 0715 0815 0915 1030 1145 1245 1345 1445 1545 1630 1700 1730 1830 2000 2100 2215",
    Leknes: "0615 0645 0730 0830 0930 1045 1200 1300 1400 1500 1600 1645 1715 1745 1845 2015 2115 2230",
  });
  assert.deepEqual(fromClockMap(legsForDate("2026-09-05")), {
    Sæbø: "0630 0830 0900 1030 1145 1245 1345 1445 1545 1630 1730 1830 2030 2115 2215",
    Leknes: "0645 0845 0915 1045 1200 1300 1400 1500 1600 1645 1745 1845 2045 2130 2230",
  });

  useKombi();
  assert.deepEqual(fromClockMap(legsForDate(WEEKDAY)).Sæbø.split(" ").slice(0, 5), [
    "0600",
    "0630",
    "0715",
    "0815",
    "0845",
  ]);
  assert.ok(fromClockMap(legsForDate("2026-08-29")).Trandal.includes("0725"));
  assert.ok(fromClockMap(legsForDate("2026-08-30")).Skår.includes("1900"));
  assert.equal(fromClockMap(legsForDate("2026-08-30")).Leknes.includes("2115"), true);
});

test("kombirute merkar berre fotnote-celler som signal", () => {
  useKombi();
  for (const iso of Object.values(KOMBI_DATES)) {
    const legs = legsForDate(iso);
    assert.ok(legs.some((leg) => leg.signal));
    assert.ok(legs.some((leg) => !leg.signal));
    assert.ok(legs.filter((leg) => leg.signal).every((leg) => leg.requestStop));
    assert.equal(
      legs.filter((leg) => leg.from === "Sæbø" && leg.to === "Skår").length,
      0
    );
  }
});

test("kombirute er éi samanhengande rute utan tomflytting", () => {
  useKombi();
  for (const iso of Object.values(KOMBI_DATES)) {
    const legs = legsForDate(iso);
    const events = buildEvents(legs, null);
    assert.ok(legs.some((leg) => leg.to === "Leknes"));
    assert.ok(
      legs.every((a, i) => !legs[i + 1] || a.to === legs[i + 1].from),
      "neste Frå-celle er neste anløp"
    );
    assert.ok(events.every((event) => event.kind !== "transfer"));
    const mid = Math.floor(legs.length / 2);
    const status = ferryStatus(legs, clockMin(legs[mid].departure) - 10, legs);
    assert.doesNotMatch(status?.text || "", /utan passasjerar/);
    assert.doesNotMatch(status?.short || "", /utan passasjerar/);
  }
});
