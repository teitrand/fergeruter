const REST_URL = "https://www.fjord1.no/api/ezp/v2/views";
const SOURCE_URL = "https://www.fjord1.no/trafikkmeldingar";
const DISPATCH_URL =
  "https://api.github.com/repos/teitrand/fergeruter/actions/workflows/update-trafikkmeldinger.yml/dispatches";
const PAGE_SIZE = 50;
const MAX_MESSAGES = 500;
const CACHE_SECONDS = 120;

/**
 * workers.dev-underdomenet blir valt på Cloudflare-kontoen.
 * `teitrand.workers.dev` løyste ikkje då dette blei skrive. Etter
 * `wrangler deploy`: om URL-en er ein annan, oppdater denne og same streng i
 * `assets/app.js`. Testen krev at dei er like.
 */
export const MESSAGES_API_URL = "https://fergeruter-trafikkmeldinger.teitrand.workers.dev/";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Accept, Content-Type",
  "Access-Control-Max-Age": "86400",
};

export function contentIdToMessageId(contentId) {
  return btoa(`DomainContent:${contentId}`);
}

export function asList(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function timestamp(value) {
  if (value && typeof value === "object" && Number.isInteger(value.timestamp)) {
    return value.timestamp;
  }
  return null;
}

export function nodeFromContent(content) {
  const version = (content.CurrentVersion || {}).Version || {};
  const fields = asList((version.Fields || {}).field);
  const values = {};
  for (const field of fields) {
    if (field && typeof field === "object" && field.fieldDefinitionIdentifier) {
      values[field.fieldDefinitionIdentifier] = field.fieldValue;
    }
  }
  const heading = values.heading || "";
  const text = values.content || "";
  const date = values.date || "";
  return {
    id: contentIdToMessageId(content._id),
    heading: typeof heading === "string" ? heading : String(heading),
    countyNumber: values.county_number ?? null,
    connectionNumber: values.connection_number ?? null,
    date: typeof date === "string" ? date : "",
    content: typeof text === "string" ? text : String(text),
    importantMessage: Boolean(values.important_message),
    validFrom: { timestamp: timestamp(values.valid_from) },
    validTo: { timestamp: timestamp(values.valid_to) },
  };
}

async function fetchViewPage(offset, fetchImpl) {
  const response = await fetchImpl(REST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/vnd.ez.api.ViewInput+json",
      Accept: "application/vnd.ez.api.View+json",
      "User-Agent": "Fergeorakelet/1.0 (+https://github.com/teitrand/fergeruter)",
    },
    body: JSON.stringify({
      ViewInput: {
        identifier: "trafikkmeldingar",
        Query: {
          Filter: { ContentTypeIdentifierCriterion: "traffic_message" },
          limit: PAGE_SIZE,
          offset,
        },
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Fjord1 REST svarte ${response.status}`);
  }
  const body = await response.json();
  if (body && body.ErrorMessage) {
    const message = body.ErrorMessage.errorMessage || body.ErrorMessage;
    throw new Error(`Fjord1 REST-feil: ${message}`);
  }
  const result = body && body.View && body.View.Result;
  if (!result || typeof result !== "object") {
    throw new Error("Uventa svar frå Fjord1 REST-viewet");
  }
  return result;
}

export async function fetchMessages({ fetchImpl = fetch } = {}) {
  let offset = 0;
  let total = null;
  const nodes = [];
  while (offset < MAX_MESSAGES) {
    const result = await fetchViewPage(offset, fetchImpl);
    if (total == null && Number.isInteger(result.count)) total = result.count;
    const hits = asList(result.searchHits && result.searchHits.searchHit);
    if (!hits.length) break;
    for (const hit of hits) {
      const content = hit && hit.value && hit.value.Content;
      if (!content || content._id == null) continue;
      nodes.push(nodeFromContent(content));
    }
    offset += hits.length;
    if (total != null && offset >= total) break;
    if (hits.length < PAGE_SIZE) break;
  }
  return nodes;
}

export function buildPayload(messages, fetchedAt = new Date().toISOString()) {
  return {
    source: SOURCE_URL,
    fetchedAt,
    complete: true,
    messages,
  };
}

function jsonResponse(body, status, cacheSeconds) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : "no-store",
    ...CORS,
  };
  return new Response(JSON.stringify(body), { status, headers });
}

export async function handleRequest(request, {
  fetchImpl = fetch,
  cache = null,
  waitUntil = (promise) => promise,
  now = () => new Date(),
} = {}) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== "GET") {
    return jsonResponse({ error: "Berre GET" }, 405, 0);
  }

  const url = new URL(request.url);
  const cacheKey = new Request(`${url.origin}/trafikkmeldinger.json`, { method: "GET" });
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  try {
    const messages = await fetchMessages({ fetchImpl });
    const response = jsonResponse(buildPayload(messages, now().toISOString()), 200, CACHE_SECONDS);
    if (cache) waitUntil(Promise.resolve(cache.put(cacheKey, response.clone())));
    return response;
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    return jsonResponse({ error: message }, 502, 0);
  }
}

export async function dispatchWorkflow({
  token,
  fetchImpl = fetch,
  log = console.log,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = 3,
} = {}) {
  if (!token) {
    log("Manglar GITHUB_TOKEN. Køyr: npx wrangler secret put GITHUB_TOKEN");
    return false;
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(DISPATCH_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "fergeruter-trafikkmeldinger",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "main" }),
      });
      if (response.status === 204) {
        log(`Starta update-trafikkmeldinger på main (forsøk ${attempt}).`);
        return true;
      }
      let detail = "";
      try {
        detail = typeof response.text === "function" ? await response.text() : "";
      } catch {
        detail = "";
      }
      log(`Dispatch svarte ${response.status} (forsøk ${attempt}). ${detail}`.trim());
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      log(`Dispatch feila (forsøk ${attempt}): ${message}`);
    }
    if (attempt < attempts) {
      await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
    }
  }
  return false;
}

export async function runScheduled(event, env, extras = {}) {
  const cron = event && event.cron ? event.cron : "";
  const log = extras.log || console.log;
  log(`Cron ${cron} startar oppdatering av trafikkmeldingar.`);
  const ok = await dispatchWorkflow({
    token: env && env.GITHUB_TOKEN,
    fetchImpl: extras.fetchImpl,
    log,
    sleep: extras.sleep,
  });
  if (!ok) {
    throw new Error("Fekk ikkje starta update-trafikkmeldinger.");
  }
}

export default {
  async fetch(request, env, ctx) {
    const cache = typeof caches !== "undefined" ? caches.default : null;
    return handleRequest(request, {
      cache,
      waitUntil: (promise) => (ctx && ctx.waitUntil ? ctx.waitUntil(promise) : promise),
    });
  },
  async scheduled(event, env) {
    await runScheduled(event, env);
  },
};
