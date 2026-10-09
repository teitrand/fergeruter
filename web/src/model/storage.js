/** Same localStorage-nøklar som vanilla-appen, så val og minne følgjer med mellom dei. */
import * as core from "../../../packages/core/index.js";
import { readSailedJourneys, writeSailedJourneys } from "../../../packages/core/index.js";

function store(storage) {
  try {
    return storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
  } catch {
    return null;
  }
}

export function readRouteChoice(storage) {
  return core.readRouteChoice(store(storage));
}

export function writeRouteChoice(choice, storage) {
  core.writeRouteChoice(choice, store(storage));
}

export function readHideArrivals(storage) {
  return core.readHideArrivals(store(storage));
}

export function writeHideArrivals(hide, storage) {
  core.writeHideArrivals(hide, store(storage));
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

/** Trafikkmeldingane i localStorage (same nøkkel som vanilla), så omleggingar overlever omlasting. */
export function messageCache(storage) {
  return {
    read: () => core.readCachedMessages(store(storage)),
    write: (payload) => core.writeCachedMessages(payload, store(storage)),
  };
}

/** Fyrste opning som installert app (same nøkkel som vanilla). */
export function markPwaFirstOpen(mode, storage) {
  return core.markPwaFirstOpen(store(storage), mode);
}
