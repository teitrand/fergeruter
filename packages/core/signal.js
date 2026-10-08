/**
 * Signalturar: frist, logg og om turen vart køyrd.
 * Rein logikk utan DOM, flytta uendra frå assets/app.js.
 */
import { t } from "../../assets/i18n.js?v=80";
import { clockMinutes, hhmm } from "./time.js";
import { leftOrigin, observationMinutes, sameLeg } from "./live.js";
import { quayPlace } from "./timetable.js";

export const SIGNAL_LOG_WATCH_START_UTC = 4 * 60;
export const SIGNAL_LOG_WATCH_END_UTC = 22 * 60 + 40;

export function isUncertainDeparture(departure, notice, switchTime) {
  if (!notice || !switchTime) return false;
  const dep = clockMinutes(departure);
  return dep > clockMinutes(notice) && dep < clockMinutes(switchTime);
}

export function bookingDeadline(leg) {
  if (!leg.signal) return null;
  return clockMinutes(leg.departure) - leg.signal.minutesBefore;
}

export function legIndex(legs, leg) {
  return (legs || []).findIndex((item) => sameLeg(item, leg));
}

/** Signalturar som kjem etter ein tur som ikkje la frå kai, før neste vanlege avgang. */
export function isInUnrunSignalTail(legs, stuck, leg) {
  const start = legIndex(legs, stuck);
  const at = legIndex(legs, leg);
  if (start < 0 || at <= start) return false;
  for (let i = start + 1; i <= at; i += 1) {
    if (!legs[i].signal) return false;
  }
  return true;
}

/** Cron skal ha skrive loggen i dette UTC-vindauget. Natta er planlagt pause. */
export function signalLogWatchActive(nowMs = Date.now()) {
  const now = new Date(nowMs);
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return minutes >= SIGNAL_LOG_WATCH_START_UTC && minutes <= SIGNAL_LOG_WATCH_END_UTC;
}

/** Slingringsmonn etter avgang før sanntid som viser ferja ved startkaien tel som «ikkje utført».
 * Ei forseinka ferje ligg òg ved kai ei stund etter avgangstida. */
export const SIGNAL_SKIP_GRACE_MIN = 15;

/** Ferja har lege ved startkaien for `leg` lenger enn slingringsmonnet etter avgang. */
export function stuckAtOrigin(live, leg, now) {
  return leftOrigin(live, leg) === false && now >= clockMinutes(leg.departure) + SIGNAL_SKIP_GRACE_MIN;
}

/**
 * Sanntid viser ferja på ein seinare tur. Det beviser berre at `leg` ikkje gjekk
 * om ferja ikkje kunne ha kome til startkaien for den seinare turen etter å ha
 * køyrt `leg`. Kvar tur i mellom reknar vi som mogleg, så tvil gjev aldri «ikkje utført».
 */
export function laterTripRulesOut(legs, leg, monitored) {
  const from = legIndex(legs, leg);
  const to = legIndex(legs, monitored);
  if (from < 0 || to <= from) return false;
  const reachable = new Set([quayPlace(leg.to)]);
  for (let i = from + 1; i < to; i += 1) {
    if (reachable.has(quayPlace(legs[i].from))) reachable.add(quayPlace(legs[i].to));
  }
  return !reachable.has(quayPlace(monitored.from));
}

export function signalSkippedStatus(leg, now) {
  const short = t("signal.notRunningShort", { from: leg.from });
  const detail = t("signal.notRunningText", {
    from: leg.from,
    to: leg.to,
    time: hhmm(leg.departure),
    quay: leg.from,
  });
  return {
    at: now,
    live: true,
    signal: "skipped",
    short,
    text: t("live.fromEntur", { text: detail }),
  };
}

/**
 * Framme på leg.to. VehicleAtStop der, eller planlagd/forventa ankomst er passert
 * utan at VM seier at ferja enno er ein annan stad.
 */
export function signalReachedDestination(leg, live, now) {
  if (!leg) return false;
  const dest = quayPlace(leg.to);
  const stop = quayPlace(live?.stopName);
  if (dest && stop === dest && live?.atStop === true) return true;
  const onDestCall = Boolean(dest && stop === dest);
  const expected = onDestCall ? observationMinutes(live?.expectedArrival) : null;
  const aimed = onDestCall ? observationMinutes(live?.aimedArrival) : null;
  const actual = onDestCall ? observationMinutes(live?.actualArrival) : null;
  if (onDestCall && actual != null && now >= actual) return true;
  if (onDestCall && expected != null && now >= expected) return true;
  if (onDestCall && expected == null && aimed != null && now >= aimed) return true;
  if (!leg.arrival || now < clockMinutes(leg.arrival)) return false;
  if (onDestCall && expected != null && now < expected) return false;
  if (live?.atStop === false && stop && dest && stop !== dest) return false;
  return true;
}
