const MESSAGES_URL = "data/trafikkmeldinger.json";
const ROUTES_URL = "data/ruter.json";

const SEVERITY_LABEL = {
  normal: "Normal drift",
  delay: "Forsinking",
  cancelled: "Innstilt",
  capacity: "Kapasitet",
  info: "Melding",
};

const HOME_QUAYS = ["Trandal", "Standal"];

const state = {
  filter: "route",
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

function nowMinutes() {
  const parts = osloParts();
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function clockMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function hhmm(time) {
  return time ? time.slice(0, 5) : "";
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

function formatDateOnly(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("nn-NO", {
    day: "numeric",
    month: "long",
    year: "numeric",
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

function minutesUntil(time) {
  const diff = clockMinutes(time) - nowMinutes();
  if (diff < 1) return "no";
  if (diff < 60) return `om ${diff} min`;
  const hours = Math.floor(diff / 60);
  const minutes = diff % 60;
  return minutes ? `om ${hours} t ${minutes} min` : `om ${hours} t`;
}

function legsToday() {
  const today = todayIso();
  return (state.routes?.legs || [])
    .filter((leg) => (leg.activeDates || []).includes(today))
    .sort((a, b) => a.departure.localeCompare(b.departure));
}

/** Kvar ferja er akkurat no, rekna ut frå rutetabellen. */
function ferryStatus(legs) {
  if (!legs.length) return null;
  const now = nowMinutes();
  const first = legs[0];
  const last = legs[legs.length - 1];

  if (now < clockMinutes(first.departure)) {
    return {
      index: 0,
      text: `Ferja ligg til kai på ${first.from}. Fyrste avgang ${hhmm(first.departure)}.`,
    };
  }
  if (now >= clockMinutes(last.arrival)) {
    return {
      index: legs.length,
      text: `Ferja er ferdig for dagen på ${last.to}.`,
    };
  }

  for (let i = 0; i < legs.length; i += 1) {
    const leg = legs[i];
    if (now >= clockMinutes(leg.departure) && now < clockMinutes(leg.arrival)) {
      return { index: i, underway: true, text: `Ferja er på veg mot ${leg.to}` };
    }
    const next = legs[i + 1];
    if (next && now >= clockMinutes(leg.arrival) && now < clockMinutes(next.departure)) {
      const text =
        leg.to === next.from
          ? `Ferja ligg til kai på ${leg.to}`
          : `Ferja ligg til kai på ${leg.to}. Neste avgang går frå ${next.from}.`;
      return { index: i + 1, text };
    }
  }
  return null;
}

function nextDepartureFrom(legs, quay) {
  const now = nowMinutes();
  return legs.find((leg) => leg.from === quay && clockMinutes(leg.departure) >= now);
}

function renderNextSummary(legs) {
  const root = document.getElementById("next-summary");
  root.replaceChildren();
  if (!legs.length) return;
  for (const quay of HOME_QUAYS) {
    const leg = nextDepartureFrom(legs, quay);
    const item = el("div", "next-item");
    item.append(el("span", "next-label", `Neste frå ${quay}`));
    item.append(
      el("span", "next-time", leg ? hhmm(leg.departure) : "—")
    );
    item.append(
      el("span", "next-sub", leg ? `mot ${leg.to} · ${minutesUntil(leg.departure)}` : "ingen fleire i dag")
    );
    root.append(item);
  }
}

function departureRow(leg, past) {
  const row = el("div", `stop stop-dep${past ? " is-past" : ""}`);
  row.append(el("span", "stop-time", hhmm(leg.departure)));
  const body = el("span", "stop-body");
  body.append(el("span", "stop-name", `Frå ${leg.from}`));
  if (leg.requestStop) body.append(el("span", "stop-tag", "på signal"));
  row.append(body);
  row.append(el("span", "stop-state", past ? "Gått" : minutesUntil(leg.departure)));
  return row;
}

function arrivalRow(leg, past) {
  const row = el("div", `stop stop-arr${past ? " is-past" : ""}`);
  row.append(el("span", "stop-time", hhmm(leg.arrival)));
  const body = el("span", "stop-body");
  body.append(el("span", "stop-name", `Ankomst ${leg.to}`));
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

function renderTimeline() {
  const root = document.getElementById("departures");
  const meta = document.getElementById("departures-meta");
  root.replaceChildren();
  if (!state.routes) {
    root.append(el("p", "empty", "Fann ikkje rutetabell."));
    return;
  }
  const legs = legsToday();
  meta.textContent = formatDay(todayIso());
  renderNextSummary(legs);
  if (!legs.length) {
    root.append(el("p", "empty", "Ingen turar i tabellen for i dag."));
    return;
  }

  const status = ferryStatus(legs);
  const now = nowMinutes();

  legs.forEach((leg, index) => {
    if (status && status.index === index && !status.underway) {
      root.append(statusRow(status));
    }
    root.append(departureRow(leg, clockMinutes(leg.departure) <= now));
    if (status && status.index === index && status.underway) {
      root.append(statusRow(status));
    }
    root.append(arrivalRow(leg, clockMinutes(leg.arrival) <= now));
  });

  if (status && status.index >= legs.length) {
    root.append(statusRow(status));
  }
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
    renderTimeline();
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
  if (state.routes) renderTimeline();
}, 30 * 1000);
