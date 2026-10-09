/**
 * Val som blir hugsa i localStorage, felles for vanilla og React (same nøklar, så
 * valet følgjer med mellom dei). `storage` blir sendt inn; null = ingen lagring.
 */
import { CHOOSABLE_ROUTES } from "./plan.js?v=83";

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
