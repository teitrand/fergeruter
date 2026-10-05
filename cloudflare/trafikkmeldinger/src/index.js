const REST_URL = "https://www.fjord1.no/api/ezp/v2/views";
const SOURCE_URL = "https://www.fjord1.no/trafikkmeldingar";
const PAGE_SIZE = 50;
const MAX_MESSAGES = 500;
const CACHE_SECONDS = 120;
export const ERROR_CACHE_SECONDS = 45;

/** Må vere lik FJORD1_MESSAGES_API i assets/app.js. Testen krev det. */
export const MESSAGES_API_URL = "https://fergeruter-trafikkmeldinger.fergeruter-teitrand.workers.dev/";

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
    const response = jsonResponse({ error: message }, 502, ERROR_CACHE_SECONDS);
    if (cache) waitUntil(Promise.resolve(cache.put(cacheKey, response.clone())));
    return response;
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
};
