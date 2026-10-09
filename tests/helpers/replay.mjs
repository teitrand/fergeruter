// Avspeling av signalturane 2.–8. oktober 2026 mot ein versjon av appen.
// Brukt av tests/replay_tripstatus.mjs (gammal mot ny kode) og test_replay_tripstatus.mjs (fasit).
import { readFileSync } from "node:fs";

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));
export const LOG = fixture("signalturar_2026-10-02_08.json");
export const ROUTES = fixture("ruter.json");
export const VM_2030 = fixture("vm_2026-10-08_2030.json");
export const DAYS = Object.keys(LOG.days);

const RealDate = Date;
let fakeNow = RealDate.now();
class FakeDate extends RealDate {
  constructor(...args) {
    super(...(args.length ? args : [fakeNow]));
  }
  static now() {
    return fakeNow;
  }
}

/** Oslo-veggtid i oktober 2026 (sommartid, UTC+2) til epoke-ms. */
export function osloMs(day, minutes) {
  const [y, m, d] = day.split("-").map(Number);
  return RealDate.UTC(y, m - 1, d, 0, minutes) - 2 * 60 * 60 * 1000;
}

function osloMinutesOf(iso) {
  const ms = RealDate.parse(iso);
  const date = new RealDate(ms + 2 * 60 * 60 * 1000);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function shiftDay(day, n) {
  const date = new RealDate(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

const clockMin = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const hm = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Når loggen fyrst kunne ha sett oppføringa. */
function visibleFrom(entry) {
  const iso = entry.status === "skipped" ? entry.skippedAt || entry.observedAt : entry.observedAt;
  return iso ? osloMinutesOf(iso) : 0;
}

function times(legs, step, deltas) {
  const set = new Set();
  for (let now = 5 * 60; now < 24 * 60; now += step) set.add(now);
  for (const leg of legs.filter((item) => item.signal)) {
    const dep = clockMin(leg.departure);
    for (const delta of deltas) {
      if (dep + delta >= 0 && dep + delta < 24 * 60) set.add(dep + delta);
    }
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Køyrer alle scenaria mot `app` (modulen assets/app.js). `rowKey(app, leg, ctx)` gjev
 * kva kolonna til høgre på rada seier. Returnerer éi rad per avgang, tidspunkt og scenario.
 */
export const FULL_DELTAS = [-61, -60, -1, 0, 1, 5, 14, 15, 16, 30, 90];

export function runReplay(app, rowKey, { step = 10, deltas = FULL_DELTAS } = {}) {
  const records = [];
  globalThis.Date = FakeDate;
  try {
    const setup = (partial) => {
      app.resetTestState();
      app.setTestState({ routes: ROUTES, kombirute: null, messages: null, routeChoice: "1136", ...partial });
    };
    const sample = (scenario, day, now, today) => {
      const legs = app.legsForDate(day);
      for (const leg of legs) {
        const detail = app.departureDetail(leg);
        const verdict = app.signalVerdict(leg);
        const fields = {
          detail,
          verdict,
          booked: app.signalIsBooked(leg),
          sailed: app.signalSailed(leg),
          atQuay: app.signalObservedAtQuay(leg),
          cancelled: app.isCancelledDeparture(leg),
        };
        const doneAt = verdict === "skipped" ? clockMin(leg.departure) : clockMin(leg.arrival || leg.departure);
        const ctx = {
          today,
          past: today && doneAt <= now,
          departed: today && now >= clockMin(leg.departure),
        };
        fields.row = rowKey(app, leg, ctx, fields);
        records.push({ scenario, day, at: hm(now), leg: `${hm(clockMin(leg.departure))} ${leg.from}–${leg.to}`, signal: Boolean(leg.signal), fields });
      }
      if (today) {
        const status = app.currentStatus(legs);
        records.push({ scenario, day, at: hm(now), leg: "(statuslinja)", signal: false, fields: { status: status ? { at: status.at, text: status.text, short: status.short ?? null } : null } });
      }
    };
    for (const day of DAYS) {
      const entries = LOG.days[day];
      const dayLegs = ROUTES.lines["1136"].legs.filter((leg) => (leg.activeDates || []).includes(day));
      for (const withDepartures of [false, true]) {
        const scenario = withDepartures ? "i dag, logg og faktisk avgang" : "i dag, berre logg";
        setup({});
        for (const now of times(dayLegs, step, deltas)) {
          fakeNow = osloMs(day, now);
          const seen = entries.filter((entry) => visibleFrom(entry) <= now);
          const departed = seen.filter((entry) => entry.evidence === "departed" && (entry.status === "booked" || entry.status === "gått"));
          // Same tilstand som appen hadde hatt: loggen så langt og det Entur hadde sagt.
          app.setTestState({
            date: null,
            signalLog: { days: { [day]: seen } },
            cancelledJourneys: new Set(seen.filter((entry) => entry.status === "skipped").map((entry) => entry.id)),
            actualDepartures: new Map(withDepartures ? departed.map((entry) => [entry.id, entry.observedAt]) : []),
            live: null,
          });
          sample(scenario, day, now, true);
        }
      }
      // Dagen etter: sjå tilbake på heile dagen.
      setup({ date: day, signalLog: { days: { [day]: entries } }, cancelledJourneys: new Set(), live: null });
      fakeNow = osloMs(shiftDay(day, 1), 12 * 60);
      sample("dagen etter", day, 12 * 60, false);
    }
    // Ekte sanntid 8. oktober kl. 20:30 (20:20 Trandal–Standal på veg, avlyst hos Entur).
    const day = "2026-10-08";
    const live = { ...app.parseVehicleMonitoring(VM_2030), validUntil: "2099-01-01T00:00:00Z" };
    setup({});
    for (let now = 19 * 60; now <= 22 * 60; now += 5) {
      fakeNow = osloMs(day, now);
      const seen = LOG.days[day].filter((entry) => visibleFrom(entry) <= now);
      app.setTestState({
        date: null,
        signalLog: { days: { [day]: seen } },
        cancelledJourneys: new Set(["MOR:ServiceJourney:1136_115_9150000046319142"]),
        live,
      });
      sample("8. okt. med sanntid 20:30", day, now, true);
    }
  } finally {
    globalThis.Date = RealDate;
  }
  return records;
}

/** Same formel som departureRow i den gamle appen (v79/v80). */
export function legacyRowKey(app, leg, { past, departed, today }, fields) {
  if (fields.cancelled) return "cancelled";
  if (fields.verdict === "skipped") return "notRunning";
  const booked = Boolean(leg.signal) && fields.verdict !== "skipped" && fields.booked;
  if (fields.sailed || (!today && booked) || past || departed) return "gone";
  return today ? "countdown" : "";
}

/**
 * Den gamle koden sette detaljfasen til «unknown» når ein tomtur hadde avgangsbevis.
 * tripStatus seier «sailed» der, med beviset. Rada var og er «Gått».
 */
function provenSailed(a, b) {
  if (a.detail?.phase !== "unknown" || b.detail?.phase !== "sailed") return false;
  const strip = ({ row, detail, ...rest }) => JSON.stringify({ ...rest, detail: { ...detail, phase: null } });
  return strip(a) === strip(b) && a.row === b.row;
}

/**
 * Samanliknar to køyringar. Lovlege skilnader: «Gått» blir «Ukjent» på rada (`unknown`),
 * og tomtur med avgangsbevis blir «sailed» i detaljvindauget (`proven`).
 */
export function compareReplays(oldRecords, newRecords) {
  if (oldRecords.length !== newRecords.length) throw new Error(`ulikt tal rader: ${oldRecords.length} mot ${newRecords.length}`);
  const unknown = [];
  const proven = [];
  const other = [];
  for (let i = 0; i < oldRecords.length; i += 1) {
    const a = oldRecords[i];
    const b = newRecords[i];
    const where = `${a.scenario} | ${a.day} kl. ${a.at} | ${a.leg}`;
    if (a.leg !== b.leg || a.at !== b.at) throw new Error(`rader i ulik rekkjefølgje ved ${where}`);
    const { row: rowA, ...restA } = a.fields;
    const { row: rowB, ...restB } = b.fields;
    const same = JSON.stringify(restA) === JSON.stringify(restB);
    if (same && rowA === rowB) continue;
    if (same && rowA === "gone" && rowB === "unknown" && b.fields.detail?.phase === "unknown") {
      unknown.push({ where, record: b });
    } else if (provenSailed(a.fields, b.fields)) {
      proven.push({ where, record: b });
    } else {
      other.push({ where, old: a.fields, new: b.fields });
    }
  }
  return { compared: oldRecords.length, unknown, proven, other };
}

/** Grovare rutenett for fasiten i CI: kvar time og rundt kvar signaltur. */
export const GOLDEN_GRID = { step: 60, deltas: [-1, 0, 15, 16, 90] };

/** Pakkar radene: kvar ulik verdi éin gong, og berre tidspunkta der ei avgang endrar seg. */
export function packGolden(records, ref) {
  const codes = [];
  const index = new Map();
  const rows = {};
  for (const record of records) {
    const code = JSON.stringify(record.fields);
    if (!index.has(code)) {
      index.set(code, codes.length);
      codes.push(record.fields);
    }
    const key = `${record.scenario}|${record.day}|${record.leg}`;
    const list = (rows[key] ||= []);
    const at = index.get(code);
    if (!list.length || list[list.length - 1][1] !== at) list.push([record.at, at]);
  }
  return {
    _comment: `Fasit frå ${ref} for avspelinga 2.–8. oktober 2026. Lag på nytt: node tests/replay_tripstatus.mjs --golden`,
    grid: GOLDEN_GRID,
    count: records.length,
    codes,
    rows,
  };
}

/** Pakkar ut fasiten til éi rad per avgang og tidspunkt, i same rekkjefølgje som runReplay. */
export function unpackGolden(golden, records) {
  const cursor = {};
  return records.map((record) => {
    const key = `${record.scenario}|${record.day}|${record.leg}`;
    const list = golden.rows[key];
    if (!list) throw new Error(`fasiten manglar ${key}`);
    let i = cursor[key] ?? 0;
    while (i + 1 < list.length && list[i + 1][0] <= record.at) i += 1;
    cursor[key] = i;
    return { ...record, fields: golden.codes[list[i][1]] };
  });
}
