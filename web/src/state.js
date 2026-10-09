/**
 * UI-tilstanden til skalet: éin reducer, så alle endringar går via kjende handlingar.
 * Data (rutetabell osv.) ligg i useAppData, klokka i useClock, minnet i ein ref i App.
 */
import { CHOOSABLE_ROUTES, shiftIso, todayIso } from "../../packages/core/index.js";

/** @returns {import("./model/context.js").UiState} */
export function initialUi({ routeChoice = "1136", lang = "nn", override = null, date = null } = {}) {
  return { routeChoice, lang, override, date, showPast: false };
}

/**
 * @param {import("./model/context.js").UiState} ui
 * @param {{ type: string, [key: string]: any }} action
 */
export function uiReducer(ui, action) {
  switch (action.type) {
    case "route": {
      const routeChoice = CHOOSABLE_ROUTES.has(action.route) ? action.route : "1136";
      return routeChoice === ui.routeChoice ? ui : { ...ui, routeChoice };
    }
    case "day": {
      // Lagra som dato, ikkje forskyving, så ei side som står open over midnatt
      // held fram med den dagen du ser på (som i vanilla-appen).
      const date = action.days === 0 ? todayIso() : shiftIso(ui.date || todayIso(), action.days);
      return { ...ui, date, showPast: false };
    }
    case "lang":
      return action.lang === ui.lang ? ui : { ...ui, lang: action.lang };
    case "togglePast":
      return { ...ui, showPast: !ui.showPast };
    default:
      throw new Error(`ukjend handling ${action.type}`);
  }
}
