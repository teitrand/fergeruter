/**
 * Ferjestatus på tidslinja: liggetid, tomkøyring og framdrift.
 * Rein logikk utan DOM, flytta uendra frå assets/app.js.
 */
import { t } from "../../assets/i18n.js?v=80";
import { clockMinutes, hasPassed } from "./time.js";
import { leftOrigin } from "./live.js";
import { catalogKeys, quayPlace } from "./timetable.js";

export const HOME_QUAY = "Standal";
/** Opphald på kai som er langt nok til å visast som liggetid, t.d. matpause. */
export const LAYOVER_MIN_MINUTES = 20;

export function delayApplies(live, monitored) {
  if (!live || !(live.delayMinutes >= 1)) return false;
  if (monitored?.signal && leftOrigin(live, monitored) !== true) return false;
  return true;
}

export function homeQuay(legs) {
  return legs[0]?.from || HOME_QUAY;
}

/** Valderøya og Store Kalvøy. Tomtur til eller frå Hjørundfjorden står ikkje i tabellen. */
export const OUTER_QUAYS = new Set(["Valderøya", "Store Kalvøy"]);

/**
 * Tomtur Valderøya/Store Kalvøy ↔ Hjørundfjorden.
 * AIS for M/F Kvernes (MMSI 257297400, feb–mars 2026) viser om lag 110–125 min
 * (målt 109, 110, 114, 117, 117, 120, 125, 126 og 134; nattur 114 min).
 * Fast 120 min, så «på veg» ikkje fyller heile holet. Resten ligg ferja til kai.
 */
export const OUTER_DEADHEAD_MINUTES = 120;

export function isOuterQuay(quay) {
  return OUTER_QUAYS.has(quayPlace(quay));
}

/** Fast seglingstid når eine kaia er ytre (Valderøya/Store Kalvøy) og den andre ikkje. */
export function outerDeadheadMinutes(fromQuay, toQuay) {
  const from = quayPlace(fromQuay);
  const to = quayPlace(toQuay);
  if (!from || !to || from === to) return null;
  if (isOuterQuay(from) === isOuterQuay(to)) return null;
  return OUTER_DEADHEAD_MINUTES;
}

/** Kortaste hol mellom to kaier i tabellen, t.d. Valderøya 12:30 → Standal 14:40. */
export function minDeadheadMinutes(allLegs, fromQuay, toQuay) {
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

/** Kortaste planlagde overfarten mellom to kaier. Tomturen tek ikkje heile holet. */
export function crossingMinutes(allLegs, fromQuay, toQuay) {
  const from = quayPlace(fromQuay);
  const to = quayPlace(toQuay);
  if (!from || !to || from === to) return null;
  let shortest = null;
  for (const leg of allLegs || []) {
    if (quayPlace(leg.from) !== from || quayPlace(leg.to) !== to) continue;
    if (!leg.departure || !leg.arrival) continue;
    const minutes = clockMinutes(leg.arrival) - clockMinutes(leg.departure);
    if (minutes > 0 && (shortest == null || minutes < shortest)) shortest = minutes;
  }
  return shortest ?? outerDeadheadMinutes(from, to);
}

/** Tidspunkt for ei VM-aktivitet: RecordedAtTime, elles ValidUntilTime. */
export function activityTime(activity) {
  const recorded = Date.parse(activity?.RecordedAtTime);
  if (Number.isFinite(recorded)) return recorded;
  const until = Date.parse(activity?.ValidUntilTime);
  return Number.isFinite(until) ? until : -Infinity;
}

export function delayBit(minutes) {
  if (minutes >= 1) return t("delay.about", { n: minutes });
  return "";
}

export function statusProgress(from, until, now) {
  if (!Number.isFinite(from) || !Number.isFinite(until) || !Number.isFinite(now)) return null;
  const span = until - from;
  if (span <= 0) return null;
  return Math.min(1, Math.max(0, (now - from) / span));
}

export function withSpan(status, from, until, now) {
  const progress = statusProgress(from, until, now);
  if (progress == null) return status;
  return { ...status, from, until, progress };
}

export function withSanntid(base, live) {
  const delay = delayBit(live.delayMinutes);
  const short = delay ? `${base}, ${delay}` : base;
  return {
    live: true,
    short,
    text: t("live.fromEntur", { text: short }),
  };
}

export function isEmptyReposition(fromQuay, toQuay) {
  return outerDeadheadMinutes(fromQuay, toQuay) != null;
}

export function overnightStatus(last, home, now) {
  const deadhead = outerDeadheadMinutes(last.to, home);
  if (deadhead == null) {
    const quay = last.to;
    return {
      at: 1441,
      short: t("status.doneAt", { home: quay }),
      text: t("status.doneAtPeriod", { home: quay }),
    };
  }
  const since = now - clockMinutes(last.arrival);
  if (since < deadhead) {
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
  return {
    at: 1441,
    short: t("status.mooredAt", { quay: home }),
    text: t("status.doneMoored", { home }),
  };
}

export function returnHomeStatus(last, back, now) {
  const arrived = clockMinutes(last.arrival);
  const leaves = clockMinutes(back.departure);
  const home = back.to;
  if (now < leaves) {
    return withSpan({ at: arrived + 0.5, text: t("status.mooredAt", { quay: last.to }) }, arrived, leaves, now);
  }
  const ends = clockMinutes(back.arrival || back.departure);
  if (now < ends) {
    return withSpan(
      {
        at: leaves + 0.5,
        underway: true,
        short: t("status.backEmpty", { home }),
        text: t("status.backEmptyText", { to: last.to, home }),
      },
      leaves,
      ends,
      now
    );
  }
  return { at: 1441, short: t("status.doneAt", { home }), text: t("status.doneAtPeriod", { home }) };
}

export function isVisibleDeparture(leg) {
  return !leg.hideDeparture;
}

export function nextArrivalAt(legs, quay, skipPassed = false) {
  if (!quay) return null;
  return (
    legs.find((leg) => {
      if (leg.to !== quay) return false;
      if (skipPassed && hasPassed(leg.arrival)) return false;
      return true;
    }) || null
  );
}

export function layoverAfter(leg, next) {
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

export const EVENT_SEQ = { arr: 0, split: 1, transfer: 2, layover: 3, wait: 3, dep: 4, status: 5 };

export function compareTimelineEvents(a, b) {
  const seq = (event) => EVENT_SEQ[event.kind] ?? 0;
  return a.at - b.at || seq(a) - seq(b);
}
