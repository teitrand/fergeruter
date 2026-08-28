import {
  applyStaticTranslations,
  detectLang,
  getLang,
  months,
  monthsShort,
  setLang,
  t,
  weekdays,
} from "./i18n.js";

const MESSAGES_URL = "data/trafikkmeldinger.json";
const ROUTES_URL = "data/ruter.json";
const CONNECTIONS_URL = "data/korrespondanse.json";
const LIVE_VM_URL =
  "https://api.entur.io/realtime/v1/rest/vm?datasetId=MOR&LineRef=MOR:Line:1136";
const ENTUR_CLIENT = "teitrand-fergeruter";
const HOME_QUAY = "Standal";
const LIVE_MAX_AGE_MS = 3 * 60 * 1000;
const FEEDBACK_MAIL = "teitrand@hotmail.com";
const FEEDBACK_GITHUB = "https://github.com/teitrand/fergeruter/issues/new";

const state = {
  messageFilter: "local",
  stopFilter: null,
  date: null,
  showPast: false,
  messages: null,
  routes: null,
  connection: null,
  connections: null,
  live: null,
  liveFetchedAt: 0,
};

let renderedDate = null;
let tickTimer = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** Anonym Plausible-hending. Feilar aldri ut til brukaren. */
function track(name, props, { interactive = true } = {}) {
  try {
    const fn = typeof window !== "undefined" ? window.plausible : null;
    if (typeof fn !== "function") return;
    const payload = {};
    if (props && Object.keys(props).length) payload.props = props;
    if (!interactive) payload.interactive = false;
    fn(name, Object.keys(payload).length ? payload : undefined);
  } catch {
    // statistikk skal ikkje stoppe sida
  }
}

function appMode() {
  try {
    if (typeof window === "undefined") return "web";
    if (window.matchMedia("(display-mode: standalone)").matches) return "pwa";
    if (navigator.standalone) return "pwa";
  } catch {
    // matchMedia kan mangle
  }
  return "web";
}

function feedbackMailto(rating, comment) {
  const ratingLabel = rating === "yes" ? t("feedback.yes") : t("feedback.no");
  const text = String(comment || "").trim() || t("feedback.mailNoComment");
  const subject = t("feedback.mailSubject");
  const body = t("feedback.mailBody", { rating: ratingLabel, comment: text });
  return `mailto:${FEEDBACK_MAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function osloParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function osloSecondsOfDay() {
  const parts = osloParts();
  return Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
}

function clockSeconds(time) {
  const [hours, minutes, seconds = 0] = time.split(":").map(Number);
  return hours * 3600 + minutes * 60 + seconds;
}

/** Minutt att, alltid runda ned, så vi aldri lovar meir tid enn det er. */
function minutesLeft(time) {
  return Math.floor((clockSeconds(time) - osloSecondsOfDay()) / 60);
}

function hasPassed(time) {
  return clockSeconds(time) <= osloSecondsOfDay();
}

function todayIso() {
  const parts = osloParts();
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftIso(iso, days) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function selectedDate() {
  // Lagra som dato, ikkje som forskyving, slik at ei sida som står open
  // over midnatt held fram med å vise den dagen du faktisk ser på.
  return state.date || todayIso();
}

function isToday() {
  return selectedDate() === todayIso();
}

function nowMinutes() {
  const parts = osloParts();
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function clockMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToClock(total) {
  const wrapped = ((total % 1440) + 1440) % 1440;
  const hours = String(Math.floor(wrapped / 60)).padStart(2, "0");
  const minutes = String(wrapped % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function hhmm(time) {
  return time ? time.slice(0, 5) : "";
}

function weekdayOf(isoDate) {
  return weekdays()[new Date(`${isoDate}T12:00:00Z`).getUTCDay()];
}

function formatDay(isoDate) {
  const [, month, day] = isoDate.split("-").map(Number);
  return t("date.full", {
    weekday: weekdayOf(isoDate),
    day: String(day),
    month: months()[month - 1],
  });
}

function headingDay(isoDate) {
  const text = formatDay(isoDate);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatDateOnly(iso) {
  if (!iso) return "";
  const parts = osloParts(new Date(iso));
  return t("date.only", {
    day: String(Number(parts.day)),
    month: months()[Number(parts.month) - 1],
    year: parts.year,
  });
}

function formatDateTime(iso) {
  if (!iso) return "";
  const parts = osloParts(new Date(iso));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return t("date.time", {
    weekday: weekdayOf(date),
    day: String(Number(parts.day)),
    month: monthsShort()[Number(parts.month) - 1],
    hour: parts.hour,
    minute: parts.minute,
  });
}

function durationText(minutes) {
  if (minutes < 1) return t("duration.now");
  if (minutes < 60) return t("duration.minutes", { n: minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest
    ? t("duration.hoursMinutes", { n: hours, m: rest })
    : t("duration.hours", { n: hours });
}

function countdown(time) {
  const minutes = minutesLeft(time);
  if (minutes < 1) return t("duration.now");
  return t("countdown.in", { duration: durationText(minutes) });
}

function legsForDate(date) {
  return (state.routes?.legs || [])
    .filter((leg) => (leg.activeDates || []).includes(date))
    .sort((a, b) => a.departure.localeCompare(b.departure));
}

function hjorundfjordQuays() {
  return state.routes?.hjorundfjordQuays || [];
}

function crossesArea(from, to) {
  const inside = hjorundfjordQuays();
  if (!inside.length) return false;
  return inside.includes(from) !== inside.includes(to);
}

function quaysInDay(legs) {
  const seen = [];
  for (const leg of legs) {
    for (const quay of [leg.from, leg.to]) {
      if (!seen.includes(quay)) seen.push(quay);
    }
  }
  return seen;
}

function bookingDeadline(leg) {
  if (!leg.signal) return null;
  return clockMinutes(leg.departure) - leg.signal.minutesBefore;
}

function quayPlace(name) {
  if (!name) return "";
  return String(name).replace(/\s+(ferjekai|kai)$/i, "").trim();
}

const LINE_QUAYS = [
  "Store Kalvøy",
  "Valderøya",
  "Standal",
  "Trandal",
  "Sæbø",
  "Skår",
  "Leknes",
  "Bjørke",
  "Urke",
];

function knownQuays() {
  const names = new Set(LINE_QUAYS);
  for (const quay of hjorundfjordQuays()) names.add(quay);
  for (const leg of state.routes?.legs || []) {
    names.add(leg.from);
    names.add(leg.to);
  }
  return [...names].filter(Boolean);
}

/** Entur kan sende heile resten av turen, t.d. «Sæbø Trandal Standal». */
function firstKnownQuay(name, quays = knownQuays()) {
  const text = quayPlace(name);
  if (!text) return "";
  const known = [...quays].sort((a, b) => b.length - a.length);
  for (const quay of known) {
    if (text === quay || text.startsWith(`${quay} `)) return quay;
  }
  return text;
}

function unwrapSiri(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return unwrapSiri(value[0]);
  if (typeof value === "object") return unwrapSiri(value.value ?? value["#text"]);
  return "";
}

function delayMinutes(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Math.floor(value / 60);
  const text = String(value);
  const iso = text.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (iso) {
    const hours = Number(iso[1] || 0);
    const minutes = Number(iso[2] || 0);
    const seconds = Number(iso[3] || 0);
    return Math.floor(hours * 60 + minutes + seconds / 60);
  }
  const numeric = Number(text);
  return Number.isFinite(numeric) ? Math.floor(numeric / 60) : null;
}

function homeQuay(legs) {
  return legs[0]?.from || HOME_QUAY;
}

/** Kortaste hol mellom to kaier i tabellen, t.d. Valderøya 12:30 → Standal 14:40. */
function minDeadheadMinutes(allLegs, fromQuay, toQuay) {
  const byDate = new Map();
  for (const leg of allLegs || []) {
    for (const date of leg.activeDates || []) {
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(leg);
    }
  }
  let shortest = null;
  for (const dayLegs of byDate.values()) {
    dayLegs.sort((a, b) => a.departure.localeCompare(b.departure));
    for (let i = 0; i < dayLegs.length - 1; i += 1) {
      const leg = dayLegs[i];
      const next = dayLegs[i + 1];
      if (leg.to !== fromQuay || next.from !== toQuay) continue;
      const gap = clockMinutes(next.departure) - clockMinutes(leg.arrival);
      if (gap > 0 && (shortest == null || gap < shortest)) shortest = gap;
    }
  }
  return shortest;
}

function parseVehicleMonitoring(data) {
  const deliveries = data?.Siri?.ServiceDelivery?.VehicleMonitoringDelivery;
  const list = Array.isArray(deliveries) ? deliveries : deliveries ? [deliveries] : [];
  const activities = [];
  for (const delivery of list) {
    const items = delivery?.VehicleActivity;
    if (!items) continue;
    activities.push(...(Array.isArray(items) ? items : [items]));
  }
  if (!activities.length) return null;
  const activity = activities[0];
  const journey = activity.MonitoredVehicleJourney || {};
  const location = journey.VehicleLocation || {};
  const recorded = activity.RecordedAtTime || activity.ValidUntilTime;
  return {
    destination: firstKnownQuay(unwrapSiri(journey.DestinationName)),
    direction: firstKnownQuay(unwrapSiri(journey.DirectionName)),
    delayMinutes: delayMinutes(journey.Delay),
    latitude: location.Latitude ?? location.latitude,
    longitude: location.Longitude ?? location.longitude,
    monitored: journey.Monitored,
    validUntil: activity.ValidUntilTime,
    recordedAt: recorded,
  };
}

function isLiveFresh(live) {
  if (!live) return false;
  if (live.validUntil) {
    const until = Date.parse(live.validUntil);
    if (Number.isFinite(until)) return until > Date.now();
  }
  if (live.recordedAt) {
    const recorded = Date.parse(live.recordedAt);
    if (Number.isFinite(recorded)) return Date.now() - recorded < LIVE_MAX_AGE_MS;
  }
  return false;
}

function delayBit(minutes) {
  if (minutes >= 1) return t("delay.about", { n: minutes });
  return "";
}

function withSanntid(base, live) {
  const delay = delayBit(live.delayMinutes);
  const short = delay ? `${base}, ${delay}` : base;
  return {
    live: true,
    short,
    text: t("live.fromEntur", { text: short }),
  };
}

function liveStatus(live) {
  if (!isLiveFresh(live)) return null;
  const dest = firstKnownQuay(live.destination);
  const base = dest ? t("status.underwayTo", { dest }) : t("status.onSchedule");
  return { underway: true, ...withSanntid(base, live) };
}

function overnightStatus(last, home, now, allLegs) {
  const deadhead = minDeadheadMinutes(allLegs, last.to, home);
  const since = now - clockMinutes(last.arrival);
  if (deadhead != null && since < deadhead) {
    return {
      at: clockMinutes(last.arrival) + 0.5,
      underway: true,
      short: t("status.backEmpty", { home }),
      text: t("status.backEmptyText", { to: last.to, home }),
    };
  }
  if (deadhead == null) {
    return {
      at: 1441,
      short: t("status.backEmpty", { home }),
      text: t("status.backOvernightText", { to: last.to, home }),
    };
  }
  return {
    at: 1441,
    short: t("status.mooredAt", { quay: home }),
    text: t("status.doneMoored", { home }),
  };
}

/** Kvar ferja er akkurat no, rekna ut frå rutetabellen. */
function ferryStatus(legs, now = nowMinutes(), allLegs = null) {
  if (!legs.length) return null;
  const first = legs[0];
  const last = legs[legs.length - 1];
  const home = homeQuay(legs);
  const catalog = allLegs || state.routes?.legs || legs;

  if (now < clockMinutes(first.departure)) {
    return {
      at: clockMinutes(first.departure) - 1,
      short: t("status.mooredAt", { quay: first.from }),
      text: t("status.firstDeparture", { from: first.from, time: hhmm(first.departure) }),
    };
  }
  if (now >= clockMinutes(last.arrival)) {
    if (last.to === home) {
      return {
        at: 1441,
        short: t("status.doneAt", { home }),
        text: t("status.doneAtPeriod", { home }),
      };
    }
    return overnightStatus(last, home, now, catalog);
  }

  for (let i = 0; i < legs.length; i += 1) {
    const leg = legs[i];
    if (now >= clockMinutes(leg.departure) && now < clockMinutes(leg.arrival)) {
      return {
        at: clockMinutes(leg.departure) + 0.5,
        underway: true,
        text: t("status.underwayTo", { dest: leg.to }),
      };
    }
    const next = legs[i + 1];
    if (next && now >= clockMinutes(leg.arrival) && now < clockMinutes(next.departure)) {
      const moving = leg.to !== next.from;
      return {
        at: clockMinutes(leg.arrival) + 0.5,
        underway: moving,
        text: moving
          ? t("status.repositionTo", { quay: next.from })
          : t("status.mooredAt", { quay: leg.to }),
      };
    }
  }
  return null;
}

function currentStatus(legs) {
  const planned = ferryStatus(legs);
  if (!isLiveFresh(state.live)) return planned;
  if (planned) {
    const base = (planned.short || planned.text || "").replace(/\.$/, "");
    return { ...planned, ...withSanntid(base, state.live) };
  }
  return liveStatus(state.live);
}

function nextDepartureFrom(legs, quay, skipPassed = false) {
  return (
    legs.find(
      (leg) => (!quay || leg.from === quay) && (!skipPassed || !hasPassed(leg.departure))
    ) || null
  );
}

function nextArrivalAt(legs, quay, skipPassed = false) {
  if (!quay) return null;
  return (
    legs.find((leg) => leg.to === quay && (!skipPassed || !hasPassed(leg.arrival))) || null
  );
}

/** Fyrste treffet på ein seinare dag, så boksen ikkje står tom om kvelden. */
function lookAhead(fromDate, matches, maxDays = 7) {
  for (let step = 1; step <= maxDays; step += 1) {
    const date = shiftIso(fromDate, step);
    const leg = legsForDate(date).find(matches);
    if (leg) return { date, leg };
  }
  return null;
}

function dayPrefix(date) {
  if (date === shiftIso(todayIso(), 1)) return t("day.tomorrow");
  return formatDay(date);
}

function resolveAhead(selected, current, matches) {
  if (current) return { leg: current, date: selected, prefix: "" };
  const ahead = lookAhead(selected, matches);
  if (!ahead) return null;
  return { leg: ahead.leg, date: ahead.date, prefix: dayPrefix(ahead.date) };
}

function overviewState(prefix, time, live) {
  const bits = [];
  if (prefix) bits.push(prefix);
  if (live) bits.push(countdown(time));
  return bits.join(" · ");
}

function buildNextRow(row) {
  const node = el("div", "next-row");
  node.append(el("span", "next-time", hhmm(row.time)));
  const body = el("span", "next-body");
  const name = el("span", "next-name", row.name);
  if (row.leg.signal) name.append(el("span", "stop-tag", t("signal.onRequest")));
  body.append(name);
  const note = signalNote(row.leg, row.live);
  if (note) body.append(note);
  const connection = connectionNote(connectionIndex(row.date), row.kind, row.leg);
  if (connection) body.append(el("span", "stop-note stop-conn", connection));
  node.append(body);
  node.append(el("span", "next-state", row.state || ""));
  return node;
}

/** Boks med neste avgang (og destinasjon) og neste anløp på same kai. */
function renderNextSummary(legs) {
  const root = document.getElementById("next-summary");
  root.replaceChildren();
  const selected = selectedDate();
  const skipPassed = isToday();
  const quay = state.stopFilter;

  const depHit = resolveAhead(
    selected,
    nextDepartureFrom(legs, quay, skipPassed),
    (leg) => !quay || leg.from === quay
  );
  const arrQuay = quay || depHit?.leg.from;
  const arrHit = resolveAhead(
    selected,
    nextArrivalAt(legs, arrQuay, skipPassed),
    (leg) => Boolean(arrQuay) && leg.to === arrQuay
  );
  if (!depHit && !arrHit) return;

  const rows = [];
  if (depHit) {
    const live = depHit.date === todayIso();
    rows.push({
      sort: `${depHit.date}T${depHit.leg.departure}`,
      time: depHit.leg.departure,
      name: t("next.fromTo", { from: depHit.leg.from, to: depHit.leg.to }),
      state: overviewState(depHit.prefix, depHit.leg.departure, live),
      live,
      leg: depHit.leg,
      kind: "dep",
      date: depHit.date,
    });
  }
  if (arrHit) {
    const live = arrHit.date === todayIso();
    rows.push({
      sort: `${arrHit.date}T${arrHit.leg.arrival}`,
      time: arrHit.leg.arrival,
      name: t("next.arrival", { to: arrHit.leg.to }),
      state: overviewState(arrHit.prefix, arrHit.leg.arrival, live),
      live,
      leg: arrHit.leg,
      kind: "arr",
      date: arrHit.date,
    });
  }
  rows.sort((a, b) => a.sort.localeCompare(b.sort));

  const item = el("div", "next-item");
  for (const row of rows) item.append(buildNextRow(row));
  root.append(item);
}

/**
 * Turane over Storfjorden som gjeld den valde dagen, delte etter retning.
 * Reisevegen avgjer kva veg det korresponderer: skal du inn fjorden treng du
 * ei ferje som er framme på knutepunktet i tide, skal du ut treng du ei som
 * går derifrå etterpå.
 */
function connectionIndex(date) {
  const data = state.connections;
  if (!data || !state.connection) return null;
  const line = data.lines.find((candidate) => candidate.id === state.connection);
  if (!line) return null;
  const runsToday = (trip) => (data.calendars[trip.cal] || []).includes(date);
  const trips = line.trips.filter(runsToday);
  return {
    hub: data.hub,
    roadTo: data.roadTo,
    buffer: (data.driveMinutes || 0) + (data.marginMinutes || 0),
    toHub: trips
      .filter((trip) => trip.to === data.hub)
      .sort((a, b) => a.arrival.localeCompare(b.arrival)),
    fromHub: trips
      .filter((trip) => trip.from === data.hub)
      .sort((a, b) => a.departure.localeCompare(b.departure)),
  };
}

function inboundConnection(index, departure) {
  const latest = clockMinutes(departure) - index.buffer;
  let found = null;
  for (const trip of index.toHub) {
    if (clockMinutes(trip.arrival) <= latest) found = trip;
    else break;
  }
  return found;
}

function outboundConnection(index, arrival) {
  const earliest = clockMinutes(arrival) + index.buffer;
  return index.fromHub.find((trip) => clockMinutes(trip.departure) >= earliest) || null;
}

function connectionNote(index, kind, leg) {
  if (!index) return null;
  const quay = kind === "dep" ? leg.from : leg.to;
  if (quay !== index.roadTo) return null;
  if (kind === "dep") {
    const trip = inboundConnection(index, leg.departure);
    return trip
      ? t("conn.takeFerry", { time: hhmm(trip.departure), from: trip.from })
      : t("conn.noInbound", { hub: index.hub });
  }
  const trip = outboundConnection(index, leg.arrival);
  return trip
    ? t("conn.onward", { time: hhmm(trip.departure), hub: index.hub, to: trip.to })
    : t("conn.noOutbound", { hub: index.hub });
}

/**
 * `live` seier om fristen skal teljast mot klokka. Gjeld turen ein annan dag
 * enn i dag, ville ei nedteljing mot dagens klokke vore feil.
 */
function signalNote(leg, live) {
  const deadline = bookingDeadline(leg);
  if (deadline == null) return null;
  const note = el("span", "stop-note");
  const phone = leg.signal.phone;
  const label = t("signal.callBy", { time: minutesToClock(deadline) });
  if (phone) {
    const link = el("a", "stop-phone", `${label} · ${phone}`);
    link.href = `tel:+47${phone.replace(/\s+/g, "")}`;
    note.append(link);
  } else {
    note.append(document.createTextNode(label));
  }
  if (live) {
    const deadlineClock = `${minutesToClock(deadline)}:00`;
    if (!hasPassed(deadlineClock)) {
      note.append(
        el(
          "span",
          "stop-left",
          t("signal.leftToBook", { duration: durationText(minutesLeft(deadlineClock)) })
        )
      );
    } else if (!hasPassed(leg.departure)) {
      note.append(el("span", "stop-expired", t("signal.expired")));
    }
  }
  return note;
}

function departureRow(leg, past, index) {
  const row = el("div", `stop stop-dep${past ? " is-past" : ""}`);
  row.append(el("span", "stop-time", hhmm(leg.departure)));
  const body = el("span", "stop-body");
  const head = el("span", "stop-head");
  head.append(el("span", "stop-name", t("next.from", { from: leg.from })));
  if (leg.signal) head.append(el("span", "stop-tag", t("signal.onRequest")));
  body.append(head);
  const note = signalNote(leg, isToday());
  if (note) body.append(note);
  const connection = connectionNote(index, "dep", leg);
  if (connection) body.append(el("span", "stop-note stop-conn", connection));
  row.append(body);
  const remaining = past ? t("gone") : isToday() ? countdown(leg.departure) : "";
  row.append(el("span", "stop-state", remaining));
  return row;
}

function arrivalRow(leg, past, index) {
  const row = el("div", `stop stop-arr${past ? " is-past" : ""}`);
  row.append(el("span", "stop-time", hhmm(leg.arrival)));
  const body = el("span", "stop-body");
  body.append(el("span", "stop-name", t("next.arrival", { to: leg.to })));
  const connection = connectionNote(index, "arr", leg);
  if (connection) body.append(el("span", "stop-note stop-conn", connection));
  row.append(body);
  row.append(el("span", "stop-state", ""));
  return row;
}

function transferRow(from, to, past) {
  const row = el("div", `stop stop-transfer${past ? " is-past" : ""}`);
  row.append(el("span", "stop-time", ""));
  const body = el("span", "stop-body");
  body.append(el("span", "stop-name", t("transfer.moves", { to })));
  body.append(
    el(
      "span",
      "stop-note",
      crossesArea(from, to)
        ? t("transfer.noPassengers", { from, to })
        : t("transfer.empty")
    )
  );
  row.append(body);
  row.append(el("span", "stop-state", ""));
  return row;
}

function statusRow(status) {
  const row = el("div", `now${status.underway ? " is-underway" : " is-moored"}`);
  row.append(el("span", "now-label", t("now")));
  row.append(el("span", "now-text", status.text));
  return row;
}

function matchesStop(quays) {
  if (!state.stopFilter) return true;
  return quays.includes(state.stopFilter);
}

const EVENT_SEQ = { arr: 0, transfer: 1, dep: 2, status: 3 };

function compareTimelineEvents(a, b) {
  const seq = (event) => EVENT_SEQ[event.kind] ?? 0;
  return a.at - b.at || seq(a) - seq(b);
}

function buildEvents(legs, connections) {
  const events = [];
  legs.forEach((leg, index) => {
    events.push({
      at: clockMinutes(leg.departure),
      kind: "dep",
      quays: [leg.from],
      build: (past) => departureRow(leg, past, connections),
    });
    events.push({
      at: clockMinutes(leg.arrival),
      kind: "arr",
      quays: [leg.to],
      build: (past) => arrivalRow(leg, past, connections),
    });
    const next = legs[index + 1];
    if (next && leg.to !== next.from) {
      events.push({
        at: clockMinutes(leg.arrival),
        kind: "transfer",
        quays: [leg.to, next.from],
        build: (past) => transferRow(leg.to, next.from, past),
      });
    }
  });
  const last = legs[legs.length - 1];
  const home = homeQuay(legs);
  if (last && last.to !== home) {
    events.push({
      at: clockMinutes(last.arrival),
      kind: "transfer",
      quays: [last.to, home],
      build: (past) => transferRow(last.to, home, past),
    });
  }
  return events;
}

function renderStopFilter(legs) {
  const root = document.getElementById("stop-filter");
  root.replaceChildren();
  const quays = quaysInDay(legs);
  if (quays.length < 2) return;
  if (state.stopFilter && !quays.includes(state.stopFilter)) state.stopFilter = null;
  const options = [{ value: null, label: t("stops.all") }].concat(
    quays.map((quay) => ({ value: quay, label: quay }))
  );
  for (const option of options) {
    const btn = el("button", "chip", option.label);
    btn.type = "button";
    const active = state.stopFilter === option.value;
    btn.setAttribute("aria-pressed", String(active));
    if (active) btn.classList.add("is-active");
    btn.addEventListener("click", () => {
      if (state.stopFilter === option.value) return;
      state.stopFilter = option.value;
      track(`Stop ${option.value || "all"}`);
      renderTimeline();
    });
    root.append(btn);
  }
}

function renderConnectionFilter() {
  const root = document.getElementById("conn-filter");
  const note = document.getElementById("connection-note");
  root.replaceChildren();
  const options = [{ value: null, label: t("conn.none") }].concat(
    (state.connections?.lines || [
      { id: "solavagen", label: "Solavågen" },
      { id: "hundeidvika", label: "Hundeidvika" },
    ]).map((line) => ({ value: line.id, label: line.label }))
  );
  for (const option of options) {
    const btn = el("button", "chip chip-small", option.label);
    btn.type = "button";
    const active = state.connection === option.value;
    btn.setAttribute("aria-pressed", String(active));
    if (active) btn.classList.add("is-active");
    btn.addEventListener("click", () => {
      if (state.connection === option.value) return;
      track(`Connection ${option.value || "none"}`);
      selectConnection(option.value);
    });
    root.append(btn);
  }
  const data = state.connections;
  note.textContent =
    state.connection && data
      ? t("conn.note", {
          drive: data.driveMinutes,
          hub: data.hub,
          roadTo: data.roadTo,
          margin: data.marginMinutes,
        })
      : "";
}

async function selectConnection(id) {
  state.connection = id;
  if (id && !state.connections) {
    try {
      const response = await fetch(CONNECTIONS_URL);
      if (!response.ok) throw new Error(response.statusText);
      state.connections = await response.json();
    } catch (error) {
      state.connection = null;
      document.getElementById("connection-note").textContent = t("conn.error");
      console.error(error);
    }
  }
  renderConnectionFilter();
  renderLive();
}

function renderDayNav() {
  const label = document.getElementById("day-label");
  if (label) label.textContent = headingDay(selectedDate());
  const todayBtn = document.getElementById("day-today");
  if (todayBtn) todayBtn.disabled = isToday();
}

/** Kort status øvst, alltid om i dag, uansett kva dag som er vald nedanfor. */
function renderLedeStatus() {
  const lede = document.getElementById("lede-status");
  if (!lede) return;
  const legs = legsForDate(todayIso());
  if (!legs.length) {
    lede.hidden = false;
    lede.textContent = t("lede.noTripsToday");
    return;
  }
  const status = currentStatus(legs);
  const next = legs.find((leg) => !hasPassed(leg.departure));
  const parts = [];
  if (status) parts.push(status.short || status.text.replace(/\.$/, ""));
  if (next) {
    parts.push(
      t("lede.nextDeparture", {
        time: hhmm(next.departure),
        from: next.from,
        countdown: countdown(next.departure),
      })
    );
  }
  lede.hidden = false;
  lede.textContent = `${parts.join(". ")}.`;
  renderPositionNote();
}

function renderPositionNote() {
  const note = document.getElementById("position-note");
  if (!note) return;
  note.textContent = liveStatus(state.live) ? t("position.live") : t("position.planned");
}

/** Knappen ligg utanfor lista, så minuttoppdateringa ikkje stel fokus. */
function renderReveal(pastCount) {
  const wrap = document.getElementById("timeline-reveal");
  if (!pastCount) {
    wrap.replaceChildren();
    return;
  }
  let button = wrap.querySelector("button");
  if (!button) {
    button = el("button", "reveal");
    button.type = "button";
    button.addEventListener("click", () => {
      state.showPast = !state.showPast;
      track(state.showPast ? "Show past" : "Hide past");
      renderLive();
    });
    wrap.replaceChildren(button);
  }
  button.textContent = state.showPast
    ? t("reveal.hide")
    : t("reveal.show", { n: pastCount });
}

/** Alt som endrar seg med klokka. Køyrer kvart minutt utan å byggje om resten. */
function renderLive() {
  const root = document.getElementById("departures");
  root.replaceChildren();
  if (!state.routes) {
    root.append(el("p", "empty", t("empty.noTimetable")));
    return;
  }
  const legs = legsForDate(selectedDate());
  renderDayNav();
  renderNextSummary(legs);

  if (!legs.length) {
    renderReveal(0);
    root.append(el("p", "empty", t("empty.noTripsDay")));
    return;
  }

  const events = buildEvents(legs, connectionIndex(selectedDate())).filter((event) =>
    matchesStop(event.quays)
  );
  const status = isToday() ? currentStatus(legs) : null;
  if (status) {
    events.push({
      at: status.at,
      kind: "status",
      status: true,
      build: () => statusRow(status),
    });
  }
  events.sort(compareTimelineEvents);

  const now = nowMinutes();
  const isPast = (event) => isToday() && !event.status && event.at <= now;
  const pastCount = events.filter(isPast).length;
  renderReveal(pastCount);

  for (const event of events) {
    const past = isPast(event);
    if (past && !state.showPast) continue;
    root.append(event.build(past));
  }
}

/** Full oppbygging: brukast når data, dag eller filter endrar seg. */
function renderTimeline() {
  renderedDate = selectedDate();
  renderStopFilter(legsForDate(renderedDate));
  renderConnectionFilter();
  renderLive();
}

function validMessages(messages) {
  const now = Date.now();
  return messages.filter((msg) => {
    if (!msg.validTo) return true;
    return new Date(msg.validTo).getTime() >= now - 60 * 60 * 1000;
  });
}

function applyMessageFilter(messages) {
  const local = messages.filter((msg) => msg.isLocal);
  if (state.messageFilter === "route") {
    return messages.filter((msg) => msg.isRoute1136);
  }
  if (state.messageFilter === "issues") {
    return local.filter((msg) => msg.severity !== "normal");
  }
  return local;
}

function renderMessages() {
  const root = document.getElementById("messages");
  const meta = document.getElementById("messages-meta");
  const panel = document.getElementById("messages-panel");
  const layout = document.getElementById("layout");
  root.replaceChildren();
  if (!state.messages) {
    panel.hidden = true;
    layout.classList.add("is-single");
    return;
  }
  const all = validMessages(state.messages.messages || []);
  // Utan noko i området er banneret øvst nok. Panelet ville berre teke plass.
  const hasLocal = all.some((msg) => msg.isLocal);
  panel.hidden = !hasLocal;
  layout.classList.toggle("is-single", !hasLocal);
  if (!hasLocal) {
    renderBanner(all);
    return;
  }
  const filtered = applyMessageFilter(all);
  meta.textContent = t("messages.fetched", { when: formatDateTime(state.messages.fetchedAt) });
  if (!filtered.length) {
    root.append(
      el(
        "p",
        "empty",
        state.messageFilter === "issues" ? t("empty.noIssues") : t("empty.noMessages")
      )
    );
    renderBanner(all);
    return;
  }
  for (const msg of filtered) {
    const card = el("article", `card is-${msg.severity}`);
    const title = el("h3", null, msg.heading || t("messages.heading"));
    title.append(
      el(
        "span",
        `badge badge-${msg.severity}`,
        t(`severity.${msg.severity}`) || t("severity.info")
      )
    );
    card.append(title, el("p", null, msg.text));
    const when = el("time", null, formatDateTime(msg.publishedAt));
    if (msg.publishedAt) when.dateTime = msg.publishedAt;
    card.append(when);
    root.append(card);
  }
  renderBanner(all);
}

function renderBanner(messages) {
  const banner = document.getElementById("status-banner");
  const local = messages.filter((msg) => msg.isLocal);
  banner.hidden = false;
  if (!local.length) {
    banner.className = "status-banner is-normal is-quiet";
    banner.textContent = t("banner.none");
    return;
  }
  const latest = local[0];
  banner.className = `status-banner is-${latest.severity}`;
  banner.textContent = latest.text;
}

async function loadMessages() {
  const meta = document.getElementById("messages-meta");
  try {
    const response = await fetch(`${MESSAGES_URL}?t=${Date.now()}`);
    if (!response.ok) throw new Error(response.statusText);
    state.messages = await response.json();
    renderMessages();
  } catch (error) {
    meta.textContent = t("messages.fetchError");
    document.getElementById("messages").replaceChildren(
      el("p", "empty", t("messages.seeFjord1"))
    );
    console.error(error);
  }
}

async function loadLivePosition() {
  if (Date.now() - (state.liveFetchedAt || 0) < 55 * 1000) return;
  state.liveFetchedAt = Date.now();
  try {
    const response = await fetch(LIVE_VM_URL, {
      headers: {
        "ET-Client-Name": ENTUR_CLIENT,
        Accept: "application/json",
      },
    });
    if (!response.ok) throw new Error(response.statusText);
    state.live = parseVehicleMonitoring(await response.json());
  } catch (error) {
    state.live = null;
    console.error(error);
  }
}

async function loadRoutes() {
  const label = document.getElementById("day-label");
  try {
    const response = await fetch(ROUTES_URL);
    if (!response.ok) throw new Error(response.statusText);
    state.routes = await response.json();
    renderTimeline();
    renderLedeStatus();
    const updated = document.getElementById("timetable-updated");
    if (updated && state.routes.fetchedAt) {
      updated.textContent = t("timetable.updated", {
        date: formatDateOnly(state.routes.fetchedAt),
      });
    }
    await loadLivePosition();
    renderLive();
    renderLedeStatus();
  } catch (error) {
    if (label) label.textContent = t("timetable.loadError");
    document.getElementById("departures").replaceChildren(
      el("p", "empty", t("timetable.notLoaded"))
    );
    console.error(error);
  }
}

function goToDay(days) {
  state.date = days === 0 ? todayIso() : shiftIso(selectedDate(), days);
  state.showPast = false;
  renderTimeline();
}

/**
 * Nedteljinga blir oppdatert på minuttskiftet, ikkje kvart 60. sekund frå
 * lasting, så ho aldri driv frå klokka. Etter kvar tikk blir neste planlagd
 * på nytt, og vi tikkar òg når fana blir synleg att etter dvale.
 */
async function tick() {
  if (!state.routes) return;
  await loadLivePosition();
  if (selectedDate() !== renderedDate) {
    renderTimeline();
  } else {
    renderLive();
  }
  renderLedeStatus();
}

function scheduleTick() {
  clearTimeout(tickTimer);
  const untilNextMinute = 60000 - (Date.now() % 60000) + 200;
  tickTimer = setTimeout(() => {
    tick();
    scheduleTick();
  }, untilNextMinute);
}

function wake() {
  tick();
  scheduleTick();
}

function applyLanguage(next) {
  if (next === getLang()) return;
  track(`Language ${next}`);
  setLang(next);
  applyStaticTranslations();
  syncLangButtons();
  const install = document.getElementById("install-btn");
  if (install) install.textContent = t("install.app");
  if (state.routes) {
    renderTimeline();
    renderLedeStatus();
  } else {
    renderDayNav();
  }
  renderMessages();
}

function syncLangButtons() {
  const current = getLang();
  document.querySelectorAll("[data-lang]").forEach((btn) => {
    const active = btn.dataset.lang === current;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
}

function bindInstallPrompt() {
  const btn = document.getElementById("install-btn");
  if (!btn) return;
  let deferred = null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event;
    btn.hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    track("App installed");
    deferred = null;
    btn.hidden = true;
  });
  btn.addEventListener("click", async () => {
    if (!deferred) return;
    track("Install app");
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    btn.hidden = true;
  });
}

function bindLanguage() {
  document.querySelectorAll("[data-lang]").forEach((btn) => {
    btn.addEventListener("click", () => applyLanguage(btn.dataset.lang));
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register(new URL("../sw.js", import.meta.url)).catch((error) => {
    console.error(error);
  });
}

function bindFeedback() {
  const dialog = document.getElementById("feedback-dialog");
  const openBtn = document.getElementById("feedback-open");
  const cancelBtn = document.getElementById("feedback-cancel");
  const sendBtn = document.getElementById("feedback-send");
  const comment = document.getElementById("feedback-comment");
  const extra = document.getElementById("feedback-extra");
  const thanks = document.getElementById("feedback-thanks");
  const github = document.getElementById("feedback-github");
  if (!dialog || !openBtn) return;

  let rating = null;
  let sentRating = false;

  if (github) github.href = FEEDBACK_GITHUB;

  function resetFeedback() {
    rating = null;
    sentRating = false;
    if (extra) extra.hidden = true;
    if (thanks) thanks.hidden = true;
    if (sendBtn) sendBtn.hidden = true;
    if (comment) comment.value = "";
    dialog.querySelectorAll("[data-rating]").forEach((btn) => {
      btn.classList.remove("is-active");
      btn.setAttribute("aria-pressed", "false");
    });
  }

  function chooseRating(value) {
    rating = value;
    dialog.querySelectorAll("[data-rating]").forEach((btn) => {
      const active = btn.dataset.rating === value;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
    if (thanks) thanks.hidden = false;
    if (extra) extra.hidden = false;
    if (sendBtn) sendBtn.hidden = false;
    if (!sentRating) {
      sentRating = true;
      track(value === "yes" ? "Feedback yes" : "Feedback no");
    }
  }

  openBtn.addEventListener("click", () => {
    resetFeedback();
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  });
  cancelBtn?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.querySelectorAll("[data-rating]").forEach((btn) => {
    btn.addEventListener("click", () => chooseRating(btn.dataset.rating));
  });
  sendBtn?.addEventListener("click", () => {
    if (!rating) return;
    const text = (comment?.value || "").trim();
    if (!text) {
      dialog.close();
      return;
    }
    track("Feedback message");
    const url = feedbackMailto(rating, text);
    dialog.close();
    window.location.href = url;
  });
}

function bindControls() {
  document.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (state.messageFilter === btn.dataset.filter) return;
      state.messageFilter = btn.dataset.filter;
      track(`Messages ${btn.dataset.filter}`);
      document.querySelectorAll("[data-filter]").forEach((other) => {
        const active = other === btn;
        other.classList.toggle("is-active", active);
        other.setAttribute("aria-pressed", String(active));
      });
      renderMessages();
    });
  });
  document.getElementById("day-prev").addEventListener("click", () => {
    track("Day prev");
    goToDay(-1);
  });
  document.getElementById("day-next").addEventListener("click", () => {
    track("Day next");
    goToDay(1);
  });
  document.getElementById("day-today").addEventListener("click", () => {
    track("Day today");
    goToDay(0);
  });
  bindLanguage();
  bindInstallPrompt();
  bindFeedback();

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) wake();
  });
  window.addEventListener("pageshow", wake);
  window.addEventListener("focus", wake);
}

export {
  FEEDBACK_MAIL,
  appMode,
  buildEvents,
  compareTimelineEvents,
  currentStatus,
  delayMinutes,
  feedbackMailto,
  ferryStatus,
  firstKnownQuay,
  homeQuay,
  isLiveFresh,
  liveStatus,
  minDeadheadMinutes,
  nextArrivalAt,
  nextDepartureFrom,
  parseVehicleMonitoring,
  quayPlace,
  track,
};

if (typeof document !== "undefined") {
  setLang(detectLang(), { persist: false });
  applyStaticTranslations();
  syncLangButtons();
  bindControls();
  registerServiceWorker();
  loadMessages();
  loadRoutes();
  scheduleTick();
  setInterval(loadMessages, 3 * 60 * 1000);
  track(`Visit ${getLang()}`, { app: appMode() }, { interactive: false });
  if (appMode() === "pwa") track("Visit pwa", null, { interactive: false });
}
