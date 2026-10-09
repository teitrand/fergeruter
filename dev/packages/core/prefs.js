/**
 * Val som blir hugsa i localStorage, felles for vanilla og React (same nøklar, så
 * valet følgjer med mellom dei). `storage` blir sendt inn; null = ingen lagring.
 */
import { CHOOSABLE_ROUTES } from "./plan.js?v=84";

export const ROUTE_CHOICE_KEY = "fergeruter-route-choice";
export const HIDE_ARRIVALS_KEY = "fergeruter-hide-arrivals";

export function readRouteChoice(storage) {
  try {
    const raw = storage?.getItem(ROUTE_CHOICE_KEY);
    return CHOOSABLE_ROUTES.has(raw) ? raw : "1136";
  } catch {
    return "1136";
  }
}

export function writeRouteChoice(choice, storage) {
  try {
    storage?.setItem(ROUTE_CHOICE_KEY, CHOOSABLE_ROUTES.has(choice) ? choice : "1136");
  } catch {
    // localStorage kan vere stengt.
  }
}

export function readHideArrivals(storage) {
  try {
    return storage?.getItem(HIDE_ARRIVALS_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeHideArrivals(hide, storage) {
  try {
    if (!storage) return;
    if (hide) storage.setItem(HIDE_ARRIVALS_KEY, "1");
    else storage.removeItem(HIDE_ARRIVALS_KEY);
  } catch {
    // localStorage kan vere stengt.
  }
}

export const MESSAGES_CACHE_KEY = "fergeruter-messages-v1";

/** Siste trafikkmeldingar, så omleggingar Fjord1 har fjerna blir ståande etter omlasting. */
export function readCachedMessages(storage) {
  try {
    const raw = storage?.getItem(MESSAGES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && Array.isArray(parsed.messages) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeCachedMessages(payload, storage) {
  try {
    if (!storage || !payload || !Array.isArray(payload.messages)) return;
    storage.setItem(MESSAGES_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // kvote / privat modus
  }
}
