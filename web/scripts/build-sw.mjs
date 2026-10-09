// Lagar dist/sw.js for React-skalet frå vår eigen sw.js i rota (ikkje Workbox).
// Køyrer etter `vite build` (npm run build). Skalet registrerer han IKKJE enno:
// bytet til React-PWA er PR 6. Dette er førebuinga, så bytet blir eit lite steg.
//
// Endringar mot malen:
// - PRECACHE: filene i dist/ (hash-namn frå Vite) i staden for vanilla-lista med ?v=.
// - CACHE: «fergeruter-web-<hash>», så cachen aldri kolliderer med vanilla-appen
//   («fergeruter-v81»/«fergeruter-dev-v81») på same origin.
// - isOwnCache: ryddar berre i eigne «fergeruter-web-»-cachar, aldri i vanilla sine.
// Strategiane (nett først for meldingar og signallogg osv.) er uendra.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CACHE_LINE = /^const CACHE = .*;$/m;
const PRECACHE_BLOCK = /^const PRECACHE = \[[\s\S]*?^\];$/m;
const OWN_CACHE = /^function isOwnCache\(key\) \{[\s\S]*?^\}$/m;

/** Alle filer under `dir`, relativt og med «/», sortert. sw.js sjølv er ikkje med. */
export function listFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(dir, full).split(sep).join("/"));
    }
  };
  walk(dir);
  return out.filter((file) => file !== "sw.js").sort();
}

/** Kort hash av innhaldet i filene. Ny versjon når eitt byte i byggjet endrar seg. */
export function buildVersion(dir, files) {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update(readFileSync(join(dir, file)));
  }
  return hash.digest("hex").slice(0, 10);
}

/**
 * Gjer om sw.js-malen til service worker for skalet. Kastar feil om malen har endra
 * form, så byggjet stoppar i staden for å lage ein halvveges service worker.
 */
export function renderServiceWorker(template, { version, files }) {
  for (const [name, pattern] of [["CACHE", CACHE_LINE], ["PRECACHE", PRECACHE_BLOCK], ["isOwnCache", OWN_CACHE]]) {
    if (!pattern.test(template)) throw new Error(`Fann ikkje ${name} i sw.js-malen`);
  }
  const precache = ["./", ...files.map((file) => `./${file}`)];
  return template
    .replace(CACHE_LINE, `const CACHE = IS_DEV ? "fergeruter-web-dev-${version}" : "fergeruter-web-${version}";`)
    .replace(PRECACHE_BLOCK, `const PRECACHE = ${JSON.stringify(precache, null, 2)};`)
    .replace(
      OWN_CACHE,
      [
        "function isOwnCache(key) {",
        '  return IS_DEV ? key.startsWith("fergeruter-web-dev-") : /^fergeruter-web-(?!dev-)/.test(key);',
        "}",
      ].join("\n")
    );
}

function main() {
  const dist = fileURLToPath(new URL("../dist/", import.meta.url));
  const template = readFileSync(new URL("../../sw.js", import.meta.url), "utf8");
  const files = listFiles(dist);
  const version = buildVersion(dist, files);
  writeFileSync(join(dist, "sw.js"), renderServiceWorker(template, { version, files }));
  console.log(`dist/sw.js: fergeruter-web-${version}, ${files.length + 1} filer i precache`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
