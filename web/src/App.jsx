import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { nowMinutes } from "../../packages/core/index.js";
import { DayNav } from "./components/DayNav.jsx";
import { Footer } from "./components/Footer.jsx";
import { Header } from "./components/Header.jsx";
import { Timeline } from "./components/Timeline.jsx";
import { setLang, t } from "./components/i18n.js";
import { useAppData } from "./hooks/useAppData.js";
import { useClock } from "./hooks/useClock.js";
import { useEntur } from "./hooks/useEntur.js";
import { hasTimetable, isTodaySelected, memoryOnly, rememberBookings, selectedDate } from "./model/context.js";
import { rememberEntur, withEntur } from "./model/entur.js";
import { ledeModel, routeChrome } from "./model/header.js";
import { writeRouteChoice } from "./model/storage.js";
import { buildTimeline } from "./model/timeline.js";
import { initialUi, uiReducer } from "./state.js";

/**
 * Skalet. Tre kjelder til tilstand:
 * - `ui` (reducer): samband, dag, språk, vis tidlegare
 * - `data` (useAppData + useEntur): rutetabell, kombirute, meldingar, signallogg,
 *   sanntid, avlysingar og faktiske avgangar
 * - `memory` (ref): bestilte/køyrde signalturar som appen hugsar gjennom dagen
 * Alt anna blir rekna ut av modellen (src/model) ved kvar teikning. Modellen les
 * minnet, men endrar det berre i effektane under.
 *
 * Props er for testar og SSR: fast data, fast Entur-tilstand, fast UI og minne utan localStorage.
 */
export function App({
  dataBase = "./data/",
  initialData = null,
  initialEntur = null,
  initialState = null,
  memory: givenMemory = null,
}) {
  const [ui, dispatch] = useReducer(uiReducer, initialState, (given) => given || initialUi());
  const { data: loaded, status } = useAppData(dataBase, initialData);
  const clockMs = useClock();
  const entur = useEntur(loaded, ui, clockMs, initialEntur);
  const data = useMemo(() => withEntur(loaded, entur), [loaded, entur]);
  const memoryRef = useRef(givenMemory);
  memoryRef.current ??= memoryOnly();
  const memory = memoryRef.current;
  // Teikn på nytt når effektane under har endra minnet.
  const [, setMemoryVersion] = useState(0);

  // i18n har éin global språkvariabel. Set han før komponentane omset noko.
  setLang(ui.lang, { persist: false });

  const ready = hasTimetable(data);
  const now = nowMinutes(clockMs);
  const chrome = useMemo(() => (ready ? routeChrome(data, ui) : null), [ready, data, ui]);
  const lede = ready ? ledeModel(data, ui, memory, now) : null;
  const timeline = ready ? buildTimeline(data, ui, memory, { now }) : null;

  useEffect(() => {
    if (!hasTimetable(loaded)) return;
    if (rememberEntur(memory, loaded, ui, entur)) setMemoryVersion((v) => v + 1);
  }, [memory, loaded, ui, entur, clockMs]);

  const remember = timeline?.remember;
  useEffect(() => {
    if (rememberBookings(memory, remember)) setMemoryVersion((v) => v + 1);
  }, [memory, remember]);

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
