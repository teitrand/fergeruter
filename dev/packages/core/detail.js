/**
 * Detaljvindauget for éi avgang som rein data: tittel og avsnitt. Visninga gjer
 * avsnitta om til <p>, og avsnittet med `phone` til ei ringelenkje.
 */
import { t } from "../../assets/i18n.js?v=83";
import { durationText, formatDateTime, hhmm, minutesToClock } from "./time.js?v=83";
import { telHref } from "./live.js?v=83";

/**
 * Kva vindauget skal seie, frå tripStatus. Entur har ikkje tidspunkt for sjølve
 * ringinga: `observedAt` er når vi fyrst såg statusen, ikkje når nokon tinga.
 */
export function departureDetail(leg, status, phone = "") {
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
    phone: status.signal ? phone : "",
    observedAt: status.observedAt,
    skippedAt: status.skippedAt,
  };
}

function statusText(detail) {
  if (detail.cancelled) return t("sailing.cancelled");
  if (detail.skipped) return t("signal.notRunning");
  if (detail.booked) return t("signal.booked");
  if (detail.phase === "sailed") return t("gone");
  return detail.signal ? t("signal.onRequest") : t("detail.regular");
}

/**
 * @returns {{ title: string, paragraphs: { className: string, text: string, phone?: string }[] }}
 */
export function departureDetailContent(leg, detail) {
  const p = (text, className = "detail-copy") => ({ className, text });
  const paragraphs = [];
  if (leg.arrival) paragraphs.push(p(t("sailing.arrival", { time: hhmm(leg.arrival) })));
  paragraphs.push(p(statusText(detail), "detail-status"));
  if (!detail.signal) {
    if (detail.cancelled) paragraphs.push(p(t("detail.cancelled")));
  } else {
    const deadline = detail.deadline != null ? minutesToClock(detail.deadline) : "";
    const lead = (detail.minutesBefore || 60) === 60 ? t("signal.leadHour") : durationText(detail.minutesBefore || 60);
    paragraphs.push(p(t("signal.how", { lead, time: deadline })));
    if (telHref(detail.phone)) {
      paragraphs.push({ className: "detail-copy", text: t("signal.callLink", { phone: detail.phone }), phone: detail.phone });
    }
    const caveat = p(t("signal.caveat"), "detail-caveat");
    if (detail.phase === "booked") {
      paragraphs.push(p(t("signal.bookedHow", { time: deadline })));
      if (detail.observedAt) paragraphs.push(p(t("signal.observed", { when: formatDateTime(detail.observedAt) })));
      paragraphs.push(caveat);
    } else if (detail.phase === "open") {
      paragraphs.push(p(t("signal.openHow", { time: deadline })), caveat);
    } else if (detail.phase === "skipped") {
      paragraphs.push(
        p(
          detail.seenSkip
            ? t("signal.skippedHow", { time: deadline })
            : detail.skipReason === "live"
              ? t("signal.skippedLiveHow")
              : t("signal.unknownHow", { time: deadline })
        )
      );
      const when = detail.skippedAt || detail.observedAt;
      if (detail.seenSkip && when) paragraphs.push(p(t("signal.skippedWhen", { when: formatDateTime(when) })));
    } else if (detail.phase === "sailed") {
      paragraphs.push(p(t("signal.sailedHow")));
    } else if (detail.phase === "unknown") {
      paragraphs.push(p(t("signal.unknownHow", { time: deadline })), caveat);
    }
  }
  return { title: t("detail.title", { time: hhmm(leg.departure), from: leg.from, to: leg.to }), paragraphs };
}
