/**
 * Trafikkmeldingar: tolking av Fjord1-tekst, vindauge, rutemodus og omlegging.
 * Rein logikk utan DOM, flytta uendra frå assets/app.js.
 */
import { t } from "../../assets/i18n.js?v=82";
import {
  NUMDATE_TOKEN,
  WEEKDAY_TOKEN,
  formatDateTime,
  fromOsloWall,
  isoFromUnix,
  osloIsoFromInstant,
  osloIsoFromMs,
  parseClockToken,
  parseNumDate,
} from "./time.js?v=82";
import { quayPlace } from "./legs.js?v=82";
import { vesselFromText } from "./live.js?v=82";

export const FJORD1_MESSAGES_PAGE = "https://www.fjord1.no/trafikkmeldingar";

export const NORMAL_RE = /normal drift/i;

export const CANCEL_RE = /innstilt|innstilling/i;

export const PARTIAL_CANCEL_RE =
  /følgjande avgangar|avgangar innstilt|avgang(?:en|ar)?\s+(?:kl\.?|klokka)/i;

export const KOMBI_RE = /kombinasjon|kombirute|kombinert rute/i;

export const DELAY_RE = /forsink/i;

export const CAPACITY_RE = /kapasitet|kapasistet|farleg last|farlig last/i;

export const HAS_1135_RE = /\b1135\b/;

export const HAS_1136_RE = /\b1136\b/;

export const ROUTE_1136_HINT_RE =
  /\b1136\b|trandal|standal|valderøy|store kalvøy|sæbø|skår/i;

export const LOCAL_ROUTE_RE = /\b(1136|1135|1049)\b/i;

export const LOCAL_PLACE_RE =
  /trandal|standal|sæbø|skår|store kalvøy|valderøy|bjørke|urke|festøy|hundeidvik/i;

/** GitHub-kopien er gammal når innhaldet ikkje er skrive på nytt. Då spør sida workeren. */
export const MESSAGES_STALE_MS = 8 * 60 * 1000;

export function excerptText(text, max = 140) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (raw.length <= max) return raw;
  const cut = raw.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > 80 ? cut.slice(0, at) : cut).trim()}…`;
}

/** Publisert-tid og «gyldig til» frå Fjord1, med klokkeslett. */
export function messageTimeLines(msg) {
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

export function beforeModeFor(after, text) {
  if (after === "1136") return KOMBI_RE.test(text || "") ? "kombi" : "1135";
  return "1136";
}

export const HJORUNDFJORD_RE =
  /\b(?:1135|1136)\b|trandal|standal|sæbø|skår|lekne|valderøy|store kalvøy|kombinasjon|kombirute|kombinert rute/i;

export const ONLY_1049_RE = /\b1049\b|festøy|hundeidvik/i;

export function messageBlob(msg) {
  if (typeof msg === "string") return msg || "";
  return `${msg?.heading || ""} ${msg?.text || ""}`;
}

export function is1049Only(heading, text) {
  const blob = `${heading || ""} ${text || ""}`;
  return ONLY_1049_RE.test(blob) && !HJORUNDFJORD_RE.test(blob);
}

export function isPartialCancel(text) {
  const blob = text || "";
  if (!CANCEL_RE.test(blob) && !/kanseller/i.test(blob)) return false;
  return PARTIAL_CANCEL_RE.test(blob);
}

export function cancelledSailingsFromText(text) {
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

export function isRouteControl(msg) {
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

export function windowFromText(text, published) {
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
  const alsoMatch = blob.match(
    new RegExp(`(?:også|òg)\\s+(?:på\\s+)?(?:${WEEKDAY_TOKEN})?${NUMDATE_TOKEN}`, "i")
  );
  if (alsoMatch) {
    const extra = parseNumDate(alsoMatch[1], alsoMatch[2], alsoMatch[3], ref);
    if (extra) return { from: null, to: extra };
  }
  return null;
}

export function activateAtFromText(text) {
  const match = String(text || "").match(
    /normal drift.{0,40}(?:frå|fra)\s+(?:klokka|kl\.?)\s*(?:ca\.?\s*)?(\d{1,2})[:.](\d{2})/is
  );
  return match ? parseClockToken(`${match[1]}:${match[2]}`) : null;
}

/** Skøyt berre når meldinga seier at tabellen byter («kombirute frå klokka»). */
export function switchFromText(text, afterMode = null) {
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

export function modeFromText(text) {
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

export function messageMode(msg) {
  if (!msg) return "1136";
  if (isPartialCancel(messageBlob(msg))) return "1136";
  return msg.routeMode || modeFromText(messageBlob(msg));
}

export function publishedMs(msg) {
  const ms = Date.parse(msg?.publishedAt || msg?.validFrom || "");
  return Number.isFinite(ms) ? ms : 0;
}

export function textRouteWindow(msg) {
  if (!msg) return null;
  return (
    msg.routeWindow ||
    windowFromText(messageBlob(msg), msg.publishedAt || msg.validFrom)
  );
}

export function textWindowCoversToday(msg, now = Date.now()) {
  const win = textRouteWindow(msg);
  return Boolean(win?.to && osloIsoFromMs(now) <= win.to);
}

/** Hald meldinga ut CMS-dagen i Oslo, éin time etter validTo, eller ut tekstvindauget. */
export function messageIsHeld(msg, now = Date.now()) {
  if (!msg?.validTo) return true;
  const until = Date.parse(msg.validTo);
  if (Number.isFinite(until) && until >= now - 60 * 60 * 1000) return true;
  const validDay = osloIsoFromInstant(msg.validTo);
  if (validDay && osloIsoFromMs(now) <= validDay) return true;
  return textWindowCoversToday(msg, now);
}

/** Behald berre når vi veit at meldinga framleis gjeld etter at Fjord1 droppa ho. */
export function messageShouldBeRetained(msg, now = Date.now()) {
  if (!msg) return false;
  if (textWindowCoversToday(msg, now)) return true;
  if (!msg.validTo) return false;
  const until = Date.parse(msg.validTo);
  if (Number.isFinite(until) && until >= now - 60 * 60 * 1000) return true;
  const validDay = osloIsoFromInstant(msg.validTo);
  return Boolean(validDay && osloIsoFromMs(now) <= validDay);
}

export function retainHeldMessages(fresh, previous, now = Date.now()) {
  const byKey = new Map();
  for (const msg of previous || []) {
    if (messageShouldBeRetained(msg, now)) byKey.set(messageMergeKey(msg), msg);
  }
  for (const msg of fresh || []) byKey.set(messageMergeKey(msg), msg);
  return [...byKey.values()].sort((a, b) => publishedMs(b) - publishedMs(a));
}

export function messageWindow(msg) {
  const textWin = textRouteWindow(msg);
  const fromDate =
    textWin?.from || osloIsoFromInstant(msg.validFrom) || osloIsoFromInstant(msg.publishedAt);
  const toDate = textWin?.to || osloIsoFromInstant(msg.validTo);
  return { from: fromDate || null, to: toDate || null };
}

export function messageAppliesToDate(msg, date, now = Date.now()) {
  if (!isRouteControl(msg)) return false;
  const today = osloIsoFromMs(now);
  if (date >= today && !messageIsHeld(msg, now)) return false;
  const win = messageWindow(msg);
  if (win.from && date < win.from) return false;
  if (win.to && date > win.to) return false;
  return true;
}

export function controllingMessages(messages, date, now = Date.now()) {
  return validMessages(messages || [], now)
    .filter((msg) => messageAppliesToDate(msg, date, now))
    .sort((a, b) => publishedMs(b) - publishedMs(a));
}

export function firstDayOf(msg) {
  const win = messageWindow(msg);
  return win.from || osloIsoFromInstant(msg.publishedAt) || osloIsoFromInstant(msg.validFrom);
}

export function resolveRoutePlan(messages, now = Date.now(), date = osloIsoFromMs(now)) {
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

export function routeModeFromMessages(messages, now = Date.now(), date = osloIsoFromMs(now)) {
  return resolveRoutePlan(messages, now, date).mode;
}

export function routeSwitchFromMessages(messages, now = Date.now(), date = osloIsoFromMs(now)) {
  return resolveRoutePlan(messages, now, date).switch;
}

export function driftNeedsOperationalTable(resolved, parsed) {
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

export function parseFjord1Published(dateStr, fallbackTs) {
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

export function classifyMessage(text) {
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

export function isRoute1136Message(heading, text, connectionNumber) {
  if (Number(connectionNumber) === CONN_1136) return true;
  return ROUTE_1136_HINT_RE.test(`${heading || ""} ${text || ""}`);
}

export function isLocalMessage(heading, text, connectionNumber) {
  if (isRoute1136Message(heading, text, connectionNumber)) return true;
  const blob = `${heading || ""} ${text || ""}`;
  return LOCAL_ROUTE_RE.test(blob) || LOCAL_PLACE_RE.test(blob);
}

export function compactMessageText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function messageMergeKey(msg) {
  return `${compactMessageText(msg?.heading)}|${compactMessageText(msg?.text)}`;
}

export function liveMessageId(heading, text) {
  const key = messageMergeKey({ heading, text });
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return `live:${(hash >>> 0).toString(16)}`;
}

export function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function normalizeFjord1Node(node) {
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

export function parseFjord1TrafficHtml(html) {
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

export function fjord1Payload(messages, { fetchedAt = null, live = true, complete = false } = {}) {
  return {
    source: FJORD1_MESSAGES_PAGE,
    fetchedAt: fetchedAt || new Date().toISOString(),
    fetchedLive: live,
    complete,
    messages,
  };
}

export function messagesAreStale(payload, now = Date.now()) {
  const ms = Date.parse(payload?.fetchedAt || "");
  if (!Number.isFinite(ms)) return true;
  return now - ms > MESSAGES_STALE_MS;
}

export function mergeMessagePayloads(base, live, now = Date.now()) {
  if (!live?.messages?.length) return base || null;
  if (!base?.messages?.length) return live;
  if (live.complete) {
    return {
      source: live.source || base.source,
      fetchedAt: live.fetchedAt || base.fetchedAt,
      fetchedLive: Boolean(live.fetchedLive),
      complete: true,
      messages: retainHeldMessages(live.messages, base.messages, now),
    };
  }
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

export function messagesFingerprint(payload) {
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

export function validMessages(messages, now = Date.now()) {
  return (messages || []).filter((msg) => messageIsHeld(msg, now));
}

export function routeNameFlags(msg) {
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

export function filterMessageKey(messages) {
  return messages.map((msg) => msg.id || messageMergeKey(msg)).join("\n");
}

export const CONN_1136 = 132;

export const CONN_1135 = 134;
