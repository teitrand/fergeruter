import { useEffect, useRef, useState } from "react";
import {
  MESSAGES_POLL_MS,
  fetchFjord1Messages,
  mergeMessagePayloads,
  messagesAreStale,
  nextMessages,
} from "../../../packages/core/index.js";
import { DATA_FILES } from "../model/data.js";

/**
 * Trafikkmeldingar som loadMessages() i vanilla-appen: fila frå Actions fyrst; er ho
 * borte eller gammal, direkte frå Fjord1 (workeren, så HTML-sida). Spør på nytt kvart
 * 3. minutt når fana er synleg.
 *
 * Siste meldingar ligg i localStorage (`cache`, same nøkkel som vanilla). Dei blir vist
 * med ein gong ved oppstart og er «førre tilstand» når nye svar kjem, så omleggingar
 * Fjord1 har fjerna, blir ståande etter omlasting (withHeldMessages i core).
 *
 * - `base`: der trafikkmeldinger.json ligg (liveDataBase)
 * - `loaded`: fila useAppData alt har henta
 * - `live` = false i testar og SSR (berre `loaded`, ingen nett og ingen localStorage)
 * - `ready`: useAppData er ferdig
 */
export function useMessages(base, loaded, { live = true, ready = true, cache = null } = {}) {
  const [messages, setMessages] = useState(() => (live ? cache?.read() ?? null : null));
  // Eitt kall om gongen, òg når StrictMode køyrer effekten to gonger.
  const inflight = useRef(null);

  useEffect(() => {
    if (!live || !ready) return undefined;
    let alive = true;
    let timer = null;
    const apply = (payload) => {
      if (alive && payload) setMessages((previous) => nextMessages(previous, payload));
    };
    const refresh = async (json) => {
      apply(json);
      if (json && !messagesAreStale(json)) return;
      try {
        inflight.current ??= fetchFjord1Messages(fetch).finally(() => {
          inflight.current = null;
        });
        const fresh = await inflight.current;
        apply(mergeMessagePayloads(json, fresh) || fresh);
      } catch (error) {
        if (!json) console.error(error);
      }
    };
    const poll = () => {
      timer = setTimeout(async () => {
        if (!document.hidden) {
          let json = null;
          try {
            const response = await fetch(base + DATA_FILES.messages, { cache: "no-cache" });
            if (response.ok) json = await response.json();
          } catch {
            // Fila kan mangle; då spør vi Fjord1.
          }
          await refresh(json);
        }
        if (alive) poll();
      }, MESSAGES_POLL_MS);
    };
    refresh(loaded);
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [base, loaded, live, ready]);

  useEffect(() => {
    if (live && messages) cache?.write(messages);
  }, [live, messages, cache]);

  return live ? (messages ?? loaded) : loaded;
}
