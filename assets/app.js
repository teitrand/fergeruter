import {
  applyStaticTranslations,
  detectLang,
  getLang,
  months,
  monthsShort,
  setLang,
  t,
  weekdays,
} from "./i18n.js?v=51";

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
const FJORD1_PDF_1135 =
  "https://www.fjord1.no/ruteoversikt/moere-og-romsdal/leknes-saeboe/(page)/pdf";
const FJORD1_GRAPHQL_URL = "https://www.fjord1.no/graphql";
const FJORD1_MESSAGES_PAGE = "https://www.fjord1.no/trafikkmeldingar";
/** HTML-lesar med CORS; Fjord1 GraphQL svarar utan Access-Control-Allow-Origin. */
const FJORD1_HTML_READER = `https://r.jina.ai/${FJORD1_MESSAGES_PAGE}`;
const FJORD1_GRAPHQL_KEY = "fergeruter-fjord1-graphql";
const FJORD1_MESSAGES_QUERY = `{
  content {
    trafficMessages(first: 50, sortBy: [_datePublished, _desc]) {
      edges {
        node {
          id
          heading
          countyNumber
          connectionNumber
          date
          content
          importantMessage
          validFrom { timestamp }
          validTo { timestamp }
        }
      }
    }
  }
}`;
const ALLOWED_MODES = new Set(["1136", "1135", "kombi"]);
const CHOOSABLE_ROUTES = new Set(["1136", "1135"]);
const NORMAL_RE = /normal drift/i;
const CANCEL_RE = /innstilt|innstilling/i;
const PARTIAL_CANCEL_RE =
  /følgjande avgangar|avgangar innstilt|avgang(?:en|ar)?\s+(?:kl\.?|klokka)/i;
const KOMBI_RE = /kombinasjon|kombirute|kombinert rute/i;
const DELAY_RE = /forsink/i;
const CAPACITY_RE = /kapasitet|kapasistet|farleg last|farlig last/i;
const HAS_1135_RE = /\b1135\b/;
const HAS_1136_RE = /\b1136\b/;
const ROUTE_1136_HINT_RE =
  /\b1136\b|trandal|standal|valderøy|store kalvøy|sæbø|skår/i;
const LOCAL_ROUTE_RE = /\b(1136|1135|1049)\b/i;
const LOCAL_PLACE_RE =
  /trandal|standal|sæbø|skår|store kalvøy|valderøy|bjørke|urke|festøy|hundeidvik/i;
const CONN_1136 = 132;
const CONN_1135 = 134;
const HIDE_ARRIVALS_KEY = "fergeruter-hide-arrivals";
/** Opphald på kai som er langt nok til å visast som liggetid, t.d. matpause. */
const LAYOVER_MIN_MINUTES = 20;
const ROUTE_CHOICE_KEY = "fergeruter-route-choice";
const PWA_FIRST_KEY = "fergeruter-pwa-first-open";
const TIMETABLE_CACHE_KEY = "fergeruter-timetable-v1";
const MESSAGES_CACHE_KEY = "fergeruter-messages-v1";
const LAST_MODE_KEY = "fergeruter-last-mode";
const ISSUE_SEVERITIES = new Set(["cancelled", "delay", "capacity"]);
const MESSAGES_POLL_MS = 3 * 60 * 1000;
/** GitHub-kopien er «gammal» når Actions ikkje har køyrd; då sjekkar sida Fjord1. */
const MESSAGES_STALE_MS = 8 * 60 * 1000;
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
  fromFilter: null,
  toFilter: null,
  date: null,
  showPast: false,
  hideArrivals: false,
  messagesExpanded: false,
  routeChoice: "1136",
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
let fjord1GraphqlBlocked = false;
let wakeTimer = null;
let bootedAt = 0;
let messagesHydrated = false;
let messagesHydrateWaiters = [];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function plausibleRoute(choice = chosenRoute()) {
  return choice === "1135" ? "saebo-leknes" : "standal-trandal";
}

function plausibleContext(extra) {
  return {
    lang: getLang(),
    app: appMode(),
    route: plausibleRoute(),
    ...extra,
  };
}

/** Anonym Plausible-hending. Feilar aldri ut til brukaren. */
function track(name, props, { interactive = true } = {}) {
  try {
    const fn = typeof window !== "undefined" ? window.plausible : null;
    if (typeof fn !== "function") return;
    const payload = { props: plausibleContext(props) };
    if (!interactive) payload.interactive = false;
    fn(name, payload);
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

/** Kva install-rettleiing som passar best. iOS har ikkje beforeinstallprompt. */
function installHint(nav = typeof navigator !== "undefined" ? navigator : null) {
  if (!nav) return "desktop";
  const ua = nav.userAgent || "";
  const platform = nav.platform || "";
  const ios =
    /iPad|iPhone|iPod/.test(ua) ||
    (platform === "MacIntel" && (nav.maxTouchPoints || 0) > 1);
  if (ios) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

/** Fyrste gong sida er open som installert app, per nettlesar. */
function markPwaFirstOpen(
  storage,
  mode = appMode()
) {
  if (mode !== "pwa") return false;
  try {
    const store =
      storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    if (!store || store.getItem(PWA_FIRST_KEY)) return false;
    store.setItem(PWA_FIRST_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

function highlightInstallHint(hint = installHint()) {
  if (typeof document === "undefined") return hint;
  document.querySelectorAll("[data-install-hint]").forEach((node) => {
    const likely = node.dataset.installHint === hint;
    node.classList.toggle("is-likely", likely);
    if (likely) node.setAttribute("aria-current", "true");
    else node.removeAttribute("aria-current");
  });
  return hint;
}

function openInstallDialog(dialog) {
  if (!dialog) return;
  highlightInstallHint();
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
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

function excerptText(text, max = 140) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (raw.length <= max) return raw;
  const cut = raw.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > 80 ? cut.slice(0, at) : cut).trim()}…`;
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

/** Publisert-tid og «gyldig til» frå Fjord1, med klokkeslett. */
function messageTimeLines(msg) {
  const lines = [];
  const published = msg?.publishedAt || msg?.validFrom || null;
  if (published) {
    lines.push({
      iso: published,
      text: t("messages.published", { when: formatDateTime(published) }),
    });
  }
  if (msg?.validTo) {
    lines.push({
      iso: msg.validTo,
      text: t("messages.validTo", { when: formatDateTime(msg.validTo) }),
    });
  }
  return lines;
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
  "(?:mandag|måndag|tysdag|tirsdag|onsdag|torsdag|fredag|laurdag|lørdag|søndag)\\s+";
const NUMDATE_TOKEN = "(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{2,4}))?";

function messageBlob(msg) {
  if (typeof msg === "string") return msg || "";
  return `${msg?.heading || ""} ${msg?.text || ""}`;
}

function is1049Only(heading, text) {
  const blob = `${heading || ""} ${text || ""}`;
  return ONLY_1049_RE.test(blob) && !HJORUNDFJORD_RE.test(blob);
}

function isPartialCancel(text) {
  const blob = text || "";
  if (!CANCEL_RE.test(blob) && !/kanseller/i.test(blob)) return false;
  return PARTIAL_CANCEL_RE.test(blob);
}

function cancelledSailingsFromText(text) {
  const blob = String(text || "");
  const found = [];
  const groupRe =
    /((?:\d{1,2}[:.]?\d{2})(?:\s+og\s+(?:\d{1,2}[:.]?\d{2}))*)\s+(?:frå|fra)\s+([^\s,.;:]+)/gi;
  for (const group of blob.matchAll(groupRe)) {
    const quay = quayPlace(group[2]);
    if (!quay) continue;
    for (const clock of group[1].matchAll(/\b(\d{1,2})[:.](\d{2})\b|\b(\d{4})\b/g)) {
      const raw = clock[3] || `${clock[1]}:${clock[2]}`;
      const time = parseClockToken(raw);
      if (time) found.push({ time, from: quay });
    }
  }
  return found;
}

function cancelledDepartureSet(messages = state.messages?.messages) {
  const set = new Set();
  for (const msg of validMessages(messages || [])) {
    if (msg.isLocal === false) continue;
    for (const item of cancelledSailingsFromText(messageBlob(msg))) {
      set.add(`${item.from}|${item.time}`);
    }
  }
  return set;
}

function isCancelledDeparture(leg, cancelled = cancelledDepartureSet()) {
  if (!leg) return false;
  return cancelled.has(`${quayPlace(leg.from)}|${leg.departure}`);
}

function runningLegs(legs) {
  const cancelled = cancelledDepartureSet();
  if (!cancelled.size) return legs;
  return legs.filter((leg) => !isCancelledDeparture(leg, cancelled));
}

function isRouteControl(msg) {
  if (!msg) return false;
  if (isPartialCancel(messageBlob(msg))) return false;
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
  if (hasCancel && has1136 && !has1135) {
    return isPartialCancel(blob) ? "1136" : "1135";
  }
  return "1136";
}

function messageMode(msg) {
  if (!msg) return "1136";
  if (isPartialCancel(messageBlob(msg))) return "1136";
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

function chosenRoute() {
  return CHOOSABLE_ROUTES.has(state.routeChoice) ? state.routeChoice : "1136";
}

function operationalMode(date = selectedDate()) {
  return resolveRoutePlan(state.messages?.messages, Date.now(), date).mode || "1136";
}

function driftNeedsOperationalTable(resolved, parsed) {
  const mode = resolved?.mode || "1136";
  if (mode === "kombi" || mode === "1135") return true;
  if (!parsed) return false;
  return (
    parsed.after === "kombi" ||
    parsed.before === "kombi" ||
    parsed.after === "1135" ||
    parsed.before === "1135"
  );
}

function applySwitchPlan(mode, parsed, date) {
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

function activePlan(date = selectedDate()) {
  const fromQuery = switchOverride();
  const resolved = resolveRoutePlan(state.messages?.messages, Date.now(), date);
  const override = routeOverride();
  const parsed = fromQuery || resolved.switch;
  if (override) {
    const forOverride = parsed && (parsed.after || override) === override ? parsed : null;
    return applySwitchPlan(override, forOverride, date);
  }
  if (driftNeedsOperationalTable(resolved, parsed)) {
    const mode = (fromQuery ? fromQuery.after : resolved.mode) || "1136";
    return applySwitchPlan(mode, parsed, date);
  }
  return { mode: chosenRoute(), switch: null, notice: null, uncertain: false };
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

function pad2(n) {
  return String(n).padStart(2, "0");
}

function fromOsloWall(year, month, day, hour = 0, minute = 0, second = 0) {
  const wall = `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;
  for (const offset of ["+02:00", "+01:00"]) {
    const ms = Date.parse(wall + offset);
    if (!Number.isFinite(ms)) continue;
    const parts = osloParts(new Date(ms));
    if (
      Number(parts.year) === year &&
      Number(parts.month) === month &&
      Number(parts.day) === day &&
      Number(parts.hour) === hour &&
      Number(parts.minute) === minute &&
      Number(parts.second) === second
    ) {
      return new Date(ms).toISOString();
    }
  }
  const ms = Date.parse(`${wall}Z`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function isoFromUnix(ts) {
  const n = Number(ts);
  if (!n) return null;
  return new Date(n * 1000).toISOString();
}

function parseFjord1Published(dateStr, fallbackTs) {
  const raw = String(dateStr || "").trim();
  const match = raw.match(
    /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[,\s]+(?:kl\.?\s*)?(\d{1,2})[:.](\d{2})(?::(\d{2}))?)?/i
  );
  if (match) {
    const iso = fromOsloWall(
      Number(match[3]),
      Number(match[2]),
      Number(match[1]),
      Number(match[4] || 0),
      Number(match[5] || 0),
      Number(match[6] || 0)
    );
    if (iso) return iso;
  }
  return isoFromUnix(fallbackTs);
}

function classifyMessage(text) {
  if (!text) return "info";
  const hasNormal = NORMAL_RE.test(text);
  const hasCancel = CANCEL_RE.test(text);
  const hasDelay = DELAY_RE.test(text);
  const hasCapacity = CAPACITY_RE.test(text);
  if (hasCancel && hasNormal) return hasDelay ? "delay" : "normal";
  if (hasCancel) return "cancelled";
  if (hasDelay) return "delay";
  if (hasNormal) return "normal";
  if (hasCapacity) return "capacity";
  return "info";
}

function isRoute1136Message(heading, text, connectionNumber) {
  if (Number(connectionNumber) === CONN_1136) return true;
  return ROUTE_1136_HINT_RE.test(`${heading || ""} ${text || ""}`);
}

function isLocalMessage(heading, text, connectionNumber) {
  if (isRoute1136Message(heading, text, connectionNumber)) return true;
  const blob = `${heading || ""} ${text || ""}`;
  return LOCAL_ROUTE_RE.test(blob) || LOCAL_PLACE_RE.test(blob);
}

function compactMessageText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function messageMergeKey(msg) {
  return `${compactMessageText(msg?.heading)}|${compactMessageText(msg?.text)}`;
}

function liveMessageId(heading, text) {
  const key = messageMergeKey({ heading, text });
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return `live:${(hash >>> 0).toString(16)}`;
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function normalizeFjord1Node(node) {
  const heading = compactMessageText(node?.heading);
  const text = compactMessageText(node?.content ?? node?.text);
  const connection = node?.connectionNumber ?? null;
  const validFromTs = node?.validFrom?.timestamp ?? node?.validFrom;
  const validToTs = node?.validTo?.timestamp ?? node?.validTo;
  const published = parseFjord1Published(node?.date || "", validFromTs);
  const blob = `${heading} ${text}`;
  const local = isLocalMessage(heading, text, connection);
  return {
    id: node?.id || liveMessageId(heading, text),
    heading,
    text,
    publishedAt: published,
    validFrom: isoFromUnix(validFromTs),
    validTo: isoFromUnix(validToTs),
    countyNumber: node?.countyNumber ?? null,
    connectionNumber: connection,
    important: Boolean(node?.importantMessage || node?.important),
    severity: classifyMessage(text),
    isRoute1136: isRoute1136Message(heading, text, connection),
    isLocal: local,
    isRouteControl:
      !isPartialCancel(blob) &&
      !is1049Only(heading, text) &&
      (local || HJORUNDFJORD_RE.test(blob)),
    routeMode: modeFromText(blob),
    routeWindow: windowFromText(blob, published),
    activateAt: activateAtFromText(blob),
    vessel: vesselFromText(blob),
    routeSwitch: switchFromText(blob),
  };
}

function parseFjord1TrafficHtml(html) {
  const source = decodeHtmlEntities(html || "");
  const found = [];
  const blockRe =
    /fjord1-alert__header">\s*<span class="ezstring-field">([^<]*)<\/span>[\s\S]*?fjord1-alert__content">\s*<span class="ezstring-field">([^<]*)<\/span>[\s\S]*?fjord1-alert__footer">\s*([^<]+)/g;
  for (const match of source.matchAll(blockRe)) {
    found.push(
      normalizeFjord1Node({
        heading: match[1],
        content: match[2],
        date: compactMessageText(match[3]),
      })
    );
  }
  if (found.length) return found;
  for (const chunk of source.split(/\n{2,}/)) {
    const line = compactMessageText(chunk);
    const match = line.match(/^Rute\s+\d+\s+(.+?):\s*(.+)$/i);
    if (!match) continue;
    found.push(
      normalizeFjord1Node({
        heading: match[1],
        content: line,
      })
    );
  }
  return found;
}

function fjord1Payload(messages, { fetchedAt = null, live = true, complete = false } = {}) {
  return {
    source: FJORD1_MESSAGES_PAGE,
    fetchedAt: fetchedAt || new Date().toISOString(),
    fetchedLive: live,
    complete,
    messages,
  };
}

function messagesAreStale(payload, now = Date.now()) {
  const ms = Date.parse(payload?.fetchedAt || "");
  if (!Number.isFinite(ms)) return true;
  return now - ms > MESSAGES_STALE_MS;
}

function mergeMessagePayloads(base, live) {
  if (!live?.messages?.length) return base || null;
  if (!base?.messages?.length || live.complete) return live;
  const byKey = new Map();
  for (const msg of base.messages) byKey.set(messageMergeKey(msg), msg);
  let added = false;
  for (const msg of live.messages) {
    const key = messageMergeKey(msg);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, msg);
      added = true;
      continue;
    }
    if (publishedMs(msg) > publishedMs(existing)) {
      byKey.set(key, { ...existing, ...msg, id: existing.id || msg.id });
      added = true;
    }
  }
  if (!added && !live.fetchedLive) return base;
  const messages = [...byKey.values()].sort((a, b) => publishedMs(b) - publishedMs(a));
  return {
    source: live.source || base.source,
    fetchedAt: live.fetchedAt || base.fetchedAt,
    fetchedLive: Boolean(live.fetchedLive || added),
    messages,
  };
}

function fjord1GraphqlIsBlocked() {
  if (fjord1GraphqlBlocked) return true;
  try {
    if (
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem(FJORD1_GRAPHQL_KEY) === "blocked"
    ) {
      fjord1GraphqlBlocked = true;
      return true;
    }
  } catch {
    // private mode
  }
  return false;
}

function markFjord1GraphqlBlocked() {
  fjord1GraphqlBlocked = true;
  try {
    sessionStorage.setItem(FJORD1_GRAPHQL_KEY, "blocked");
  } catch {
    // private mode
  }
}

async function fetchWithTimeout(url, options = {}, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFjord1Graphql() {
  const response = await fetchWithTimeout(FJORD1_GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: FJORD1_MESSAGES_QUERY }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(response.statusText);
  const body = await response.json();
  if (body?.errors) throw new Error("Fjord1 GraphQL-feil");
  const edges = body?.data?.content?.trafficMessages?.edges || [];
  const messages = edges
    .map((edge) => edge?.node)
    .filter(Boolean)
    .map(normalizeFjord1Node);
  return fjord1Payload(messages, { complete: true });
}

async function fetchFjord1Html() {
  const response = await fetchWithTimeout(FJORD1_HTML_READER, {
    headers: { "X-Return-Format": "html", Accept: "text/html,text/plain" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(response.statusText);
  const messages = parseFjord1TrafficHtml(await response.text());
  if (!messages.length) throw new Error("Ingen Fjord1-meldingar i HTML");
  return fjord1Payload(messages);
}

async function fetchFjord1Messages() {
  if (!fjord1GraphqlIsBlocked()) {
    try {
      return await fetchFjord1Graphql();
    } catch {
      markFjord1GraphqlBlocked();
    }
  }
  return fetchFjord1Html();
}

async function fetchMessagesJson() {
  const response = await fetch(messagesUrl(), { cache: "no-cache" });
  if (!response.ok) throw new Error(response.statusText);
  return response.json();
}

function latestLocalMessage(now = Date.now()) {
  return resolveRoutePlan(state.messages?.messages, now, selectedDate()).message || null;
}

function messageVessel(msg) {
  if (!msg) return null;
  return msg.vessel || vesselFromText(`${msg.heading || ""} ${msg.text || ""}`) || null;
}

function defaultVesselName(table) {
  if (table === "1135") return "Geiranger";
  if (table === "1136") return "Kvernes";
  return null;
}

/** Ferja som køyrer denne tabellen denne dagen, ikkje ei utgått kombirute-melding. */
function vesselNameForTable(table, date = selectedDate()) {
  const plan = resolveRoutePlan(state.messages?.messages, Date.now(), date);
  const fromMsg = messageVessel(plan.message);
  const after = plan.switch?.after || plan.mode;
  const before = plan.switch?.before;
  if (fromMsg) {
    if (plan.switch) {
      if (table === after) return fromMsg;
      if (table === before) return defaultVesselName(before);
    } else if (messageMode(plan.message) === table || plan.mode === table) {
      return fromMsg;
    }
  }
  return defaultVesselName(table);
}

function activeVessel() {
  return vesselNameForTable(activeMode());
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

function phoneDigits(phone) {
  const digits = String(phone || "").replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.startsWith("47") && digits.length >= 10) return digits.slice(-8);
  return digits;
}

function telHref(phone) {
  const digits = phoneDigits(phone);
  return digits ? `tel:+47${digits}` : "";
}

function defaultSignalPhone(leg) {
  const table = leg?.table || activeMode();
  if (table === "1135") return vesselInfo("Geiranger")?.phone || "916 69 321";
  if (table === "kombi") return "";
  return vesselInfo("Kvernes")?.phone || "916 69 340";
}

/** Telefon til ferja som faktisk køyrer denne turen, elles nummeret frå rutetabellen. */
function signalPhone(leg) {
  const table = leg?.table || activeMode();
  const running = vesselInfo(vesselNameForTable(table));
  if (running?.phone) return running.phone;
  if (leg?.signal?.phone) return leg.signal.phone;
  return defaultSignalPhone(leg);
}

function bindTelLink(link, phone, how) {
  const href = telHref(phone);
  if (!href) return link;
  link.href = href;
  link.addEventListener("click", () => track("Call ferry", { how }));
  return link;
}

function phoneIcon() {
  const svg = svgEl("svg", {
    viewBox: "0 0 24 24",
    class: "stop-phone-icon",
    "aria-hidden": "true",
    focusable: "false",
  });
  svg.append(
    svgEl("path", {
      fill: "currentColor",
      d: "M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z",
    })
  );
  return svg;
}

function signalTag(leg, { call = true } = {}) {
  const phone = call ? signalPhone(leg) : "";
  if (!telHref(phone)) return el("span", "stop-tag", t("signal.onRequest"));
  const link = el("a", "stop-tag stop-tag-call");
  link.append(document.createTextNode(t("signal.onRequest")));
  link.append(phoneIcon());
  link.setAttribute("aria-label", t("signal.callAria", { phone }));
  link.title = t("signal.callAria", { phone });
  return bindTelLink(link, phone, "tag");
}

function linkifyPhone(node, text, phone, how) {
  if (!phone || !text.includes(phone)) {
    node.textContent = text;
    return;
  }
  const at = text.indexOf(phone);
  node.replaceChildren();
  if (at > 0) node.append(document.createTextNode(text.slice(0, at)));
  const link = el("a", "footer-phone", phone);
  link.setAttribute("aria-label", t("signal.callAria", { phone }));
  node.append(bindTelLink(link, phone, how));
  const after = text.slice(at + phone.length);
  if (after) node.append(document.createTextNode(after));
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

function statusProgress(from, until, now) {
  if (!Number.isFinite(from) || !Number.isFinite(until) || !Number.isFinite(now)) return null;
  const span = until - from;
  if (span <= 0) return null;
  return Math.min(1, Math.max(0, (now - from) / span));
}

function withSpan(status, from, until, now) {
  const progress = statusProgress(from, until, now);
  if (progress == null) return status;
  return { ...status, from, until, progress };
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
    const start = clockMinutes(last.arrival);
    return withSpan(
      {
        at: start + 0.5,
        underway: true,
        short: t("status.backEmpty", { home }),
        text: t("status.backEmptyText", { to: last.to, home }),
      },
      start,
      start + deadhead,
      now
    );
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
      const start = clockMinutes(leg.departure);
      const end = clockMinutes(leg.arrival);
      return withSpan(
        {
          at: start + 0.5,
          underway: true,
          text: t("status.underwayTo", { dest: leg.to }),
        },
        start,
        end,
        now
      );
    }
    const next = legs[i + 1];
    if (next && now >= clockMinutes(leg.arrival) && now < clockMinutes(next.departure)) {
      const start = clockMinutes(leg.arrival);
      const end = clockMinutes(next.departure);
      const moving = !isCombinedTimetable() && leg.to !== next.from;
      if (moving) {
        return withSpan(
          {
            at: start + 0.5,
            underway: true,
            text: t("status.repositionTo", { quay: next.from }),
          },
          start,
          end,
          now
        );
      }
      const stay = layoverAfter(leg, next);
      if (stay) {
        return withSpan(
          {
            at: start + 0.5,
            layover: true,
            short: t("status.mooredAt", { quay: stay.quay }),
            text: t("status.layoverAt", {
              quay: stay.quay,
              duration: durationText(stay.minutes),
              time: hhmm(stay.until),
            }),
          },
          start,
          end,
          now
        );
      }
      return withSpan(
        {
          at: start + 0.5,
          text: t("status.mooredAt", { quay: leg.to }),
        },
        start,
        end,
        now
      );
    }
  }
  return null;
}

function currentStatus(legs) {
  const planned = ferryStatus(runningLegs(legs));
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

function readRouteChoice(storage) {
  try {
    const store =
      storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    const raw = store?.getItem(ROUTE_CHOICE_KEY);
    return CHOOSABLE_ROUTES.has(raw) ? raw : "1136";
  } catch {
    return "1136";
  }
}

function writeRouteChoice(choice, storage) {
  try {
    const store =
      storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    if (!store) return;
    const next = CHOOSABLE_ROUTES.has(choice) ? choice : "1136";
    store.setItem(ROUTE_CHOICE_KEY, next);
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

function readCachedMessages(storage) {
  try {
    const store =
      storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    if (!store) return null;
    const raw = store.getItem(MESSAGES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.messages)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedMessages(payload, storage) {
  try {
    const store =
      storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    if (!store || !payload || !Array.isArray(payload.messages)) return;
    store.setItem(MESSAGES_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // kvote / privat modus
  }
}

function readLastMode(storage) {
  try {
    const store =
      storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    if (!store) return null;
    const parsed = JSON.parse(store.getItem(LAST_MODE_KEY) || "null");
    if (!parsed || !ALLOWED_MODES.has(parsed.mode)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLastMode(mode = activeMode(), date = todayIso(), storage) {
  try {
    const store =
      storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    if (!store || !ALLOWED_MODES.has(mode)) return;
    store.setItem(LAST_MODE_KEY, JSON.stringify({ date, mode }));
  } catch {
    // kvote / privat modus
  }
}

function hydrateCachedMessages(storage) {
  if (state.messages) return state.messages;
  const cached = readCachedMessages(storage);
  if (cached) state.messages = cached;
  return cached;
}

function markMessagesHydrated() {
  messagesHydrated = true;
  for (const resolve of messagesHydrateWaiters) resolve();
  messagesHydrateWaiters = [];
}

function whenMessagesHydrated() {
  if (messagesHydrated || state.messages) {
    messagesHydrated = true;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    messagesHydrateWaiters.push(resolve);
  });
}

function showArrivals() {
  return !state.hideArrivals;
}

function nextDepartureFrom(legs, quay, skipPassed = false) {
  const cancelled = cancelledDepartureSet();
  return (
    legs.find(
      (leg) =>
        isVisibleDeparture(leg) &&
        !isCancelledDeparture(leg, cancelled) &&
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
 * Turane over Storfjorden som gjeld den valde dagen, delte etter retning.
 * Reisevegen avgjer kva veg det korresponderer: skal du inn fjorden treng du
 * ei ferje som er framme på knutepunktet i tide, skal du ut treng du ei som
 * går derifrå etterpå.
 */
const SAEBØ = "Sæbø";
const TRANSFER_MARGIN_MIN = 5;
const TRANSFER_DESTINATIONS = ["Trandal", "Standal", "Skår"];

function otherFerryMode() {
  if (isCombinedTimetable()) return null;
  const mode = activeMode();
  if (mode === "1135") return "1136";
  if (mode === "1136") return "1135";
  return null;
}

function transferLineId(dest) {
  const slug = dest === "Skår" ? "skar" : String(dest || "").toLowerCase();
  return `saebo-${slug}`;
}

function transferDestFromId(id) {
  return TRANSFER_DESTINATIONS.find((dest) => transferLineId(dest) === id) || null;
}

function isFerryTransfer(id) {
  return Boolean(transferDestFromId(id));
}

function legKey(leg) {
  return leg.id || `${leg.from}|${leg.departure}|${leg.to}|${leg.arrival || ""}`;
}

function nextSameSailing(legs, current, seen) {
  const from = quayPlace(current.to);
  const earliest = clockMinutes(current.arrival);
  let found = null;
  for (const leg of legs) {
    if (seen.has(legKey(leg))) continue;
    if (quayPlace(leg.from) !== from) continue;
    const dep = clockMinutes(leg.departure);
    const gap = dep - earliest;
    if (gap < 0 || gap >= LAYOVER_MIN_MINUTES) continue;
    if (!found || dep < clockMinutes(found.departure)) found = leg;
  }
  return found;
}

function prevSameSailing(legs, current, seen) {
  const to = quayPlace(current.from);
  const latest = clockMinutes(current.departure);
  let found = null;
  for (const leg of legs) {
    if (seen.has(legKey(leg))) continue;
    if (quayPlace(leg.to) !== to) continue;
    const arr = clockMinutes(leg.arrival);
    const gap = latest - arr;
    if (gap < 0 || gap >= LAYOVER_MIN_MINUTES) continue;
    if (!found || arr > clockMinutes(found.arrival)) found = leg;
  }
  return found;
}

/** Går same segling vidare frå eit Sæbø-bein til destinasjonen. */
function reachesDest(legs, start, dest) {
  if (quayPlace(start.to) === dest) return true;
  let current = start;
  const seen = new Set([legKey(start)]);
  for (let i = 0; i < 8; i++) {
    const next = nextSameSailing(legs, current, seen);
    if (!next) return false;
    seen.add(legKey(next));
    if (quayPlace(next.to) === dest) return true;
    if (quayPlace(next.to) === SAEBØ) return false;
    current = next;
  }
  return false;
}

/** Fyrste bein i same segling, der ein stig på ved destinasjonen. */
function boardingFromDest(legs, arrival, dest) {
  if (quayPlace(arrival.from) === dest) return arrival;
  let current = arrival;
  const seen = new Set([legKey(arrival)]);
  for (let i = 0; i < 8; i++) {
    const prev = prevSameSailing(legs, current, seen);
    if (!prev) return null;
    seen.add(legKey(prev));
    if (quayPlace(prev.from) === dest) return prev;
    if (quayPlace(prev.from) === SAEBØ) return null;
    current = prev;
  }
  return null;
}

function cameFromDest(legs, arrival, dest) {
  return Boolean(boardingFromDest(legs, arrival, dest));
}

function tableGroup(leg) {
  return leg.table || "same";
}

function collectSailings(legs) {
  const used = new Set();
  const sailings = [];
  for (const leg of legs) {
    const key = legKey(leg);
    if (used.has(key)) continue;
    if (prevSameSailing(legs, leg, new Set())) continue;
    const chain = [leg];
    used.add(key);
    let current = leg;
    for (let i = 0; i < 24; i++) {
      const next = nextSameSailing(legs, current, used);
      if (!next) break;
      used.add(legKey(next));
      chain.push(next);
      current = next;
    }
    sailings.push(chain);
  }
  return sailings;
}

function rideOnSailing(chain, from, to) {
  const rides = [];
  for (let i = 0; i < chain.length; i++) {
    if (quayPlace(chain[i].from) !== from) continue;
    const slice = [];
    for (let j = i; j < chain.length; j++) {
      slice.push(chain[j]);
      const arrived = quayPlace(chain[j].to);
      if (arrived === to) {
        rides.push(slice.slice());
        break;
      }
      if (arrived === from) break;
    }
  }
  if (!rides.length) return [];
  rides.sort((a, b) => a.length - b.length || clockMinutes(a[0].departure) - clockMinutes(b[0].departure));
  const shortest = rides[0].length;
  return rides.filter((ride) => ride.length === shortest);
}

function hubOnwardReaches(legs, start, hub, dest) {
  for (let j = start; j < legs.length; j++) {
    const arrived = quayPlace(legs[j].to);
    if (arrived === dest) return true;
    if (arrived === hub) return false;
  }
  return false;
}

function firstHubOnwardIndex(legs, hub, dest) {
  for (let i = 0; i < legs.length; i++) {
    if (quayPlace(legs[i].from) !== hub) continue;
    if (hubOnwardReaches(legs, i, hub, dest)) return i;
  }
  return -1;
}

/** Hopp over Sæbø–Leknes-pendel; passasjeren ventar på knutepunktet. */
function collapseHubWait(legs, hub = SAEBØ) {
  if (!legs.length) return { legs, wait: null };
  const dest = quayPlace(legs[legs.length - 1].to);
  if (dest === hub) return { legs, wait: null };
  const firstArr = legs.findIndex((leg) => quayPlace(leg.to) === hub);
  const onward = firstHubOnwardIndex(legs, hub, dest);
  if (firstArr < 0 || onward < 0 || onward <= firstArr) return { legs, wait: null };
  const arrive = legs[firstArr];
  const depart = legs[onward];
  const minutes = clockMinutes(depart.departure) - clockMinutes(arrive.arrival);
  const dropped = onward > firstArr + 1;
  if (minutes < 1) return { legs, wait: null };
  if (!dropped && minutes < LAYOVER_MIN_MINUTES) return { legs, wait: null };
  return {
    legs: [...legs.slice(0, firstArr + 1), ...legs.slice(onward)],
    wait: {
      quay: hub,
      minutes,
      from: arrive.arrival,
      until: depart.departure,
      afterKey: legKey(arrive),
    },
  };
}

function asPassengerJourney(parts, extra = {}) {
  const collapsed = collapseHubWait(parts);
  return {
    transfer: Boolean(extra.transfer),
    hub: extra.hub,
    onwardAt: extra.onwardAt,
    legs: collapsed.legs,
    wait: collapsed.wait,
  };
}

function sameTableJourneys(legs, from, to) {
  if (!from || !to || from === to) return [];
  return collectSailings(legs).flatMap((chain) => rideOnSailing(chain, from, to));
}

function hubTransfers(feederLegs, onwardLegs, from, to, hub) {
  const feeders = sameTableJourneys(feederLegs, from, hub);
  const onwards = sameTableJourneys(onwardLegs, hub, to);
  const journeys = [];
  for (const onward of onwards) {
    const departHub = clockMinutes(onward[0].departure);
    const latest = departHub - TRANSFER_MARGIN_MIN;
    const candidates = feeders.filter(
      (feeder) => clockMinutes(feeder[feeder.length - 1].arrival) <= latest
    );
    if (!candidates.length) continue;
    candidates.sort(
      (a, b) =>
        clockMinutes(b[b.length - 1].arrival) - clockMinutes(a[a.length - 1].arrival)
    );
    journeys.push({
      legs: [...candidates[0], ...onward],
      transfer: true,
      hub,
      onwardAt: onward[0].departure,
    });
  }
  return journeys;
}

function passengerJourneysFrom(legs, from, to) {
  if (!from || !to || from === to) return [];
  const groups = new Map();
  for (const leg of legs) {
    const key = tableGroup(leg);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(leg);
  }
  const tables = [...groups.values()];
  const same = tables.flatMap((group) => sameTableJourneys(group, from, to));
  if (same.length) return same.map((parts) => asPassengerJourney(parts));
  if (tables.length < 2) return [];
  const transfers = [];
  for (let i = 0; i < tables.length; i++) {
    for (let j = 0; j < tables.length; j++) {
      if (i === j) continue;
      transfers.push(...hubTransfers(tables[i], tables[j], from, to, SAEBØ));
    }
  }
  return transfers.map((journey) => asPassengerJourney(journey.legs, journey));
}

function journeyForLeg(journeys, leg) {
  if (!journeys || !leg) return null;
  const key = legKey(leg);
  return journeys.find((journey) => journey.legs.some((part) => legKey(part) === key)) || null;
}

function journeyNote(leg, journey) {
  if (!journey || journey.legs.length < 2) return null;
  if (legKey(journey.legs[0]) !== legKey(leg)) return null;
  const last = journey.legs[journey.legs.length - 1];
  const via = journey.legs.slice(0, -1).map((part) => quayPlace(part.to));
  if (journey.transfer) {
    return t("place.transferVia", {
      hub: journey.hub || SAEBØ,
      to: quayPlace(last.to),
      time: hhmm(journey.onwardAt),
      arrival: hhmm(last.arrival),
    });
  }
  return t("place.via", { via: via.join(", "), time: hhmm(last.arrival) });
}

function otherFerryLegs(date) {
  const other = otherFerryMode();
  if (!other) return [];
  return legsForMode(other, date);
}

function placeFilterQuays(legs, date) {
  const seen = quaysInDay(legs);
  for (const quay of quaysInDay(otherFerryLegs(date))) {
    if (!seen.includes(quay)) seen.push(quay);
  }
  return seen;
}

function legsForPlaceFilter(date, current = legsForDate(date)) {
  if (!state.fromFilter && !state.toFilter) return current;
  const extra = otherFerryLegs(date);
  if (!extra.length) return current;
  if (state.fromFilter && state.toFilter) return sortDayLegs([...current, ...extra]);
  const quays = quaysInDay(current);
  const selected = [state.fromFilter, state.toFilter].filter(Boolean);
  if (selected.some((quay) => !quays.includes(quay))) return sortDayLegs([...current, ...extra]);
  return current;
}

function transferDestinationsFor(date) {
  const legs = legsForMode("1136", date);
  return TRANSFER_DESTINATIONS.filter((dest) =>
    legs.some(
      (leg) =>
        (quayPlace(leg.from) === SAEBØ && reachesDest(legs, leg, dest)) ||
        (quayPlace(leg.to) === SAEBØ && cameFromDest(legs, leg, dest))
    )
  );
}

function asTransferTrip(leg, { from, to, departure, arrival, signal }) {
  return {
    from,
    to,
    departure: departure || leg.departure,
    arrival: arrival || leg.arrival,
    signal: signal === undefined ? leg.signal : signal,
    table: leg.table,
  };
}

function ferryTransferIndex(date) {
  const dest = transferDestFromId(state.connection);
  const other = otherFerryMode();
  if (!other || !dest) return null;
  const otherLegs = legsForMode(other, date);
  const view = activeMode();
  const toHub =
    other === "1136"
      ? otherLegs
          .filter((leg) => quayPlace(leg.to) === SAEBØ && cameFromDest(otherLegs, leg, dest))
          .map((leg) => {
            const board = boardingFromDest(otherLegs, leg, dest) || leg;
            return asTransferTrip(leg, {
              from: dest,
              to: SAEBØ,
              departure: board.departure,
              arrival: leg.arrival,
              signal: board.signal || leg.signal,
            });
          })
      : otherLegs
          .filter((leg) => quayPlace(leg.to) === SAEBØ)
          .map((leg) =>
            asTransferTrip(leg, { from: leg.from, to: SAEBØ, signal: leg.signal })
          );
  const fromHub =
    other === "1136"
      ? otherLegs
          .filter((leg) => quayPlace(leg.from) === SAEBØ && reachesDest(otherLegs, leg, dest))
          .map((leg) =>
            asTransferTrip(leg, {
              from: SAEBØ,
              to: dest,
              departure: leg.departure,
              arrival: leg.arrival,
              signal: leg.signal,
            })
          )
      : otherLegs
          .filter((leg) => quayPlace(leg.from) === SAEBØ)
          .map((leg) =>
            asTransferTrip(leg, { from: SAEBØ, to: leg.to, signal: leg.signal })
          );
  return {
    hub: SAEBØ,
    roadTo: SAEBØ,
    buffer: TRANSFER_MARGIN_MIN,
    ferry: true,
    dest,
    other,
    view,
    toHub: toHub.sort((a, b) => a.arrival.localeCompare(b.arrival)),
    fromHub: fromHub.sort((a, b) => a.departure.localeCompare(b.departure)),
  };
}

function connectionIndex(date) {
  if (!state.connection) return null;
  if (isFerryTransfer(state.connection)) return ferryTransferIndex(date);
  const data = state.connections;
  if (!data) return null;
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
];

function visibleConnectionLines(legs) {
  const quays = quaysInDay(legs);
  const lines = [];
  const other = otherFerryMode();
  const date = selectedDate();
  if (other && quays.includes(SAEBØ) && quaysInDay(legsForMode(other, date)).includes(SAEBØ)) {
    for (const dest of transferDestinationsFor(date)) {
      lines.push({ id: transferLineId(dest), label: dest, hub: SAEBØ });
    }
  }
  const road = (state.connections?.lines || DEFAULT_CONNECTION_LINES).filter((line) => {
    if (line.id === "oye" || line.hub === "Leknes" || line.roadTo === "Leknes") return false;
    const dest = line.roadTo || state.connections?.roadTo;
    return !dest || quays.includes(dest);
  });
  return lines.concat(road);
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

function connectionSignalText(trip, route) {
  if (!trip?.signal || !route) return "";
  const phone = signalPhone(trip);
  return phone
    ? t("conn.signalCallPhone", { route, phone })
    : t("conn.signalCall", { route });
}

function withConnectionSignal(base, trip, index) {
  const extra = connectionSignalText(trip, index.other);
  return extra ? `${base}. ${extra}` : base;
}

function connectionNote(index, kind, leg) {
  if (!index) return null;
  const quay = quayPlace(kind === "dep" ? leg.from : leg.to);
  if (quay !== index.roadTo) return null;
  if (index.dest && index.view === "1136") {
    const own = legsForMode("1136", selectedDate());
    if (kind === "dep") {
      if (!reachesDest(own, leg, index.dest)) return null;
    } else if (!cameFromDest(own, leg, index.dest)) return null;
  }
  if (kind === "dep") {
    const trip = inboundConnection(index, leg.departure);
    return trip
      ? withConnectionSignal(
          t("conn.takeFerry", { time: hhmm(trip.departure), from: trip.from }),
          trip,
          index
        )
      : t("conn.noInbound", { hub: index.hub });
  }
  const trip = outboundConnection(index, leg.arrival);
  return trip
    ? withConnectionSignal(
        t("conn.onward", { time: hhmm(trip.departure), hub: index.hub, to: trip.to }),
        trip,
        index
      )
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
  const phone = signalPhone(leg);
  const label = t("signal.callBy", { time: minutesToClock(deadline) });
  if (telHref(phone)) {
    const link = el("a", "stop-phone", `${label} · ${phone}`);
    note.append(bindTelLink(link, phone, "note"));
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

function sailingDoneAt(event) {
  if ((event.kind === "layover" || event.kind === "wait") && event.until != null) return event.until;
  if (event.kind === "arr") return event.at;
  if (event.kind !== "dep" || !event.leg) return event.at;
  const leg = event.leg;
  if (
    state.fromFilter &&
    !state.toFilter &&
    state.fromFilter === leg.from &&
    leg.from !== leg.to
  ) {
    return clockMinutes(leg.departure);
  }
  if (leg.arrival) return clockMinutes(leg.arrival);
  return event.at;
}

function departureRow(leg, past, connections, journey = null) {
  const cancelled = isCancelledDeparture(leg);
  const row = el(
    "div",
    `stop stop-dep${past ? " is-past" : ""}${cancelled ? " is-cancelled" : ""}`
  );
  row.append(el("span", "stop-time", hhmm(leg.departure)));
  const body = el("span", "stop-body");
  const head = el("span", "stop-head");
  head.append(el("span", "stop-name", t("sailing.route", { from: leg.from, to: leg.to })));
  if (cancelled) head.append(el("span", "stop-tag stop-tag-stop", t("sailing.cancelled")));
  if (leg.signal) head.append(signalTag(leg, { call: !cancelled }));
  body.append(head);
  if (showArrivals()) {
    body.append(
      el("span", "stop-note stop-eta", t("sailing.arrival", { time: hhmm(leg.arrival) }))
    );
  }
  if (!cancelled) {
    const via = journeyNote(leg, journey);
    if (via) body.append(el("span", "stop-note stop-conn", via));
    const note = signalNote(leg, isToday());
    if (note) body.append(note);
    const depConn = connectionNote(connections, "dep", leg);
    if (depConn) body.append(el("span", "stop-note stop-conn", depConn));
    const arrConn = connectionNote(connections, "arr", leg);
    if (arrConn) body.append(el("span", "stop-note stop-conn", arrConn));
  }
  row.append(body);
  const departed = isToday() && hasPassed(leg.departure);
  const remaining = cancelled
    ? t("sailing.cancelled")
    : past || departed
      ? t("gone")
      : isToday()
        ? countdown(leg.departure)
        : "";
  const remainingNode = el("span", "stop-state", remaining);
  if (isToday() && !cancelled) remainingNode.dataset.countdown = leg.departure;
  row.append(remainingNode);
  return row;
}

function layoverAfter(leg, next) {
  if (!next || !leg?.arrival || !next.departure) return null;
  if (leg.to !== next.from) return null;
  const minutes = clockMinutes(next.departure) - clockMinutes(leg.arrival);
  if (minutes < LAYOVER_MIN_MINUTES) return null;
  return {
    quay: leg.to,
    minutes,
    from: leg.arrival,
    until: next.departure,
  };
}

function layoverRow(stay, past) {
  const row = el("div", `stop stop-layover${past ? " is-past" : ""}`);
  row.append(el("span", "stop-time", hhmm(stay.from)));
  const body = el("span", "stop-body");
  const title = state.fromFilter
    ? t("layover.title")
    : t("layover.atQuay", { quay: stay.quay });
  body.append(el("span", "stop-name", title));
  body.append(
    el(
      "span",
      "stop-note",
      t("layover.until", { duration: durationText(stay.minutes), time: hhmm(stay.until) })
    )
  );
  row.append(body);
  row.append(el("span", "stop-state", ""));
  return row;
}

function waitRow(stay, past) {
  const row = el("div", `stop stop-layover stop-wait${past ? " is-past" : ""}`);
  row.append(el("span", "stop-time", hhmm(stay.from)));
  const body = el("span", "stop-body");
  body.append(
    el(
      "span",
      "stop-name",
      t("place.waitAt", { quay: stay.quay, duration: durationText(stay.minutes) })
    )
  );
  body.append(el("span", "stop-note", t("place.waitUntil", { time: hhmm(stay.until) })));
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
  const kind = status.layover ? " is-layover" : status.underway ? " is-underway" : " is-moored";
  const row = el("div", `now${kind}`);
  const progress = statusProgress(status.from, status.until, nowMinutes());
  if (progress != null) {
    row.classList.add("has-progress");
    row.dataset.from = String(status.from);
    row.dataset.until = String(status.until);
    row.style.setProperty("--now-progress", `${Math.round(progress * 100)}%`);
    const track = el("span", "now-track");
    track.setAttribute("aria-hidden", "true");
    track.append(el("span", "now-fill"));
    row.append(track);
  }
  row.append(el("span", "now-label", t("now")));
  row.append(el("span", "now-text", status.text));
  return row;
}

function matchesLegPlaces(leg, journeys = null) {
  if (!leg) return false;
  if (state.fromFilter && state.toFilter) {
    if (journeys) return Boolean(journeyForLeg(journeys, leg));
    return quayPlace(leg.from) === state.fromFilter && quayPlace(leg.to) === state.toFilter;
  }
  if (state.fromFilter && quayPlace(leg.from) !== state.fromFilter) return false;
  if (state.toFilter && quayPlace(leg.to) !== state.toFilter) return false;
  return true;
}

function matchesLayover(stay) {
  if (!stay) return false;
  if (state.fromFilter && state.toFilter) return false;
  if (state.toFilter) return false;
  if (state.fromFilter) return stay.quay === state.fromFilter;
  return true;
}

function swapPlaceFilters() {
  const from = state.fromFilter;
  state.fromFilter = state.toFilter;
  state.toFilter = from;
}

function emptyPlaceMessage() {
  if (state.fromFilter && state.toFilter) {
    return t("empty.noFromTo", { from: state.fromFilter, to: state.toFilter });
  }
  if (state.fromFilter) return t("empty.noFrom", { from: state.fromFilter });
  if (state.toFilter) return t("empty.noTo", { to: state.toFilter });
  return t("empty.noTripsDay");
}

function matchesStop(event) {
  if (!state.fromFilter && !state.toFilter) return true;
  if (event?.kind === "split") return false;
  if (event?.kind === "dep" && event.leg) {
    if (state.fromFilter && state.toFilter) return true;
    return matchesLegPlaces(event.leg);
  }
  if (event?.kind === "wait") return Boolean(state.fromFilter && state.toFilter);
  if (state.fromFilter && state.toFilter) return false;
  if (!event?.quays || !event.quays.length) return true;
  if (state.fromFilter && event.quays.includes(state.fromFilter)) return true;
  if (state.toFilter && event.quays.includes(state.toFilter)) return true;
  return false;
}

const EVENT_SEQ = { arr: 0, split: 1, transfer: 2, layover: 3, wait: 3, dep: 4, status: 5 };

function compareTimelineEvents(a, b) {
  const seq = (event) => EVENT_SEQ[event.kind] ?? 0;
  return a.at - b.at || seq(a) - seq(b);
}

function tableName(mode) {
  if (mode === "kombi" || mode === "1135" || mode === "1136") return mode;
  return "1136";
}

function isParallelFerrySplit(fromTable, toTable) {
  const pair = new Set([fromTable, toTable]);
  return pair.has("1135") && pair.has("1136");
}

function isPlannedFerrySwitch(routeSwitch) {
  if (!routeSwitch) return false;
  return isParallelFerrySplit(routeSwitch.before, routeSwitch.after);
}

/** Raud merkelapp ved fyrste avgang når kombiruta tek til eller sluttar heile dagen. */
function dayStartSplit(legs) {
  if (!legs.length) return null;
  const plan = activePlan();
  if (plan.switch) return null;
  const mode = tableName(plan.mode);
  const prev = tableName(operationalMode(shiftIso(selectedDate(), -1)));
  if (mode === prev) return null;
  if (mode !== "kombi" && prev !== "kombi") return null;
  const first = legs.find((leg) => isVisibleDeparture(leg)) || legs[0];
  if (!first?.departure) return null;
  return {
    at: clockMinutes(first.departure),
    kind: "split",
    quays: [],
    build: (past) =>
      splitRow(
        { time: first.departure, quay: first.from, before: prev, notice: null },
        mode,
        past
      ),
  };
}

function buildEvents(legs, connections) {
  const events = [];
  const seenDep = new Set();
  const journeys =
    state.fromFilter && state.toFilter
      ? passengerJourneysFrom(legs, state.fromFilter, state.toFilter)
      : null;
  legs.forEach((leg, index) => {
    const depKey = `${leg.from}|${leg.departure}`;
    if (isVisibleDeparture(leg) && !seenDep.has(depKey)) {
      seenDep.add(depKey);
      if (matchesLegPlaces(leg, journeys)) {
        const journey = journeyForLeg(journeys, leg);
        events.push({
          at: clockMinutes(leg.departure),
          kind: "dep",
          quays: [leg.from, leg.to],
          leg,
          build: (past) => departureRow(leg, past, connections, journey),
        });
        if (journey?.wait && journey.wait.afterKey === legKey(leg)) {
          events.push({
            at: clockMinutes(journey.wait.from),
            until: clockMinutes(journey.wait.until),
            kind: "wait",
            quays: [journey.wait.quay],
            stay: journey.wait,
            build: (past) => waitRow(journey.wait, past),
          });
        }
      }
    }
    const next = legs[index + 1];
    const stay = layoverAfter(leg, next);
    if (stay && matchesLayover(stay)) {
      events.push({
        at: clockMinutes(stay.from),
        until: clockMinutes(stay.until),
        kind: "layover",
        quays: [stay.quay],
        stay,
        build: (past) => layoverRow(stay, past),
      });
    }
    if (next && leg.table && next.table && leg.table !== next.table) {
      const routeSwitch = activePlan().switch;
      if (isParallelFerrySplit(leg.table, next.table) && !isPlannedFerrySwitch(routeSwitch)) {
        // 1135 og 1136 i same tidslinje kjem frå frå/til-filteret, ikkje tabellskifte.
      } else {
        const notice =
          routeSwitch && clockMinutes(routeSwitch.time) === clockMinutes(next.departure)
            ? routeSwitch.notice
            : null;
        events.push({
          at: clockMinutes(next.departure),
          kind: "split",
          quays: [],
          build: (past) =>
            splitRow(
              { time: next.departure, quay: next.from, before: leg.table, notice },
              next.table,
              past
            ),
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
  const start = dayStartSplit(legs);
  if (start) events.push(start);
  return events;
}

function svgEl(name, attrs) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function swapIcon() {
  const svg = svgEl("svg", {
    viewBox: "0 0 24 24",
    "aria-hidden": "true",
    focusable: "false",
  });
  svg.append(
    svgEl("path", {
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      d: "M7 8h11M15 5l3 3-3 3M17 16H6M9 13l-3 3 3 3",
    })
  );
  return svg;
}

function fillSelect(select, options, value) {
  select.replaceChildren();
  for (const option of options) {
    const item = document.createElement("option");
    item.value = option.value ?? "";
    item.textContent = option.label;
    select.append(item);
  }
  select.value = value ?? "";
}

function placeField(id, labelText, options, value, onChange) {
  const field = el("label", "place-field");
  field.append(el("span", "place-label", labelText));
  const select = el("select", value ? "place-select has-value" : "place-select");
  select.id = id;
  fillSelect(select, options, value);
  select.addEventListener("change", () => onChange(select.value || null));
  field.append(select);
  return field;
}

function renderPlaceFilter(legs) {
  const root = document.getElementById("trip-filter");
  if (!root) return;
  root.replaceChildren();
  const quays = placeFilterQuays(legs, selectedDate());
  if (quays.length < 2) {
    state.fromFilter = null;
    state.toFilter = null;
    return;
  }
  if (state.fromFilter && !quays.includes(state.fromFilter)) state.fromFilter = null;
  if (state.toFilter && !quays.includes(state.toFilter)) state.toFilter = null;

  const any = { value: "", label: t("stops.all") };
  const fromOptions = [any].concat(
    quays
      .filter((quay) => quay !== state.toFilter)
      .map((quay) => ({ value: quay, label: quay }))
  );
  const toOptions = [any].concat(
    quays
      .filter((quay) => quay !== state.fromFilter)
      .map((quay) => ({ value: quay, label: quay }))
  );

  root.append(
    placeField("from-stop", t("place.from"), fromOptions, state.fromFilter, (value) => {
      if (state.fromFilter === value) return;
      state.fromFilter = value;
      track(`From ${value || "all"}`);
      renderTimeline();
    })
  );

  const swap = el("button", "swap-dir");
  swap.type = "button";
  swap.setAttribute("aria-label", t("place.swap"));
  swap.title = t("place.swap");
  swap.disabled = !state.fromFilter && !state.toFilter;
  swap.append(swapIcon());
  swap.addEventListener("click", () => {
    if (!state.fromFilter && !state.toFilter) return;
    swapPlaceFilters();
    track("Swap direction");
    renderTimeline();
  });
  root.append(swap);

  root.append(
    placeField("to-stop", t("place.to"), toOptions, state.toFilter, (value) => {
      if (state.toFilter === value) return;
      state.toFilter = value;
      track(`To ${value || "all"}`);
      renderTimeline();
    })
  );
}

function selectRoute(choice) {
  const next = CHOOSABLE_ROUTES.has(choice) ? choice : "1136";
  if (state.routeChoice === next) return;
  state.routeChoice = next;
  writeRouteChoice(next);
  track(`Route ${next}`);
  state.fromFilter = null;
  state.toFilter = null;
  state.live = null;
  state.liveFetchedAt = 0;
  renderRouteChrome();
  renderMessages();
  renderTimeline();
  renderLedeStatus();
}

function renderRouteFilter() {
  const root = document.getElementById("route-filter");
  if (!root) return;
  root.replaceChildren();
  const chosen = chosenRoute();
  const options = [
    { value: "1136", label: t("route.1136") },
    { value: "1135", label: t("route.1135") },
  ];
  for (const option of options) {
    const btn = el("button", "chip", option.label);
    btn.type = "button";
    const active = chosen === option.value;
    btn.setAttribute("aria-pressed", String(active));
    if (active) btn.classList.add("is-active");
    btn.addEventListener("click", () => selectRoute(option.value));
    root.append(btn);
  }
}

function renderViewFilter() {
  const root = document.getElementById("view-filter");
  if (!root) return;
  root.replaceChildren();
  const visible = showArrivals();
  const btn = el("button", "chip chip-small", t("view.arrivals"));
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
  if (visible.length) {
    const field = el("label", "conn-field");
    field.append(el("span", "conn-label", t("conn.label")));
    const select = el("select", state.connection ? "conn-select has-value" : "conn-select");
    select.setAttribute("aria-label", t("conn.label"));
    const options = [{ value: "", label: t("conn.none") }].concat(
      visible.map((line) => ({ value: line.id, label: line.label }))
    );
    fillSelect(select, options, state.connection);
    select.addEventListener("change", () => {
      const next = select.value || null;
      track(`Connection ${next || "none"}`);
      selectConnection(next);
    });
    field.append(select);
    root.append(field);
  }
  const dest = transferDestFromId(state.connection);
  if (dest) {
    note.textContent = t("conn.transferNote", {
      dest,
      margin: TRANSFER_MARGIN_MIN,
    });
    return;
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
  const needsFile = id && !isFerryTransfer(id);
  if (needsFile && !state.connections) {
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
  if (todayBtn) {
    todayBtn.hidden = false;
    todayBtn.disabled = isToday();
  }
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
  const next = runningLegs(legs).find(
    (leg) => isVisibleDeparture(leg) && !hasPassed(leg.departure)
  );
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
  return sailingDoneAt(event) <= now;
}

function keepTimelineEvent(event, events, now = nowMinutes(), status = null) {
  if (event.status) return true;
  if (isToday() && status?.layover && event.kind === "layover" && event.at <= now && event.until > now) {
    return false;
  }
  if (!isToday() || state.showPast) return true;
  if (event.kind === "split") {
    return events.some((item) => item.kind !== "split" && item.kind !== "status" && item.at > now);
  }
  return sailingDoneAt(event) > now;
}

function pastDepartureCount(events, now = nowMinutes()) {
  if (!isToday()) return 0;
  return events.filter((event) => event.kind === "dep" && sailingDoneAt(event) <= now).length;
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
    from: state.fromFilter,
    to: state.toFilter,
    conn: state.connection,
    showPast: state.showPast,
    hideArr: state.hideArrivals,
    route: state.routeChoice || "auto",
    statusAt: status?.at ?? null,
    statusText: status?.text ?? "",
    liveRec: state.live?.recordedAt || "",
    rows,
  });
}

function patchNowProgress() {
  const now = nowMinutes();
  document.querySelectorAll(".now.has-progress").forEach((node) => {
    const progress = statusProgress(Number(node.dataset.from), Number(node.dataset.until), now);
    if (progress == null) return;
    node.style.setProperty("--now-progress", `${Math.round(progress * 100)}%`);
  });
}

function patchLiveClock() {
  patchNowProgress();
  document.querySelectorAll("[data-countdown]").forEach((node) => {
    const time = node.dataset.countdown;
    const past = node.closest(".is-past");
    node.textContent =
      past || (time && hasPassed(time)) ? t("gone") : time && isToday() ? countdown(time) : "";
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
  const dayLegs = legsForDate(selectedDate());
  renderDayNav();

  if (!dayLegs.length) {
    lastLiveStructureKey = null;
    renderReveal(0);
    root.replaceChildren();
    root.append(el("p", "empty", t("empty.noTripsDay")));
    return;
  }

  const legs = legsForPlaceFilter(selectedDate(), dayLegs);
  const events = buildEvents(legs, connectionIndex(selectedDate())).filter((event) =>
    matchesStop(event)
  );
  const status = isToday() ? currentStatus(dayLegs) : null;
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
  root.replaceChildren();
  const pastCount = pastDepartureCount(events, now);
  renderReveal(pastCount);

  for (const event of events) {
    if (!keepTimelineEvent(event, events, now, status)) continue;
    const past = timelineEventIsPast(event, events, now);
    root.append(event.build(past));
  }
  if (!events.some((event) => event.kind === "dep") && (state.fromFilter || state.toFilter)) {
    root.append(el("p", "empty", emptyPlaceMessage()));
  }
}

/** Full oppbygging: brukast når data, dag eller filter endrar seg. */
function renderTimeline() {
  lastLiveStructureKey = null;
  renderedDate = selectedDate();
  renderRouteChrome();
  renderPlaceFilter(legsForDate(renderedDate));
  renderRouteFilter();
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

function routeNameFlags(msg) {
  const blob = messageBlob(msg);
  const heading = String(msg?.heading || "");
  const conn = Number(msg?.connectionNumber);
  return {
    named1136:
      conn === CONN_1136 ||
      /\b1136\b/.test(blob) ||
      /standal|trandal|valderøy|store kalvøy/i.test(heading),
    named1135: conn === CONN_1135 || /\b1135\b/.test(blob) || /lekne/i.test(heading),
  };
}

function matchesChosenRouteNotice(msg, route = chosenRoute()) {
  const flags = routeNameFlags(msg);
  if (route === "1135") return flags.named1135;
  return flags.named1136;
}

function isDisruptionNotice(msg) {
  return ISSUE_SEVERITIES.has(msg?.severity);
}

function messagesForFilter(messages, filter = state.messageFilter, route = chosenRoute()) {
  const local = messages.filter((msg) => msg.isLocal);
  if (filter === "route") {
    return sortMessagesForRoute(
      messages.filter((msg) => matchesChosenRouteNotice(msg, route)),
      route
    );
  }
  if (filter === "issues") {
    return sortMessagesForRoute(local.filter(isDisruptionNotice), route);
  }
  return sortMessagesForRoute(local, route);
}

function applyMessageFilter(messages) {
  return messagesForFilter(messages, state.messageFilter);
}

function filterMessageKey(messages) {
  return messages.map((msg) => msg.id || messageMergeKey(msg)).join("\n");
}

function usefulMessageFilters(messages, route = chosenRoute()) {
  const local = filterMessageKey(messagesForFilter(messages, "local", route));
  const routeIds = filterMessageKey(messagesForFilter(messages, "route", route));
  const issues = filterMessageKey(messagesForFilter(messages, "issues", route));
  const chips = [];
  if (routeIds !== local) chips.push("route");
  if (issues !== local) chips.push("issues");
  if (!chips.length) return [];
  return ["local", ...chips];
}

function syncMessageFilters(all) {
  const useful = new Set(usefulMessageFilters(all));
  const group = document.querySelector("#messages-details .filters");
  if (group) group.hidden = useful.size === 0;
  if (!useful.has(state.messageFilter)) {
    state.messageFilter = "local";
  }
  document.querySelectorAll("#messages-details [data-filter]").forEach((btn) => {
    const key = btn.dataset.filter;
    btn.hidden = useful.size > 0 && !useful.has(key);
    const active = key === state.messageFilter;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
    if (key === "route") btn.textContent = t("messages.filterRoute", { n: chosenRoute() });
  });
}

function messageRouteScore(msg, route = chosenRoute()) {
  const blob = messageBlob(msg);
  const { named1136, named1135 } = routeNameFlags(msg);
  const kombi = msg?.routeMode === "kombi" || /kombinasjon|kombirute|kombinert rute/i.test(blob);
  if (route === "1136") {
    if (named1136 && !named1135) return 0;
    if (named1136) return 1;
    if (kombi) return 2;
    return 3;
  }
  if (route === "1135") {
    if (named1135 && !named1136) return 0;
    if (named1135) return 1;
    if (kombi) return 2;
    return 3;
  }
  return 3;
}

function sortMessagesForRoute(messages, route = chosenRoute()) {
  return [...messages].sort((a, b) => {
    const byRoute = messageRouteScore(a, route) - messageRouteScore(b, route);
    if (byRoute) return byRoute;
    return (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9);
  });
}

function renderMessages() {
  const root = document.getElementById("messages");
  const meta = document.getElementById("messages-meta");
  const panel = document.getElementById("messages-panel");
  const layout = document.getElementById("layout");
  if (!root || !panel || !layout) return;
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
  syncMessageFilters(all);
  const filtered = applyMessageFilter(all);
  meta.textContent = t(
    state.messages.fetchedLive ? "messages.fetchedLive" : "messages.fetched",
    { when: formatDateTime(state.messages.fetchedAt) }
  );
  renderMessageSummary(filtered);
  const details = document.getElementById("messages-details");
  if (details) details.hidden = !state.messagesExpanded;
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
    const times = el("p", "card-times");
    for (const line of messageTimeLines(msg)) {
      const when = el("time", null, line.text);
      when.dateTime = line.iso;
      times.append(when);
    }
    if (times.childNodes.length) card.append(times);
    root.append(card);
  }
}

const SEVERITY_RANK = { cancelled: 0, delay: 1, capacity: 2, info: 3, normal: 4 };

function renderMessageSummary(filtered) {
  const root = document.getElementById("messages-summary");
  if (!root) return;
  root.replaceChildren();
  const bar = el("button", "messages-bar");
  bar.type = "button";
  bar.setAttribute("aria-expanded", String(Boolean(state.messagesExpanded)));
  const head = el("span", "messages-bar-head");
  const body = el("span", "messages-bar-body");
  head.append(el("span", "messages-bar-title", t("messages.title")));
  if (!filtered.length) {
    bar.classList.add("is-info");
    if (!state.messagesExpanded) {
      body.append(
        el(
          "span",
          "messages-bar-excerpt",
          state.messageFilter === "issues" ? t("empty.noIssues") : t("empty.noMessages")
        )
      );
    }
  } else {
    const top = filtered[0];
    bar.classList.add(`is-${top.severity}`);
    const count = el("span", "messages-count");
    count.textContent = String(filtered.length);
    count.setAttribute("aria-label", t("messages.countAria", { n: filtered.length }));
    head.append(count);
    if (!state.messagesExpanded) {
      body.append(
        el("span", "messages-bar-excerpt", String(top.text || "").replace(/\s+/g, " ").trim())
      );
      if (filtered.length > 1) {
        body.append(el("span", "messages-bar-more", t("messages.andNMore", { n: filtered.length - 1 })));
      }
    }
  }
  head.append(
    el(
      "span",
      "messages-bar-toggle",
      state.messagesExpanded ? t("messages.collapse") : t("messages.expand")
    )
  );
  bar.append(head);
  if (body.childNodes.length) bar.append(body);
  bar.addEventListener("click", () => {
    state.messagesExpanded = !state.messagesExpanded;
    renderMessages();
  });
  root.append(bar);
}

function revealRouteChrome() {
  document.querySelector(".site-header")?.classList.remove("is-pending-route");
}

function renderRouteChrome() {
  const mode = activeMode();
  const title = document.getElementById("route-title");
  if (title) {
    title.textContent =
      mode === "kombi"
        ? t("route.titleKombi")
        : mode === "1135"
          ? t("route.title1135")
          : t("route.title1136");
  }
  revealRouteChrome();
  writeLastMode(mode);
  const badge = document.getElementById("route-badge");
  if (badge) {
    const kombi = mode === "kombi";
    badge.hidden = !kombi;
    if (kombi) badge.textContent = t("route.badgeKombi");
  }
  document.title =
    mode === "kombi" ? t("meta.titleKombi") : mode === "1135" ? t("meta.title1135") : t("meta.title");
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
    } else if (mode === "1135") {
      pdf.href = FJORD1_PDF_1135;
      pdf.textContent = "fjord1.no";
    } else {
      pdf.href = FJORD1_PDF;
      pdf.textContent = "fjord1.no";
    }
  }
  const vessel =
    mode === "kombi"
      ? vesselInfo(activeVessel())
      : mode === "1135"
        ? vesselInfo("Geiranger")
        : null;
  const operator = document.getElementById("footer-operator");
  if (operator) {
    if (vessel) {
      linkifyPhone(
        operator,
        t("footer.operatorVessel", { name: vessel.name, phone: vessel.phone || "" }),
        vessel.phone,
        "footer"
      );
    } else {
      const phone = vesselInfo("Kvernes")?.phone || "916 69 340";
      linkifyPhone(operator, t("footer.operator"), phone, "footer");
    }
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
  let json = null;
  let error = null;
  try {
    try {
      json = await fetchMessagesJson();
    } catch (err) {
      error = err;
    }
    if (json) applyIncomingMessages(json);
  } finally {
    markMessagesHydrated();
  }
  let live = null;
  if (!json || messagesAreStale(json)) {
    try {
      live = await fetchFjord1Messages();
    } catch (err) {
      error = error || err;
    }
    const payload = mergeMessagePayloads(json, live) || live;
    if (payload) applyIncomingMessages(payload);
  }
  if (!state.messages) {
    if (meta) meta.textContent = t("messages.fetchError");
    document.getElementById("messages")?.replaceChildren(
      el("p", "empty", t("messages.seeFjord1"))
    );
    if (error) console.error(error);
  }
}

function applyIncomingMessages(payload) {
  if (!payload) return false;
  const same =
    state.messages && messagesFingerprint(state.messages) === messagesFingerprint(payload);
  state.messages = payload;
  writeCachedMessages(payload);
  if (same) {
    writeLastMode();
    return false;
  }
  renderMessages();
  renderRouteChrome();
  if (hasTimetable()) {
    renderTimeline();
    renderLedeStatus();
  }
  return true;
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
  await whenMessagesHydrated();
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
  const dialog = document.getElementById("install-dialog");
  const closeBtn = document.getElementById("install-close");
  if (!btn) return;

  if (appMode() === "pwa") {
    btn.hidden = true;
    return;
  }

  btn.hidden = false;
  highlightInstallHint();

  let deferred = null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event;
    btn.hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    track("App installed", { how: "native" });
    deferred = null;
    btn.hidden = true;
    try {
      if (dialog?.open) dialog.close();
    } catch {
      // dialog kan vere stengt
    }
  });
  btn.addEventListener("click", async () => {
    if (deferred) {
      track("Install app", { how: "native" });
      deferred.prompt();
      const choice = await deferred.userChoice;
      deferred = null;
      if (choice?.outcome === "accepted") btn.hidden = true;
      return;
    }
    track("Install app", { how: "help" });
    openInstallDialog(dialog);
  });
  closeBtn?.addEventListener("click", () => dialog?.close());
  dialog?.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
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
  document.querySelectorAll("#messages-details [data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (state.messageFilter === btn.dataset.filter) return;
      state.messageFilter = btn.dataset.filter;
      track(`Messages ${btn.dataset.filter}`);
      document.querySelectorAll("#messages-details [data-filter]").forEach((other) => {
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
  state.fromFilter = null;
  state.toFilter = null;
  state.date = null;
  state.showPast = false;
  state.hideArrivals = false;
  state.messagesExpanded = false;
  state.routeChoice = "1136";
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
  fjord1GraphqlBlocked = false;
  messagesHydrated = false;
  messagesHydrateWaiters = [];
}

export {
  FEEDBACK_MAIL,
  LAYOVER_MIN_MINUTES,
  LIVE_MAX_BACKOFF_MS,
  LIVE_SERVICE_MARGIN_MIN,
  MESSAGES_POLL_MS,
  MESSAGES_STALE_MS,
  TIMETABLE_CACHE_KEY,
  MESSAGES_CACHE_KEY,
  LAST_MODE_KEY,
  ROUTE_CHOICE_KEY,
  PWA_FIRST_KEY,
  WAKE_DEBOUNCE_MS,
  activateAtFromText,
  activeMode,
  activePlan,
  appMode,
  buildEvents,
  chosenRoute,
  connectionIndex,
  connectionNote,
  compareTimelineEvents,
  currentStatus,
  dayType,
  delayMinutes,
  emptyPlaceMessage,
  feedbackMailto,
  ferryStatus,
  headingDay,
  statusProgress,
  firstKnownQuay,
  homeQuay,
  highlightInstallHint,
  installHint,
  isCancelledDeparture,
  cancelledSailingsFromText,
  classifyMessage,
  isPartialCancel,
  isLiveFresh,
  isUncertainDeparture,
  isPreview,
  isRouteControl,
  mergeMessagePayloads,
  messagesAreStale,
  messagesUrl,
  normalizeFjord1Node,
  parseFjord1Published,
  parseFjord1TrafficHtml,
  keepTimelineEvent,
  excerptText,
  layoverAfter,
  legsForDate,
  legsForPlaceFilter,
  liveBlockedUntil,
  liveFetchUrls,
  liveStatus,
  markPwaFirstOpen,
  matchesLegPlaces,
  matchesStop,
  messageRouteScore,
  matchesChosenRouteNotice,
  applyMessageFilter,
  usefulMessageFilters,
  isDisruptionNotice,
  messageTimeLines,
  pastDepartureCount,
  passengerJourneysFrom,
  plausibleContext,
  plausibleRoute,
  sortMessagesForRoute,
  messagesFingerprint,
  minDeadheadMinutes,
  modeFromText,
  nextArrivalAt,
  nextDepartureFrom,
  noteLiveFailure,
  operationalMode,
  parseVehicleMonitoring,
  quayAtStart,
  quayPlace,
  quaysInDay,
  readCachedTimetable,
  readCachedMessages,
  readLastMode,
  readHideArrivals,
  readRouteChoice,
  resetTestState,
  resolveRoutePlan,
  routeModeFromMessages,
  routeOverride,
  switchFromText,
  switchOverride,
  swapPlaceFilters,
  setTestState,
  shouldFetchLive,
  showArrivals,
  signalPhone,
  telHref,
  vesselNameForTable,
  serviceWindowMinutes,
  timetableFingerprint,
  todayIso,
  track,
  vesselFromText,
  windowFromText,
  visibleConnectionLines,
  writeCachedTimetable,
  writeCachedMessages,
  writeLastMode,
  hydrateCachedMessages,
  markMessagesHydrated,
  whenMessagesHydrated,
  writeHideArrivals,
  writeRouteChoice,
};

if (typeof document !== "undefined") {
  bootedAt = Date.now();
  setLang(detectLang(), { persist: false });
  applyStaticTranslations();
  syncLangButtons();
  state.hideArrivals = readHideArrivals();
  state.routeChoice = readRouteChoice();
  hydrateCachedMessages();
  bindControls();
  renderRouteFilter();
  if (state.messages) {
    markMessagesHydrated();
    renderMessages();
    renderRouteChrome();
  }
  registerServiceWorker();
  loadMessages();
  loadRoutes();
  scheduleTick();
  scheduleMessagesPoll();
  track(`Visit ${getLang()}`, null, { interactive: false });
  if (appMode() === "pwa") {
    track("Visit pwa", null, { interactive: false });
    if (markPwaFirstOpen()) track("PWA first open", null, { interactive: false });
  }
}
