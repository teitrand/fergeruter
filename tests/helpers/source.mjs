import { readdirSync, readFileSync } from "node:fs";

const CORE_DIR = new URL("../../packages/core/", import.meta.url);

/** Kjeldekoden til packages/core samla, for testar som leitar etter tekst i koden til appen. */
export function coreSource() {
  return readdirSync(CORE_DIR)
    .filter((name) => name.endsWith(".js"))
    .sort()
    .map((name) => readFileSync(new URL(name, CORE_DIR), "utf8"))
    .join("\n");
}

/** Filnamna i packages/core, til dømes for å sjekke at service workeren lagrar alle. */
export function coreFiles() {
  return readdirSync(CORE_DIR).filter((name) => name.endsWith(".js")).sort();
}
