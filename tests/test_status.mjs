import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEvents,
  compareTimelineEvents,
  delayMinutes,
  ferryStatus,
  homeQuay,
  isLiveFresh,
  liveStatus,
  minDeadheadMinutes,
  parseVehicleMonitoring,
  quayPlace,
} from "../assets/app.js";

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

test("liveStatus krev fersk data", () => {
  assert.equal(isLiveFresh(null), false);
  assert.equal(isLiveFresh({ validUntil: "2000-01-01T00:00:00Z" }), false);
  const live = {
    destination: "Trandal",
    delayMinutes: 2,
    validUntil: "2099-01-01T00:00:00Z",
  };
  assert.equal(isLiveFresh(live), true);
  const status = liveStatus(live);
  assert.match(status.text, /sanntid frå Entur/);
  assert.match(status.text, /Trandal/);
  assert.match(status.text, /2 min forsinka/);
});

test("ankomst kjem før avgang når klokka er den same", () => {
  const events = buildEvents(wednesday, null).sort(compareTimelineEvents);
  const sameTime = events.filter((event) => event.at === 15 * 60 + 25);
  assert.deepEqual(
    sameTime.map((event) => event.kind),
    ["arr", "dep"]
  );
  assert.deepEqual(sameTime.map((event) => event.quays[0]), ["Sæbø", "Sæbø"]);
});

test("flytting kjem etter ankomst, før neste avgang", () => {
  const events = buildEvents(wednesday, null).sort(compareTimelineEvents);
  const afterLast = events.filter((event) => event.at === 19 * 60 + 45);
  assert.deepEqual(
    afterLast.map((event) => event.kind),
    ["arr", "transfer"]
  );
});
