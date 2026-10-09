/**
 * Plausible-hendingar i skalet. Same namn og eigenskapar som track(...)-kalla i
 * assets/app.js (testen i tests/test_plausible.mjs lister dei); sjølve sendinga og
 * konteksten (språk, web/pwa, samband) ligg i packages/core/track.js.
 */
import { CHOOSABLE_ROUTES, appMode, chosenRoute, trackEvent } from "../../../packages/core/index.js";

/** Språk, web/pwa og samband for `ui`, som plausibleContext() i vanilla. */
export function trackContext(ui, win = null) {
  return { lang: ui.lang, app: appMode(win), route: chosenRoute(ui) };
}

/** Sender éi hending. `win` = null (SSR, testar utan window) gjer ingenting. */
export function track(win, name, props, ui, opts) {
  if (!win) return;
  trackEvent(win, name, props, trackContext(ui, win), opts);
}

/**
 * Kva hending ei handling til uiReducer gjev, rekna ut frå tilstanden før handlinga.
 * null = inga hending (t.d. same val på nytt, slik vanilla-appen heller ikkje sender).
 * `ui` i svaret er tilstanden konteksten skal lesast frå når han ikkje er den gamle
 * (nytt samband blir sendt med det nye sambandet, som i selectRoute()).
 * @returns {{ name: string, props?: object, ui?: object }|null}
 */
export function actionEvent(action, ui) {
  switch (action.type) {
    case "from":
    case "to": {
      const value = action.value || null;
      if (ui.filters[action.type] === value) return null;
      return { name: `${action.type === "from" ? "From" : "To"} ${value || "all"}` };
    }
    case "swap":
      return ui.filters.from || ui.filters.to ? { name: "Swap direction" } : null;
    case "route": {
      const next = CHOOSABLE_ROUTES.has(action.route) ? action.route : "1136";
      return next === ui.routeChoice ? null : { name: `Route ${next}`, ui: { ...ui, routeChoice: next } };
    }
    case "toggleArrivals":
      return { name: ui.hideArrivals ? "Show arrivals" : "Hide arrivals" };
    case "connection":
      return { name: `Connection ${action.id || "none"}` };
    case "messageFilter":
      return action.filter === ui.messageFilter ? null : { name: `Messages ${action.filter}` };
    case "togglePast":
      return { name: ui.showPast ? "Hide past" : "Show past" };
    case "day":
      return { name: action.days === 0 ? "Day today" : action.days < 0 ? "Day prev" : "Day next" };
    case "lang":
      return action.lang === ui.lang ? null : { name: `Language ${action.lang}` };
    case "detail":
      return action.leg ? { name: "Departure detail", props: { signal: action.leg.signal ? "yes" : "no" } } : null;
    default:
      return null;
  }
}

/** Hendingane ved oppstart (ikkje interaktive): Visit <språk>, og for installert app Visit pwa / PWA first open. */
export function visitEvents(ui, mode, firstOpen) {
  const events = [`Visit ${ui.lang}`];
  if (mode === "pwa") {
    events.push("Visit pwa");
    if (firstOpen) events.push("PWA first open");
  }
  return events;
}
