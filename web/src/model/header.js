/** Toppen: kva rute som gjeld, og statuslinja (alltid om i dag). */
import {
  activeMode,
  countdown,
  currentStatus,
  formatDateTime,
  hasPassed,
  hhmm,
  isVisibleDeparture,
  legsForDate,
  nowMinutes,
  runningLegs,
  signalLogStale,
  todayIso,
  vesselInfo,
  vesselNameForTable,
} from "../../../packages/core/index.js";
import { planContext, statusEvidence, statusView } from "./context.js";

const CHROME = {
  1136: { title: "route.title1136", eyebrow: "eyebrow", meta: "meta.title" },
  1135: { title: "route.title1135", eyebrow: "eyebrow.1135", meta: "meta.title1135" },
  kombi: { title: "route.titleKombi", eyebrow: "eyebrow.kombi", meta: "meta.titleKombi" },
};

/** Tittel, overtittel og kombirute-merke for det sambandet som gjeld den valde dagen. */
export function routeChrome(data, ui) {
  const ctx = planContext(data, ui);
  const mode = activeMode(ctx);
  const keys = CHROME[mode] || CHROME[1136];
  const vesselName = mode === "kombi" ? vesselNameForTable(mode, ctx) : mode === "1135" ? "Geiranger" : null;
  const vessel = vesselName ? vesselInfo(vesselName, ctx) : null;
  return {
    mode,
    kombi: mode === "kombi",
    titleKey: keys.title,
    eyebrowKey: keys.eyebrow,
    metaTitleKey: keys.meta,
    vessel: vessel ? { name: vessel.name, phone: vessel.phone || "" } : null,
  };
}

/**
 * Statuslinja øvst, som renderLedeStatus i assets/app.js.
 * @returns {{ noTrips: true } | { noTrips: false, status: string|null,
 *   next: { time: string, from: string, countdown: string }|null,
 *   logWarning: { when: string }|null }}
 */
export function ledeModel(data, ui, memory, now = nowMinutes()) {
  const ctx = planContext(data, ui);
  const legs = legsForDate(todayIso(), ctx);
  if (!legs.length) return { noTrips: true };
  const ev = statusEvidence(data, ui, memory, ctx);
  const status = currentStatus(legs, now, ev, statusView(ctx));
  const next = runningLegs(legs, now, ev).find((leg) => isVisibleDeparture(leg) && !hasPassed(leg.departure));
  const stale = signalLogStale(Date.now(), data.signalLog) && legs.some((leg) => leg.signal);
  return {
    noTrips: false,
    status: status ? status.short || status.text.replace(/\.$/, "") : null,
    next: next ? { time: hhmm(next.departure), from: next.from, countdown: countdown(next.departure) } : null,
    logWarning: stale ? { when: data.signalLog?.updatedAt ? formatDateTime(data.signalLog.updatedAt) : "" } : null,
  };
}
