import {
  applyStaticTranslations,
  detectLang,
  getLang,
  setLang,
  t,
} from "./i18n.js?v=82";
import {
  ALLOWED_MODES,
  CHOOSABLE_ROUTES,
  LIVE_MAX_BACKOFF_MS,
  LIVE_MIN_INTERVAL_MS,
  LIVE_SERVICE_MARGIN_MIN,
  FJORD1_MESSAGES_PAGE,
  SAEBØ,
  TRANSFER_DESTINATIONS,
  TRANSFER_MARGIN_MIN,
  asTransferTrip,
  beforeModeFor,
  boardingFromDest,
  bookingDeadline,
  cameFromDest,
  clockMinutes,
  compareTimelineEvents,
  countdown,
  defaultVesselName,
  departureStateKey,
  durationText,
  filterMessageKey,
  fjord1Payload,
  formatDateOnly,
  formatDateTime,
  hasPassed,
  headingDay,
  hhmm,
  homeQuay,
  inboundConnection,
  isEmptyReposition,
  isFerryTransfer,
  isOnwardLeg,
  isParallelFerrySplit,
  isPlannedFerrySwitch,
  isVisibleDeparture,
  journeyForLeg,
  journeyNote,
  layoverAfter,
  legKey,
  mergeMessagePayloads,
  messageBlob,
  messageMode,
  messageTimeLines,
  messageVessel,
  messagesAreStale,
  messagesFingerprint,
  minutesLeft,
  minutesToClock,
  normalizeFjord1Node,
  nowMinutes,
  osloIsoFromMs,
  outboundConnection,
  parseClockToken,
  parseFjord1TrafficHtml,
  passengerJourneysFrom,
  publishedMs,
  quayPlace,
  quaysInDay,
  reachesDest,
  resolveRoutePlan,
  retainHeldMessages,
  routeNameFlags,
  shiftIso,
  sortDayLegs,
  statusProgress,
  tableName,
  telHref,
  timetableFingerprint,
  todayIso,
  transferDestFromId,
  transferLineId,
  validMessages,
} from "../packages/core/index.js?v=82";
import * as core from "../packages/core/index.js?v=82";

const MESSAGES_URL = "data/trafikkmeldinger.json";
const SIGNAL_LOG_URL = "data/signalturar.json";
const ROUTES_URL = "data/ruter.json";
const KOMBI_URL = "data/kombirute.json";
const CONNECTIONS_URL = "data/korrespondanse.json";
const FEEDBACK_MAIL = "teitrand@hotmail.com";
const FEEDBACK_GITHUB = "https://github.com/teitrand/fergeruter/issues/new";
const KOMBI_PDF =
  "https://frammr.no/_f/p2/i2e02cdba-2cdc-4a23-b9bf-f6a6bd437bbe/kombinasjonsrute-sabo-leknes-skar-trandal-standal-20251118.pdf";
const FJORD1_PDF =
  "https://www.fjord1.no/ruteoversikt/moere-og-romsdal/standal-trandal-valderoeya-store-kalvoey/(page)/pdf";
const FJORD1_PDF_1135 =
  "https://www.fjord1.no/ruteoversikt/moere-og-romsdal/leknes-saeboe/(page)/pdf";
/**
 * CORS-JSON frå cloudflare/trafikkmeldinger/. Må vere lik MESSAGES_API_URL der.
 * Det gamle Fjord1-endepunktet svarar 404 og blir ikkje kalla.
 */
const FJORD1_MESSAGES_API = "https://fergeruter-trafikkmeldinger.fergeruter-teitrand.workers.dev/";
/** Siste utveg om workeren feilar. Fjord1-sida har ikkje CORS. */
const FJORD1_HTML_READER = `https://r.jina.ai/${FJORD1_MESSAGES_PAGE}`;
const HIDE_ARRIVALS_KEY = "fergeruter-hide-arrivals";
const ROUTE_CHOICE_KEY = "fergeruter-route-choice";
const PWA_FIRST_KEY = "fergeruter-pwa-first-open";
const TIMETABLE_CACHE_KEY = "fergeruter-timetable-v1";
const MESSAGES_CACHE_KEY = "fergeruter-messages-v1";
const LAST_MODE_KEY = "fergeruter-last-mode";
const MESSAGES_POLL_MS = 3 * 60 * 1000;
const WAKE_DEBOUNCE_MS = 400;
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
  /** Siste VM-kall feila (nettverk, status eller JSON). Då seier vi det, ikkje «ingen posisjon». */
  liveFailed: false,
  /** Service journey-id som Entur har merkt avlyst i dag. */
  cancelledJourneys: new Set(),
  /** Når vi sist fekk svar frå Entur om avlysingar. 0 = ikkje spurt enno. */
  cancellationsFetchedAt: 0,
  /** Turar som var med i siste avlysingssvar, avlyst eller ikkje. */
  seenJourneys: new Set(),
  /** Faktisk avgangstid frå Journey Planner, per service journey. */
  actualDepartures: new Map(),
  /** Turar vi har sett gå (faktisk avgang eller sanntid). Vert ståande ut dagen, til avlysing. */
  confirmedBooked: new Set(),
  /** Turar sanntid har vist at ferja køyrde i dag, òg om Entur har avlyst dei. */
  sailedJourneys: new Set(),
  /** Dagen `sailedJourneys` gjeld. */
  sailedDate: null,
  signalLog: null,
};

let renderedDate = null;
let lastLiveStructureKey = null;
let tickTimer = null;
let messagesTimer = null;
let messagesInflight = null;
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

function selectedDate() {
  // Lagra som dato, ikkje som forskyving, slik at ei sida som står open
  // over midnatt held fram med å vise den dagen du faktisk ser på.
  return state.date || todayIso();
}

function isToday() {
  return selectedDate() === todayIso();
}

function previewLocation(loc) {
  if (loc) return loc;
  if (typeof location !== "undefined") return location;
  return null;
}

/** Testhost /dev/ les produksjonsfila. Action oppdaterer berre main. */
function productionDataUrl(loc, file) {
  const here = previewLocation(loc);
  const path = String(here?.pathname || "");
  if (!path.includes("/dev/")) return file;
  try {
    let origin = here.origin;
    if (!origin && here.href) origin = new URL(here.href).origin;
    if (!origin) return file;
    const prefix = path.slice(0, path.indexOf("/dev/"));
    return `${origin}${prefix}/data/${file.replace(/^data\//, "")}`;
  } catch {
    return file;
  }
}

function messagesUrl(loc) {
  return productionDataUrl(loc, MESSAGES_URL);
}

function signalLogUrl(loc) {
  return productionDataUrl(loc, SIGNAL_LOG_URL);
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

function cancelledDepartureSet(messages = state.messages?.messages) {
  return core.cancelledDepartureSet(messages);
}

function isCancelledDeparture(leg, cancelled) {
  const ev = statusEvidence();
  return core.isCancelledDeparture(leg, ev, cancelled ?? ev.messageCancelled);
}

function runningLegs(legs, now = nowMinutes()) {
  return core.runningLegs(legs, now, statusEvidence());
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

function quayAtStart(mode, date, time) {
  return core.quayAtStart(mode, date, time, planContext());
}

function chosenRoute() {
  return core.chosenRoute(state);
}

function operationalMode(date = selectedDate()) {
  return core.operationalMode(date, planContext());
}

/**
 * Alt planlegginga treng frå global tilstand, samla på éin stad.
 * Rutelogikken i packages/core/plan.js les berre frå dette objektet.
 */
function planContext() {
  return {
    routes: state.routes,
    kombirute: state.kombirute,
    messages: state.messages?.messages,
    routeChoice: state.routeChoice,
    override: routeOverride(),
    fromQuery: switchOverride(),
    nowMs: Date.now(),
    today: todayIso(),
    date: selectedDate(),
  };
}

function activePlan(date = selectedDate()) {
  return core.activePlan(date, planContext());
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

async function fetchFjord1Api() {
  const response = await fetchWithTimeout(
    FJORD1_MESSAGES_API,
    {
      headers: { Accept: "application/json" },
      cache: "no-store",
    },
    5000
  );
  if (!response.ok) throw new Error(response.statusText || String(response.status));
  const body = await response.json();
  if (!Array.isArray(body?.messages)) throw new Error("Uventa svar frå trafikkmelding-API");
  const messages = body.messages.filter(Boolean).map((node) => normalizeFjord1Node(node));
  return fjord1Payload(messages, { fetchedAt: body.fetchedAt || null, complete: true });
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
  try {
    return await fetchFjord1Api();
  } catch {
    return fetchFjord1Html();
  }
}

async function fetchMessagesJson() {
  const response = await fetch(messagesUrl(), { cache: "no-cache" });
  if (!response.ok) throw new Error(response.statusText);
  return response.json();
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

function localStore(storage) {
  return storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
}

function readSailedJourneys(date = todayIso(), storage) {
  return core.readSailedJourneys(date, localStore(storage));
}

function writeSailedJourneys(date, ids, storage) {
  core.writeSailedJourneys(date, ids, localStore(storage));
}

function hydrateSailedJourneys(storage) {
  state.sailedDate = todayIso();
  state.sailedJourneys = readSailedJourneys(state.sailedDate, storage);
}

/**
 * Hugs turen fersk sanntid viser at ferja køyrde, så han står som gått òg når
 * VM-posten har gått ut (8. oktober: 20:20 gjekk tom til Standal, men var avlyst hos Entur).
 */
function rememberLiveSailed(live = state.live, now = nowMinutes(), storage) {
  const today = todayIso();
  const id = core.liveSailedJourneyId(live, now, statusEvidence());
  if (!id) return false;
  if (state.sailedDate !== today) hydrateSailedJourneys(storage);
  if (state.sailedJourneys.has(id)) return false;
  state.sailedJourneys.add(id);
  writeSailedJourneys(today, state.sailedJourneys, storage);
  return true;
}

function signalSailed(leg) {
  return core.signalSailed(leg, statusEvidence());
}

function signalIsBooked(leg, now = nowMinutes()) {
  const booking = core.signalBooking(leg, now, statusEvidence());
  rememberBooking(booking.remember === null ? null : { id: booking.id, booked: booking.remember === "add" });
  return booking.booked;
}

/**
 * Kva detaljvindauget skal seie. Entur har ikkje tidspunkt for sjølve ringinga.
 * `observedAt` er når vi fyrst såg statusen, ikkje når nokon tinga.
 */
function departureDetail(leg, now = nowMinutes()) {
  const status = tripStatusFor(leg, now);
  return {
    phase: status.kind,
    booked: status.booked,
    skipped: status.skipped,
    cancelled: status.cancelled,
    signal: status.signal,
    deadline: status.deadline,
    seenSkip: status.seenSkip,
    skipReason: status.skipReason,
    minutesBefore: leg?.signal?.minutesBefore ?? null,
    phone: status.signal ? signalPhone(leg) : "",
    observedAt: status.observedAt,
    skippedAt: status.skippedAt,
  };
}

function signalTag(leg, { call = true, booked = false } = {}) {
  if (booked) return el("span", "stop-tag stop-tag-booked", t("signal.booked"));
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
  return core.activeMode(planContext());
}

function lineLegs(mode) {
  return core.lineLegs(mode, state);
}

function hasTimetable() {
  return Boolean(state.routes || state.kombirute);
}

function legsForMode(mode, date) {
  return core.legsForMode(mode, date, state);
}

function legsForDate(date) {
  return core.legsForDate(date, planContext());
}

function crossesArea(from, to) {
  return core.crossesArea(from, to, state);
}

function knownQuays() {
  return core.knownQuays(state);
}

/** Entur kan sende heile resten av turen, t.d. «Sæbø Trandal Standal». */
function firstKnownQuay(name, quays = knownQuays()) {
  return core.firstKnownQuay(name, quays);
}

/** Avlyst hos Entur i dag. Rute-id blir brukt fleire datoar, så berre dagsens status bruker settet. */
function journeyCancelled(leg, cancelled = state.cancelledJourneys) {
  return core.journeyCancelled(leg, cancelled);
}

/** True når bakgrunnsjobben skulle ha køyrt, men loggen er for gammal. */
function signalLogStale(nowMs = Date.now(), log = state.signalLog) {
  return core.signalLogStale(nowMs, log);
}

/**
 * Alt statuslogikken i packages/core/tripstatus.js treng, samla frå global tilstand.
 * Felta blir rekna ut fyrst når dei blir lesne, akkurat som før. `sailedJourneys`
 * hentar turane frå localStorage fyrst når statusen spør etter dei.
 */
function statusEvidence() {
  const today = todayIso();
  const date = selectedDate();
  let dayLegs = null;
  let dateLegs = null;
  let messageCancelled = null;
  return {
    date,
    today,
    live: state.live,
    log: state.signalLog,
    cancelledJourneys: state.cancelledJourneys,
    actualDepartures: state.actualDepartures,
    confirmedBooked: state.confirmedBooked,
    get dayLegs() {
      dayLegs ??= legsForDate(today);
      return dayLegs;
    },
    get dateLegs() {
      dateLegs ??= date === today ? this.dayLegs : legsForDate(date);
      return dateLegs;
    },
    get messageCancelled() {
      messageCancelled ??= cancelledDepartureSet();
      return messageCancelled;
    },
    get sailedJourneys() {
      if (state.sailedDate !== todayIso()) hydrateSailedJourneys();
      return state.sailedJourneys;
    },
    get clockNow() {
      return nowMinutes();
    },
  };
}

/** Rutetabellen statuslinja treng. Rekna ut fyrst når han blir lesen. */
function statusView() {
  let combined;
  let catalog;
  let quays;
  return {
    get combined() {
      combined ??= isCombinedTimetable();
      return combined;
    },
    get catalog() {
      catalog ??= lineLegs(activeMode());
      return catalog;
    },
    get quays() {
      quays ??= knownQuays();
      return quays;
    },
  };
}

/** Hugs eller gløym at ein signaltur er sett bestilt, slik tripStatus ber om. */
function rememberBooking(remember) {
  if (!remember?.id) return;
  if (remember.booked) state.confirmedBooked.add(remember.id);
  else state.confirmedBooked.delete(remember.id);
}

/** tripStatus for éin avgang med det appen veit no. Hugsar bestilling som før. */
function tripStatusFor(leg, now = nowMinutes(), opts = {}) {
  const status = core.tripStatus(leg, statusEvidence(), now, opts);
  rememberBooking(status.remember);
  return status;
}

function signalLogStatus(leg, date = selectedDate()) {
  return core.signalLogStatus(leg, date, state.signalLog);
}

function signalSkipReason(leg, live = state.live, now = nowMinutes(), legs = null) {
  return core.signalSkipReason(leg, live, now, legs, statusEvidence());
}

function signalVerdict(leg, live = state.live, now = nowMinutes(), legs = null) {
  return core.signalVerdict(leg, live, now, legs, statusEvidence());
}

function signalObservedAtQuay(leg, live = state.live, now = nowMinutes(), legs = null) {
  return core.signalObservedAtQuay(leg, live, now, legs, statusEvidence());
}

function isCombinedTimetable() {
  return core.isCombinedTimetable(planContext());
}

function parseVehicleMonitoring(data) {
  return core.parseVehicleMonitoring(data, knownQuays());
}

function liveStatus(live) {
  return core.liveStatus(live, knownQuays());
}

/** Kvar ferja er akkurat no, rekna ut frå rutetabellen. */
function ferryStatus(legs, now = nowMinutes(), allLegs = null) {
  return core.ferryStatus(legs, now, allLegs, statusView());
}

function currentStatus(legs, now = nowMinutes()) {
  return core.currentStatus(legs, now, statusEvidence(), statusView());
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

function otherFerryMode() {
  if (isCombinedTimetable()) return null;
  const mode = activeMode();
  if (mode === "1135") return "1136";
  if (mode === "1136") return "1135";
  return null;
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
  if (signalIsBooked(leg) || signalVerdict(leg) === "skipped" || signalSailed(leg)) {
    return null;
  }
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
  if (leg.signal && isToday() && signalVerdict(leg) === "skipped") {
    return clockMinutes(leg.departure);
  }
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
  const status = tripStatusFor(leg);
  const cancelled = status.cancelled;
  const verdict = status.verdict;
  const booked = status.booked;
  const sailed = status.sailed;
  const onward = isOnwardLeg(leg, journey);
  const row = el(
    "div",
    `stop stop-dep${past ? " is-past" : ""}${cancelled ? " is-cancelled" : ""}${
      verdict === "skipped" ? " is-signal-off" : ""
    }${onward ? " stop-onward" : ""}`
  );
  row.append(el("span", "stop-time", hhmm(leg.departure)));
  const body = el("span", "stop-body");
  const head = el("span", "stop-head");
  const name = el("button", "stop-name stop-detail", t("sailing.route", { from: leg.from, to: leg.to }));
  name.type = "button";
  name.setAttribute("aria-haspopup", "dialog");
  name.setAttribute("aria-controls", "departure-dialog");
  name.addEventListener("click", (event) => {
    event.stopPropagation();
    openDepartureDetail(leg);
  });
  head.append(name);
  if (cancelled) head.append(el("span", "stop-tag stop-tag-stop", t("sailing.cancelled")));
  if (leg.signal && verdict !== "skipped" && !sailed) {
    head.append(signalTag(leg, { call: !cancelled && !booked, booked }));
  }
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
    if (signalObservedAtQuay(leg)) body.append(el("span", "stop-note", t("signal.stillAtQuay")));
    const depConn = connectionNote(connections, "dep", leg);
    if (depConn) body.append(el("span", "stop-note stop-conn", depConn));
    const arrConn = connectionNote(connections, "arr", leg);
    if (arrConn) body.append(el("span", "stop-note stop-conn", arrConn));
  }
  row.append(body);
  const departed = isToday() && hasPassed(leg.departure);
  const stateKey = departureStateKey(status, { past, departed, today: isToday() });
  const remaining = {
    cancelled: () => t("sailing.cancelled"),
    notRunning: () => t("signal.notRunning"),
    unknown: () => t("signal.unknown"),
    gone: () => t("gone"),
    countdown: () => countdown(leg.departure),
  }[stateKey]?.() ?? "";
  const remainingNode = el("span", "stop-state", remaining);
  if (verdict === "skipped") remainingNode.dataset.signal = "skipped";
  else if (stateKey === "unknown") remainingNode.dataset.signal = "unknown";
  else if (isToday() && !cancelled) remainingNode.dataset.countdown = leg.departure;
  row.append(remainingNode);
  row.addEventListener("click", (event) => {
    if (event.target.closest("a, button")) return;
    openDepartureDetail(leg);
  });
  return row;
}

function detailParagraph(className, text) {
  return el("p", className || "detail-copy", text);
}

function renderDepartureDetail(leg) {
  const detail = departureDetail(leg);
  const title = document.getElementById("departure-title");
  const body = document.getElementById("departure-body");
  const close = document.getElementById("departure-close");
  if (title) {
    title.textContent = t("detail.title", {
      time: hhmm(leg.departure),
      from: leg.from,
      to: leg.to,
    });
  }
  if (close) close.textContent = t("detail.close");
  if (!body) return;
  const nodes = [];
  if (leg.arrival) nodes.push(detailParagraph("", t("sailing.arrival", { time: hhmm(leg.arrival) })));
  const status = detail.cancelled
    ? t("sailing.cancelled")
    : detail.skipped
      ? t("signal.notRunning")
      : detail.booked
        ? t("signal.booked")
        : detail.phase === "sailed"
          ? t("gone")
          : detail.signal
            ? t("signal.onRequest")
            : t("detail.regular");
  nodes.push(detailParagraph("detail-status", status));
  if (!detail.signal) {
    if (detail.cancelled) nodes.push(detailParagraph("", t("detail.cancelled")));
  } else {
    const deadline = detail.deadline != null ? minutesToClock(detail.deadline) : "";
    nodes.push(
      detailParagraph(
        "",
        t("signal.how", {
          lead:
            (detail.minutesBefore || 60) === 60
              ? t("signal.leadHour")
              : durationText(detail.minutesBefore || 60),
          time: deadline,
        })
      )
    );
    if (telHref(detail.phone)) {
      const line = el("p", "detail-copy");
      const link = el("a", "stop-phone", t("signal.callLink", { phone: detail.phone }));
      line.append(bindTelLink(link, detail.phone, "detail"));
      nodes.push(line);
    }
    if (detail.phase === "booked") {
      nodes.push(detailParagraph("", t("signal.bookedHow", { time: deadline })));
      if (detail.observedAt) {
        nodes.push(detailParagraph("", t("signal.observed", { when: formatDateTime(detail.observedAt) })));
      }
      nodes.push(detailParagraph("detail-caveat", t("signal.caveat")));
    } else if (detail.phase === "open") {
      nodes.push(detailParagraph("", t("signal.openHow", { time: deadline })));
      nodes.push(detailParagraph("detail-caveat", t("signal.caveat")));
    } else if (detail.phase === "skipped") {
      nodes.push(
        detailParagraph(
          "",
          detail.seenSkip
            ? t("signal.skippedHow", { time: deadline })
            : detail.skipReason === "live"
              ? t("signal.skippedLiveHow")
              : t("signal.unknownHow", { time: deadline })
        )
      );
      const when = detail.skippedAt || detail.observedAt;
      if (detail.seenSkip && when) {
        nodes.push(detailParagraph("", t("signal.skippedWhen", { when: formatDateTime(when) })));
      }
    } else if (detail.phase === "sailed") {
      nodes.push(detailParagraph("", t("signal.sailedHow")));
    } else if (detail.phase === "unknown") {
      nodes.push(detailParagraph("", t("signal.unknownHow", { time: deadline })));
      nodes.push(detailParagraph("detail-caveat", t("signal.caveat")));
    }
  }
  body.replaceChildren(...nodes);
}

function openDepartureDetail(leg) {
  const dialog = document.getElementById("departure-dialog");
  if (!dialog || !leg) return;
  renderDepartureDetail(leg);
  track("Departure detail", { signal: leg.signal ? "yes" : "no" });
  if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
  else dialog.setAttribute("open", "");
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
  const row = el("div", `stop stop-layover stop-wait stop-onward${past ? " is-past" : ""}`);
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
          onward: isOnwardLeg(leg, journey),
          build: (past) => departureRow(leg, past, connections, journey),
        });
        if (journey?.wait && journey.wait.afterKey === legKey(leg)) {
          events.push({
            at: clockMinutes(journey.wait.from),
            until: clockMinutes(journey.wait.until),
            kind: "wait",
            quays: [journey.wait.quay],
            stay: journey.wait,
            onward: true,
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
      isEmptyReposition(leg.to, next.from) &&
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
  if (!isCombinedTimetable() && last && isEmptyReposition(last.to, home)) {
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
  lede.replaceChildren(document.createTextNode(`${parts.join(". ")}.`));
  appendSignalLogWarning(lede, legs);
  renderPositionNote();
}

function appendSignalLogWarning(lede, legs) {
  if (!signalLogStale() || !(legs || []).some((leg) => leg.signal)) return;
  const when = state.signalLog?.updatedAt ? formatDateTime(state.signalLog.updatedAt) : "";
  const text = when ? t("signal.logLate", { when }) : t("signal.logMissing");
  lede.append(document.createTextNode(" "));
  lede.append(el("span", "lede-warn", text));
}

/**
 * Fotnote for posisjonen. Når Entur strupar, manglar svaret CORS-hovud, så
 * nettlesaren ser berre «Failed to fetch» og aldri 429. Difor reknar vi kvar
 * feil ved kallet som «fekk ikkje kontakt», og tomt svar som «ingen posisjon».
 */
function positionNoteKey() {
  if (liveStatus(state.live)) return "position.live";
  if (state.liveFailed) return "position.offline";
  return "position.planned";
}

function renderPositionNote() {
  const note = document.getElementById("position-note");
  if (!note) return;
  note.textContent = t(positionNoteKey());
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
  if (signalIsBooked(leg)) return "booked";
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
      isToday() && event.leg ? signalVerdict(event.leg, state.live, now) || "" : "",
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
  document.querySelectorAll("[data-countdown], [data-signal]").forEach((node) => {
    if (node.dataset.signal === "skipped") {
      node.textContent = t("signal.notRunning");
      return;
    }
    if (node.dataset.signal === "unknown") {
      node.textContent = t("signal.unknown");
      return;
    }
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

function matchesChosenRouteNotice(msg, route = chosenRoute()) {
  const flags = routeNameFlags(msg);
  if (route === "1135") return flags.named1135;
  return flags.named1136;
}

function messagesForFilter(messages, filter = state.messageFilter, route = chosenRoute()) {
  const local = messages.filter((msg) => msg.isLocal);
  if (filter === "route") {
    return sortMessagesForRoute(
      messages.filter((msg) => matchesChosenRouteNotice(msg, route)),
      route
    );
  }
  return sortMessagesForRoute(local, route);
}

function applyMessageFilter(messages) {
  return messagesForFilter(messages, state.messageFilter);
}

function usefulMessageFilters(messages, route = chosenRoute()) {
  const local = filterMessageKey(messagesForFilter(messages, "local", route));
  const routeIds = filterMessageKey(messagesForFilter(messages, "route", route));
  if (routeIds === local) return [];
  return ["local", "route"];
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
    const byPublished = publishedMs(b) - publishedMs(a);
    if (byPublished) return byPublished;
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
        t("empty.noMessages")
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
          t("empty.noMessages")
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
  const previous = state.messages?.messages || readCachedMessages()?.messages;
  if (previous?.length) {
    payload = {
      ...payload,
      messages: retainHeldMessages(payload.messages, previous),
    };
  }
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

function liveFetchUrls(mode = activeMode()) {
  return core.liveFetchUrls(mode);
}

function serviceWindowMinutes(date) {
  return core.serviceWindowMinutes(legsForDate(date));
}

function shouldFetchLive(nowMs = Date.now()) {
  if (typeof document !== "undefined" && document.hidden) return false;
  if (!hasTimetable()) return false;
  return core.shouldFetchLive(legsForDate(osloIsoFromMs(nowMs)), nowMs, state.liveBlockedUntil);
}

function noteLiveFailure(nowMs = Date.now()) {
  const next = core.liveBackoff(state.liveBackoffMs, nowMs);
  state.liveBackoffMs = next.backoffMs;
  state.liveBlockedUntil = next.blockedUntil;
}

function liveBlockedUntil() {
  return state.liveBlockedUntil || 0;
}

/** Hugs signalturar Entur har faktisk avgang for. Avlyste turar blir gløymde. */
function rememberSeenBookings() {
  for (const id of state.cancelledJourneys) state.confirmedBooked.delete(id);
  const fetchedAt = state.cancellationsFetchedAt;
  if (!fetchedAt || osloIsoFromMs(fetchedAt) !== todayIso()) return;
  for (const id of core.bookingsSeenInFeed(legsForDate(todayIso()), nowMinutes(), statusEvidence())) {
    state.confirmedBooked.add(id);
  }
}

async function loadLivePosition() {
  if (!shouldFetchLive()) return;
  if (Date.now() - (state.liveFetchedAt || 0) < LIVE_MIN_INTERVAL_MS) return;
  state.liveFetchedAt = Date.now();
  const result = await core.loadEnturEvidence(fetch, {
    mode: activeMode(),
    todayLegs: legsForDate(todayIso()),
    quays: knownQuays(),
  });
  if (result.live !== undefined) {
    state.live = result.live;
    rememberLiveSailed();
  }
  if (result.liveError) {
    state.liveFailed = true;
    noteLiveFailure();
    console.error(result.liveError);
  } else {
    state.liveBackoffMs = 0;
    state.liveBlockedUntil = 0;
    state.liveFailed = false;
  }
  if (result.journeys) {
    state.cancelledJourneys = result.journeys.cancelled;
    state.seenJourneys = result.journeys.seen;
    state.actualDepartures = result.journeys.actualDepartures;
    state.cancellationsFetchedAt = Date.now();
    rememberSeenBookings();
  } else {
    console.error(result.journeysError);
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

async function loadSignalLog() {
  try {
    const response = await fetch(signalLogUrl(), { cache: "no-cache" });
    if (!response.ok) return;
    const data = await response.json();
    if (!data || typeof data.days !== "object") return;
    state.signalLog = data;
    if (hasTimetable()) {
      renderLive();
      renderLedeStatus();
    }
  } catch (error) {
    console.error(error);
  }
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

function bindDepartureDialog() {
  const dialog = document.getElementById("departure-dialog");
  const close = document.getElementById("departure-close");
  if (!dialog) return;
  close?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
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
  bindDepartureDialog();
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
  state.liveFailed = false;
  state.cancelledJourneys = new Set();
  state.cancellationsFetchedAt = 0;
  state.seenJourneys = new Set();
  state.actualDepartures = new Map();
  state.confirmedBooked = new Set();
  state.sailedJourneys = new Set();
  state.sailedDate = null;
  state.signalLog = null;
  lastLiveStructureKey = null;
  messagesHydrated = false;
  messagesHydrateWaiters = [];
}

export {
  tripStatusFor,
  FEEDBACK_MAIL,
  LIVE_MAX_BACKOFF_MS,
  LIVE_SERVICE_MARGIN_MIN,
  MESSAGES_POLL_MS,
  TIMETABLE_CACHE_KEY,
  MESSAGES_CACHE_KEY,
  LAST_MODE_KEY,
  ROUTE_CHOICE_KEY,
  PWA_FIRST_KEY,
  WAKE_DEBOUNCE_MS,
  activeMode,
  activePlan,
  appMode,
  buildEvents,
  chosenRoute,
  connectionIndex,
  connectionNote,
  currentStatus,
  signalVerdict,
  signalSkipReason,
  signalSailed,
  rememberLiveSailed,
  readSailedJourneys,
  writeSailedJourneys,
  signalObservedAtQuay,
  signalIsBooked,
  signalLogStatus,
  signalLogStale,
  signalLogUrl,
  departureDetail,
  emptyPlaceMessage,
  feedbackMailto,
  ferryStatus,
  firstKnownQuay,
  highlightInstallHint,
  installHint,
  isCancelledDeparture,
  journeyCancelled,
  isPreview,
  messagesUrl,
  keepTimelineEvent,
  legsForDate,
  legsForPlaceFilter,
  liveBlockedUntil,
  liveFetchUrls,
  liveStatus,
  loadLivePosition,
  markPwaFirstOpen,
  matchesLegPlaces,
  matchesStop,
  messageRouteScore,
  matchesChosenRouteNotice,
  applyMessageFilter,
  usefulMessageFilters,
  pastDepartureCount,
  plausibleContext,
  plausibleRoute,
  positionNoteKey,
  sortMessagesForRoute,
  nextDepartureFrom,
  noteLiveFailure,
  operationalMode,
  parseVehicleMonitoring,
  quayAtStart,
  readCachedTimetable,
  readCachedMessages,
  readLastMode,
  readHideArrivals,
  readRouteChoice,
  resetTestState,
  routeOverride,
  switchOverride,
  swapPlaceFilters,
  setTestState,
  shouldFetchLive,
  showArrivals,
  signalPhone,
  vesselNameForTable,
  serviceWindowMinutes,
  track,
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
  hydrateSailedJourneys();
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
  loadSignalLog();
  scheduleTick();
  scheduleMessagesPoll();
  track(`Visit ${getLang()}`, null, { interactive: false });
  if (appMode() === "pwa") {
    track("Visit pwa", null, { interactive: false });
    if (markPwaFirstOpen()) track("PWA first open", null, { interactive: false });
  }
}
