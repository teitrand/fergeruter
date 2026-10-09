import { useEffect, useMemo, useReducer, useRef } from "react";
import { nowMinutes } from "../../packages/core/index.js";
import { DayNav } from "./components/DayNav.jsx";
import { Footer } from "./components/Footer.jsx";
import { Header } from "./components/Header.jsx";
import { Timeline } from "./components/Timeline.jsx";
import { setLang, t } from "./components/i18n.js";
import { useAppData } from "./hooks/useAppData.js";
import { useClock } from "./hooks/useClock.js";
import { hasTimetable, isTodaySelected, memoryOnly, selectedDate } from "./model/context.js";
import { ledeModel, routeChrome } from "./model/header.js";
import { writeRouteChoice } from "./model/storage.js";
import { buildTimeline } from "./model/timeline.js";
import { initialUi, uiReducer } from "./state.js";

/**
 * Skalet. Tre kjelder til tilstand:
 * - `ui` (reducer): samband, dag, språk, vis tidlegare
 * - `data` (useAppData): rutetabell, kombirute, meldingar, signallogg
 * - `memory` (ref): bestilte/køyrde signalturar som appen hugsar gjennom dagen
 * Alt anna blir rekna ut av modellen (src/model) ved kvar teikning.
 *
 * Props er for testar og SSR: fast data, fast UI og minne utan localStorage.
 */
export function App({ dataBase = "./data/", initialData = null, initialState = null, memory: givenMemory = null }) {
  const [ui, dispatch] = useReducer(uiReducer, initialState, (given) => given || initialUi());
  const { data, status } = useAppData(dataBase, initialData);
  const clockMs = useClock();
  const memoryRef = useRef(givenMemory);
  memoryRef.current ??= memoryOnly();
  const memory = memoryRef.current;

  // i18n har éin global språkvariabel. Set han før komponentane omset noko.
  setLang(ui.lang, { persist: false });

  const ready = hasTimetable(data);
  const now = nowMinutes(clockMs);
  const chrome = useMemo(() => (ready ? routeChrome(data, ui) : null), [ready, data, ui]);
  const lede = ready ? ledeModel(data, ui, memory, now) : null;
  const timeline = ready ? buildTimeline(data, ui, memory, { now }) : null;

  useEffect(() => {
    document.documentElement.lang = ui.lang;
    if (chrome) document.title = t(chrome.metaTitleKey);
  }, [ui.lang, chrome]);

  const onRoute = (route) => {
    writeRouteChoice(route);
    dispatch({ type: "route", route });
  };
  const onLang = (lang) => {
    setLang(lang);
    dispatch({ type: "lang", lang });
  };

  return (
    <>
      <a className="skip-link" href="#innhald">
        {t("skip")}
      </a>
      <div className="skyline" aria-hidden="true" />
      <Header chrome={chrome} lede={lede} ui={ui} onRoute={onRoute} onLang={onLang} />
      <main id="innhald">
        <div className="layout">
          <section className="panel" aria-labelledby="day-label">
            <DayNav
              date={selectedDate(ui)}
              isToday={isTodaySelected(ui)}
              loading={!ready && status === "loading"}
              onDay={(days) => dispatch({ type: "day", days })}
            />
            {status === "error" && !ready ? (
              <div className="timeline">
                <p className="empty">{t("timetable.notLoaded")}</p>
              </div>
            ) : timeline ? (
              <Timeline timeline={timeline} showPast={ui.showPast} onTogglePast={() => dispatch({ type: "togglePast" })} />
            ) : null}
            <p className="footnote">
              <span>{t("footnote.signal")}</span>
            </p>
          </section>
        </div>
      </main>
      <Footer chrome={chrome} />
    </>
  );
}
