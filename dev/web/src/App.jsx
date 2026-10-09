import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { chosenRoute, nowMinutes } from "../../packages/core/index.js";
import { DayNav } from "./components/DayNav.jsx";
import { DepartureDialog } from "./components/DepartureDialog.jsx";
import { Footer } from "./components/Footer.jsx";
import { Header } from "./components/Header.jsx";
import { MessagesPanel } from "./components/MessagesPanel.jsx";
import { Timeline } from "./components/Timeline.jsx";
import { ExtrasRow, PlaceFilter } from "./components/TripControls.jsx";
import { setLang, t } from "./components/i18n.js";
import { useAppData } from "./hooks/useAppData.js";
import { useClock } from "./hooks/useClock.js";
import { useEntur } from "./hooks/useEntur.js";
import { useMessages } from "./hooks/useMessages.js";
import { hasTimetable, isTodaySelected, memoryOnly, rememberBookings, selectedDate } from "./model/context.js";
import { connectionModel, detailModel, messagesModel, placeFilterModel, staleChoices } from "./model/controls.js";
import { rememberEntur, withEntur } from "./model/entur.js";
import { ledeModel, routeChrome } from "./model/header.js";
import { writeHideArrivals, writeRouteChoice } from "./model/storage.js";
import { buildTimeline } from "./model/timeline.js";
import { initialUi, uiReducer } from "./state.js";

const NO_CONNECTION = { lines: [], value: null, footnote: "" };

/**
 * Skalet. Tre kjelder til tilstand:
 * - `ui` (reducer): samband, dag, språk, vis tidlegare, frå/til, ankomsttider,
 *   korrespondanse, meldingsfilter og opent detaljvindauge
 * - `data` (useAppData + useMessages + useEntur): rutetabell, kombirute, meldingar,
 *   signallogg, korrespondanse, sanntid, avlysingar og faktiske avgangar
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
  const [ui, dispatch] = useReducer(uiReducer, initialState, (given) => ({ ...initialUi(), ...given }));
  const { data: loaded, status } = useAppData(dataBase, initialData);
  const messages = useMessages(dataBase, loaded.messages, status === "ready" && !initialData);
  const base = useMemo(() => ({ ...loaded, messages }), [loaded, messages]);
  const clockMs = useClock();
  const entur = useEntur(base, ui, clockMs, initialEntur);
  const data = useMemo(() => withEntur(base, entur), [base, entur]);
  const memoryRef = useRef(givenMemory);
  memoryRef.current ??= memoryOnly();
  const memory = memoryRef.current;
  // Teikn på nytt når effektane under har endra minnet.
  const [memoryVersion, setMemoryVersion] = useState(0);

  // i18n har éin global språkvariabel. Set han før komponentane omset noko.
  setLang(ui.lang, { persist: false });

  const ready = hasTimetable(data);
  const now = nowMinutes(clockMs);
  const chrome = useMemo(() => (ready ? routeChrome(data, ui) : null), [ready, data, ui]);
  const lede = ready ? ledeModel(data, ui, memory, now) : null;
  const place = ready ? placeFilterModel(data, ui) : null;
  const connection = ready ? connectionModel(data, ui) : NO_CONNECTION;
  const panel = messagesModel(data, ui, clockMs);
  const filters = place?.filters;
  const timeline = useMemo(
    () => (ready ? buildTimeline(data, { ...ui, filters, connection: connection.value }, memory, { now }) : null),
    // memoryVersion: minnet er ein ref, så endringar der må gje ny tidslinje.
    [ready, data, ui, filters, connection.value, memory, now, memoryVersion]
  );
  const detail = ui.detail && ready ? detailModel(data, ui, memory, ui.detail, now) : null;

  useEffect(() => {
    if (!hasTimetable(base)) return;
    if (rememberEntur(memory, base, ui, entur)) setMemoryVersion((v) => v + 1);
  }, [memory, base, ui, entur, clockMs]);

  const remember = timeline?.remember;
  useEffect(() => {
    if (rememberBookings(memory, remember)) setMemoryVersion((v) => v + 1);
  }, [memory, remember]);

  // Val som ikkje gjeld lenger (anna dag eller samband), blir gløymde som i vanilla-appen.
  const stale = ready ? staleChoices(ui, place, connection, panel) : null;
  useEffect(() => {
    if (stale) dispatch({ type: "sanitize", patch: stale });
  });

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
  const onToggleArrivals = () => {
    writeHideArrivals(!ui.hideArrivals);
    dispatch({ type: "toggleArrivals" });
  };

  return (
    <>
      <a className="skip-link" href="#innhald">
        {t("skip")}
      </a>
      <div className="skyline" aria-hidden="true" />
      <Header chrome={chrome} lede={lede} ui={ui} onRoute={onRoute} onLang={onLang} />
      <main id="innhald">
        <div className={panel.hidden ? "layout is-single" : "layout"} id="layout">
          <MessagesPanel
            panel={panel}
            route={chosenRoute(ui)}
            expanded={ui.messagesExpanded}
            onToggle={() => dispatch({ type: "toggleMessages" })}
            onFilter={(filter) => dispatch({ type: "messageFilter", filter })}
          />
          <section className="panel" aria-labelledby="day-label" id="timetable-panel">
            <DayNav
              date={selectedDate(ui)}
              isToday={isTodaySelected(ui)}
              loading={!ready && status === "loading"}
              onDay={(days) => dispatch({ type: "day", days })}
            />
            {place ? <PlaceFilter place={place} dispatch={dispatch} /> : null}
            {ready ? (
              <ExtrasRow
                showArrivals={!ui.hideArrivals}
                onToggleArrivals={onToggleArrivals}
                connection={connection}
                onConnection={(id) => dispatch({ type: "connection", id })}
              />
            ) : null}
            {status === "error" && !ready ? (
              <div className="timeline">
                <p className="empty">{t("timetable.notLoaded")}</p>
              </div>
            ) : timeline ? (
              <Timeline
                timeline={timeline}
                showPast={ui.showPast}
                onTogglePast={() => dispatch({ type: "togglePast" })}
                onDetail={(leg) => dispatch({ type: "detail", leg })}
              />
            ) : null}
            <p className="footnote">
              <span>{t("footnote.signal")}</span> <span id="connection-note">{connection.footnote}</span>
            </p>
          </section>
        </div>
      </main>
      <Footer chrome={chrome} />
      <DepartureDialog detail={detail} onClose={() => dispatch({ type: "detail", leg: null })} />
    </>
  );
}
