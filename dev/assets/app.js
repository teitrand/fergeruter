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
const KOMBI_URL = "data/kombirute.json";
const CONNECTIONS_URL = "data/korrespondanse.json";
const LIVE_VM_URLS = {
  1136: "https://api.entur.io/realtime/v1/rest/vm?datasetId=MOR&LineRef=MOR:Line:1136",
  1135: "https://api.entur.io/realtime/v1/rest/vm?datasetId=MOR&LineRef=MOR:Line:1135",
};
const ENTUR_CLIENT = "teitrand-fergeruter";
const HOME_QUAY = "Standal";
const LIVE_MAX_AGE_MS = 3 * 60 * 1000;
const FEEDBACK_MAIL = "teitrand@hotmail.com";
const FEEDBACK_GITHUB = "https://github.com/teitrand/fergeruter/issues/new";
const KOMBI_PDF =
  "https://frammr.no/_f/p2/i2e02cdba-2cdc-4a23-b9bf-f6a6bd437bbe/kombinasjonsrute-sabo-leknes-skar-trandal-standal-20251118.pdf";
const FJORD1_PDF =
  "https://www.fjord1.no/ruteoversikt/moere-og-romsdal/standal-trandal-valderoeya-store-kalvoey/(page)/pdf";
const ALLOWED_MODES = new Set(["1136", "1135", "kombi"]);
const NORMAL_RE = /normal drift/i;
const CANCEL_RE = /innstilt|innstilling/i;
const KOMBI_RE = /kombinasjon|kombirute|kombinert rute/i;
const HAS_1135_RE = /\b1135\b/;
const HAS_1136_RE = /\b1136\b/;
const HIDE_ARRIVALS_KEY = "fergeruter-hide-arrivals";
const TIMETABLE_CACHE_KEY = "fergeruter-timetable-v1";
const MESSAGES_POLL_MS = 3 * 60 * 1000;
const LIVE_MIN_INTERVAL_MS = 55 * 1000;
const LIVE_BACKOFF_START_MS = 60 * 1000;
const LIVE_MAX_BACKOFF_MS = 15 * 60 * 1000;
const LIVE_SERVICE_MARGIN_MIN = 30;
const WAKE_DEBOUNCE_MS = 400;
const VESSEL_UTFORT_RE = /utført av\s+(?:m\/?f\.?\s*)?(geiranger|kvernes)/i;
const DEFAULT_VESSELS = [
  { name: "M/F Geiranger", phone: "916 69 321" },
  { name: "M/F Kvernes", phone: "916 69 340" },
];

const state = {
  messageFilter: "local",
  stopFilter: null,
  date: null,
  showPast: false,
  hideArrivals: false,
  messages: null,
  routes: null,
  kombirute: null,
  connection: null,
  connections: null,
  live: null,
  liveFetchedAt: 0,
  liveBackoffMs: 0,
  liveBlockedUntil: 0,
};

let renderedDate = null;
let lastLiveStructureKey = null;
let tickTimer = null;
let messagesTimer = null;
let messagesInflight = null;
let wakeTimer = null;
let bootedAt = 0;

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

function nowMinutes(ms = Date.now()) {
  const parts = osloParts(new Date(ms));
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

function previewLocation(loc) {
  if (loc) return loc;
  if (typeof location !== "undefined") return location;
  return null;
}

/** Testhost /dev/ les produksjonsfila. Action oppdaterer berre main. */
function messagesUrl(loc) {
  const here = previewLocation(loc);
  const path = String(here?.pathname || "");
  if (!path.includes("/dev/")) return MESSAGES_URL;
  try {
    let origin = here.origin;
    if (!origin && here.href) origin = new URL(here.href).origin;
    if (!origin) return MESSAGES_URL;
    const prefix = path.slice(0, path.indexOf("/dev/"));
    return `${origin}${prefix}/data/trafikkmeldinger.json`;
  } catch {
    return MESSAGES_URL;
  }
}

/** Lokal utvikling og /dev/ på Pages. Produksjon tek ikkje ?rute=. */
function isPreview(loc) {
  const here = previewLocation(loc);
  if (!here) return false;
  const host = here.hostname || "";
  const path = here.pathname || "";
  return host === "localhost" || host === "127.0.0.1" || path.includes("/dev/");
}

function routeOverride(loc) {
  const here = previewLocation(loc);
  if (!isPreview(here)) return null;
  try {
    const raw = new URL(here.href, "https://teitrand.github.io").searchParams.get("rute");
    return ALLOWED_MODES.has(raw) ? raw : null;
  } catch {
    return null;
  }
}

function parseClockToken(raw) {
  const text = String(raw || "").trim();
  const match = text.match(/^(\d{1,2})[:.](\d{2})$/) || text.match(/^(\d{2})(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

function beforeModeFor(after, text) {
  if (after === "1136") return KOMBI_RE.test(text || "") ? "kombi" : "1135";
  return "1136";
}

const HJORUNDFJORD_RE =
  /\b(?:1135|1136)\b|trandal|standal|sæbø|skår|lekne|valderøy|store kalvøy|kombinasjon|kombirute|kombinert rute/i;
const ONLY_1049_RE = /\b1049\b|festøy|hundeidvik/i;
const WEEKDAY_TOKEN =
  "(?:mandag|tysdag|tirsdag|onsdag|torsdag|fredag|laurdag|lørdag|søndag)\\s+";
const NUMDATE_TOKEN = "(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{2,4}))?";

function messageBlob(msg) {
  if (typeof msg === "string") return msg || "";
  return `${msg?.heading || ""} ${msg?.text || ""}`;
}

function is1049Only(heading, text) {
  const blob = `${heading || ""} ${text || ""}`;
  return ONLY_1049_RE.test(blob) && !HJORUNDFJORD_RE.test(blob);
}

function isRouteControl(msg) {
  if (!msg) return false;
  if (msg.isRouteControl === true) return true;
  if (msg.isRouteControl === false) return false;
  const heading = msg.heading || "";
  const text = msg.text || "";
  if (is1049Only(heading, text)) return false;
  if (msg.isLocal === false) return false;
  if (msg.isLocal === true) return true;
  return HJORUNDFJORD_RE.test(`${heading} ${text}`);
}

function osloIsoFromMs(ms = Date.now()) {
  const parts = osloParts(new Date(ms));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function parseNumDate(day, month, year, refIso) {
  const d = Number(day);
  const m = Number(month);
  if (!d || !m || m > 12 || d > 31) return null;
  const ref = refIso || osloIsoFromMs();
  const refYear = Number(ref.slice(0, 4));
  let y = year ? Number(year) : refYear;
  if (y && y < 100) y += 2000;
  if (!year) {
    const candidate = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const diff =
      (Date.parse(`${ref}T12:00:00Z`) - Date.parse(`${candidate}T12:00:00Z`)) /
      86400000;
    if (diff > 45) y += 1;
  }
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return Number.isNaN(Date.parse(`${iso}T12:00:00Z`)) ? null : iso;
}

function windowFromText(text, published) {
  const blob = text || "";
  const ref = osloIsoFromInstant(published) || osloIsoFromMs();
  const range = blob.match(
    new RegExp(
      `(?:frå|fra)\\s+(?:rutestart\\s+)?(?:${WEEKDAY_TOKEN})?${NUMDATE_TOKEN}\\s+(?:til(?:\\s+og\\s+med)?|tom)\\s+(?:${WEEKDAY_TOKEN})?${NUMDATE_TOKEN}`,
      "i"
    )
  );
  if (range) {
    const start = parseNumDate(range[1], range[2], range[3], ref);
    const end = parseNumDate(range[4], range[5], range[6], ref);
    if (start || end) return { from: start, to: end };
  }
  const fromMatch = blob.match(
    new RegExp(`(?:frå|fra)\\s+(?:rutestart\\s+)?(?:${WEEKDAY_TOKEN})?${NUMDATE_TOKEN}`, "i")
  );
  const untilMatch = blob.match(
    new RegExp(`til\\s+og\\s+med\\s+(?:${WEEKDAY_TOKEN})?${NUMDATE_TOKEN}`, "i")
  );
  const start = fromMatch ? parseNumDate(fromMatch[1], fromMatch[2], fromMatch[3], ref) : null;
  const end = untilMatch
    ? parseNumDate(untilMatch[1], untilMatch[2], untilMatch[3], ref)
    : null;
  if (start || end) return { from: start, to: end };
  return null;
}

function activateAtFromText(text) {
  const match = String(text || "").match(
    /normal drift.{0,40}(?:frå|fra)\s+(?:klokka|kl\.?)\s*(?:ca\.?\s*)?(\d{1,2})[:.](\d{2})/is
  );
  return match ? parseClockToken(`${match[1]}:${match[2]}`) : null;
}

/** Skøyt berre når meldinga seier at tabellen byter («kombirute frå klokka»). */
function switchFromText(text, afterMode = null) {
  const blob = text || "";
  const after = afterMode || modeFromText(blob);
  const kombiClock = blob.match(
    /(?:kombinasjon\w*|kombirute|kombinert rute)[\s\S]{0,80}(?:frå|fra)\s+(?:klokka|kl\.?)\s*(?:ca\.?\s*)?(\d{1,2})[:.](\d{2})/i
  );
  const performed = blob.match(
    /(?:utført|gjeld)\s+frå\s+(?:klokka\s+|kl\.?\s*)?(?:ca\.?\s*)?(\d{1,2})[:.](\d{2})/i
  );
  const match = kombiClock || performed;
  if (!match) return null;
  const time = parseClockToken(`${match[1]}:${match[2]}`);
  if (!time) return null;
  return {
    time,
    quay: null,
    before: beforeModeFor(after, blob),
    after,
    acute: null,
  };
}

function switchOverride(loc) {
  const here = previewLocation(loc);
  if (!isPreview(here)) return null;
  try {
    const params = new URL(here.href, "https://teitrand.github.io").searchParams;
    const time = parseClockToken(params.get("frå") || params.get("fra"));
    if (!time) return null;
    const mode = routeOverride(here) || "kombi";
    const acuteFlag = params.get("akutt");
    const notice = parseClockToken(params.get("melding") || params.get("varsla"));
    return {
      time,
      quay: null,
      before: ALLOWED_MODES.has(params.get("før")) ? params.get("før") : beforeModeFor(mode, ""),
      after: mode,
      notice,
      acute: acuteFlag === "1" || acuteFlag === "true" ? true : acuteFlag === "0" ? false : null,
    };
  } catch {
    return null;
  }
}

function osloIsoFromInstant(iso) {
  if (!iso) return null;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  const parts = osloParts(when);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function quayAtStart(mode, date, time) {
  const hits = sortDayLegs(legsForMode(mode, date).filter((leg) => leg.departure === time));
  return hits[0] ? quayPlace(hits[0].from) : null;
}

function resolveSwitch(raw, date) {
  if (!raw) return null;
  const after = raw.after;
  return {
    ...raw,
    after,
    quay: quayAtStart(after, date, raw.time),
  };
}

function clockFromInstant(iso) {
  if (!iso) return null;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  const parts = osloParts(when);
  return `${parts.hour}:${parts.minute}:00`;
}

function clockFromNow() {
  const parts = osloParts();
  return `${parts.hour}:${parts.minute}:00`;
}

/** Klokka meldinga kom. Berre same dag som tabellen gjev eit usikkert hol. */
function resolveNotice(raw, date) {
  if (raw?.notice) return raw.notice;
  if (raw?.acute === true) return date === todayIso() ? clockFromNow() : "00:00:00";
  if (raw?.acute === false) return null;
  const latest = latestLocalMessage();
  const iso = latest?.publishedAt || latest?.validFrom;
  if (!iso || osloIsoFromInstant(iso) !== date) return null;
  return clockFromInstant(iso);
}

function isUncertainDeparture(departure, notice, switchTime) {
  if (!notice || !switchTime) return false;
  const dep = clockMinutes(departure);
  return dep > clockMinutes(notice) && dep < clockMinutes(switchTime);
}

function modeFromText(text) {
  const blob = text || "";
  const hasNormal = NORMAL_RE.test(blob);
  const hasCancel = CANCEL_RE.test(blob);
  const hasKombi = KOMBI_RE.test(blob);
  const has1135 = HAS_1135_RE.test(blob);
  const has1136 = HAS_1136_RE.test(blob);
  if (hasNormal && hasCancel && !hasKombi) return "1136";
  if (hasKombi || (hasCancel && has1135 && has1136)) return "kombi";
  if (hasCancel && has1136 && !has1135) return "1135";
  return "1136";
}

function messageMode(msg) {
  if (!msg) return "1136";
  return msg.routeMode || modeFromText(messageBlob(msg));
}

function publishedMs(msg) {
  const ms = Date.parse(msg?.publishedAt || msg?.validFrom || "");
  return Number.isFinite(ms) ? ms : 0;
}

function messageWindow(msg) {
  const textWin =
    msg.routeWindow || windowFromText(messageBlob(msg), msg.publishedAt || msg.validFrom);
  const fromDate =
    textWin?.from || osloIsoFromInstant(msg.validFrom) || osloIsoFromInstant(msg.publishedAt);
  const toDate = textWin?.to || osloIsoFromInstant(msg.validTo);
  return { from: fromDate || null, to: toDate || null };
}

function messageAppliesToDate(msg, date, now = Date.now()) {
  if (!isRouteControl(msg)) return false;
  const today = osloIsoFromMs(now);
  if (msg.validTo) {
    const until = new Date(msg.validTo).getTime();
    if (Number.isFinite(until) && now > until + 60 * 60 * 1000 && date >= today) {
      return false;
    }
  }
  const win = messageWindow(msg);
  if (win.from && date < win.from) return false;
  if (win.to && date > win.to) return false;
  return true;
}

function controllingMessages(messages, date, now = Date.now()) {
  return validMessages(messages || [], now)
    .filter((msg) => messageAppliesToDate(msg, date, now))
    .sort((a, b) => publishedMs(b) - publishedMs(a));
}

function firstDayOf(msg) {
  const win = messageWindow(msg);
  return win.from || osloIsoFromInstant(msg.publishedAt) || osloIsoFromInstant(msg.validFrom);
}

function resolveRoutePlan(messages, now = Date.now(), date = osloIsoFromMs(now)) {
  const matches = controllingMessages(messages, date, now);
  const latest = matches[0];
  if (!latest) return { mode: "1136", switch: null, message: null };
  const mode = messageMode(latest);
  const blob = messageBlob(latest);
  let parsed = latest.routeSwitch || switchFromText(blob, mode);
  const activateAt = latest.activateAt || activateAtFromText(blob);
  if (!parsed && activateAt && date === firstDayOf(latest)) {
    const previous = matches[1];
    const before = previous ? messageMode(previous) : null;
    if (before && before !== mode) {
      parsed = { time: activateAt, quay: null, before, after: mode, acute: null };
    }
  }
  return { mode, switch: parsed, message: latest };
}

function routeModeFromMessages(messages, now = Date.now(), date = osloIsoFromMs(now)) {
  return resolveRoutePlan(messages, now, date).mode;
}

function routeSwitchFromMessages(messages, now = Date.now(), date = osloIsoFromMs(now)) {
  return resolveRoutePlan(messages, now, date).switch;
}

function activePlan(date = selectedDate()) {
  const fromQuery = switchOverride();
  const resolved = resolveRoutePlan(state.messages?.messages, Date.now(), date);
  const mode = routeOverride() || (fromQuery ? fromQuery.after : resolved.mode) || "1136";
  const parsed = fromQuery || resolved.switch;
  if (!parsed || (parsed.after || mode) !== mode) {
    return { mode, switch: null, notice: null, uncertain: false };
  }
  const routeSwitch = resolveSwitch(parsed, date);
  const notice = resolveNotice(parsed, date);
  return {
    mode: routeSwitch.after || mode,
    switch: { ...routeSwitch, notice },
    notice,
    uncertain: Boolean(notice && clockMinutes(notice) < clockMinutes(routeSwitch.time)),
  };
}

function titleVessel(name) {
  const key = String(name || "").toLowerCase();
  if (key === "geiranger") return "Geiranger";
  if (key === "kvernes") return "Kvernes";
  return null;
}

function vesselFromText(text) {
  const blob = text || "";
  const performed = blob.match(VESSEL_UTFORT_RE);
  if (performed) return titleVessel(performed[1]);
  const names = [...blob.matchAll(/\b(?:m\/?f\.?\s*)?(geiranger|kvernes)\b/gi)].map((match) =>
    match[1].toLowerCase()
  );
  const unique = [...new Set(names)];
  if (unique.length === 1) return titleVessel(unique[0]);
  return null;
}

function latestLocalMessage(now = Date.now()) {
  const plan = resolveRoutePlan(state.messages?.messages, now, selectedDate());
  if (plan.message) return plan.message;
  return validMessages(state.messages?.messages || [], now).find((msg) => msg.isLocal) || null;
}

function activeVessel() {
  const latest = latestLocalMessage();
  if (!latest) return null;
  return latest.vessel || vesselFromText(`${latest.heading || ""} ${latest.text || ""}`);
}

function vesselInfo(name) {
  const vessels = state.kombirute?.vessels || DEFAULT_VESSELS;
  if (!name) return null;
  return (
    vessels.find((item) => item.name.toLowerCase().includes(name.toLowerCase())) || {
      name: `M/F ${name}`,
      phone: null,
    }
  );
}

function activeMode() {
  return routeOverride() || activePlan().mode || "1136";
}

function dayType(iso) {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  if (dow === 0) return "sunday";
  if (dow === 6) return "saturday";
  return "weekday";
}

function lineLegs(mode) {
  if (mode === "kombi") return state.kombirute?.legs || [];
  return state.routes?.lines?.[mode]?.legs || state.routes?.legs || [];
}

function allCatalogLegs() {
  const fromLines = Object.values(state.routes?.lines || {}).flatMap((line) => line.legs || []);
  return [...fromLines, ...(state.routes?.legs || []), ...(state.kombirute?.legs || [])];
}

function hasTimetable() {
  return Boolean(state.routes || state.kombirute);
}

function legsForMode(mode, date) {
  const tagged =
    mode === "kombi"
      ? lineLegs("kombi")
          .filter((leg) => (leg.days || []).includes(dayType(date)))
          .map((leg) => ({ ...leg, table: "kombi" }))
      : lineLegs(mode)
          .filter((leg) => (leg.activeDates || []).includes(date))
          .map((leg) => ({ ...leg, table: mode }));
  return tagged;
}

function cutBeforeSwitch(legs, routeSwitch, notice = null) {
  const at = clockMinutes(routeSwitch.time);
  return legs.filter((leg) => {
    const dep = clockMinutes(leg.departure);
    if (dep >= at) return false;
    return !isUncertainDeparture(leg.departure, notice, routeSwitch.time);
  });
}

function cutFromSwitch(legs, routeSwitch) {
  const at = clockMinutes(routeSwitch.time);
  const quay = routeSwitch.quay ? quayPlace(routeSwitch.quay) : null;
  return legs.filter((leg) => {
    const dep = clockMinutes(leg.departure);
    if (dep > at) return true;
    if (dep < at) return false;
    return !quay || quayPlace(leg.from) === quay;
  });
}

function sortDayLegs(legs) {
  return [...legs].sort(
    (a, b) => a.departure.localeCompare(b.departure) || a.from.localeCompare(b.from)
  );
}

function legsForDate(date) {
  const plan = activePlan(date);
  const after = legsForMode(plan.mode, date);
  if (!plan.switch) return sortDayLegs(after);
  const fromAfter = cutFromSwitch(after, plan.switch);
  const before = cutBeforeSwitch(
    legsForMode(plan.switch.before, date),
    plan.switch,
    plan.notice
  );
  return sortDayLegs([...before, ...fromAfter]);
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
  const place = String(name).replace(/\s+(ferjekai|kai)$/i, "").trim();
  return place === "Lekneset" ? "Leknes" : place;
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
  for (const leg of allCatalogLegs()) {
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

/**
 * Éi ferje køyrer både 1135 og 1136 som éi tabell. PDF-en har òg
 * signalturar som overlappar i klokka (t.d. Skår og Leknes samstundes).
 * Då er «flyttar seg utan passasjerar» ikkje ei ekte forflytting.
 */
function isCombinedTimetable() {
  const plan = activePlan();
  return plan.mode === "kombi" || Boolean(plan.switch);
}

function catalogKeys(leg) {
  if (leg.activeDates?.length) return leg.activeDates;
  if (leg.days?.length) return leg.days;
  return ["*"];
}

/** Kortaste hol mellom to kaier i tabellen, t.d. Valderøya 12:30 → Standal 14:40. */
function minDeadheadMinutes(allLegs, fromQuay, toQuay) {
  const byDate = new Map();
  for (const leg of allLegs || []) {
    for (const date of catalogKeys(leg)) {
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
  const catalog = allLegs || lineLegs(activeMode()) || legs;

  if (now < clockMinutes(first.departure)) {
    return {
      at: clockMinutes(first.departure) - 1,
      short: t("status.mooredAt", { quay: first.from }),
      text: t("status.firstDeparture", { from: first.from, time: hhmm(first.departure) }),
    };
  }
  if (now >= clockMinutes(last.arrival)) {
    if (isCombinedTimetable() || last.to === home) {
      const quay = last.to;
      return {
        at: 1441,
        short: t("status.doneAt", { home: quay }),
        text: t("status.doneAtPeriod", { home: quay }),
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
      const moving = !isCombinedTimetable() && leg.to !== next.from;
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

function isVisibleDeparture(leg) {
  return !leg.hideDeparture;
}

function readHideArrivals(storage) {
  try {
    const store =
      storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    return Boolean(store && store.getItem(HIDE_ARRIVALS_KEY) === "1");
  } catch {
    return false;
  }
}

function writeHideArrivals(hide, storage) {
  try {
    const store =
      storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    if (!store) return;
    if (hide) store.setItem(HIDE_ARRIVALS_KEY, "1");
    else store.removeItem(HIDE_ARRIVALS_KEY);
  } catch {
    // localStorage kan vere stengt.
  }
}

/** Rutetabellen endrar seg sjeldan; hugsa sist vising så oppdatering av sida ikkje ventar på 400 KB JSON. */
function timetableFingerprint(routes, kombirute, connections) {
  return JSON.stringify({
    routes: routes?.fetchedAt || null,
    kombi: kombirute?.source || null,
    kombiFrom: kombirute?.validFrom || null,
    conn: connections?.fetchedAt || null,
  });
}

function messagesFingerprint(payload) {
  const messages = payload?.messages || [];
  return JSON.stringify(
    messages.map((msg) => [
      msg.id || "",
      msg.text || "",
      msg.validTo || "",
      msg.severity || "",
      msg.routeMode || "",
      msg.routeSwitch || null,
      msg.activateAt || null,
    ])
  );
}

function readCachedTimetable(storage) {
  try {
    const store =
      storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    if (!store) return null;
    const raw = store.getItem(TIMETABLE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.routes) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedTimetable({ routes, kombirute, connections }, storage) {
  try {
    const store =
      storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    if (!store || !routes) return;
    store.setItem(
      TIMETABLE_CACHE_KEY,
      JSON.stringify({
        routes,
        kombirute: kombirute || null,
        connections: connections || null,
      })
    );
  } catch {
    // kvote / privat modus
  }
}

function showArrivals() {
  return !state.hideArrivals;
}

function nextDepartureFrom(legs, quay, skipPassed = false) {
  return (
    legs.find(
      (leg) =>
        isVisibleDeparture(leg) &&
        (!quay || leg.from === quay) &&
        (!skipPassed || !hasPassed(leg.departure))
    ) || null
  );
}

function nextArrivalAt(legs, quay, skipPassed = false) {
  if (!quay) return null;
  return (
    legs.find((leg) => {
      if (leg.to !== quay) return false;
      if (skipPassed && hasPassed(leg.arrival)) return false;
      return true;
    }) || null
  );
}

/**
 * Neste tur i oversiktsboksen: fyrste avgang (frå valt kai, eller fyrste i
 * tabellen) og ankomst for same strekning. Ikkje neste innkomst attende på
 * avgangskaia — 06:45 Standal–Trandal skal vise 07:00 Trandal, ikkje 07:20 Standal.
 */
function nextOverview(legs, quay, skipPassed = false) {
  const dep = nextDepartureFrom(legs, quay, skipPassed);
  if (!dep) return null;
  return { dep, arr: dep };
}

/** Fyrste treffet på ein seinare dag, så boksen ikkje står tom om kvelden. */
function lookAhead(fromDate, matches, maxDays = 7) {
  for (let step = 1; step <= maxDays; step += 1) {
    const date = shiftIso(fromDate, step);
    const dayLegs = legsForDate(date);
    const leg = dayLegs.find((item) => matches(item, dayLegs));
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
  const stateNode = el("span", "next-state");
  if (row.prefix) {
    stateNode.append(document.createTextNode(`${row.prefix} · `));
  }
  if (row.live && row.time) {
    const cd = el("span", "next-countdown", countdown(row.time));
    cd.dataset.countdown = row.time;
    stateNode.append(cd);
  } else if (row.state) {
    stateNode.textContent = row.state;
  }
  node.append(stateNode);
  return node;
}

/** Boks med neste avgang og ankomst for same tur. */
function renderNextSummary(legs) {
  const root = document.getElementById("next-summary");
  root.replaceChildren();
  const selected = selectedDate();
  const skipPassed = isToday();
  const quay = state.stopFilter;

  const overview = nextOverview(legs, quay, skipPassed);
  const depHit = resolveAhead(
    selected,
    overview?.dep ?? null,
    (leg) => isVisibleDeparture(leg) && (!quay || leg.from === quay)
  );
  if (!depHit) return;

  const live = depHit.date === todayIso();
  const rows = [
    {
      time: depHit.leg.departure,
      name: t("next.fromTo", { from: depHit.leg.from, to: depHit.leg.to }),
      prefix: depHit.prefix,
      live,
      leg: depHit.leg,
      kind: "dep",
      date: depHit.date,
    },
  ];
  if (showArrivals()) {
    rows.push({
      time: depHit.leg.arrival,
      name: t("next.arrival", { to: depHit.leg.to }),
      prefix: depHit.prefix,
      live,
      leg: depHit.leg,
      kind: "arr",
      date: depHit.date,
    });
  }

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
  const hub = line.hub || data.hub;
  const roadTo = line.roadTo || data.roadTo;
  const drive = line.driveMinutes ?? data.driveMinutes ?? 0;
  const margin = line.marginMinutes ?? data.marginMinutes ?? 0;
  const runsToday = (trip) => (data.calendars[trip.cal] || []).includes(date);
  const trips = line.trips.filter(runsToday);
  return {
    hub,
    roadTo,
    buffer: drive + margin,
    toHub: trips
      .filter((trip) => trip.to === hub)
      .sort((a, b) => a.arrival.localeCompare(b.arrival)),
    fromHub: trips
      .filter((trip) => trip.from === hub)
      .sort((a, b) => a.departure.localeCompare(b.departure)),
  };
}

const DEFAULT_CONNECTION_LINES = [
  { id: "solavagen", label: "Solavågen", hub: "Festøya", roadTo: "Standal" },
  { id: "hundeidvika", label: "Hundeidvika", hub: "Festøya", roadTo: "Standal" },
  { id: "oye", label: "Øye", hub: "Leknes", roadTo: "Leknes" },
];

function visibleConnectionLines(legs) {
  const quays = quaysInDay(legs);
  const lines = state.connections?.lines || DEFAULT_CONNECTION_LINES;
  return lines.filter((line) => {
    const hub = line.hub || state.connections?.hub;
    const road = line.roadTo || state.connections?.roadTo;
    if (line.id === "oye" || hub === "Leknes" || road === "Leknes") {
      return quays.includes("Leknes");
    }
    return true;
  });
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
      const left = el(
        "span",
        "stop-left",
        t("signal.leftToBook", { duration: durationText(minutesLeft(deadlineClock)) })
      );
      left.dataset.deadline = deadlineClock;
      note.append(left);
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
  const remainingNode = el("span", "stop-state", remaining);
  if (isToday()) remainingNode.dataset.countdown = leg.departure;
  row.append(remainingNode);
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

function splitRow(routeSwitch, table, past) {
  const row = el("div", `stop-split${past ? " is-past" : ""}`);
  row.setAttribute("role", "separator");
  row.append(el("span", "split-kicker", t("split.kicker")));
  row.append(
    el(
      "span",
      "split-title",
      t("split.continues", {
        table: t(`split.table.${table}`),
        time: hhmm(routeSwitch.time),
        quay: routeSwitch.quay ? t("split.atQuay", { quay: routeSwitch.quay }) : "",
      })
    )
  );
  row.append(
    el("span", "split-before", t("split.before", { before: t(`split.table.${routeSwitch.before}`) }))
  );
  if (routeSwitch.notice) {
    row.append(
      el(
        "span",
        "split-before",
        t("mode.acuteNote", { from: hhmm(routeSwitch.notice), to: hhmm(routeSwitch.time) })
      )
    );
  }
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
  if (!quays || !quays.length) return true;
  return quays.includes(state.stopFilter);
}

const EVENT_SEQ = { arr: 0, split: 1, transfer: 2, dep: 3, status: 4 };

function compareTimelineEvents(a, b) {
  const seq = (event) => EVENT_SEQ[event.kind] ?? 0;
  return a.at - b.at || seq(a) - seq(b);
}

function buildEvents(legs, connections) {
  const events = [];
  const seenDep = new Set();
  legs.forEach((leg, index) => {
    const depKey = `${leg.from}|${leg.departure}`;
    if (isVisibleDeparture(leg) && !seenDep.has(depKey)) {
      seenDep.add(depKey);
      events.push({
        at: clockMinutes(leg.departure),
        kind: "dep",
        quays: [leg.from],
        leg,
        build: (past) => departureRow(leg, past, connections),
      });
    }
    if (showArrivals()) {
      events.push({
        at: clockMinutes(leg.arrival),
        kind: "arr",
        quays: [leg.to],
        build: (past) => arrivalRow(leg, past, connections),
      });
    }
    const next = legs[index + 1];
    if (next && leg.table && next.table && leg.table !== next.table) {
      const routeSwitch = activePlan().switch;
      if (routeSwitch && !events.some((event) => event.kind === "split")) {
        events.push({
          at: clockMinutes(routeSwitch.time),
          kind: "split",
          quays: [],
          build: (past) => splitRow(routeSwitch, next.table, past),
        });
      }
    }
    if (
      !isCombinedTimetable() &&
      next &&
      leg.to !== next.from &&
      (!leg.table || !next.table || leg.table === next.table)
    ) {
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
  if (!isCombinedTimetable() && last && last.to !== home) {
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

function renderViewFilter() {
  const root = document.getElementById("view-filter");
  if (!root) return;
  root.replaceChildren();
  const visible = showArrivals();
  const btn = el("button", "chip chip-small", visible ? t("view.hideArrivals") : t("view.showArrivals"));
  btn.type = "button";
  btn.setAttribute("aria-pressed", String(visible));
  if (visible) btn.classList.add("is-active");
  btn.addEventListener("click", () => {
    state.hideArrivals = !state.hideArrivals;
    writeHideArrivals(state.hideArrivals);
    track(state.hideArrivals ? "Hide arrivals" : "Show arrivals");
    renderTimeline();
  });
  root.append(btn);
}

function renderConnectionFilter() {
  const root = document.getElementById("conn-filter");
  const note = document.getElementById("connection-note");
  if (!root || !note) return;
  root.replaceChildren();
  const visible = visibleConnectionLines(legsForDate(selectedDate()));
  if (state.connection && !visible.some((line) => line.id === state.connection)) {
    state.connection = null;
  }
  const options = [{ value: null, label: t("conn.none") }].concat(
    visible.map((line) => ({ value: line.id, label: line.label }))
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
  const line = data?.lines?.find((candidate) => candidate.id === state.connection);
  note.textContent =
    state.connection && data
      ? t("conn.note", {
          drive: line?.driveMinutes ?? data.driveMinutes,
          hub: line?.hub ?? data.hub,
          roadTo: line?.roadTo ?? data.roadTo,
          margin: line?.marginMinutes ?? data.marginMinutes,
        })
      : "";
}

async function loadConnections() {
  if (state.connections) return;
  try {
    const response = await fetch(CONNECTIONS_URL);
    if (!response.ok) throw new Error(response.statusText);
    state.connections = await response.json();
  } catch (error) {
    console.error(error);
  }
}

async function selectConnection(id) {
  state.connection = id;
  if (id && !state.connections) {
    await loadConnections();
    if (!state.connections) {
      state.connection = null;
      const note = document.getElementById("connection-note");
      if (note) note.textContent = t("conn.error");
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
  const next = legs.find((leg) => isVisibleDeparture(leg) && !hasPassed(leg.departure));
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

function timelineEventIsPast(event, events, now = nowMinutes()) {
  if (!isToday() || event.status) return false;
  if (event.kind === "split") {
    return !events.some((item) => item.kind !== "split" && item.kind !== "status" && item.at > now);
  }
  return event.at <= now;
}

function keepTimelineEvent(event, events, now = nowMinutes()) {
  if (event.status) return true;
  if (!isToday() || state.showPast) return true;
  if (event.kind === "split") {
    return events.some((item) => item.kind !== "split" && item.kind !== "status" && item.at > now);
  }
  return event.at > now;
}

function pastDepartureCount(events, now = nowMinutes()) {
  if (!isToday()) return 0;
  return events.filter((event) => event.kind === "dep" && event.at <= now).length;
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
function bookingState(event) {
  const leg = event.leg;
  if (!leg?.signal) return "";
  const deadline = bookingDeadline(leg);
  if (deadline == null) return "";
  const deadlineClock = `${minutesToClock(deadline)}:00`;
  if (!hasPassed(deadlineClock)) return "open";
  if (!hasPassed(leg.departure)) return "expired";
  return "gone";
}

function liveStructureKey(events, now, status) {
  const rows = events
    .filter((event) => keepTimelineEvent(event, events, now))
    .map((event) => [
      event.kind,
      event.at,
      (event.quays || []).join(","),
      timelineEventIsPast(event, events, now) ? 1 : 0,
      bookingState(event),
    ]);
  return JSON.stringify({
    date: selectedDate(),
    stop: state.stopFilter,
    conn: state.connection,
    showPast: state.showPast,
    hideArr: state.hideArrivals,
    statusAt: status?.at ?? null,
    statusText: status?.text ?? "",
    liveRec: state.live?.recordedAt || "",
    rows,
  });
}

function patchLiveClock() {
  document.querySelectorAll("[data-countdown]").forEach((node) => {
    const time = node.dataset.countdown;
    const past = node.closest(".is-past");
    node.textContent = past ? t("gone") : time && isToday() ? countdown(time) : "";
  });
  document.querySelectorAll("[data-deadline]").forEach((node) => {
    const deadlineClock = node.dataset.deadline;
    if (!deadlineClock || hasPassed(deadlineClock)) return;
    node.textContent = t("signal.leftToBook", {
      duration: durationText(minutesLeft(deadlineClock)),
    });
  });
}

function renderLive() {
  const root = document.getElementById("departures");
  if (!hasTimetable()) {
    lastLiveStructureKey = null;
    root.replaceChildren();
    root.append(el("p", "empty", t("empty.noTimetable")));
    return;
  }
  const legs = legsForDate(selectedDate());
  renderDayNav();

  if (!legs.length) {
    lastLiveStructureKey = null;
    renderReveal(0);
    renderNextSummary(legs);
    root.replaceChildren();
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
  const key = liveStructureKey(events, now, status);
  if (key === lastLiveStructureKey && root.children.length) {
    patchLiveClock();
    return;
  }

  lastLiveStructureKey = key;
  renderNextSummary(legs);
  root.replaceChildren();
  const pastCount = pastDepartureCount(events, now);
  renderReveal(pastCount);

  for (const event of events) {
    if (!keepTimelineEvent(event, events, now)) continue;
    const past = timelineEventIsPast(event, events, now);
    root.append(event.build(past));
  }
}

/** Full oppbygging: brukast når data, dag eller filter endrar seg. */
function renderTimeline() {
  lastLiveStructureKey = null;
  renderedDate = selectedDate();
  renderStopFilter(legsForDate(renderedDate));
  renderViewFilter();
  renderConnectionFilter();
  renderLive();
}

function validMessages(messages, now = Date.now()) {
  return (messages || []).filter((msg) => {
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
  // Utan noko i området tek panelet berre plass.
  const hasLocal = all.some((msg) => msg.isLocal);
  panel.hidden = !hasLocal;
  layout.classList.toggle("is-single", !hasLocal);
  if (!hasLocal) return;
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
}

function renderRouteChrome() {
  const mode = activeMode();
  const plan = activePlan();
  const title = document.getElementById("route-title");
  if (title) {
    title.textContent = plan.switch
      ? t("route.titleSwitch", {
          before: t(`split.table.${plan.switch.before}`),
          after: t(`split.table.${plan.mode}`),
        })
      : mode === "kombi"
        ? t("route.titleKombi")
        : mode === "1135"
          ? t("route.title1135")
          : t("route.title1136");
  }
  const eyebrow = document.querySelector(".eyebrow");
  if (eyebrow) {
    eyebrow.textContent =
      mode === "kombi" ? t("eyebrow.kombi") : mode === "1135" ? t("eyebrow.1135") : t("eyebrow");
  }
  const pdf = document.getElementById("timetable-pdf");
  if (pdf) {
    if (mode === "kombi") {
      pdf.href = state.kombirute?.source || KOMBI_PDF;
      pdf.textContent = t("footnote.kombiPdf");
    } else {
      pdf.href = FJORD1_PDF;
      pdf.textContent = "fjord1.no";
    }
  }
  const vessel = mode === "kombi" ? vesselInfo(activeVessel()) : null;
  const operator = document.getElementById("footer-operator");
  if (operator) {
    operator.textContent = vessel
      ? t("footer.operatorVessel", { name: vessel.name, phone: vessel.phone || "" })
      : t("footer.operator");
  }
  const nais = document.getElementById("footnote-nais");
  if (nais) {
    nais.textContent = vessel
      ? t("footnote.naisVessel", { name: vessel.name })
      : t("footnote.nais");
  }
}

async function loadMessages() {
  if (messagesInflight) return messagesInflight;
  messagesInflight = loadMessagesOnce().finally(() => {
    messagesInflight = null;
  });
  return messagesInflight;
}

async function loadMessagesOnce() {
  const meta = document.getElementById("messages-meta");
  try {
    // Fjord1-fila kan skifte kvart 5. minutt. no-cache revaliderer utan å omgå ETag.
    const response = await fetch(messagesUrl(), { cache: "no-cache" });
    if (!response.ok) throw new Error(response.statusText);
    const payload = await response.json();
    const same =
      state.messages &&
      messagesFingerprint(state.messages) === messagesFingerprint(payload);
    state.messages = payload;
    if (same) return;
    renderMessages();
    if (hasTimetable()) {
      renderRouteChrome();
      renderTimeline();
      renderLedeStatus();
    }
  } catch (error) {
    if (!state.messages) {
      if (meta) meta.textContent = t("messages.fetchError");
      document.getElementById("messages")?.replaceChildren(
        el("p", "empty", t("messages.seeFjord1"))
      );
    }
    console.error(error);
  }
}

function scheduleMessagesPoll() {
  clearTimeout(messagesTimer);
  messagesTimer = setTimeout(async () => {
    if (typeof document === "undefined" || !document.hidden) {
      await loadMessages();
    }
    scheduleMessagesPoll();
  }, MESSAGES_POLL_MS);
}

function recordedMs(live) {
  if (!live) return 0;
  const raw = live.recordedAt || live.validUntil;
  const ms = raw ? Date.parse(raw) : 0;
  return Number.isFinite(ms) ? ms : 0;
}

function pickFreshest(lives) {
  const fresh = lives.filter((live) => isLiveFresh(live));
  const pool = fresh.length ? fresh : lives;
  return pool.slice().sort((a, b) => recordedMs(b) - recordedMs(a))[0] || null;
}

async function fetchLive(url) {
  const response = await fetch(url, {
    headers: {
      "ET-Client-Name": ENTUR_CLIENT,
      Accept: "application/json",
    },
  });
  if (response.status === 429 || response.status >= 500) {
    const error = new Error(response.statusText);
    error.retryable = true;
    throw error;
  }
  if (!response.ok) throw new Error(response.statusText);
  return parseVehicleMonitoring(await response.json());
}

function liveFetchUrls(mode = activeMode()) {
  if (mode === "1135") return [LIVE_VM_URLS["1135"]];
  if (mode === "1136") return [LIVE_VM_URLS["1136"]];
  return [LIVE_VM_URLS["1136"], LIVE_VM_URLS["1135"]];
}

function serviceWindowMinutes(date) {
  const legs = legsForDate(date);
  if (!legs.length) return null;
  let start = Infinity;
  let end = 0;
  for (const leg of legs) {
    start = Math.min(start, clockMinutes(leg.departure));
    if (leg.arrival) end = Math.max(end, clockMinutes(leg.arrival));
    else end = Math.max(end, clockMinutes(leg.departure));
  }
  return { start, end };
}

function shouldFetchLive(nowMs = Date.now()) {
  if (typeof document !== "undefined" && document.hidden) return false;
  if (!hasTimetable()) return false;
  if (nowMs < (state.liveBlockedUntil || 0)) return false;
  const date = osloIsoFromMs(nowMs);
  const win = serviceWindowMinutes(date);
  if (!win) return false;
  const minutes = nowMinutes(nowMs);
  return (
    minutes >= win.start - LIVE_SERVICE_MARGIN_MIN &&
    minutes <= win.end + LIVE_SERVICE_MARGIN_MIN
  );
}

function noteLiveFailure(nowMs = Date.now()) {
  const prev = state.liveBackoffMs || LIVE_BACKOFF_START_MS / 2;
  state.liveBackoffMs = Math.min(LIVE_MAX_BACKOFF_MS, prev * 2);
  state.liveBlockedUntil = nowMs + state.liveBackoffMs;
}

function liveBlockedUntil() {
  return state.liveBlockedUntil || 0;
}

async function loadLivePosition() {
  if (!shouldFetchLive()) return;
  if (Date.now() - (state.liveFetchedAt || 0) < LIVE_MIN_INTERVAL_MS) return;
  state.liveFetchedAt = Date.now();
  const urls = liveFetchUrls();
  const found = [];
  try {
    for (const url of urls) {
      const live = await fetchLive(url);
      if (live) found.push(live);
      if (found.some((item) => isLiveFresh(item))) break;
    }
    state.live = pickFreshest(found);
    state.liveBackoffMs = 0;
    state.liveBlockedUntil = 0;
  } catch (error) {
    if (found.length) state.live = pickFreshest(found);
    noteLiveFailure();
    console.error(error);
  }
}

function applyTimetable({ routes, kombirute, connections }, { persist = true } = {}) {
  state.routes = routes;
  if (kombirute) state.kombirute = kombirute;
  if (connections) state.connections = connections;
  if (persist) {
    writeCachedTimetable({
      routes,
      kombirute: state.kombirute,
      connections: state.connections,
    });
  }
  renderRouteChrome();
  renderTimeline();
  renderLedeStatus();
  const updated = document.getElementById("timetable-updated");
  if (updated && state.routes?.fetchedAt) {
    updated.textContent = t("timetable.updated", {
      date: formatDateOnly(state.routes.fetchedAt),
    });
  }
}

async function fetchTimetableFiles() {
  const [routesRes, kombiRes, connRes] = await Promise.all([
    fetch(ROUTES_URL),
    fetch(KOMBI_URL).catch(() => null),
    fetch(CONNECTIONS_URL).catch(() => null),
  ]);
  if (!routesRes.ok) throw new Error(routesRes.statusText);
  const routes = await routesRes.json();
  const kombirute = kombiRes?.ok ? await kombiRes.json() : null;
  const connections = connRes?.ok ? await connRes.json() : null;
  return { routes, kombirute, connections };
}

async function loadRoutes({ useCache = true } = {}) {
  const label = document.getElementById("day-label");
  const cached = useCache ? readCachedTimetable() : null;
  if (cached?.routes && !hasTimetable()) {
    applyTimetable(cached, { persist: false });
  }
  try {
    const fresh = await fetchTimetableFiles();
    const next = {
      routes: fresh.routes,
      kombirute: fresh.kombirute ?? state.kombirute,
      connections: fresh.connections ?? state.connections,
    };
    const previous = cached || {
      routes: state.routes,
      kombirute: state.kombirute,
      connections: state.connections,
    };
    const same =
      previous.routes &&
      timetableFingerprint(previous.routes, previous.kombirute, previous.connections) ===
        timetableFingerprint(next.routes, next.kombirute, next.connections);
    if (!same) applyTimetable(next);
    await loadLivePosition();
    renderLive();
    renderLedeStatus();
  } catch (error) {
    if (!state.routes) {
      if (label) label.textContent = t("timetable.loadError");
      document.getElementById("departures")?.replaceChildren(
        el("p", "empty", t("timetable.notLoaded"))
      );
    }
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
  if (!hasTimetable()) return;
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
  if (typeof document !== "undefined" && document.hidden) return;
  const untilNextMinute = 60000 - (Date.now() % 60000) + 200;
  tickTimer = setTimeout(() => {
    tick();
    scheduleTick();
  }, untilNextMinute);
}

function requestWake() {
  if (bootedAt && Date.now() - bootedAt < 2500) return;
  if (wakeTimer) return;
  wakeTimer = setTimeout(() => {
    wakeTimer = null;
    wake();
  }, WAKE_DEBOUNCE_MS);
}

function wake() {
  if (typeof document !== "undefined" && document.hidden) return;
  loadMessages();
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
  renderRouteChrome();
  if (hasTimetable()) {
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
  const swUrl = new URL("../sw.js", import.meta.url);
  navigator.serviceWorker.register(swUrl, { scope: "./" }).catch((error) => {
    console.error(error);
  });
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "timetable-updated") loadRoutes({ useCache: false });
    if (event.data?.type === "messages-updated") loadMessages();
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
    if (document.hidden) {
      clearTimeout(tickTimer);
      tickTimer = null;
      return;
    }
    requestWake();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) requestWake();
  });
  window.addEventListener("focus", requestWake);
}

function setTestState(partial) {
  Object.assign(state, partial);
}

function resetTestState() {
  state.messageFilter = "local";
  state.stopFilter = null;
  state.date = null;
  state.showPast = false;
  state.hideArrivals = false;
  state.messages = null;
  state.routes = null;
  state.kombirute = null;
  state.connection = null;
  state.connections = null;
  state.live = null;
  state.liveFetchedAt = 0;
  state.liveBackoffMs = 0;
  state.liveBlockedUntil = 0;
  lastLiveStructureKey = null;
}

export {
  FEEDBACK_MAIL,
  LIVE_MAX_BACKOFF_MS,
  LIVE_SERVICE_MARGIN_MIN,
  MESSAGES_POLL_MS,
  TIMETABLE_CACHE_KEY,
  WAKE_DEBOUNCE_MS,
  activateAtFromText,
  activeMode,
  activePlan,
  appMode,
  buildEvents,
  compareTimelineEvents,
  currentStatus,
  dayType,
  delayMinutes,
  feedbackMailto,
  ferryStatus,
  firstKnownQuay,
  homeQuay,
  isLiveFresh,
  isUncertainDeparture,
  isPreview,
  isRouteControl,
  messagesUrl,
  keepTimelineEvent,
  legsForDate,
  liveBlockedUntil,
  liveFetchUrls,
  liveStatus,
  pastDepartureCount,
  messagesFingerprint,
  minDeadheadMinutes,
  modeFromText,
  nextArrivalAt,
  nextDepartureFrom,
  nextOverview,
  noteLiveFailure,
  parseVehicleMonitoring,
  quayAtStart,
  quayPlace,
  quaysInDay,
  readCachedTimetable,
  readHideArrivals,
  resetTestState,
  resolveRoutePlan,
  routeModeFromMessages,
  routeOverride,
  switchFromText,
  switchOverride,
  setTestState,
  shouldFetchLive,
  showArrivals,
  serviceWindowMinutes,
  timetableFingerprint,
  track,
  vesselFromText,
  windowFromText,
  visibleConnectionLines,
  writeCachedTimetable,
  writeHideArrivals,
};

if (typeof document !== "undefined") {
  bootedAt = Date.now();
  setLang(detectLang(), { persist: false });
  applyStaticTranslations();
  syncLangButtons();
  state.hideArrivals = readHideArrivals();
  bindControls();
  registerServiceWorker();
  loadMessages();
  loadRoutes();
  scheduleTick();
  scheduleMessagesPoll();
  track(`Visit ${getLang()}`, { app: appMode() }, { interactive: false });
  if (appMode() === "pwa") track("Visit pwa", null, { interactive: false });
}
