/** Same localStorage-nøklar som vanilla-appen, så val og minne følgjer med mellom dei. */
import { CHOOSABLE_ROUTES, readSailedJourneys, writeSailedJourneys } from "../../../packages/core/index.js";

export const ROUTE_CHOICE_KEY = "fergeruter-route-choice";

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

/** Minne for heile økta: bestilte turar i minnet, køyrde turar i localStorage per dag (same nøkkel som vanilla). */
export function browserMemory(storage) {
  let day = null;
  let sailed = new Set();
  const load = (today) => {
    if (day !== today) {
      day = today;
      sailed = readSailedJourneys(today, store(storage));
    }
    return sailed;
  };
  return {
    confirmedBooked: new Set(),
    sailedJourneys: load,
    rememberSailed(today, id) {
      const ids = load(today);
      if (ids.has(id)) return false;
      ids.add(id);
      writeSailedJourneys(today, ids, store(storage));
      return true;
    },
  };
}
