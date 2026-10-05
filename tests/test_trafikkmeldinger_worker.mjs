import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import worker, {
  MESSAGES_API_URL,
  buildPayload,
  contentIdToMessageId,
  dispatchWorkflow,
  fetchMessages,
  handleRequest,
  nodeFromContent,
  runScheduled,
} from "../cloudflare/trafikkmeldinger/src/index.js";

const DISPATCH_URL =
  "https://api.github.com/repos/teitrand/fergeruter/actions/workflows/update-trafikkmeldinger.yml/dispatches";

function field(ident, value) {
  return { fieldDefinitionIdentifier: ident, fieldValue: value };
}

function content(id, { content2 = { xml: "<section>ikkje bruk</section>" } } = {}) {
  return {
    _id: id,
    CurrentVersion: {
      Version: {
        Fields: {
          field: [
            field("heading", "Standal-Trandal-Valderøya-Store Kalvøy"),
            field("county_number", 15),
            field("connection_number", 132),
            field("date", "24.08.2026 12:46:06"),
            field("content", "Rute 1136: normal drift."),
            field("content2", content2),
            field("important_message", false),
            field("valid_from", { timestamp: 1787568366 }),
            field("valid_to", { timestamp: 1787654704 }),
          ],
        },
      },
    },
  };
}

function view(hits, count = hits.length) {
  const searchHit = hits.length === 1 ? hits[0] : hits;
  return {
    View: {
      Result: {
        count,
        searchHits: { searchHit },
      },
    },
  };
}

function hit(id) {
  return { value: { Content: content(id) } };
}

test("id-formatet er det same som Python-skriptet", () => {
  assert.equal(contentIdToMessageId(21874418), "RG9tYWluQ29udGVudDoyMTg3NDQxOA==");
});

test("nodar hoppar over content2 og bruker plain content", () => {
  const node = nodeFromContent(content(21870001));
  assert.equal(node.id, contentIdToMessageId(21870001));
  assert.equal(node.content, "Rute 1136: normal drift.");
  assert.equal(node.connectionNumber, 132);
  assert.deepEqual(node.validFrom, { timestamp: 1787568366 });
  assert.equal(JSON.stringify(node).includes("ikkje bruk"), false);
});

test("hentinga bladrar og godtek éin treff som objekt", async () => {
  const calls = [];
  const messages = await fetchMessages({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const body = JSON.parse(init.body);
      const offset = body.ViewInput.Query.offset;
      assert.equal(body.ViewInput.Query.limit, 50);
      assert.equal(url, "https://www.fjord1.no/api/ezp/v2/views");
      const ids = [];
      for (let id = offset + 1; id <= Math.min(offset + 50, 51); id += 1) ids.push(id);
      return {
        ok: true,
        json: async () => view(ids.map(hit), 51),
      };
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(messages.length, 51);
  assert.equal(messages[50].id, contentIdToMessageId(51));
  assert.equal(calls.some((call) => String(call.url).includes("graphql")), false);
});

test("GET svarar JSON med CORS og bruker cachen", async () => {
  const store = new Map();
  let upstream = 0;
  const cache = {
    async match(request) {
      return store.get(request.url) || null;
    },
    async put(request, response) {
      store.set(request.url, response);
    },
  };
  const fetchImpl = async () => {
    upstream += 1;
    return { ok: true, json: async () => view([hit(7)]) };
  };
  const now = () => new Date("2026-10-05T12:00:00.000Z");
  const first = await handleRequest(new Request("https://fergeruter-trafikkmeldinger.teitrand.workers.dev/"), {
    fetchImpl,
    cache,
    now,
  });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("access-control-allow-origin"), "*");
  assert.equal(first.headers.get("cache-control"), "public, max-age=120");
  const payload = await first.json();
  assert.equal(payload.complete, true);
  assert.equal(payload.fetchedAt, "2026-10-05T12:00:00.000Z");
  assert.equal(payload.source, "https://www.fjord1.no/trafikkmeldingar");
  assert.equal(payload.messages.length, 1);
  assert.deepEqual(payload, buildPayload(payload.messages, payload.fetchedAt));

  const second = await handleRequest(
    new Request("https://fergeruter-trafikkmeldinger.teitrand.workers.dev/?t=1"),
    { fetchImpl, cache, now }
  );
  assert.equal(upstream, 1);
  assert.equal((await second.json()).messages[0].id, contentIdToMessageId(7));
});

test("feil frå Fjord1 blir 502 utan å bli lagra", async () => {
  const store = new Map();
  const cache = {
    async match(request) {
      return store.get(request.url) || null;
    },
    async put(request, response) {
      store.set(request.url, response);
    },
  };
  const response = await handleRequest(new Request("https://example.test/"), {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ ErrorMessage: { errorMessage: "nei" } }),
    }),
    cache,
  });
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match((await response.json()).error, /nei/);
  assert.equal(store.size, 0);
});

test("OPTIONS og POST", async () => {
  const options = await handleRequest(new Request("https://example.test/", { method: "OPTIONS" }), {
    fetchImpl: async () => {
      throw new Error("skal ikkje hente");
    },
  });
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("access-control-allow-origin"), "*");
  const post = await handleRequest(new Request("https://example.test/", { method: "POST" }));
  assert.equal(post.status, 405);
});

test("dispatch prøver om att og godtek 204", async () => {
  const calls = [];
  let n = 0;
  const logs = [];
  const ok = await dispatchWorkflow({
    token: "ghp_test",
    fetchImpl: async (url, init) => {
      n += 1;
      calls.push({ url, init });
      if (n < 3) return { status: 500, text: async () => "nei" };
      return { status: 204, text: async () => "" };
    },
    log: (line) => logs.push(line),
    sleep: async () => {},
  });
  assert.equal(ok, true);
  assert.equal(calls[0].url, DISPATCH_URL);
  assert.equal(calls[0].init.headers.Authorization, "Bearer ghp_test");
  assert.equal(calls[0].init.headers["User-Agent"], "fergeruter-trafikkmeldinger");
  assert.deepEqual(JSON.parse(calls[0].init.body), { ref: "main" });
  assert.equal(logs.join("\n").includes("ghp_test"), false);
});

test("manglande token hentar ikkje", async () => {
  let called = false;
  const logs = [];
  const ok = await dispatchWorkflow({
    token: "",
    fetchImpl: async () => {
      called = true;
      return { status: 204 };
    },
    log: (line) => logs.push(line),
  });
  assert.equal(ok, false);
  assert.equal(called, false);
  assert.match(logs.join("\n"), /npx wrangler secret put GITHUB_TOKEN/);
});

test("scheduled kastar når dispatch feilar", async () => {
  await assert.rejects(
    () => runScheduled({ cron: "*/10 * * * *" }, {}, { log: () => {}, sleep: async () => {} }),
    /update-trafikkmeldinger/
  );
  await assert.rejects(() => worker.scheduled({ cron: "*/10 * * * *" }, {}), /update-trafikkmeldinger/);
});

test("wrangler køyrer kvart 10. minutt og app.js bruker same URL", () => {
  const toml = readFileSync(new URL("../cloudflare/trafikkmeldinger/wrangler.toml", import.meta.url), "utf8");
  const app = readFileSync(new URL("../assets/app.js", import.meta.url), "utf8");
  assert.match(toml, /crons = \["\*\/10 \* \* \* \*"\]/);
  assert.equal(app.includes(MESSAGES_API_URL), true);
  assert.equal(app.includes("www.fjord1.no/graphql"), false);
  assert.equal(app.includes("FJORD1_GRAPHQL"), false);
});
