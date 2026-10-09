import { createContext, useContext } from "react";

/**
 * `track(name, props, opts)` for komponentar som sender hendingar sjølve (ringelenkjer,
 * installering, tilbakemelding). App gjev den ekte; utan App (testar) gjer han ingenting.
 */
export const TrackContext = createContext(() => {});

export function useTrack() {
  return useContext(TrackContext);
}
