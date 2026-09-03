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
  resolveRoutePlan,
  switchFromText,
  switchOverride,
  windowFromText,
  setTestState,
  vesselFromText,
  visibleConnectionLines,
  readHideArrivals,
  showArrivals,
  writeHideArrivals,
  TIMETABLE_CACHE_KEY,
  readCachedTimetable,
  timetableFingerprint,
  writeCachedTimetable,
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

test("datoar i meldinga styrer når kombiruta gjeld", () => {
  const kombiMsg = {
    isLocal: true,
    isRouteControl: true,
    heading: "Standal-Trandal",
    text: "Grunna verkstadopphald vert det køyrt kombinert rute frå 14.06 til 18.06.",
    routeMode: "kombi",
    routeWindow: { from: "2026-06-14", to: "2026-06-18" },
    publishedAt: "2026-06-12T09:00:00+02:00",
    validTo: "2026-06-30T21:59:00Z",
  };
  const normalMsg = {
    isLocal: true,
    isRouteControl: true,
    text: "Det vert normal drift i sambandet frå rutestart fredag 05.06.",
    routeMode: "1136",
    routeWindow: { from: "2026-06-05", to: null },
    publishedAt: "2026-06-04T22:40:00+02:00",
    validTo: "2026-06-30T21:59:00Z",
  };
  const messages = [kombiMsg, normalMsg];
  assert.deepEqual(windowFromText(kombiMsg.text, kombiMsg.publishedAt), {
    from: "2026-06-14",
    to: "2026-06-18",
  });
  assert.equal(
    routeModeFromMessages(messages, Date.parse("2026-06-12T10:00:00+02:00"), "2026-06-12"),
    "1136"
  );
  assert.equal(
    routeModeFromMessages(messages, Date.parse("2026-06-15T10:00:00+02:00"), "2026-06-15"),
    "kombi"
  );
  assert.equal(
    routeModeFromMessages(messages, Date.parse("2026-06-19T10:00:00+02:00"), "2026-06-19"),
    "1136"
  );
});

test("normal drift frå rutestart byter ikkje tabell dagen før", () => {
  const messages = [
    {
      isLocal: true,
      isRouteControl: true,
      text: "Det vert normal drift i sambandet frå rutestart fredag 05.06.",
      routeMode: "1136",
      routeWindow: { from: "2026-06-05", to: null },
      publishedAt: "2026-06-04T22:40:00+02:00",
      validTo: "2026-06-20T21:59:00Z",
    },
    {
      isLocal: true,
      isRouteControl: true,
      text: "Grunna verkstadopphald vert det køyrt kombinert rute.",
      routeMode: "kombi",
      publishedAt: "2026-06-03T12:00:00+02:00",
      validTo: "2026-06-20T21:59:00Z",
    },
  ];
  assert.equal(
    routeModeFromMessages(messages, Date.parse("2026-06-04T22:50:00+02:00"), "2026-06-04"),
    "kombi"
  );
  assert.equal(
    routeModeFromMessages(messages, Date.parse("2026-06-05T08:00:00+02:00"), "2026-06-05"),
    "1136"
  );
});

test("normal drift frå klokka skøyt mot førre modus same dag", () => {
  const messages = [
    {
      isLocal: true,
      isRouteControl: true,
      text: "Det vert normal drift i sambandet frå kl. 21:00.",
      routeMode: "1136",
      activateAt: "21:00:00",
      publishedAt: "2026-04-07T16:00:00+02:00",
      validTo: "2026-04-10T21:59:00Z",
    },
    {
      isLocal: true,
      isRouteControl: true,
      text: "Rute 1136 Standal-Trandal er innstilt inntil vidare.",
      routeMode: "1135",
      publishedAt: "2026-04-07T08:00:00+02:00",
      validTo: "2026-04-10T21:59:00Z",
    },
  ];
  const day = resolveRoutePlan(messages, Date.parse("2026-04-07T16:10:00+02:00"), "2026-04-07");
  assert.equal(day.mode, "1136");
  assert.deepEqual(day.switch, {
    time: "21:00:00",
    quay: null,
    before: "1135",
    after: "1136",
    acute: null,
  });
  const next = resolveRoutePlan(messages, Date.parse("2026-04-08T10:00:00+02:00"), "2026-04-08");
  assert.equal(next.mode, "1136");
  assert.equal(next.switch, null);
});

test("1049-melding styrer ikkje 1136-tabellen", () => {
  const messages = [
    {
      isLocal: true,
      isRouteControl: false,
      heading: "Hundeidvika – Festøya",
      text: "Rute 1049: innstilt frå kl. 10:30 til 13:25.",
      routeMode: "1136",
      publishedAt: "2026-05-20T08:00:00+02:00",
      validTo: "2026-05-21T21:59:00Z",
    },
    {
      isLocal: true,
      isRouteControl: true,
      text: "Grunna verkstadopphald vert det køyrt kombinert rute.",
      routeMode: "kombi",
      publishedAt: "2026-05-19T12:00:00+02:00",
      validTo: "2026-05-21T21:59:00Z",
    },
  ];
  assert.equal(
    routeModeFromMessages(messages, Date.parse("2026-05-20T11:00:00+02:00"), "2026-05-20"),
    "kombi"
  );
  assert.equal(switchFromText(messages[0].text), null);
});

test("normal drift frå klokka skøyt tabellen same dag", () => {
  setTestState({
    routes: ruter,
    kombirute: kombi,
    date: WEEKDAY,
    messages: {
      messages: [
        {
          isLocal: true,
          isRouteControl: true,
          text: "Det vert normal drift i sambandet frå kl. 14:00.",
          routeMode: "1136",
          activateAt: "14:00:00",
          publishedAt: `${WEEKDAY}T10:00:00+02:00`,
          validTo: "2099-01-01T00:00:00Z",
        },
        {
          isLocal: true,
          isRouteControl: true,
          text: "Rute 1136 Standal-Trandal er innstilt inntil vidare.",
          routeMode: "1135",
          publishedAt: `${WEEKDAY}T08:00:00+02:00`,
          validTo: "2099-01-01T00:00:00Z",
        },
      ],
    },
  });
  const legs = legsForDate(WEEKDAY);
  assert.ok(legs.some((leg) => leg.table === "1135" && leg.departure < "14:00:00"));
  assert.ok(legs.some((leg) => leg.table === "1136" && leg.departure >= "14:00:00"));
  assert.ok(legs.every((leg) => !(leg.table === "1136" && leg.departure < "14:00:00")));
  assert.ok(legs.every((leg) => !(leg.table === "1135" && leg.departure >= "14:00:00")));
});

test("enskild kansellert avgang skøyt ikkje til 1135", () => {
  assert.equal(
    switchFromText(
      "Rute 1136: Avgang kl. 14:25 frå Trandal blir kansellert. Normal drift frå kl. 14:50."
    ),
    null
  );
  const plan = resolveRoutePlan(
    [
      {
        isLocal: true,
        isRouteControl: true,
        text: "Rute 1136: Avgang kl. 14:25 frå Trandal blir kansellert. Normal drift frå kl. 14:50.",
        routeMode: "1136",
        activateAt: "14:50:00",
        publishedAt: "2026-04-23T09:00:00+02:00",
        validTo: "2026-04-24T21:59:00Z",
      },
    ],
    Date.parse("2026-04-23T10:00:00+02:00"),
    "2026-04-23"
  );
  assert.equal(plan.mode, "1136");
  assert.equal(plan.switch, null);
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

test("rutetabellen kan hentast frå lokal cache utan nett", () => {
  const store = new Map();
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  assert.equal(readCachedTimetable(storage), null);
  writeCachedTimetable({ routes: ruter, kombirute: kombi, connections: { fetchedAt: "2026-08-29" } }, storage);
  const cached = readCachedTimetable(storage);
  assert.equal(cached.routes.fetchedAt, ruter.fetchedAt);
  assert.equal(cached.kombirute.validFrom, kombi.validFrom);
  assert.equal(store.has(TIMETABLE_CACHE_KEY), true);
  assert.equal(
    timetableFingerprint(ruter, kombi, { fetchedAt: "2026-08-29" }),
    timetableFingerprint(cached.routes, cached.kombirute, cached.connections)
  );
  assert.notEqual(
    timetableFingerprint(ruter, kombi, { fetchedAt: "2026-08-29" }),
    timetableFingerprint({ ...ruter, fetchedAt: "2026-09-01T00:00:00Z" }, kombi, {
      fetchedAt: "2026-08-29",
    })
  );
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
