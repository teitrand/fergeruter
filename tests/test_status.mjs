import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  buildEvents,
  compareTimelineEvents,
  delayMinutes,
  ferryStatus,
  homeQuay,
  isLiveFresh,
  keepTimelineEvent,
  liveBlockedUntil,
  liveFetchUrls,
  liveStatus,
  minDeadheadMinutes,
  nextArrivalAt,
  nextOverview,
  noteLiveFailure,
  parseVehicleMonitoring,
  pastDepartureCount,
  quayPlace,
  resetTestState,
  setTestState,
  shouldFetchLive,
  serviceWindowMinutes,
} from "../assets/app.js";
import { setLang } from "../assets/i18n.js";

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

test("ved valt kai står innkomst på ankomsttid", () => {
  setTestState({ stopFilter: "Sæbø" });
  const events = buildEvents(wednesday, null);
  const inbound = events.find(
    (event) => event.kind === "dep" && event.leg.from === "Trandal" && event.leg.to === "Sæbø"
  );
  const outbound = events.find(
    (event) => event.kind === "dep" && event.leg.from === "Sæbø" && event.leg.to === "Trandal"
  );
  assert.equal(inbound.at, 8 * 60 + 30);
  assert.equal(outbound.at, 8 * 60 + 35);
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

test("neste avgang har destinasjon, ankomst er på destinasjonen", () => {
  const trip = nextOverview(wednesday, "Standal");
  assert.equal(trip.dep.from, "Standal");
  assert.equal(trip.dep.to, "Trandal");
  assert.equal(trip.dep.departure, "07:40:00");
  assert.equal(trip.arr.to, "Trandal");
  assert.equal(trip.arr.arrival, "07:55:00");
});

test("utan kaival er neste tur fyrste avgang og ankomst på destinasjonen", () => {
  const trip = nextOverview(wednesday, null);
  assert.equal(trip.dep.from, "Standal");
  assert.equal(trip.dep.to, "Trandal");
  assert.equal(trip.arr.to, "Trandal");
  assert.equal(trip.arr.arrival, "07:55:00");
});

test("morgonpendelen viser 07:00 Trandal, ikkje 07:20 attende til Standal", () => {
  const morning = [
    leg("Standal", "Trandal", "06:45:00", "07:00:00"),
    leg("Trandal", "Standal", "07:05:00", "07:20:00"),
  ];
  const trip = nextOverview(morning, null);
  assert.equal(trip.dep.departure, "06:45:00");
  assert.equal(trip.dep.from, "Standal");
  assert.equal(trip.arr.to, "Trandal");
  assert.equal(trip.arr.arrival, "07:00:00");
  const inbound = nextArrivalAt(morning, "Standal");
  assert.equal(inbound.arrival, "07:20:00");
  assert.notEqual(trip.arr.arrival, inbound.arrival);
});

test("valt kai viser neste tur derifrå, med ankomst på destinasjonen", () => {
  const morning = [
    leg("Standal", "Trandal", "06:45:00", "07:00:00"),
    leg("Trandal", "Standal", "07:05:00", "07:20:00"),
  ];
  const fromStandal = nextOverview(morning, "Standal");
  assert.equal(fromStandal.dep.departure, "06:45:00");
  assert.equal(fromStandal.arr.to, "Trandal");
  assert.equal(fromStandal.arr.arrival, "07:00:00");
  const fromTrandal = nextOverview(morning, "Trandal");
  assert.equal(fromTrandal.dep.departure, "07:05:00");
  assert.equal(fromTrandal.arr.to, "Standal");
  assert.equal(fromTrandal.arr.arrival, "07:20:00");
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
