/**
 * Delt logikk for Fergeruter. Rein ESM utan avhengnader og utan byggjesteg,
 * så nettlesaren og testane importerer han direkte. Tekstane kjem framleis frå
 * assets/i18n.js, med same ?v= som app.js, så det blir berre éin i18n-modul.
 */
export * from "./time.js";
export * from "./messages.js";
export * from "./live.js";
export * from "./signal.js";
export * from "./status.js";
export * from "./timetable.js";
