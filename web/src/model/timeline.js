/**
 * Tidslinja for éin dag som rein data: kva rader som skal visast og kva dei seier.
 * Same reglar som buildEvents/renderLive i assets/app.js, men utan frå/til-filter,
 * korrespondanse og sanntid (kjem i PR 5). Komponentane gjer berre om til JSX og
 * omset nøklane med i18n.
 */
import {
  bookingDeadline,
  clockMinutes,
  compareTimelineEvents,
  countdown,
  crossesArea,
  currentStatus,
  departureStateKey,
  durationText,
  hasPassed,
  hhmm,
  homeQuay,
  isCombinedTimetable,
  isEmptyReposition,
  isParallelFerrySplit,
  isPlannedFerrySwitch,
  isVisibleDeparture,
  layoverAfter,
  legsForDate,
  minutesLeft,
  minutesToClock,
  nowMinutes,
  operationalMode,
  activePlan,
  shiftIso,
  signalObservedAtQuay,
  statusProgress,
  tableName,
  tripStatus,
} from "../../../packages/core/index.js";
import { planContext, rememberBooking, statusEvidence, statusView } from "./context.js";
import { signalPhone } from "./vessel.js";

/**
 * @typedef {object} DepartureRow
 * @property {"dep"} kind
 * @property {string} key
 * @property {boolean} past
 * @property {string} time       hh:mm
 * @property {string} from
 * @property {string} to
 * @property {string|null} arrival  hh:mm, eller null
 * @property {boolean} cancelled
 * @property {boolean} skipped    signaltur «ikkje utført»
 * @property {"onRequest"|"booked"|null} tag
 * @property {string} phone
 * @property {{ time: string, phone: string, left: string|null, expired: boolean }|null} signalNote
 * @property {boolean} stillAtQuay
 * @property {"cancelled"|"notRunning"|"unknown"|"gone"|"countdown"|""} state
 * @property {string} countdown  ferdig omsett nedteljing når state er «countdown»
 * @property {object} status     heile tripStatus-svaret, til detaljvindauget seinare
 */

/** Når ein hendingsrad er ferdig, for å avgjere om ho er «tidlegare». */
function doneAt(event, today) {
  if ((event.kind === "layover" || event.kind === "wait") && event.until != null) return event.until;
  if (event.kind !== "dep" || !event.leg) return event.at;
  const leg = event.leg;
  if (leg.signal && today && event.status.verdict === "skipped") return clockMinutes(leg.departure);
  if (leg.arrival) return clockMinutes(leg.arrival);
  return event.at;
}

function departureRow(leg, status, ctx, ev, now, { today, showArrivals }) {
  const departed = today && hasPassed(leg.departure);
  const skipped = status.verdict === "skipped";
  const phone = leg.signal ? signalPhone(leg, ctx) : "";
  let signalNote = null;
  if (leg.signal && !status.booked && !skipped && !status.sailed && !status.cancelled) {
    const deadline = bookingDeadline(leg);
    if (deadline != null) {
      const clock = `${minutesToClock(deadline)}:00`;
      const open = today && !hasPassed(clock);
      signalNote = {
        time: minutesToClock(deadline),
        phone,
        left: open ? durationText(minutesLeft(clock)) : null,
        expired: today && !open && !hasPassed(leg.departure),
      };
    }
  }
  return {
    kind: "dep",
    key: `dep|${leg.from}|${leg.departure}`,
    time: hhmm(leg.departure),
    from: leg.from,
    to: leg.to,
    arrival: showArrivals && leg.arrival ? hhmm(leg.arrival) : null,
    cancelled: status.cancelled,
    skipped,
    tag: leg.signal && !skipped && !status.sailed ? (status.booked ? "booked" : "onRequest") : null,
    phone,
    signalNote,
    stillAtQuay: !status.cancelled && signalObservedAtQuay(leg, ev.live, now, null, ev),
    departed,
    status,
  };
}

/**
 * @param {import("./context.js").AppData} data
 * @param {import("./context.js").UiState} ui
 * @param {import("./context.js").Memory} memory
 * @returns {{ empty: string|null, rows: object[], pastCount: number }}
 */
export function buildTimeline(data, ui, memory, { now = nowMinutes(), showArrivals = true } = {}) {
  if (!data.routes && !data.kombirute) return { empty: "empty.noTimetable", rows: [], pastCount: 0 };
  const ctx = planContext(data, ui);
  const today = ctx.date === ctx.today;
  const legs = legsForDate(ctx.date, ctx);
  if (!legs.length) return { empty: "empty.noTripsDay", rows: [], pastCount: 0 };
  const ev = statusEvidence(data, ui, memory, ctx);
  const combined = isCombinedTimetable(ctx);
  const plan = activePlan(ctx.date, ctx);
  const events = [];
  const seenDep = new Set();

  legs.forEach((leg, index) => {
    const depKey = `${leg.from}|${leg.departure}`;
    if (isVisibleDeparture(leg) && !seenDep.has(depKey)) {
      seenDep.add(depKey);
      const status = tripStatus(leg, ev, now);
      rememberBooking(memory, status.remember);
      events.push({ at: clockMinutes(leg.departure), kind: "dep", leg, status });
    }
    const next = legs[index + 1];
    const stay = layoverAfter(leg, next);
    if (stay) {
      events.push({ at: clockMinutes(stay.from), until: clockMinutes(stay.until), kind: "layover", stay });
    }
    if (next && leg.table && next.table && leg.table !== next.table) {
      const routeSwitch = plan.switch;
      if (!(isParallelFerrySplit(leg.table, next.table) && !isPlannedFerrySwitch(routeSwitch))) {
        const notice =
          routeSwitch && clockMinutes(routeSwitch.time) === clockMinutes(next.departure)
            ? routeSwitch.notice
            : null;
        events.push({
          at: clockMinutes(next.departure),
          kind: "split",
          split: { time: hhmm(next.departure), quay: next.from, table: next.table, before: leg.table, notice: notice ? hhmm(notice) : null },
        });
      }
    }
    if (!combined && next && isEmptyReposition(leg.to, next.from) && (!leg.table || !next.table || leg.table === next.table)) {
      events.push({ at: clockMinutes(leg.arrival), kind: "transfer", from: leg.to, to: next.from });
    }
  });
  const last = legs[legs.length - 1];
  const home = homeQuay(legs);
  if (!combined && last && isEmptyReposition(last.to, home)) {
    events.push({ at: clockMinutes(last.arrival), kind: "transfer", from: last.to, to: home });
  }
  const start = dayStartSplit(legs, plan, ctx);
  if (start) events.push(start);

  const status = today ? currentStatus(legs, now, ev, statusView(ctx)) : null;
  if (status) events.push({ at: status.at, kind: "status", now: status });
  events.sort(compareTimelineEvents);

  const isPast = (event) => {
    if (!today || event.kind === "status") return false;
    if (event.kind === "split") return !events.some((item) => item.kind !== "split" && item.kind !== "status" && item.at > now);
    return doneAt(event, today) <= now;
  };
  const keep = (event) => {
    if (event.kind === "status") return true;
    if (today && status?.layover && event.kind === "layover" && event.at <= now && event.until > now) return false;
    if (!today || ui.showPast) return true;
    return !isPast(event);
  };
  const pastCount = today ? events.filter((event) => event.kind === "dep" && isPast(event)).length : 0;

  const rows = [];
  for (const event of events) {
    if (!keep(event)) continue;
    const past = isPast(event);
    rows.push(toRow(event, past, { ctx, ev, now, today, showArrivals }));
  }
  return { empty: null, rows, pastCount };
}

function toRow(event, past, { ctx, ev, now, today, showArrivals }) {
  switch (event.kind) {
    case "dep": {
      const row = departureRow(event.leg, event.status, ctx, ev, now, { today, showArrivals });
      row.past = past;
      row.state = departureStateKey(event.status, { past, departed: row.departed, today });
      row.countdown = row.state === "countdown" ? countdown(event.leg.departure) : "";
      return row;
    }
    case "layover":
      return {
        kind: "layover",
        key: `layover|${event.stay.quay}|${event.stay.from}`,
        past,
        time: hhmm(event.stay.from),
        quay: event.stay.quay,
        duration: durationText(event.stay.minutes),
        until: hhmm(event.stay.until),
      };
    case "split":
      return { kind: "split", key: `split|${event.at}`, past, ...event.split };
    case "transfer":
      return {
        kind: "transfer",
        key: `transfer|${event.at}|${event.to}`,
        past,
        from: event.from,
        to: event.to,
        crossesArea: crossesArea(event.from, event.to, ctx),
      };
    case "status":
      return {
        kind: "now",
        key: "now",
        past: false,
        text: event.now.text,
        layover: Boolean(event.now.layover),
        underway: Boolean(event.now.underway),
        progress: statusProgress(event.now.from, event.now.until, now),
      };
    default:
      throw new Error(`ukjend hending ${event.kind}`);
  }
}

/** Raud merkelapp når kombiruta tek til eller sluttar heile dagen. */
function dayStartSplit(legs, plan, ctx) {
  if (!legs.length || plan.switch) return null;
  const mode = tableName(plan.mode);
  const prev = tableName(operationalMode(shiftIso(ctx.date, -1), ctx));
  if (mode === prev) return null;
  if (mode !== "kombi" && prev !== "kombi") return null;
  const first = legs.find((leg) => isVisibleDeparture(leg)) || legs[0];
  if (!first?.departure) return null;
  return {
    at: clockMinutes(first.departure),
    kind: "split",
    split: { time: hhmm(first.departure), quay: first.from, table: mode, before: prev, notice: null },
  };
}
