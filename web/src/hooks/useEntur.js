import { useEffect, useReducer, useRef } from "react";
import { knownQuays, loadEnturEvidence } from "../../../packages/core/index.js";
import { hasTimetable, planContext } from "../model/context.js";
import { emptyEntur, enturDue, enturMode, enturReducer, enturRequest } from "../model/entur.js";

/**
 * Hentar sanntid (VM) og dagens turar frå Entur (avlysingar, faktiske avgangar), som
 * loadLivePosition() i vanilla-appen: på klokketikket, berre i driftsvindauget, minst
 * 55 s mellom kall, backoff når VM feilar, og ikkje når fana er gøymd.
 * Byte av samband gjer at den gamle posisjonen fell bort og vi spør med ein gong;
 * svar som kjem etter bytet, blir kasta. Starttida blir hugsa i ein ref med ein gong,
 * så StrictMode (effekten to gonger) ikkje gjev to kall; og eit treigt svar skriv
 * ikkje over eit nyare (sjå enturReducer).
 *
 * `initial` let testar og SSR gje fast Entur-tilstand; då blir det ikkje henta noko.
 * @returns {import("../model/entur.js").EnturState}
 */
export function useEntur(data, ui, clockMs, initial = null) {
  const [entur, dispatch] = useReducer(enturReducer, initial, (given) => ({ ...emptyEntur(), ...given }));
  const ready = hasTimetable(data);
  const mode = ready ? enturMode(data, ui) : null;
  const latest = useRef(entur);
  latest.current = entur;
  const started = useRef(0);
  const generation = useRef({ mode, count: 0 });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const gen = generation.current;
    if (gen.mode === mode) return;
    const hadMode = gen.mode !== null;
    generation.current = { mode, count: gen.count + 1 };
    if (hadMode) {
      started.current = 0;
      dispatch({ type: "reset" });
    }
  }, [mode]);

  useEffect(() => {
    if (initial || !ready) return;
    const at = Date.now();
    const fetchedAt = Math.max(latest.current.fetchedAt, started.current);
    if (!enturDue({ ...latest.current, fetchedAt }, data, ui, at, document.hidden)) return;
    const gen = generation.current;
    started.current = at;
    dispatch({ type: "start", at });
    const request = enturRequest(data, ui, knownQuays(planContext(data, { ...ui, date: null })));
    loadEnturEvidence(fetch, request).then((result) => {
      if (result.liveError) console.error(result.liveError);
      if (result.journeysError) console.error(result.journeysError);
      if (mounted.current && generation.current === gen) dispatch({ type: "loaded", result, at: Date.now(), startedAt: at });
    });
    // Med vilje: `ui` kjem inn via `mode`, og `entur.fetchedAt` er med så ein reset spør med ein gong.
  }, [initial, ready, data, mode, clockMs, entur.fetchedAt]);

  return entur;
}
