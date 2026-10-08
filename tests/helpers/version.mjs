import { readFileSync } from "node:fs";

/** Versjonen står i sw.js. Testane les han derifrå, så ein ny versjon krev ikkje at testane blir endra. */
export function appVersion() {
  const sw = readFileSync(new URL("../../sw.js", import.meta.url), "utf8");
  const match = sw.match(/"fergeruter-v(\d+)"/);
  if (!match) throw new Error("Fann ikkje fergeruter-vN i sw.js");
  return match[1];
}
