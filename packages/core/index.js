/**
 * Delt logikk for Fergeruter. Rein ESM utan avhengnader og utan byggjesteg,
 * så nettlesaren og testane importerer han direkte. Kvar import har ?v= med
 * versjonen i sw.js, så nettlesaren aldri blandar ny og gammal kode. Tekstane kjem
 * frå assets/i18n.js med same ?v= som app.js, så det blir berre éin i18n-modul.
 */
export * from "./time.js?v=82";
export * from "./legs.js?v=82";
export * from "./live.js?v=82";
export * from "./messages.js?v=82";
export * from "./timetable.js?v=82";
export * from "./plan.js?v=82";
export * from "./signal.js?v=82";
export * from "./tripstatus.js?v=82";
export * from "./status.js?v=82";
export * from "./entur.js?v=82";
