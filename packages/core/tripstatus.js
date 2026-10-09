/**
 * Status for éin avgang ut frå bevis: tripStatus(leg, evidence, now).
 *
 * Bevisa blir rangerte slik (sterkast fyrst):
 *   1. bevist gått: signalloggen seier «gått», faktisk avgang hos Entur, eller sanntid
 *      som viste at ferja køyrde turen
 *   2. avlyst hos Entur (eller logga som avlyst)
 *   3. bevist ikkje køyrd: fersk sanntid viser at ferja låg att
 *   4. open før fristen
 *   5. ukjent
 *
 * Alt les frå `ev` (evidence). Ingenting her les global tilstand, DOM, klokka
 * utanom det `ev` gjev, eller skriv noko. Feltet `remember` i svaret seier kva
 * appen skal hugse til neste gong (sjå signalBooking).
 *
 * `ev` har desse felta:
 * - `date`: dagen brukaren ser på, `today`: dagen i dag (ISO)
 * - `live`: siste sanntidsposisjon (kan vere gammal; isLiveFresh avgjer)
 * - `dayLegs`: turane i dag, `dateLegs`: turane den valde dagen
 * - `log`: signalloggen (data/signalturar.json)
 * - `cancelledJourneys`: turar Entur har avlyst i dag (Set med ServiceJourney-id)
 * - `actualDepartures`: faktisk avgangstid hos Entur i dag (Map id → ISO)
 * - `sailedJourneys`: turar sanntid tidlegare i dag viste at ferja køyrde (Set)
 * - `confirmedBooked`: turar vi før har sett som bestilte i dag (Set)
 * - `messageCancelled`: «Kai|HH:MM:SS» som trafikkmeldingane seier er innstilte (Set)
 * - `clockNow`: klokka no i minutt, for reglar som alltid gjeld no og ikkje `now`
 */
import { clockMinutes } from "./time.js?v=81";
import { quayPlace, sameLeg, serviceJourneyId } from "./legs.js?v=81";
import { isLiveFresh, leftOrigin, legForLive, liveProvesSailed } from "./live.js?v=81";
import { cancelledSailingsFromText, messageBlob, validMessages } from "./messages.js?v=81";
import {
  bookingDeadline,
  isInUnrunSignalTail,
  laterTripRulesOut,
  signalLogWatchActive,
  stuckAtOrigin,
} from "./signal.js?v=81";

/**
 * Signalloggen skal skrivast kvart 30. minutt, cron :07 og :37 frå 04 til 21 UTC.
 * 70 minutt er eitt uteblitt køyrd pluss litt kø. Etter det seier vi frå.
 * Vindauget varer til 22:40 UTC, så den siste lovlege forseinkinga òg blir fanga.
 * Nattpausen tel ikkje: alderen blir rekna frå 04:00 UTC om det er nyare enn updatedAt.
 */
export const SIGNAL_LOG_MAX_AGE_MS = 70 * 60 * 1000;

/** True når bakgrunnsjobben skulle ha køyrt, men loggen er for gammal. */
export function signalLogStale(nowMs, log) {
  if (!signalLogWatchActive(nowMs)) return false;
  const updated = Date.parse(log?.updatedAt || "");
  if (!Number.isFinite(updated)) return true;
  const now = new Date(nowMs);
  const windowStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 4, 0, 0);
  return nowMs - Math.max(updated, windowStart) > SIGNAL_LOG_MAX_AGE_MS;
}

export function signalLogEntry(leg, date, log) {
  const trips = log?.days?.[date];
  const list = Array.isArray(trips) ? trips : trips?.trips;
  if (!Array.isArray(list) || !leg) return null;
  const id = serviceJourneyId(leg.id);
  return (
    list.find(
      (item) =>
        (id && serviceJourneyId(item.id) === id) ||
        (item.departure === leg.departure && item.from === leg.from && item.to === leg.to)
    ) || null
  );
}

export function signalLogStatus(leg, date, log) {
  const hit = signalLogEntry(leg, date, log);
  if (hit?.status === "booked" || hit?.status === "skipped" || hit?.status === "gått") {
    return hit.status;
  }
  return null;
}

/** Avlyst hos Entur i dag. Rute-id blir brukt fleire datoar, så berre dagsens status bruker settet. */
export function journeyCancelled(leg, cancelled) {
  const id = serviceJourneyId(leg?.id);
  if (!id || !cancelled || typeof cancelled.has !== "function") return false;
  return cancelled.has(id);
}

/** «Kai|HH:MM:SS» for avgangar trafikkmeldingane seier er innstilte. */
export function cancelledDepartureSet(messages) {
  const set = new Set();
  for (const msg of validMessages(messages || [])) {
    if (msg.isLocal === false) continue;
    for (const item of cancelledSailingsFromText(messageBlob(msg))) {
      set.add(`${item.from}|${item.time}`);
    }
  }
  return set;
}

function isTodayIn(ev) {
  return ev.date === ev.today;
}

function logEntry(leg, ev) {
  return signalLogEntry(leg, ev.date, ev.log);
}

function logStatus(leg, ev) {
  return signalLogStatus(leg, ev.date, ev.log);
}

export function isCancelledDeparture(leg, ev, cancelled = ev.messageCancelled) {
  if (!leg) return false;
  if (isTodayIn(ev) && !leg.signal && journeyCancelled(leg, ev.cancelledJourneys)) return true;
  return cancelled.has(`${quayPlace(leg.from)}|${leg.departure}`);
}

/**
 * Loggen seier bestilt berre når rada er skriven frå faktisk avgang.
 * `booked` utan `evidence: "departed"` er eit gammalt gjett (kallet låg i
 * feeden utan avlysing) og tel ikkje.
 */
function signalLogBookedCounts(leg, ev) {
  if (logStatus(leg, ev) !== "booked") return false;
  return logEntry(leg, ev)?.evidence === "departed";
}

export function feedDepartureIso(leg, ev) {
  const id = serviceJourneyId(leg?.id);
  const map = ev.actualDepartures;
  if (!id || !map || typeof map.get !== "function") return "";
  return map.get(id) || "";
}

export function liveLeftThisLeg(leg, ev) {
  if (!leg || !isTodayIn(ev) || !isLiveFresh(ev.live)) return false;
  const monitored = legForLive(ev.dayLegs, ev.live);
  if (!monitored || !sameLeg(monitored, leg)) return false;
  return leftOrigin(ev.live, monitored) === true;
}

/** Sanntid har vist at ferja køyrde turen i dag, no eller tidlegare. */
export function liveSailed(leg, ev) {
  if (!leg || !isTodayIn(ev)) return false;
  const id = serviceJourneyId(leg.id);
  if (id && ev.sailedJourneys.has(id)) return true;
  if (!isLiveFresh(ev.live)) return false;
  const monitored = legForLive(ev.dayLegs, ev.live);
  return Boolean(
    monitored && sameLeg(monitored, leg) && liveProvesSailed(ev.live, monitored, ev.clockNow)
  );
}

/** Turen fersk sanntid viser at ferja køyrde, så appen kan hugse han. */
export function liveSailedJourneyId(live, now, ev) {
  if (!isLiveFresh(live)) return null;
  const monitored = legForLive(ev.dayLegs, live);
  if (!monitored || !liveProvesSailed(live, monitored, now)) return null;
  return serviceJourneyId(monitored.id) || null;
}

/**
 * Turen gjekk utan at vi veit om nokon tinga: «gått» i loggen, eller avlyst
 * (Entur eller loggen) men sett køyrd i sanntid. Då er han «Gått», ikkje «Ikkje utført».
 * Returnerer beviset, eller null.
 */
function sailedEvidence(leg, ev) {
  if (!leg?.signal) return null;
  if (logStatus(leg, ev) === "gått") {
    return { source: "log", reason: "log-sailed", at: logEntry(leg, ev)?.observedAt || null };
  }
  if (!journeyCancelled(leg, ev.cancelledJourneys) && logStatus(leg, ev) !== "skipped") return null;
  return liveSailed(leg, ev) ? liveProof(leg, ev, "live-sailed") : null;
}

function liveProof(leg, ev, reason) {
  const fresh = isLiveFresh(ev.live) && sameLeg(legForLive(ev.dayLegs, ev.live), leg);
  return { source: "live", reason, at: fresh ? ev.live?.recordedAt || null : null };
}

export function signalSailed(leg, ev) {
  return Boolean(sailedEvidence(leg, ev));
}

/** Faktisk avgang eller sanntid som viser at denne turen har lagt frå kai. */
function departureEvidence(leg, ev) {
  if (!leg?.signal || journeyCancelled(leg, ev.cancelledJourneys)) return null;
  if (logStatus(leg, ev) === "skipped") return null;
  const entry = logEntry(leg, ev);
  if (signalLogBookedCounts(leg, ev)) {
    return { source: "log", reason: "log-departed", at: entry?.observedAt || null };
  }
  if (logStatus(leg, ev) === "gått" && entry?.evidence === "departed") {
    return { source: "log", reason: "log-departed", at: entry?.observedAt || null };
  }
  const feed = feedDepartureIso(leg, ev);
  if (feed) return { source: "entur", reason: "entur-departure", at: feed };
  if (liveLeftThisLeg(leg, ev)) return liveProof(leg, ev, "live-left");
  if (liveSailed(leg, ev)) return liveProof(leg, ev, "live-sailed");
  return null;
}

export function signalHasDeparture(leg, ev) {
  return Boolean(departureEvidence(leg, ev));
}

const POSITIONING_GAP_MINUTES = 45;

function oppositeReturns(leg, ev) {
  if (!leg?.signal) return [];
  const arrived = clockMinutes(leg.arrival || leg.departure || "00:00");
  const departed = clockMinutes(leg.departure || "00:00");
  const found = [];
  for (const other of ev.dateLegs) {
    if (!other?.signal || sameLeg(other, leg)) continue;
    if (other.from !== leg.to || other.to !== leg.from) continue;
    const otherDep = clockMinutes(other.departure || "99:99");
    if (otherDep <= departed) continue;
    const gap = otherDep - arrived;
    if (gap < 0 || gap > POSITIONING_GAP_MINUTES) continue;
    found.push(other);
  }
  return found;
}

function returnHasDeparture(other, ev) {
  const id = serviceJourneyId(other?.id);
  if (!id || journeyCancelled(other, ev.cancelledJourneys)) return false;
  if (feedDepartureIso(other, ev)) return true;
  const entry = logEntry(other, ev);
  if (entry?.status === "booked" && entry?.evidence === "departed") return true;
  return liveLeftThisLeg(other, ev) || liveSailed(other, ev);
}

function returnStillOpen(other, now, ev) {
  if (!other || journeyCancelled(other, ev.cancelledJourneys) || returnHasDeparture(other, ev)) {
    return false;
  }
  const limit = clockMinutes(other.arrival || other.departure);
  return now <= limit;
}

/**
 * Utturen kan vere ein tomtur for ein seinare retur. Då er han ikkje bestilt,
 * og vi ventar med å seie bestilt til returen er avgjord.
 */
export function positioningBlocksBooked(leg, now, ev) {
  if (!leg?.signal) return false;
  let pending = false;
  for (const other of oppositeReturns(leg, ev)) {
    if (returnHasDeparture(other, ev)) return true;
    if (returnStillOpen(other, now, ev)) pending = true;
  }
  return pending;
}

/**
 * Kvifor signalturen er «ikkje utført», eller null når vi ikkje har bevis.
 * «cancelled»: Entur har avlyst turen (i dag, eller logga som avlyst).
 * «live»: fersk sanntid viser at ferja ikkje gjekk.
 * Fristen åleine er aldri bevis: telefonbestillingar kjem ikkje til Entur.
 * At turen som skulle bringe ferja hit er avlyst, er heller ikkje bevis: er turen
 * herifrå tinga, går ferja dit tom (sjå «gått» i signalloggen).
 *
 * `live`, `now` og `legs` gjeld sjølve sanntidsslutninga. Bevis for at turen gjekk
 * kjem alltid frå `ev`.
 */
function skipEvidence(leg, live, now, legs, ev) {
  if (!leg?.signal) return null;
  // Gått (logg eller sanntid) vinn over avlysing.
  if (signalSailed(leg, ev)) return null;
  const entry = logEntry(leg, ev);
  const fromLog = {
    reason: "cancelled",
    source: "log",
    why: "log-skipped",
    at: entry?.skippedAt || entry?.observedAt || null,
  };
  if (!isTodayIn(ev)) return logStatus(leg, ev) === "skipped" ? fromLog : null;
  if (journeyCancelled(leg, ev.cancelledJourneys)) {
    return { reason: "cancelled", source: "entur", why: "entur-cancelled", at: null };
  }
  if (logStatus(leg, ev) === "skipped") return fromLog;
  // Bevis for at turen gjekk vinn over alle slutningar under.
  if (signalHasDeparture(leg, ev)) return null;
  if (!isLiveFresh(live)) return null;
  if (now < clockMinutes(leg.departure)) return null;
  const dayLegs = legs || ev.dayLegs;
  const monitored = legForLive(dayLegs, live);
  if (!monitored) return null;
  const seen = (why) => ({ reason: "live", source: "live", why, at: live?.recordedAt || null });
  if (sameLeg(monitored, leg)) return stuckAtOrigin(live, monitored, now) ? seen("live-at-quay") : null;
  if (clockMinutes(monitored.departure) > clockMinutes(leg.departure)) {
    return laterTripRulesOut(dayLegs, leg, monitored) ? seen("live-later-trip") : null;
  }
  if (
    monitored.signal &&
    stuckAtOrigin(live, monitored, now) &&
    isInUnrunSignalTail(dayLegs, monitored, leg)
  ) {
    return seen("live-signal-tail");
  }
  return null;
}

export function signalSkipReason(leg, live, now, legs, ev) {
  return skipEvidence(leg, live, now, legs, ev)?.reason || null;
}

/** Ferja har lagt frå kai på denne signalturen no (fersk sanntid). */
function runningNow(leg, live, legs, ev) {
  if (!isTodayIn(ev) || !isLiveFresh(live)) return false;
  const monitored = legForLive(legs || ev.dayLegs, live);
  return Boolean(monitored && sameLeg(monitored, leg) && leftOrigin(live, monitored) === true);
}

/**
 * «running» når signalturen har lagt frå kai.
 * «skipped» berre med bevis: avlyst hos Entur, eller fersk sanntid viser at ferja
 * ikkje gjekk. Elles null («På signal»).
 */
export function signalVerdict(leg, live, now, legs, ev) {
  if (!leg?.signal) return null;
  if (runningNow(leg, live, legs, ev)) return "running";
  return signalSkipReason(leg, live, now, legs, ev) ? "skipped" : null;
}

/**
 * Sanntid seier at ferja framleis ligg ved kaien denne turen skulle gått frå.
 * Avlysing hos Entur åleine er ikkje det same: då veit vi ikkje om ho ligg der.
 */
export function signalObservedAtQuay(leg, live, now, legs, ev) {
  if (!leg?.signal || !isTodayIn(ev) || !isLiveFresh(live)) return false;
  if (now < clockMinutes(leg.departure)) return false;
  const dayLegs = legs || ev.dayLegs;
  const monitored = legForLive(dayLegs, live);
  if (!monitored) return false;
  if (sameLeg(monitored, leg)) return leftOrigin(live, monitored) === false;
  return (
    Boolean(monitored.signal) &&
    leftOrigin(live, monitored) === false &&
    isInUnrunSignalTail(dayLegs, monitored, leg)
  );
}

/**
 * Om signalturen er bestilt. Når vi har sett avgang, hugsar appen det resten av dagen
 * (`remember: "add"`), og gløymer det om turen viste seg å vere tomtur for ein retur
 * (`remember: "delete"`). Elles avgjer det appen hugsar (`ev.confirmedBooked`).
 */
export function signalBooking(leg, now, ev) {
  const none = { booked: false, remember: null, id: "", proof: null };
  if (!leg?.signal) return none;
  if (logStatus(leg, ev) === "skipped" || logStatus(leg, ev) === "gått") return none;
  if (!isTodayIn(ev)) {
    if (!signalLogBookedCounts(leg, ev)) return none;
    const at = logEntry(leg, ev)?.observedAt || null;
    return { ...none, booked: true, proof: { source: "log", reason: "log-departed", at } };
  }
  if (signalSailed(leg, ev)) return none;
  if (signalVerdict(leg, ev.live, now, null, ev) === "skipped") return none;
  const id = serviceJourneyId(leg.id);
  if (positioningBlocksBooked(leg, now, ev)) {
    return { ...none, id, remember: id ? "delete" : null };
  }
  const proof = departureEvidence(leg, ev);
  if (proof) return { booked: true, remember: id ? "add" : null, id, proof };
  const remembered = Boolean(id && ev.confirmedBooked?.has(id));
  return {
    ...none,
    id,
    booked: remembered,
    proof: remembered ? { source: "memory", reason: "seen-earlier", at: null } : null,
  };
}

/**
 * Samla status for éin avgang. `kind` er det detaljvindauget og radene viser:
 * «regular», «cancelled», «skipped», «booked», «sailed», «open» eller «unknown».
 * `source` og `at` seier kva bevis som avgjorde og når det vart sett, når vi veit det.
 *
 * `opts.live` og `opts.legs` overstyrer sanntida og turlista for sjølve
 * «ikkje utført»-slutninga, som signalVerdict(leg, live, now, legs).
 */
export function tripStatus(leg, ev, now, opts = {}) {
  const signal = Boolean(leg?.signal);
  const live = opts.live === undefined ? ev.live : opts.live;
  const legs = opts.legs || null;
  const today = isTodayIn(ev);
  const verdict = signal ? signalVerdict(leg, live, now, legs, ev) : null;
  const skipped = verdict === "skipped";
  const skip = skipped ? skipEvidence(leg, live, now, legs, ev) : null;
  const booking = signal && !skipped ? signalBooking(leg, now, ev) : null;
  const booked = Boolean(booking?.booked);
  const cancelled = isCancelledDeparture(leg, ev);
  const entry = signal ? logEntry(leg, ev) : null;
  const deadline = signal ? bookingDeadline(leg) : null;
  const sailedProof = signal ? sailedEvidence(leg, ev) : null;
  const sailed = Boolean(sailedProof);
  let kind = "regular";
  let proof = { source: "timetable", reason: "timetable", at: null };
  if (cancelled && !signal) {
    kind = "cancelled";
    proof =
      today && journeyCancelled(leg, ev.cancelledJourneys)
        ? { source: "entur", reason: "entur-cancelled", at: null }
        : { source: "messages", reason: "message-cancelled", at: null };
  } else if (skipped) {
    kind = "skipped";
    proof = { source: skip?.source || null, reason: skip?.why || null, at: skip?.at || null };
  } else if (booked) {
    kind = "booked";
    proof = booking.proof;
  } else if (sailed) {
    kind = "sailed";
    proof = sailedProof;
  } else if (signal && deadline != null && today && now < deadline) {
    kind = "open";
    proof = { source: "timetable", reason: "before-deadline", at: null };
  } else if (signal) {
    kind = "unknown";
    proof = { source: null, reason: "no-evidence", at: null };
  }
  return {
    kind,
    source: proof.source,
    at: proof.at,
    reason: proof.reason,
    signal,
    verdict,
    skipped,
    skipReason: skip?.reason || null,
    booked,
    sailed,
    cancelled,
    deadline,
    seenSkip: Boolean(
      logStatus(leg, ev) === "skipped" || (today && journeyCancelled(leg, ev.cancelledJourneys))
    ),
    observedAt: entry?.observedAt || null,
    skippedAt: entry?.skippedAt || null,
    remember: booking?.remember ? { id: booking.id, booked: booking.remember === "add" } : null,
  };
}

/**
 * Kva kolonna til høgre på ei avgangsrad skal seie:
 * «cancelled», «notRunning», «gone», «unknown», «countdown» eller «».
 * Ein signaltur utan bevis etter avgangstida er «unknown», ikkje «gone».
 */
export function departureStateKey(status, { past = false, departed = false, today = false } = {}) {
  if (status.cancelled) return "cancelled";
  if (status.verdict === "skipped") return "notRunning";
  if (status.kind === "unknown" && (past || departed)) return "unknown";
  if (status.sailed || (!today && status.booked) || past || departed) return "gone";
  return today ? "countdown" : "";
}

/** Turar som (truleg) køyrer: avlyste og bevist ikkje køyrde signalturar fell bort. */
export function runningLegs(legs, now, ev) {
  const cancelled = ev.messageCancelled;
  return (legs || []).filter((leg) => {
    // Sanntid viste at ferja køyrde turen. Det vinn over avlysing.
    if (liveSailed(leg, ev)) return true;
    if (isCancelledDeparture(leg, ev, cancelled) || journeyCancelled(leg, ev.cancelledJourneys)) {
      return false;
    }
    if (leg.signal && signalVerdict(leg, ev.live, now, legs, ev) === "skipped") return false;
    return true;
  });
}
