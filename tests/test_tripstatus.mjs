// Einingstestar for tripStatus i packages/core. Ingen global tilstand: alt kjem frå `ev`.
// Køyrer òg via test_status.mjs, sidan arbeidsflyta listar testfilene ein og ein.
import assert from "node:assert/strict";
import test from "node:test";
import { departureStateKey, tripStatus } from "../packages/core/index.js";

const DAY = "2026-10-08";
const J = (n) => `MOR:ServiceJourney:1136_${n}_9150000046000000`;

function leg(from, to, departure, arrival, n, signal = true) {
  return {
    id: `${J(n)}#0`,
    from,
    to,
    departure,
    arrival,
    ...(signal ? { signal: { minutesBefore: 60, phone: "91 66 93 40" } } : {}),
  };
}

const out = leg("Standal", "Trandal", "14:00:00", "14:15:00", 1);
const back = leg("Trandal", "Standal", "18:00:00", "18:15:00", 2);
const regular = leg("Standal", "Trandal", "07:00:00", "07:15:00", 3, false);
const dayLegs = [regular, out, back];
const min = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Bevis utan noko: i dag, ingen logg, ingen sanntid. */
function evidence(partial = {}) {
  return {
    date: DAY,
    today: DAY,
    live: null,
    dayLegs,
    dateLegs: dayLegs,
    log: { days: {} },
    cancelledJourneys: new Set(),
    actualDepartures: new Map(),
    sailedJourneys: new Set(),
    confirmedBooked: new Set(),
    messageCancelled: new Set(),
    clockNow: min("15:00"),
    ...partial,
  };
}

function logged(entries, date = DAY) {
  return { days: { [date]: entries } };
}

function liveAt(stopName, atStop, extra = {}) {
  return {
    validUntil: "2099-01-01T00:00:00Z",
    recordedAt: "2026-10-08T12:30:00Z",
    journeyRef: J(1),
    stopName,
    atStop,
    ...extra,
  };
}

test("tripStatus: vanleg avgang etter rutetabellen", () => {
  const status = tripStatus(regular, evidence(), min("06:00"));
  assert.equal(status.kind, "regular");
  assert.equal(status.source, "timetable");
  assert.equal(status.signal, false);
  assert.equal(departureStateKey(status, { today: true }), "countdown");
});

test("tripStatus: vanleg avgang avlyst hos Entur eller i trafikkmelding", () => {
  const entur = tripStatus(regular, evidence({ cancelledJourneys: new Set([J(3)]) }), min("06:00"));
  assert.equal(entur.kind, "cancelled");
  assert.equal(entur.source, "entur");
  const message = tripStatus(regular, evidence({ messageCancelled: new Set(["Standal|07:00:00"]) }), min("06:00"));
  assert.equal(message.kind, "cancelled");
  assert.equal(message.source, "messages");
  assert.equal(departureStateKey(message, { today: true }), "cancelled");
});

test("tripStatus: open før fristen", () => {
  const status = tripStatus(out, evidence(), min("12:30"));
  assert.equal(status.kind, "open");
  assert.equal(status.deadline, min("13:00"));
  assert.equal(status.reason, "before-deadline");
  assert.equal(departureStateKey(status, { today: true }), "countdown");
});

test("tripStatus: ukjent etter fristen utan bevis, og «Ukjent» i staden for «Gått» etter avgang", () => {
  const before = tripStatus(out, evidence(), min("13:30"));
  assert.equal(before.kind, "unknown");
  assert.equal(before.source, null);
  assert.equal(departureStateKey(before, { today: true }), "countdown");
  const after = tripStatus(out, evidence(), min("14:30"));
  assert.equal(after.kind, "unknown");
  assert.equal(departureStateKey(after, { today: true, departed: true }), "unknown");
  assert.equal(departureStateKey(after, { today: true, past: true }), "unknown");
});

test("tripStatus: bevist gått frå signalloggen", () => {
  const ev = evidence({ log: logged([{ id: J(1), status: "gått", evidence: "departed", observedAt: "2026-10-08T14:20:00+02:00" }]) });
  const status = tripStatus(out, ev, min("14:30"));
  assert.equal(status.kind, "sailed");
  assert.equal(status.source, "log");
  assert.equal(status.at, "2026-10-08T14:20:00+02:00");
  assert.equal(departureStateKey(status, { today: true, departed: true }), "gone");
});

test("tripStatus: bevist gått i sanntid slår avlysing hos Entur", () => {
  const ev = evidence({ cancelledJourneys: new Set([J(1)]), sailedJourneys: new Set([J(1)]) });
  const status = tripStatus(out, ev, min("14:30"));
  assert.equal(status.kind, "sailed");
  assert.equal(status.source, "live");
  assert.equal(status.verdict, null);
});

test("tripStatus: bestilt når Entur har faktisk avgang, og appen blir beden om å hugse det", () => {
  const ev = evidence({ actualDepartures: new Map([[J(1), "2026-10-08T14:01:00+02:00"]]) });
  const status = tripStatus(out, ev, min("14:05"));
  assert.equal(status.kind, "booked");
  assert.equal(status.source, "entur");
  assert.equal(status.at, "2026-10-08T14:01:00+02:00");
  assert.deepEqual(status.remember, { id: J(1), booked: true });
});

test("tripStatus: bestilt frå loggen med avgangsbevis, òg ein tidlegare dag", () => {
  const entry = { id: J(1), status: "booked", evidence: "departed", observedAt: "2026-10-07T14:02:00+02:00" };
  const ev = evidence({ date: "2026-10-07", log: logged([entry], "2026-10-07") });
  const status = tripStatus(out, ev, min("20:00"));
  assert.equal(status.kind, "booked");
  assert.equal(status.source, "log");
  assert.equal(departureStateKey(status, { today: false }), "gone");
  // «booked» utan avgangsbevis er eit gammalt gjett og tel ikkje.
  const guess = evidence({ date: "2026-10-07", log: logged([{ ...entry, evidence: undefined }], "2026-10-07") });
  assert.equal(tripStatus(out, guess, min("20:00")).kind, "unknown");
});

test("tripStatus: bestilt fordi ferja har lagt frå kai i fersk sanntid", () => {
  const ev = evidence({ live: liveAt("Trandal", false, { actualDeparture: "2026-10-08T12:01:00Z" }) });
  const status = tripStatus(out, ev, min("14:05"));
  assert.equal(status.kind, "booked");
  assert.equal(status.source, "live");
  assert.equal(status.verdict, "running");
});

test("tripStatus: hugsar bestilt frå tidlegare i dag når beviset er borte", () => {
  const status = tripStatus(out, evidence({ confirmedBooked: new Set([J(1)]) }), min("14:30"));
  assert.equal(status.kind, "booked");
  assert.equal(status.source, "memory");
  assert.equal(status.remember, null);
});

test("tripStatus: utturen er tomtur for ein retur som gjekk, så han er ikkje bestilt", () => {
  const out2 = leg("Standal", "Trandal", "17:30:00", "17:45:00", 4);
  const legs = [out2, back];
  const ev = evidence({
    dayLegs: legs,
    dateLegs: legs,
    actualDepartures: new Map([[J(4), "2026-10-08T17:31:00+02:00"], [J(2), "2026-10-08T18:00:00+02:00"]]),
    confirmedBooked: new Set([J(4)]),
  });
  const status = tripStatus(out2, ev, min("18:30"));
  assert.equal(status.booked, false);
  assert.deepEqual(status.remember, { id: J(4), booked: false });
});

test("tripStatus: avlyst hos Entur er «ikkje utført»", () => {
  const status = tripStatus(out, evidence({ cancelledJourneys: new Set([J(1)]) }), min("13:30"));
  assert.equal(status.kind, "skipped");
  assert.equal(status.skipReason, "cancelled");
  assert.equal(status.source, "entur");
  assert.equal(status.seenSkip, true);
  assert.equal(departureStateKey(status, { today: true }), "notRunning");
});

test("tripStatus: avlysing slår avgangsbevis i loggen, men ikkje «gått»", () => {
  const booked = { id: J(1), status: "booked", evidence: "departed" };
  const ev = evidence({ cancelledJourneys: new Set([J(1)]), log: logged([booked]) });
  assert.equal(tripStatus(out, ev, min("14:30")).kind, "skipped");
  const gone = evidence({ cancelledJourneys: new Set([J(1)]), log: logged([{ ...booked, status: "gått" }]) });
  assert.equal(tripStatus(out, gone, min("14:30")).kind, "sailed");
});

test("tripStatus: logga avlyst ein tidlegare dag", () => {
  const entry = { id: J(1), status: "skipped", observedAt: "2026-10-07T13:07:00+02:00", skippedAt: "2026-10-07T13:01:00+02:00" };
  const ev = evidence({ date: "2026-10-07", log: logged([entry], "2026-10-07") });
  const status = tripStatus(out, ev, min("20:00"));
  assert.equal(status.kind, "skipped");
  assert.equal(status.source, "log");
  assert.equal(status.at, "2026-10-07T13:01:00+02:00");
  assert.equal(status.skippedAt, "2026-10-07T13:01:00+02:00");
});

test("tripStatus: bevist ikkje køyrd, ferja låg ved kai i fersk sanntid", () => {
  const ev = evidence({ live: liveAt("Standal", true) });
  const early = tripStatus(out, ev, min("14:10"));
  assert.equal(early.kind, "unknown", "innan slingringsmonnet kan ho berre vere forseinka");
  const status = tripStatus(out, ev, min("14:20"));
  assert.equal(status.kind, "skipped");
  assert.equal(status.skipReason, "live");
  assert.equal(status.source, "live");
  assert.equal(status.reason, "live-at-quay");
  assert.equal(status.at, "2026-10-08T12:30:00Z");
});

test("tripStatus: gammal sanntid er ikkje bevis", () => {
  const stale = { ...liveAt("Standal", true), validUntil: "2000-01-01T00:00:00Z", recordedAt: "2000-01-01T00:00:00Z" };
  assert.equal(tripStatus(out, evidence({ live: stale }), min("14:30")).kind, "unknown");
});

test("tripStatus: opts.live overstyrer berre slutninga om «ikkje utført»", () => {
  const ev = evidence({ live: liveAt("Standal", true) });
  assert.equal(tripStatus(out, ev, min("14:20"), { live: null }).kind, "unknown");
});

test("tripStatus endrar ikkje bevisa", () => {
  const ev = evidence({
    actualDepartures: new Map([[J(1), "2026-10-08T14:01:00+02:00"]]),
    confirmedBooked: new Set(),
  });
  tripStatus(out, ev, min("14:05"));
  assert.equal(ev.confirmedBooked.size, 0);
  assert.equal(ev.sailedJourneys.size, 0);
});
