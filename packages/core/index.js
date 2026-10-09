/**
 * Delt logikk for Fergeruter. Rein ESM utan avhengnader og utan byggjesteg,
 * så nettlesaren og testane importerer han direkte. Kvar import har ?v= med
 * versjonen i sw.js, så nettlesaren aldri blandar ny og gammal kode. Tekstane kjem
 * frå assets/i18n.js med same ?v= som app.js, så det blir berre éin i18n-modul.
 */
export * from "./time.js?v=83";
export * from "./legs.js?v=83";
export * from "./live.js?v=83";
export * from "./messages.js?v=83";
export * from "./timetable.js?v=83";
export * from "./plan.js?v=83";
export * from "./signal.js?v=83";
export * from "./tripstatus.js?v=83";
export * from "./status.js?v=83";
export * from "./entur.js?v=83";
export * from "./vessel.js?v=83";
export * from "./timeline.js?v=83";
export * from "./detail.js?v=83";
export * from "./prefs.js?v=83";
