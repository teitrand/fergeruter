const MESSAGES_URL = "data/trafikkmeldinger.json";
const ROUTES_URL = "data/ruter.json";

const SEVERITY_LABEL = {
  normal: "Normal drift",
  delay: "Forsinking",
  cancelled: "Innstilt",
  capacity: "Kapasitet",
  info: "Melding",
};

const state = {
  filter: "route",
  alternativeId: "fra-trandal",
  messages: null,
  routes: null,
};

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
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function todayIso() {
  const parts = osloParts();
  return `${parts.year}-${parts.month}-${parts.day}`;
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

function formatDay(isoDate) {
  return new Intl.DateTimeFormat("nn-NO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T12:00:00Z`));
}

function clockMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function nowMinutesOslo() {
  const parts = osloParts();
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function minutesUntilTime(time) {
  const diff = clockMinutes(time) - nowMinutesOslo();
  if (diff < 1) return "no";
  if (diff < 60) return `om ${diff} min`;
  const hours = Math.floor(diff / 60);
  const minutes = diff % 60;
  return minutes ? `om ${hours} t ${minutes} min` : `om ${hours} t`;
}

function hhmm(time) {
  return time ? time.slice(0, 5) : "";
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

function selectedAlternative() {
  return (state.routes?.alternatives || []).find(
    (alt) => alt.id === state.alternativeId
  );
}

function tripsToday(alternative) {
  const today = todayIso();
  return (alternative?.trips || []).filter((trip) =>
    (trip.activeDates || []).includes(today)
  );
}

function renderMessages() {
  const root = document.getElementById("messages");
  const meta = document.getElementById("messages-meta");
  root.replaceChildren();
  if (!state.messages) {
    root.append(el("p", "empty", "Fann ikkje trafikkmeldingar."));
    return;
  }
  const all = validMessages(state.messages.messages || []);
  const filtered = applyFilter(all);
  meta.textContent = `Sist henta ${formatDateTime(state.messages.fetchedAt)}`;
  if (!filtered.length) {
    root.append(
      el(
        "p",
        "empty",
        state.filter === "route"
          ? "Ingen gjeldande Fjord1-meldingar for rute 1136."
          : "Ingen meldingar å vise."
      )
    );
    renderStatus(all);
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

function renderAlternativeButtons() {
  const root = document.getElementById("stops");
  root.replaceChildren();
  for (const alt of state.routes?.alternatives || []) {
    const btn = el("button", "chip", alt.label);
    btn.type = "button";
    btn.dataset.alternativeId = alt.id;
    const active = alt.id === state.alternativeId;
    btn.setAttribute("aria-pressed", String(active));
    if (active) btn.classList.add("is-active");
    btn.addEventListener("click", () => {
      state.alternativeId = alt.id;
      renderAlternativeButtons();
      renderDepartures();
    });
    root.append(btn);
  }
}

function renderDepartures() {
  const root = document.getElementById("departures");
  const meta = document.getElementById("departures-meta");
  root.replaceChildren();
  const alternative = selectedAlternative();
  if (!state.routes || !alternative) {
    root.append(el("p", "empty", "Fann ikkje rutetabell."));
    return;
  }
  const trips = tripsToday(alternative);
  meta.textContent = `${alternative.label} · ${formatDay(todayIso())}`;
  if (!trips.length) {
    root.append(el("p", "empty", "Ingen turar i tabellen for i dag."));
    return;
  }

  const now = nowMinutesOslo();
  const next = trips.find((trip) => clockMinutes(trip.departure) > now - 2);

  for (const trip of trips) {
    const when = clockMinutes(trip.departure);
    const past = when < now - 2;
    const isNext = next && trip.id === next.id;
    const row = el(
      "article",
      `departure${past ? " is-past" : ""}${isNext ? " is-next" : ""}`
    );
    row.append(el("div", "clock", hhmm(trip.departure)));
    const mid = el("div");
    mid.append(el("div", "dest", alternative.to));
    const sub = el("div", "sub");
    sub.textContent = trip.requestStop
      ? `På signal · framme ${hhmm(trip.arrival)}`
      : `Framme ${hhmm(trip.arrival)}`;
    mid.append(sub);
    row.append(mid);
    row.append(
      el("div", "eta", past ? "Gått" : isNext ? minutesUntilTime(trip.departure) : "")
    );
    root.append(row);
  }
}

async function loadMessages() {
  const meta = document.getElementById("messages-meta");
  try {
    const response = await fetch(MESSAGES_URL);
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
    if (state.routes.alternatives?.[0] && !selectedAlternative()) {
      state.alternativeId = state.routes.alternatives[0].id;
    }
    renderAlternativeButtons();
    renderDepartures();
  } catch (error) {
    meta.textContent = "Feil ved lasting av rutetabell";
    document.getElementById("departures").replaceChildren(
      el("p", "empty", "Rutetabellen er ikkje lasta ned enno.")
    );
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
loadMessages();
loadRoutes();
setInterval(() => {
  if (state.routes) renderDepartures();
}, 30 * 1000);
