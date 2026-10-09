/** Same localStorage-nøklar som vanilla-appen, så val og minne følgjer med mellom dei. */
import { CHOOSABLE_ROUTES } from "../../../packages/core/index.js";

export const ROUTE_CHOICE_KEY = "fergeruter-route-choice";
export const SAILED_KEY = "fergeruter-sailed-v1";

function store(storage) {
  try {
    return storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
  } catch {
    return null;
  }
}

export function readRouteChoice(storage) {
  try {
    const raw = store(storage)?.getItem(ROUTE_CHOICE_KEY);
    return CHOOSABLE_ROUTES.has(raw) ? raw : "1136";
  } catch {
    return "1136";
  }
}

export function writeRouteChoice(choice, storage) {
  try {
    store(storage)?.setItem(ROUTE_CHOICE_KEY, CHOOSABLE_ROUTES.has(choice) ? choice : "1136");
  } catch {
    // localStorage kan vere stengt.
  }
}

/** Turar vanilla-appen har sett køyrde i sanntid i dag. Skalet les dei, men skriv ikkje enno. */
export function readSailedJourneys(date, storage) {
  try {
    const parsed = JSON.parse(store(storage)?.getItem(SAILED_KEY) || "null");
    const ids = parsed?.[date];
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

/** Minne for heile økta: bestilte turar i minnet, køyrde turar frå localStorage per dag. */
export function browserMemory(storage) {
  let day = null;
  let sailed = new Set();
  return {
    confirmedBooked: new Set(),
    sailedJourneys(today) {
      if (day !== today) {
        day = today;
        sailed = readSailedJourneys(today, storage);
      }
      return sailed;
    },
  };
}
