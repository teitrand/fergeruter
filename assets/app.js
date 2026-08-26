const MESSAGES_URL = "data/trafikkmeldinger.json";
const ROUTES_URL = "data/ruter.json";
const CONNECTIONS_URL = "data/korrespondanse.json";

const SEVERITY_LABEL = {
  normal: "Normal drift",
  delay: "Forsinking",
  cancelled: "Innstilt",
  capacity: "Kapasitet",
  info: "Melding",
};

const state = {
  messageFilter: "local",
  stopFilter: null,
  date: null,
  showPast: false,
  messages: null,
  routes: null,
  connection: null,
  connections: null,
};

let renderedDate = null;
let tickTimer = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
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

// Skrivne ut for hand: nettlesarar utan nynorsk i ICU fell tilbake til engelsk.
const WEEKDAYS = [
  "søndag",
  "måndag",
  "tysdag",
  "onsdag",
  "torsdag",
  "fredag",
  "laurdag",
];
const MONTHS = [
  "januar",
  "februar",
  "mars",
  "april",
  "mai",
  "juni",
  "juli",
  "august",
  "september",
  "oktober",
  "november",
  "desember",
];

function weekdayOf(isoDate) {
  return WEEKDAYS[new Date(`${isoDate}T12:00:00Z`).getUTCDay()];
}

function formatDay(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${weekdayOf(isoDate)} ${day}. ${MONTHS[month - 1]}`;
}

function formatDateOnly(iso) {
  if (!iso) return "";
  const parts = osloParts(new Date(iso));
  return `${Number(parts.day)}. ${MONTHS[Number(parts.month) - 1]} ${parts.year}`;
}

function formatDateTime(iso) {
  if (!iso) return "";
  const parts = osloParts(new Date(iso));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const month = MONTHS[Number(parts.month) - 1].slice(0, 3);
  return `${weekdayOf(date)} ${Number(parts.day)}. ${month}. ${parts.hour}:${parts.minute}`;
}

function durationText(minutes) {
  if (minutes < 1) return "no";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} t ${rest} min` : `${hours} t`;
}

function countdown(time) {
  return `om ${durationText(minutesLeft(time))}`;
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

/** Kvar ferja er akkurat no, rekna ut frå rutetabellen. */
function ferryStatus(legs) {
  if (!legs.length) return null;
  const now = nowMinutes();
  const first = legs[0];
  const last = legs[legs.length - 1];

  if (now < clockMinutes(first.departure)) {
    return {
      at: clockMinutes(first.departure) - 1,
      short: `Ferja ligg til kai på ${first.from}`,
      text: `Ferja ligg til kai på ${first.from}. Fyrste avgang ${hhmm(first.departure)}.`,
    };
  }
  if (now >= clockMinutes(last.arrival)) {
    return {
      at: 1441,
      short: `Ferja er ferdig for dagen på ${last.to}`,
      text: `Ferja er ferdig for dagen på ${last.to}.`,
    };
  }

  for (let i = 0; i < legs.length; i += 1) {
    const leg = legs[i];
    if (now >= clockMinutes(leg.departure) && now < clockMinutes(leg.arrival)) {
      return {
        at: clockMinutes(leg.departure) + 0.5,
        underway: true,
        text: `Ferja er på veg mot ${leg.to}`,
      };
    }
    const next = legs[i + 1];
    if (next && now >= clockMinutes(leg.arrival) && now < clockMinutes(next.departure)) {
      const moving = leg.to !== next.from;
      return {
        at: clockMinutes(leg.arrival) + 0.5,
        underway: moving,
        text: moving
          ? `Ferja går til ${next.from} utan passasjerar`
          : `Ferja ligg til kai på ${leg.to}`,
      };
    }
  }
  return null;
}

function nextDepartureFrom(legs, quay) {
  return legs.find((leg) => leg.from === quay && (!isToday() || !hasPassed(leg.departure)));
}

/** Fyrste avgangen på ein seinare dag, så boksen ikkje står tom om kvelden. */
function lookAhead(fromDate, matches, maxDays = 7) {
  for (let step = 1; step <= maxDays; step += 1) {
    const date = shiftIso(fromDate, step);
    const leg = legsForDate(date).find(matches);
    if (leg) return { date, leg };
  }
  return null;
}

function dayPrefix(date) {
  if (date === shiftIso(todayIso(), 1)) return "i morgon";
  return formatDay(date);
}

/** Éin boks, for kaia du har valt. Utan val: den neste avgangen som helst. */
function renderNextSummary(legs) {
  const root = document.getElementById("next-summary");
  root.replaceChildren();
  const quay = state.stopFilter;
  const matches = (leg) => !quay || leg.from === quay;

  let leg = legs.find((candidate) => matches(candidate) && (!isToday() || !hasPassed(candidate.departure)));
  let legDate = selectedDate();
  let prefix = "";
  if (!leg) {
    const ahead = lookAhead(selectedDate(), matches);
    if (ahead) {
      leg = ahead.leg;
      legDate = ahead.date;
      prefix = dayPrefix(ahead.date);
    }
  }
  if (!leg) return;

  const live = legDate === todayIso();
  const item = el("div", "next-item");
  const head = el("span", "next-head");
  head.append(el("span", "next-label", `Neste frå ${quay || leg.from}`));
  if (leg.signal) head.append(el("span", "stop-tag", "På signal"));
  item.append(head);
  item.append(el("span", "next-time", hhmm(leg.departure)));

  const bits = [];
  if (prefix) bits.push(prefix);
  bits.push(`mot ${leg.to}`);
  if (live) bits.push(countdown(leg.departure));
  item.append(el("span", "next-sub", bits.join(" · ")));

  const note = signalNote(leg, live);
  if (note) item.append(note);
  const connection = connectionNote(connectionIndex(legDate), "dep", leg);
  if (connection) item.append(el("span", "stop-note stop-conn", connection));
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
      ? `Ta ferja ${hhmm(trip.departure)} frå ${trip.from} for å rekke denne`
      : `Ingen korresponderande ferje frå ${index.hub}-sida`;
  }
  const trip = outboundConnection(index, leg.arrival);
  return trip
    ? `Vidare ${hhmm(trip.departure)} frå ${index.hub} mot ${trip.to}`
    : `Ingen korresponderande ferje frå ${index.hub} etterpå`;
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
  const label = `Ring innan ${minutesToClock(deadline)}`;
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
      note.append(el("span", "stop-left", `${countdown(deadlineClock)} igjen å tinge`));
    } else if (!hasPassed(leg.departure)) {
      note.append(el("span", "stop-expired", "fristen er ute"));
    }
  }
  return note;
}

function departureRow(leg, past, index) {
  const row = el("div", `stop stop-dep${past ? " is-past" : ""}`);
  row.append(el("span", "stop-time", hhmm(leg.departure)));
  const body = el("span", "stop-body");
  const head = el("span", "stop-head");
  head.append(el("span", "stop-name", `Frå ${leg.from}`));
  if (leg.signal) head.append(el("span", "stop-tag", "På signal"));
  body.append(head);
  const note = signalNote(leg, isToday());
  if (note) body.append(note);
  const connection = connectionNote(index, "dep", leg);
  if (connection) body.append(el("span", "stop-note stop-conn", connection));
  row.append(body);
  const remaining = past ? "Gått" : isToday() ? countdown(leg.departure) : "";
  row.append(el("span", "stop-state", remaining));
  return row;
}

function arrivalRow(leg, past, index) {
  const row = el("div", `stop stop-arr${past ? " is-past" : ""}`);
  row.append(el("span", "stop-time", hhmm(leg.arrival)));
  const body = el("span", "stop-body");
  body.append(el("span", "stop-name", `Ankomst ${leg.to}`));
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
  body.append(el("span", "stop-name", `Ferja flyttar seg til ${to}`));
  body.append(
    el(
      "span",
      "stop-note",
      crossesArea(from, to)
        ? `Ikkje persontrafikk mellom ${from} og ${to}`
        : "Utan passasjerar"
    )
  );
  row.append(body);
  row.append(el("span", "stop-state", ""));
  return row;
}

function statusRow(status) {
  const row = el("div", `now${status.underway ? " is-underway" : " is-moored"}`);
  row.append(el("span", "now-label", "Nå"));
  row.append(el("span", "now-text", status.text));
  return row;
}

function matchesStop(quays) {
  if (!state.stopFilter) return true;
  return quays.includes(state.stopFilter);
}

function buildEvents(legs, connections) {
  const events = [];
  legs.forEach((leg, index) => {
    events.push({
      at: clockMinutes(leg.departure),
      quays: [leg.from],
      build: (past) => departureRow(leg, past, connections),
    });
    events.push({
      at: clockMinutes(leg.arrival) + 0.1,
      quays: [leg.to],
      build: (past) => arrivalRow(leg, past, connections),
    });
    const next = legs[index + 1];
    if (next && leg.to !== next.from) {
      events.push({
        at: clockMinutes(leg.arrival) + 0.2,
        quays: [leg.to, next.from],
        build: (past) => transferRow(leg.to, next.from, past),
      });
    }
  });
  return events;
}

function renderStopFilter(legs) {
  const root = document.getElementById("stop-filter");
  root.replaceChildren();
  const quays = quaysInDay(legs);
  if (quays.length < 2) return;
  if (state.stopFilter && !quays.includes(state.stopFilter)) state.stopFilter = null;
  const options = [{ value: null, label: "Alle stopp" }].concat(
    quays.map((quay) => ({ value: quay, label: quay }))
  );
  for (const option of options) {
    const btn = el("button", "chip", option.label);
    btn.type = "button";
    const active = state.stopFilter === option.value;
    btn.setAttribute("aria-pressed", String(active));
    if (active) btn.classList.add("is-active");
    btn.addEventListener("click", () => {
      state.stopFilter = option.value;
      renderTimeline();
    });
    root.append(btn);
  }
}

function renderConnectionFilter() {
  const root = document.getElementById("conn-filter");
  const note = document.getElementById("connection-note");
  root.replaceChildren();
  const options = [{ value: null, label: "Ingen" }].concat(
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
    btn.addEventListener("click", () => selectConnection(option.value));
    root.append(btn);
  }
  const data = state.connections;
  note.textContent =
    state.connection && data
      ? `Korrespondansen reknar ${data.driveMinutes} min køyring ${data.hub}–${data.roadTo} pluss ${data.marginMinutes} min margin.`
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
      document.getElementById("connection-note").textContent =
        "Klarte ikkje hente korresponderande ruter.";
      console.error(error);
    }
  }
  renderConnectionFilter();
  renderLive();
}

function renderDayNav() {
  const label = document.getElementById("day-label");
  if (label) label.textContent = formatDay(selectedDate());
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
    lede.textContent = "Ingen turar i rutetabellen i dag.";
    return;
  }
  const status = ferryStatus(legs);
  const next = legs.find((leg) => !hasPassed(leg.departure));
  const parts = [];
  if (status) parts.push(status.short || status.text.replace(/\.$/, ""));
  if (next) {
    parts.push(
      `Neste avgang ${hhmm(next.departure)} frå ${next.from}, ${countdown(next.departure)}`
    );
  }
  lede.hidden = false;
  lede.textContent = `${parts.join(". ")}.`;
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
      renderLive();
    });
    wrap.replaceChildren(button);
  }
  button.textContent = state.showPast
    ? "Skjul tidlegare anløp"
    : `Vis ${pastCount} tidlegare anløp`;
}

/** Alt som endrar seg med klokka. Køyrer kvart minutt utan å byggje om resten. */
function renderLive() {
  const root = document.getElementById("departures");
  const meta = document.getElementById("departures-meta");
  root.replaceChildren();
  if (!state.routes) {
    root.append(el("p", "empty", "Fann ikkje rutetabell."));
    return;
  }
  const legs = legsForDate(selectedDate());
  renderDayNav();
  renderNextSummary(legs);
  meta.textContent = isToday() ? "I dag" : formatDay(selectedDate());

  if (!legs.length) {
    renderReveal(0);
    root.append(el("p", "empty", "Ingen turar i tabellen denne dagen."));
    return;
  }

  const events = buildEvents(legs, connectionIndex(selectedDate())).filter((event) =>
    matchesStop(event.quays)
  );
  const status = isToday() ? ferryStatus(legs) : null;
  if (status) {
    events.push({ at: status.at, status: true, build: () => statusRow(status) });
  }
  events.sort((a, b) => a.at - b.at);

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
  meta.textContent = `Sist henta ${formatDateTime(state.messages.fetchedAt)}`;
  if (!filtered.length) {
    root.append(
      el(
        "p",
        "empty",
        state.messageFilter === "issues"
          ? "Ingen avvik i området no."
          : "Ingen gjeldande meldingar for området."
      )
    );
    renderBanner(all);
    return;
  }
  for (const msg of filtered) {
    const card = el("article", `card is-${msg.severity}`);
    const title = el("h3", null, msg.heading || "Trafikkmelding");
    title.append(
      el("span", `badge badge-${msg.severity}`, SEVERITY_LABEL[msg.severity] || "Melding")
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
    banner.textContent = "Ingen trafikkmeldingar i Hjørundfjorden no.";
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
    meta.textContent = "Klarte ikkje hente lokale Fjord1-data.";
    document.getElementById("messages").replaceChildren(
      el("p", "empty", "Sjå trafikkmeldingane direkte hos Fjord1.")
    );
    console.error(error);
  }
}

async function loadRoutes() {
  const meta = document.getElementById("departures-meta");
  try {
    const response = await fetch(ROUTES_URL);
    if (!response.ok) throw new Error(response.statusText);
    state.routes = await response.json();
    renderTimeline();
    renderLedeStatus();
    const updated = document.getElementById("timetable-updated");
    if (updated && state.routes.fetchedAt) {
      updated.textContent = `Sist lasta ned ${formatDateOnly(state.routes.fetchedAt)}. `;
    }
  } catch (error) {
    meta.textContent = "Feil ved lasting av rutetabell";
    document.getElementById("departures").replaceChildren(
      el("p", "empty", "Rutetabellen er ikkje lasta ned enno.")
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
function tick() {
  if (!state.routes) return;
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

function bindControls() {
  document.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.messageFilter = btn.dataset.filter;
      document.querySelectorAll("[data-filter]").forEach((other) => {
        const active = other === btn;
        other.classList.toggle("is-active", active);
        other.setAttribute("aria-pressed", String(active));
      });
      renderMessages();
    });
  });
  document.getElementById("day-prev").addEventListener("click", () => goToDay(-1));
  document.getElementById("day-next").addEventListener("click", () => goToDay(1));
  document.getElementById("day-today").addEventListener("click", () => goToDay(0));

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) wake();
  });
  window.addEventListener("pageshow", wake);
  window.addEventListener("focus", wake);
}

bindControls();
loadMessages();
loadRoutes();
scheduleTick();
setInterval(loadMessages, 3 * 60 * 1000);
