import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  buildEvents,
  compareTimelineEvents,
  delayMinutes,
  emptyPlaceMessage,
  ferryStatus,
  statusProgress,
  homeQuay,
  isLiveFresh,
  keepTimelineEvent,
  layoverAfter,
  liveBlockedUntil,
  liveFetchUrls,
  liveStatus,
  matchesLegPlaces,
  matchesStop,
  minDeadheadMinutes,
  nextArrivalAt,
  excerptText,
  headingDay,
  messageRouteScore,
  sortMessagesForRoute,
  swapPlaceFilters,
  todayIso,
  noteLiveFailure,
  parseVehicleMonitoring,
  pastDepartureCount,
  quayPlace,
  resetTestState,
  setTestState,
  shouldFetchLive,
  serviceWindowMinutes,
} from "../assets/app.js";
import { setLang } from "../assets/i18n.js?v=49";

beforeEach(() => {
  setLang("nn");
  resetTestState();
});

function leg(from, to, departure, arrival, dates = ["2026-08-26"]) {
  return { from, to, departure, arrival, activeDates: dates };
}

const wednesday = [
  leg("Standal", "Trandal", "07:40:00", "07:55:00"),
  leg("Trandal", "Sæbø", "08:00:00", "08:30:00"),
  leg("Sæbø", "Trandal", "08:35:00", "08:55:00"),
  leg("Valderøya", "Store Kalvøy", "11:10:00", "11:30:00"),
  leg("Store Kalvøy", "Valderøya", "12:10:00", "12:30:00"),
  leg("Standal", "Trandal", "14:40:00", "14:55:00"),
  leg("Trandal", "Sæbø", "15:00:00", "15:25:00"),
  leg("Sæbø", "Trandal", "15:25:00", "15:45:00"),
  leg("Trandal", "Standal", "15:50:00", "16:05:00"),
  leg("Standal", "Trandal", "16:10:00", "16:25:00"),
  leg("Trandal", "Standal", "16:30:00", "16:45:00"),
  leg("Valderøya", "Store Kalvøy", "19:00:00", "19:20:00"),
  leg("Store Kalvøy", "Valderøya", "19:25:00", "19:45:00"),
];

const weekdayHome = [
  leg("Standal", "Trandal", "06:45:00", "07:00:00", ["2026-08-25"]),
  leg("Trandal", "Standal", "20:20:00", "20:35:00", ["2026-08-25"]),
];

test("heimkaia er fyrste avgang", () => {
  assert.equal(homeQuay(wednesday), "Standal");
});

test("kortaste hol Valderøya–Standal er 130 min", () => {
  assert.equal(minDeadheadMinutes(wednesday, "Valderøya", "Standal"), 130);
});

test("før fyrste avgang ligg ferja på Standal", () => {
  const status = ferryStatus(wednesday, 7 * 60 + 10, wednesday);
  assert.equal(status.short, "Ferja ligg til kai på Standal");
  assert.equal(status.underway, undefined);
});

test("på veg i ein passasjertur", () => {
  const status = ferryStatus(wednesday, 7 * 60 + 45, wednesday);
  assert.equal(status.text, "Ferja er på veg mot Trandal");
  assert.equal(status.underway, true);
  assert.equal(status.from, 7 * 60 + 40);
  assert.equal(status.until, 7 * 60 + 55);
  assert.equal(status.progress, 5 / 15);
});

test("NO-status fyller tida mellom stopp, òg i liggetid og kort kai-opphald", () => {
  assert.equal(statusProgress(10, 20, 15), 0.5);
  assert.equal(statusProgress(10, 20, 8), 0);
  assert.equal(statusProgress(10, 20, 30), 1);
  assert.equal(statusProgress(10, 10, 10), null);
  const wait = ferryStatus(wednesday, 7 * 60 + 57, wednesday);
  assert.equal(wait.underway, undefined);
  assert.equal(wait.progress, 2 / 5);
  const stay = ferryStatus(wednesday, 11 * 60 + 50, wednesday);
  assert.equal(stay.layover, true);
  assert.equal(stay.progress, 0.5);
  const before = ferryStatus(wednesday, 7 * 60 + 10, wednesday);
  assert.equal(before.progress, undefined);
  const done = ferryStatus(weekdayHome, 21 * 60, weekdayHome);
  assert.equal(done.progress, undefined);
});

test("etter siste passasjertur til Valderøya går ho heim utan folk", () => {
  const status = ferryStatus(wednesday, 19 * 60 + 50, wednesday);
  assert.match(status.short, /tilbake til Standal/);
  assert.match(status.text, /Valderøya/);
  assert.equal(status.underway, true);
  assert.doesNotMatch(status.text, /ferdig for dagen på Valderøya/);
});

test("etter hol tilsvarande dagsforflyttinga ligg ho på Standal", () => {
  const status = ferryStatus(wednesday, 21 * 60 + 55, wednesday);
  assert.equal(status.short, "Ferja ligg til kai på Standal");
  assert.match(status.text, /Standal/);
  assert.doesNotMatch(status.text, /Valderøya/);
});

test("dagar der siste anløp er Standal seier ferdig der", () => {
  const status = ferryStatus(weekdayHome, 21 * 60, weekdayHome);
  assert.equal(status.short, "Ferja er ferdig for dagen på Standal");
  assert.equal(status.text, "Ferja er ferdig for dagen på Standal.");
});

test("utan hol i tabellen finn vi ikkje opp ei klokkeslett", () => {
  const onlyEvening = [
    leg("Standal", "Trandal", "07:40:00", "07:55:00"),
    leg("Store Kalvøy", "Valderøya", "19:25:00", "19:45:00"),
  ];
  const status = ferryStatus(onlyEvening, 20 * 60, onlyEvening);
  assert.match(status.text, /over natta/);
  assert.doesNotMatch(status.text, /ferdig for dagen på Valderøya/);
});

test("quayPlace strippar ferjekai", () => {
  assert.equal(quayPlace("Valderøya ferjekai"), "Valderøya");
  assert.equal(quayPlace("Standal"), "Standal");
  assert.equal(quayPlace("Lekneset ferjekai"), "Leknes");
});

test("delayMinutes les ISO-varigheit og sekund", () => {
  assert.equal(delayMinutes("PT2M"), 2);
  assert.equal(delayMinutes("PT1H5M"), 65);
  assert.equal(delayMinutes(120), 2);
  assert.equal(delayMinutes("PT0S"), 0);
});

test("parseVehicleMonitoring tom levering", () => {
  assert.equal(
    parseVehicleMonitoring({
      Siri: { ServiceDelivery: { VehicleMonitoringDelivery: [{ version: "2.0" }] } },
    }),
    null
  );
});

test("parseVehicleMonitoring les destinasjon og posisjon", () => {
  const live = parseVehicleMonitoring({
    Siri: {
      ServiceDelivery: {
        VehicleMonitoringDelivery: [
          {
            VehicleActivity: {
              ValidUntilTime: "2026-08-26T23:10:00+02:00",
              RecordedAtTime: "2026-08-26T23:08:00+02:00",
              MonitoredVehicleJourney: {
                DestinationName: [{ value: "Standal ferjekai" }],
                Delay: "PT3M",
                VehicleLocation: { Latitude: 62.3, Longitude: 6.4 },
              },
            },
          },
        ],
      },
    },
  });
  assert.equal(live.destination, "Standal");
  assert.equal(live.delayMinutes, 3);
  assert.equal(live.latitude, 62.3);
});

test("parseVehicleMonitoring kuttar destinasjonslista til neste kai", () => {
  const live = parseVehicleMonitoring({
    Siri: {
      ServiceDelivery: {
        VehicleMonitoringDelivery: [
          {
            VehicleActivity: {
              ValidUntilTime: "2099-01-01T00:00:00Z",
              MonitoredVehicleJourney: {
                DestinationName: [{ value: "Sæbø Trandal Standal" }],
                Delay: "PT1M",
                VehicleLocation: { Latitude: 62.2, Longitude: 6.5 },
              },
            },
          },
        ],
      },
    },
  });
  assert.equal(live.destination, "Sæbø");
  assert.equal(live.delayMinutes, 1);
});

test("liveStatus krev fersk data", () => {
  assert.equal(isLiveFresh(null), false);
  assert.equal(isLiveFresh({ validUntil: "2000-01-01T00:00:00Z" }), false);
  const live = {
    destination: "Trandal",
    delayMinutes: 2,
    validUntil: "2099-01-01T00:00:00Z",
  };
  assert.equal(isLiveFresh(live), true);
  const status = liveStatus({
    destination: "Sæbø Trandal Standal",
    delayMinutes: 1,
    validUntil: "2099-01-01T00:00:00Z",
  });
  assert.equal(
    status.text,
    "Ferja er på veg mot Sæbø, om lag 1 min forsinka (sanntid frå Entur)."
  );
  assert.doesNotMatch(status.text, /Sæbø Trandal Standal/);
});

test("segling viser destinasjon og båe kaier, utan eiga ankomst-rad", () => {
  const events = buildEvents(wednesday, null);
  assert.ok(events.every((event) => event.kind !== "arr"));
  const first = events.find((event) => event.kind === "dep");
  assert.deepEqual(first.quays, ["Standal", "Trandal"]);
  assert.equal(first.leg.to, "Trandal");
  assert.equal(first.at, 7 * 60 + 40);
});

test("ved valt frå-stad står berre avgangar derifrå, ikkje dempa innkomst", () => {
  setTestState({ fromFilter: "Sæbø" });
  const events = buildEvents(wednesday, null);
  assert.ok(events.every((event) => event.kind !== "arr"));
  const outbound = events.find(
    (event) => event.kind === "dep" && event.leg.from === "Sæbø" && event.leg.to === "Trandal"
  );
  const inboundAsDep = events.find(
    (event) => event.kind === "dep" && event.leg.from === "Trandal" && event.leg.to === "Sæbø"
  );
  assert.equal(outbound.at, 8 * 60 + 35);
  assert.equal(inboundAsDep, undefined);
  assert.ok(events.filter((event) => event.kind === "dep").every((event) => event.leg.from === "Sæbø"));
});

test("til-stad viser alle turar som endar der", () => {
  setTestState({ toFilter: "Trandal" });
  const events = buildEvents(wednesday, null).filter((event) => event.kind === "dep");
  assert.ok(events.length > 1);
  assert.ok(events.every((event) => event.leg.to === "Trandal"));
  assert.ok(events.some((event) => event.leg.from === "Standal"));
  assert.ok(events.some((event) => event.leg.from === "Sæbø"));
  assert.equal(
    events.find((event) => event.leg.from === "Trandal"),
    undefined
  );
});

test("frå og til saman viser berre den strekninga", () => {
  setTestState({ fromFilter: "Standal", toFilter: "Trandal" });
  const events = buildEvents(wednesday, null).filter((event) => event.kind === "dep");
  assert.ok(events.length >= 1);
  assert.ok(events.every((event) => event.leg.from === "Standal" && event.leg.to === "Trandal"));
});

test("frå og til følgjer mellomstopp på same ferje", () => {
  const legs = [
    leg("Sæbø", "Skår", "08:35:00", "08:55:00"),
    leg("Skår", "Sæbø", "08:55:00", "09:15:00"),
    leg("Sæbø", "Trandal", "09:20:00", "09:45:00"),
    leg("Trandal", "Standal", "09:45:00", "10:00:00"),
  ];
  setTestState({ fromFilter: "Skår", toFilter: "Standal" });
  const events = buildEvents(legs, null).filter((event) => event.kind === "dep");
  assert.deepEqual(
    events.map((event) => `${event.leg.from}→${event.leg.to}`),
    ["Skår→Sæbø", "Sæbø→Trandal", "Trandal→Standal"]
  );
});

test("frå Sæbø til Standal hoppar over Skår-vendinga", () => {
  const legs = [
    leg("Sæbø", "Skår", "08:35:00", "08:55:00"),
    leg("Skår", "Sæbø", "08:55:00", "09:15:00"),
    leg("Sæbø", "Trandal", "09:20:00", "09:45:00"),
    leg("Trandal", "Standal", "09:45:00", "10:00:00"),
  ];
  setTestState({ fromFilter: "Sæbø", toFilter: "Standal" });
  const events = buildEvents(legs, null).filter((event) => event.kind === "dep");
  assert.equal(events[0].leg.from, "Sæbø");
  assert.equal(events[0].leg.to, "Trandal");
  assert.equal(events[0].leg.departure, "09:20:00");
  assert.ok(events.every((event) => event.leg.from !== "Skår"));
});

test("Sæbø-pendel blir ventetid, ikkje eigne avgongar", () => {
  const legs = [
    leg("Standal", "Trandal", "15:50:00", "16:05:00"),
    leg("Trandal", "Sæbø", "16:05:00", "16:25:00"),
    leg("Sæbø", "Leknes", "16:30:00", "16:45:00"),
    leg("Leknes", "Sæbø", "16:45:00", "17:00:00"),
    leg("Sæbø", "Leknes", "17:00:00", "17:15:00"),
    leg("Leknes", "Sæbø", "17:15:00", "17:30:00"),
    leg("Sæbø", "Leknes", "17:30:00", "17:45:00"),
    leg("Leknes", "Skår", "17:45:00", "18:00:00"),
  ];
  setTestState({ fromFilter: "Standal", toFilter: "Skår" });
  const events = buildEvents(legs, null).filter((event) => matchesStop(event));
  assert.deepEqual(
    events.filter((event) => event.kind === "dep").map((event) => `${event.leg.from}→${event.leg.to}`),
    ["Standal→Trandal", "Trandal→Sæbø", "Sæbø→Leknes", "Leknes→Skår"]
  );
  const wait = events.find((event) => event.kind === "wait");
  assert.ok(wait);
  assert.equal(wait.stay.quay, "Sæbø");
  assert.equal(wait.stay.minutes, 65);
  assert.equal(wait.stay.from, "16:25:00");
  assert.equal(wait.stay.until, "17:30:00");
  assert.ok(events.every((event) => event.leg?.from !== "Leknes" || event.leg.to === "Skår"));
});

test("ferjeskifte på Sæbø får ventetid mellom tabellane", () => {
  const legs = [
    { ...leg("Leknes", "Sæbø", "08:30:00", "08:43:00"), table: "1135" },
    { ...leg("Sæbø", "Leknes", "08:50:00", "09:03:00"), table: "1135" },
    { ...leg("Sæbø", "Trandal", "09:20:00", "09:45:00"), table: "1136" },
    { ...leg("Trandal", "Standal", "09:45:00", "10:00:00"), table: "1136" },
  ];
  setTestState({ fromFilter: "Leknes", toFilter: "Standal" });
  const events = buildEvents(legs, null).filter((event) => matchesStop(event));
  assert.deepEqual(
    events.filter((event) => event.kind === "dep").map((event) => `${event.leg.from}→${event.leg.to}`),
    ["Leknes→Sæbø", "Sæbø→Trandal", "Trandal→Standal"]
  );
  const wait = events.find((event) => event.kind === "wait");
  assert.ok(wait);
  assert.equal(wait.stay.quay, "Sæbø");
  assert.equal(wait.stay.minutes, 37);
});

test("frå-til-reise viser ikkje tabellskifte mellom ferjene", () => {
  const legs = [
    { ...leg("Skår", "Sæbø", "08:55:00", "09:15:00"), table: "1136" },
    { ...leg("Leknes", "Sæbø", "09:00:00", "09:13:00"), table: "1135" },
    { ...leg("Sæbø", "Trandal", "09:20:00", "09:45:00"), table: "1136" },
    { ...leg("Trandal", "Standal", "09:45:00", "10:00:00"), table: "1136" },
  ];
  setTestState({ fromFilter: "Skår", toFilter: "Standal" });
  const events = buildEvents(legs, null).filter((event) => matchesStop(event));
  assert.ok(events.every((event) => event.kind === "dep"));
  assert.ok(events.some((event) => event.leg.from === "Skår"));
  assert.ok(events.some((event) => event.leg.to === "Standal"));
});

test("berre til-filter viser ikkje skifte-banner mellom 1135 og 1136", () => {
  const legs = [
    { ...leg("Sæbø", "Leknes", "06:30:00", "06:43:00"), table: "1135" },
    { ...leg("Standal", "Trandal", "07:40:00", "07:55:00"), table: "1136" },
    { ...leg("Sæbø", "Leknes", "08:30:00", "08:43:00"), table: "1135" },
    { ...leg("Sæbø", "Trandal", "08:35:00", "08:55:00"), table: "1136" },
    { ...leg("Skår", "Sæbø", "08:55:00", "09:15:00"), table: "1136" },
  ];
  setTestState({ toFilter: "Trandal" });
  const built = buildEvents(legs, null);
  assert.equal(
    built.filter((event) => event.kind === "split").length,
    0,
    "1135 og 1136 skal ikkje skape tabellskifte når dei berre er fletta for filteret"
  );
  const events = built.filter((event) => matchesStop(event));
  assert.ok(events.every((event) => event.kind !== "split"));
  assert.deepEqual(
    events.filter((event) => event.kind === "dep").map((event) => `${event.leg.from}→${event.leg.to}`),
    ["Standal→Trandal", "Sæbø→Trandal"]
  );
});

test("byte frå og til snur filteret", () => {
  setTestState({ fromFilter: "Trandal", toFilter: null });
  swapPlaceFilters();
  const toTrandal = buildEvents(wednesday, null).filter((event) => event.kind === "dep");
  assert.ok(toTrandal.length > 0);
  assert.ok(toTrandal.every((event) => event.leg.to === "Trandal"));
  assert.ok(toTrandal.every((event) => matchesLegPlaces(event.leg)));
  setTestState({ fromFilter: "Standal", toFilter: "Trandal" });
  swapPlaceFilters();
  const swapped = buildEvents(wednesday, null).filter((event) => event.kind === "dep");
  assert.ok(swapped.length > 0);
  assert.ok(swapped.every((event) => event.leg.from === "Trandal" && event.leg.to === "Standal"));
});

test("tomt frå-til-val får eiga melding", () => {
  setTestState({ fromFilter: "Trandal", toFilter: "Store Kalvøy" });
  assert.equal(emptyPlaceMessage(), "Ingen turar frå Trandal til Store Kalvøy denne dagen.");
  setTestState({ fromFilter: null, toFilter: "Trandal" });
  assert.equal(emptyPlaceMessage(), "Ingen turar til Trandal denne dagen.");
  setTestState({ fromFilter: "Standal", toFilter: null });
  assert.equal(emptyPlaceMessage(), "Ingen turar frå Standal denne dagen.");
});

test("kort vending er ikkje liggetid, lengre opphald er", () => {
  assert.equal(
    layoverAfter(
      leg("Leknes", "Sæbø", "13:00:00", "13:13:00"),
      leg("Sæbø", "Leknes", "13:15:00", "13:28:00")
    ),
    null
  );
  assert.equal(
    layoverAfter(
      leg("Leknes", "Sæbø", "13:00:00", "13:13:00"),
      leg("Sæbø", "Leknes", "13:32:00", "13:45:00")
    ),
    null
  );
  const stay = layoverAfter(
    leg("Leknes", "Sæbø", "13:00:00", "13:13:00"),
    leg("Sæbø", "Leknes", "13:33:00", "13:46:00")
  );
  assert.equal(stay.quay, "Sæbø");
  assert.equal(stay.minutes, 20);
  assert.equal(
    layoverAfter(
      leg("Valderøya", "Store Kalvøy", "11:10:00", "11:30:00"),
      leg("Standal", "Trandal", "14:40:00", "14:55:00")
    ),
    null
  );
});

test("tabellen merkar liggetid ved matpause, ikkje innkomst-rad", () => {
  const legs = [
    leg("Sæbø", "Leknes", "09:00:00", "09:13:00"),
    leg("Leknes", "Sæbø", "09:15:00", "09:28:00"),
    leg("Sæbø", "Leknes", "10:30:00", "10:43:00"),
  ];
  const events = buildEvents(legs, null);
  assert.ok(events.every((event) => event.kind !== "arr"));
  const stay = events.find((event) => event.kind === "layover");
  assert.ok(stay);
  assert.equal(stay.quays[0], "Sæbø");
  assert.equal(stay.at, 9 * 60 + 28);
  assert.equal(stay.until, 10 * 60 + 30);
  assert.equal(stay.stay.minutes, 62);
  assert.equal(
    events.filter((event) => event.kind === "layover" && event.quays[0] === "Leknes").length,
    0
  );
  assert.equal(keepTimelineEvent(stay, events, 9 * 60 + 50), true);
  assert.equal(keepTimelineEvent(stay, events, 10 * 60 + 30), false);
  setTestState({ fromFilter: "Leknes" });
  const leknes = buildEvents(legs, null);
  assert.ok(leknes.every((event) => event.kind !== "layover"));
  assert.ok(leknes.every((event) => event.kind !== "arr"));
  setTestState({ fromFilter: "Sæbø" });
  const saebo = buildEvents(legs, null);
  assert.equal(saebo.filter((event) => event.kind === "layover").length, 1);
});

test("liggetid visest òg når ankomsttider er skjulte", () => {
  setTestState({ hideArrivals: true });
  const events = buildEvents(
    [
      leg("Leknes", "Sæbø", "09:15:00", "09:28:00"),
      leg("Sæbø", "Leknes", "10:30:00", "10:43:00"),
    ],
    null
  );
  assert.equal(events.filter((event) => event.kind === "layover").length, 1);
});

test("onsdag har liggetid på Store Kalvøy, ikkje fem-minutts vending", () => {
  const stays = buildEvents(wednesday, null).filter((event) => event.kind === "layover");
  assert.equal(stays.length, 1);
  assert.equal(stays[0].quays[0], "Store Kalvøy");
  assert.equal(stays[0].stay.minutes, 40);
});

test("flytting kjem etter siste segling", () => {
  const events = buildEvents(wednesday, null).sort(compareTimelineEvents);
  const lastDep = events.filter((event) => event.kind === "dep").at(-1);
  const lastTransfer = events.filter((event) => event.kind === "transfer").at(-1);
  assert.ok(lastDep);
  assert.ok(lastTransfer);
  assert.equal(lastTransfer.at, 19 * 60 + 45);
  assert.ok(lastTransfer.at >= lastDep.at);
});

test("segling er synleg til ankomst når alle stopp er valt", () => {
  const trip = [leg("Standal", "Trandal", "07:40:00", "07:55:00")];
  const events = buildEvents(trip, null);
  const dep = events.find((event) => event.kind === "dep");
  assert.equal(keepTimelineEvent(dep, events, 7 * 60 + 50), true);
  assert.equal(keepTimelineEvent(dep, events, 7 * 60 + 55), false);
  assert.equal(pastDepartureCount(events, 7 * 60 + 50), 0);
  assert.equal(pastDepartureCount(events, 7 * 60 + 55), 1);
});

test("NO-status får liggetid-tekst og amber når ferja ligg i eit slikt opphald", () => {
  const status = ferryStatus(wednesday, 11 * 60 + 50, wednesday);
  assert.equal(status.layover, true);
  assert.equal(status.underway, undefined);
  assert.equal(status.short, "Ferja ligg til kai på Store Kalvøy");
  assert.equal(
    status.text,
    "Ferja ligg til kai på Store Kalvøy. Liggetid 40 min, til 12:10."
  );
  const stays = buildEvents(wednesday, null).filter((event) => event.kind === "layover");
  assert.equal(stays.length, 1);
  assert.equal(keepTimelineEvent(stays[0], stays, 11 * 60 + 50, status), false);
  assert.equal(keepTimelineEvent(stays[0], stays, 11 * 60 + 50), true);
});

test("kort vending gjev vanleg kai-status, ikkje liggetid i NO", () => {
  const legs = [
    leg("Sæbø", "Leknes", "09:00:00", "09:13:00"),
    leg("Leknes", "Sæbø", "09:15:00", "09:28:00"),
  ];
  const status = ferryStatus(legs, 9 * 60 + 14, legs);
  assert.equal(status.layover, undefined);
  assert.equal(status.text, "Ferja ligg til kai på Leknes");
  assert.equal(layoverAfter(legs[0], legs[1]), null);
});

test("morgonpendelen har ankomst attende til Standal kl 07:20", () => {
  const morning = [
    leg("Standal", "Trandal", "06:45:00", "07:00:00"),
    leg("Trandal", "Standal", "07:05:00", "07:20:00"),
  ];
  const inbound = nextArrivalAt(morning, "Standal");
  assert.equal(inbound.arrival, "07:20:00");
  assert.equal(inbound.from, "Trandal");
});

test("utdrag bryt ved ord og I dag står i knappen, ikkje i overskrifta", () => {
  const long = "Ferja er innstilt i dag på grunn av tekniske problem ved kaiene i Hjørundfjorden.";
  const excerpt = excerptText(long, 40);
  assert.ok(excerpt.endsWith("…"));
  assert.ok(excerpt.length <= 41);
  assert.doesNotMatch(excerpt, / {2}/);
  assert.equal(excerptText("Kort melding"), "Kort melding");
  assert.doesNotMatch(headingDay(todayIso()), /^I dag/);
  assert.doesNotMatch(headingDay("2020-01-15"), /^I dag/);
});

test("meldingar for valt samband kjem øvst", () => {
  const standal = {
    heading: "Standal-Trandal-Valderøya-Store Kalvøy",
    text: "Verkstad i veka",
    connectionNumber: 132,
    severity: "info",
  };
  const leknes = {
    heading: "Leknes-Sæbø",
    text: "Normal drift",
    connectionNumber: 134,
    severity: "cancelled",
  };
  const other = {
    heading: "Festøy-Hundeidvik",
    text: "innstilt",
    connectionNumber: 1049,
    severity: "cancelled",
  };
  assert.equal(messageRouteScore(standal, "1136"), 0);
  assert.equal(messageRouteScore(leknes, "1136"), 3);
  assert.equal(messageRouteScore(leknes, "1135"), 0);
  assert.equal(messageRouteScore(standal, "1135"), 3);
  const sorted1136 = sortMessagesForRoute([leknes, other, standal], "1136");
  assert.equal(sorted1136[0].heading, standal.heading);
  const sorted1135 = sortMessagesForRoute([standal, other, leknes], "1135");
  assert.equal(sorted1135[0].heading, leknes.heading);
});

test("sanntidsvindauge er fyrste avgang til siste ankomst", () => {
  setTestState({
    routes: { lines: { 1136: { legs: wednesday } } },
  });
  const win = serviceWindowMinutes("2026-08-26");
  assert.equal(win.start, 7 * 60 + 40);
  assert.equal(win.end, 19 * 60 + 45);
  const midday = Date.parse("2026-08-26T12:00:00+02:00");
  const night = Date.parse("2026-08-26T23:40:00+02:00");
  const early = Date.parse("2026-08-26T05:00:00+02:00");
  assert.equal(shouldFetchLive(midday), true);
  assert.equal(shouldFetchLive(night), false);
  assert.equal(shouldFetchLive(early), false);
});

test("kombi spør 1136 fyrst, 1135 berre som reserveløype", () => {
  assert.deepEqual(liveFetchUrls("1136"), [
    "https://api.entur.io/realtime/v1/rest/vm?datasetId=MOR&LineRef=MOR:Line:1136",
  ]);
  assert.deepEqual(liveFetchUrls("1135"), [
    "https://api.entur.io/realtime/v1/rest/vm?datasetId=MOR&LineRef=MOR:Line:1135",
  ]);
  const kombi = liveFetchUrls("kombi");
  assert.equal(kombi.length, 2);
  assert.match(kombi[0], /1136/);
  assert.match(kombi[1], /1135/);
});

test("Entur-feil aukar backoff", () => {
  setTestState({
    routes: { lines: { 1136: { legs: wednesday } } },
  });
  const midday = Date.parse("2026-08-26T12:00:00+02:00");
  assert.equal(shouldFetchLive(midday), true);
  noteLiveFailure(midday);
  assert.equal(liveBlockedUntil(), midday + 60_000);
  assert.equal(shouldFetchLive(midday + 10_000), false);
  noteLiveFailure(midday);
  assert.equal(liveBlockedUntil(), midday + 120_000);
});
