/** Kvar skalet hentar data, og sjølve hentinga. */

export const DATA_FILES = {
  routes: "ruter.json",
  kombirute: "kombirute.json",
  messages: "trafikkmeldinger.json",
  signalLog: "signalturar.json",
  connections: "korrespondanse.json",
};

/**
 * Basen for data/*.json. Standard er `./data/` ved sida av skalet (vite dev serverar
 * data/ frå repoet, og byggjet legg ein kopi i dist/data/). Ved publisering (PR 6)
 * set ein VITE_DATA_BASE til dei levande filene.
 */
export function dataBase(env = {}) {
  const base = env.VITE_DATA_BASE || "./data/";
  return base.endsWith("/") ? base : `${base}/`;
}

async function getJson(fetchImpl, url, { required = false, cache } = {}) {
  try {
    const response = await fetchImpl(url, cache ? { cache } : undefined);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return await response.json();
  } catch (error) {
    if (required) throw error;
    return null;
  }
}

/**
 * Hentar rutetabell, kombirute, trafikkmeldingar, signallogg og korrespondanse parallelt.
 * Berre rutetabellen er påkravd; dei andre kan mangle utan at skalet stoppar.
 */
export async function fetchAppData(fetchImpl, base) {
  const [routes, kombirute, messages, signalLog, connections] = await Promise.all([
    getJson(fetchImpl, base + DATA_FILES.routes, { required: true }),
    getJson(fetchImpl, base + DATA_FILES.kombirute),
    getJson(fetchImpl, base + DATA_FILES.messages, { cache: "no-cache" }),
    getJson(fetchImpl, base + DATA_FILES.signalLog, { cache: "no-cache" }),
    getJson(fetchImpl, base + DATA_FILES.connections),
  ]);
  return {
    routes,
    kombirute,
    messages,
    signalLog: signalLog && typeof signalLog.days === "object" ? signalLog : null,
    connections: connections && Array.isArray(connections.lines) ? connections : null,
  };
}
