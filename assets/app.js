const LINE_ID = "MOR:Line:1136";
const ENTUR_URL = "https://api.entur.io/journey-planner/v3/graphql";
const CLIENT_NAME = "teitrand-fergeruter";
const MESSAGES_URL = "data/trafikkmeldinger.json";

const STOPS = [
  { id: "NSR:StopPlace:58521", name: "Trandal" },
  { id: "NSR:StopPlace:39713", name: "Standal" },
  { id: "NSR:StopPlace:58765", name: "Sæbø" },
  { id: "NSR:StopPlace:41385", name: "Skår" },
  { id: "NSR:StopPlace:61752", name: "Valderøya" },
  { id: "NSR:StopPlace:39770", name: "Store Kalvøy" },
];

const SEVERITY_LABEL = {
  normal: "Normal drift",
  delay: "Forsinking",
  cancelled: "Innstilt",
  capacity: "Kapasitet",
  info: "Melding",
};

const DEPARTURE_QUERY = `
query ($id: String!) {
  stopPlace(id: $id) {
    name
    estimatedCalls(
      numberOfDepartures: 24
      timeRange: 86400
      includeCancelledTrips: true
      whiteListed: { lines: ["${LINE_ID}"] }
    ) {
      aimedDepartureTime
      expectedDepartureTime
      realtime
      cancellation
      destinationDisplay { frontText }
    }
  }
}
`;

const state = {
  filter: "route",
  stopId: STOPS[0].id,
  payload: null,
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function formatClock(iso) {
  return new Intl.DateTimeFormat("nn-NO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  }).format(new Date(iso));
}

function formatDateTime(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("nn-NO", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  }).format(new Date(iso));
}

function minutesUntil(iso) {
  const diff = Math.round((new Date(iso) - Date.now()) / 60000);
  if (diff < 1) return "no";
  if (diff < 60) return `om ${diff} min`;
  const hours = Math.floor(diff / 60);
  const minutes = diff % 60;
  return minutes ? `om ${hours} t ${minutes} min` : `om ${hours} t`;
}

function validMessages(messages) {
  const now = Date.now();
  return messages.filter((msg) => {
    if (!msg.validTo) return true;
    return new Date(msg.validTo).getTime() >= now - 60 * 60 * 1000;
  });
}

function applyFilter(messages) {
  if (state.filter === "route") return messages.filter((msg) => msg.isRoute1136);
  if (state.filter === "issues") {
    return messages.filter((msg) => msg.severity !== "normal");
  }
  return messages;
}

function renderMessages() {
  const root = document.getElementById("messages");
  const meta = document.getElementById("messages-meta");
  root.replaceChildren();
  if (!state.payload) {
    root.append(el("p", "empty", "Fann ikkje trafikkmeldingar."));
    return;
  }
  const all = validMessages(state.payload.messages || []);
  const filtered = applyFilter(all);
  meta.textContent = `Sist henta ${formatDateTime(state.payload.fetchedAt)}`;
  if (!filtered.length) {
    const empty = el(
      "p",
      "empty",
      state.filter === "route"
        ? "Ingen gjeldande Fjord1-meldingar for rute 1136."
        : "Ingen meldingar å vise."
    );
    root.append(empty);
    renderStatus(all);
    return;
  }
  for (const msg of filtered) {
    const card = el("article", `card is-${msg.severity}`);
    const title = el("h3", null, msg.heading || "Trafikkmelding");
    title.append(el("span", `badge badge-${msg.severity}`, SEVERITY_LABEL[msg.severity] || "Melding"));
    card.append(title, el("p", null, msg.text));
    const when = el("time", null, formatDateTime(msg.publishedAt));
    if (msg.publishedAt) when.dateTime = msg.publishedAt;
    card.append(when);
    root.append(card);
  }
  renderStatus(all);
}

function renderStatus(messages) {
  const banner = document.getElementById("status-banner");
  const routeMsgs = messages.filter((msg) => msg.isRoute1136);
  if (!routeMsgs.length) {
    banner.hidden = false;
    banner.className = "status-banner is-normal";
    banner.textContent = "Ingen aktive Fjord1-trafikkmeldingar for rute 1136.";
    return;
  }
  const latest = routeMsgs[0];
  banner.hidden = false;
  banner.className = `status-banner is-${latest.severity}`;
  banner.textContent = latest.text;
}

function renderStopButtons() {
  const root = document.getElementById("stops");
  root.replaceChildren();
  for (const stop of STOPS) {
    const btn = el("button", "chip", stop.name);
    btn.type = "button";
    btn.dataset.stopId = stop.id;
    btn.setAttribute("aria-pressed", String(stop.id === state.stopId));
    if (stop.id === state.stopId) btn.classList.add("is-active");
    btn.addEventListener("click", () => {
      state.stopId = stop.id;
      renderStopButtons();
      loadDepartures();
    });
    root.append(btn);
  }
}

function renderDepartures(calls, stopName) {
  const root = document.getElementById("departures");
  const meta = document.getElementById("departures-meta");
  root.replaceChildren();
  meta.textContent = stopName ? `Frå ${stopName}` : "Avganger";
  const upcoming = (calls || []).filter((call) => {
    const t = new Date(call.expectedDepartureTime || call.aimedDepartureTime);
    return t.getTime() > Date.now() - 2 * 60 * 1000;
  });
  if (!upcoming.length) {
    root.append(el("p", "empty", "Ingen fleire avganger i dag frå denne kaia."));
    return;
  }
  for (const call of upcoming.slice(0, 12)) {
    const expected = call.expectedDepartureTime || call.aimedDepartureTime;
    const delayed =
      call.aimedDepartureTime &&
      expected &&
      new Date(expected) - new Date(call.aimedDepartureTime) >= 60 * 1000;
    const row = el("article", `departure${call.cancellation ? " is-cancelled" : ""}`);
    row.append(el("div", "clock", formatClock(expected)));
    const mid = el("div");
    mid.append(el("div", "dest", call.destinationDisplay?.frontText || "Ferje"));
    const sub = el("div", "sub");
    if (call.cancellation) sub.textContent = "Innstilt";
    else if (delayed) sub.textContent = `Rutetid ${formatClock(call.aimedDepartureTime)}`;
    else if (call.realtime) {
      sub.append(el("span", "live-dot"), document.createTextNode("Sanntid"));
    } else sub.textContent = "Etter rute";
    mid.append(sub);
    row.append(mid);
    row.append(
      el(
        "div",
        "eta",
        call.cancellation ? "Innstilt" : minutesUntil(expected)
      )
    );
    root.append(row);
  }
}

async function loadMessages() {
  const meta = document.getElementById("messages-meta");
  try {
    const response = await fetch(`${MESSAGES_URL}?t=${Date.now()}`);
    if (!response.ok) throw new Error(response.statusText);
    state.payload = await response.json();
    renderMessages();
  } catch (error) {
    meta.textContent = "Klarte ikkje hente lokale Fjord1-data.";
    document.getElementById("messages").replaceChildren(
      el(
        "p",
        "empty",
        "Sjå trafikkmeldingane direkte hos Fjord1."
      )
    );
    console.error(error);
  }
}

async function loadDepartures() {
  const meta = document.getElementById("departures-meta");
  meta.textContent = "Hentar avganger…";
  try {
    const response = await fetch(ENTUR_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ET-Client-Name": CLIENT_NAME,
      },
      body: JSON.stringify({
        query: DEPARTURE_QUERY,
        variables: { id: state.stopId },
      }),
    });
    if (!response.ok) throw new Error(response.statusText);
    const payload = await response.json();
    if (payload.errors) throw new Error(payload.errors[0]?.message || "Entur-feil");
    const stop = payload.data?.stopPlace;
    renderDepartures(stop?.estimatedCalls, stop?.name);
  } catch (error) {
    document.getElementById("departures").replaceChildren(
      el("p", "empty", "Klarte ikkje hente avganger frå Entur nett no.")
    );
    meta.textContent = "Feil ved henting";
    console.error(error);
  }
}

function bindFilters() {
  document.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.filter = btn.dataset.filter;
      document.querySelectorAll("[data-filter]").forEach((other) => {
        const active = other === btn;
        other.classList.toggle("is-active", active);
        other.setAttribute("aria-pressed", String(active));
      });
      renderMessages();
    });
  });
}

bindFilters();
renderStopButtons();
loadMessages();
loadDepartures();
setInterval(loadDepartures, 60 * 1000);
setInterval(loadMessages, 5 * 60 * 1000);
