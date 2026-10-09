/**
 * Tilstandsmodellen til React-skalet, utan React og utan DOM.
 *
 * - `data`: det som er lasta (rutetabell, kombirute, meldingar, signallogg) pluss
 *   Entur-bevis (sanntid, avlysingar, faktiske avgangar, sjå entur.js).
 * - `ui`: det brukaren har valt (samband, dag, språk, vis tidlegare).
 * - `memory`: det appen hugsar gjennom dagen (bestilte og sett køyrde signalturar).
 *
 * Funksjonane her byggjer `ctx`, `ev` og `view` som packages/core ventar, på same måte
 * som planContext(), statusEvidence() og statusView() i assets/app.js.
 *
 * Importen av core er utan ?v=. I Vite blir ?v= inne i core fjerna (web/build/
 * strip-version-query.js), så det blir éin i18n-modul. I node (testane) les core i18n
 * med ?v=<versjon> som vanleg.
 */
import {
  activeMode,
  cancelledDepartureSet,
  isCombinedTimetable,
  knownQuays,
  legsForDate,
  lineLegs,
  nowMinutes,
  todayIso,
} from "../../../packages/core/index.js";

const EMPTY_SET = new Set();
const EMPTY_MAP = new Map();

/** @typedef {{ routes: object|null, kombirute: object|null, messages: object|null, signalLog: object|null,
 *   live?: object|null, cancelledJourneys?: Set<string>, actualDepartures?: Map<string,string> }} AppData */
/** @typedef {{ routeChoice: string, date: string|null, lang: string, showPast: boolean, override?: string|null }} UiState */
/** @typedef {{ confirmedBooked: Set<string>, sailedJourneys: (today: string) => Set<string>,
 *   rememberSailed: (today: string, id: string) => boolean }} Memory */

/** Tom data før noko er lasta. */
export function emptyData() {
  return {
    routes: null,
    kombirute: null,
    messages: null,
    signalLog: null,
    connections: null,
    live: null,
    cancelledJourneys: EMPTY_SET,
    actualDepartures: EMPTY_MAP,
  };
}

/** Minne utan lagring, til testar og før localStorage er lese. */
export function memoryOnly(sailed = new Set()) {
  return {
    confirmedBooked: new Set(),
    sailedJourneys: () => sailed,
    rememberSailed(_today, id) {
      if (sailed.has(id)) return false;
      sailed.add(id);
      return true;
    },
  };
}

/** @param {UiState} ui */
export function selectedDate(ui) {
  return ui.date || todayIso();
}

/** @param {UiState} ui */
export function isTodaySelected(ui) {
  return selectedDate(ui) === todayIso();
}

export function hasTimetable(data) {
  return Boolean(data?.routes || data?.kombirute);
}

/**
 * `ctx` for packages/core/plan.js.
 * @param {AppData} data
 * @param {UiState} ui
 */
export function planContext(data, ui, nowMs = Date.now()) {
  return {
    routes: data.routes,
    kombirute: data.kombirute,
    messages: data.messages?.messages,
    routeChoice: ui.routeChoice,
    override: ui.override || null,
    fromQuery: null,
    nowMs,
    today: todayIso(),
    date: selectedDate(ui),
  };
}

/**
 * `ev` for tripStatus og currentStatus. Felta blir rekna ut fyrst når dei blir lesne,
 * som statusEvidence() i vanilla-appen.
 * @param {AppData} data
 * @param {UiState} ui
 * @param {Memory} memory
 */
export function statusEvidence(data, ui, memory, ctx = planContext(data, ui)) {
  const { today, date } = ctx;
  let dayLegs = null;
  let dateLegs = null;
  let messageCancelled = null;
  return {
    date,
    today,
    live: data.live ?? null,
    log: data.signalLog,
    cancelledJourneys: data.cancelledJourneys ?? EMPTY_SET,
    actualDepartures: data.actualDepartures ?? EMPTY_MAP,
    confirmedBooked: memory.confirmedBooked,
    get dayLegs() {
      dayLegs ??= legsForDate(today, ctx);
      return dayLegs;
    },
    get dateLegs() {
      dateLegs ??= date === today ? this.dayLegs : legsForDate(date, ctx);
      return dateLegs;
    },
    get messageCancelled() {
      messageCancelled ??= cancelledDepartureSet(data.messages?.messages);
      return messageCancelled;
    },
    get sailedJourneys() {
      return memory.sailedJourneys(today);
    },
    get clockNow() {
      return nowMinutes();
    },
  };
}

/** `view` for statuslinja. */
export function statusView(ctx) {
  let combined;
  let catalog;
  let quays;
  return {
    get combined() {
      combined ??= isCombinedTimetable(ctx);
      return combined;
    },
    get catalog() {
      catalog ??= lineLegs(activeMode(ctx), ctx);
      return catalog;
    },
    get quays() {
      quays ??= knownQuays(ctx);
      return quays;
    },
  };
}

/**
 * Hugs eller gløym bestilte signalturar, slik tripStatus ber om (`timeline.remember`).
 * Køyrer i ein effekt etter teikninga. Returnerer true når minnet endra seg.
 */
export function rememberBookings(memory, list) {
  let changed = false;
  for (const { id, booked } of list || []) {
    if (!id || memory.confirmedBooked.has(id) === Boolean(booked)) continue;
    if (booked) memory.confirmedBooked.add(id);
    else memory.confirmedBooked.delete(id);
    changed = true;
  }
  return changed;
}
