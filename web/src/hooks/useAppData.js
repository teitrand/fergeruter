import { useEffect, useState } from "react";
import { emptyData } from "../model/context.js";
import { fetchAppData } from "../model/data.js";

/**
 * Lastar data/*.json éin gong. `initial` let testar og SSR gje fast data utan nett.
 * @returns {{ data: import("../model/context.js").AppData, status: "loading"|"ready"|"error" }}
 */
export function useAppData(base, initial = null) {
  const [state, setState] = useState(() =>
    initial ? { data: { ...emptyData(), ...initial }, status: "ready" } : { data: emptyData(), status: "loading" }
  );
  useEffect(() => {
    if (initial) return undefined;
    let cancelled = false;
    fetchAppData(fetch, base)
      .then((loaded) => {
        if (!cancelled) setState({ data: { ...emptyData(), ...loaded }, status: "ready" });
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) setState((prev) => ({ ...prev, status: "error" }));
      });
    return () => {
      cancelled = true;
    };
  }, [base, initial]);
  return state;
}
