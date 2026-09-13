import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  FEEDBACK_MAIL,
  appMode,
  feedbackMailto,
  plausibleContext,
  plausibleRoute,
  resetTestState,
  setTestState,
  track,
} from "../assets/app.js";
import { setLang } from "../assets/i18n.js?v=41";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../assets/app.js", import.meta.url), "utf8");

const FJORD1_PDF =
  "https://www.fjord1.no/ruteoversikt/moere-og-romsdal/standal-trandal-valderoeya-store-kalvoey/(page)/pdf";

test("index.html lastar Plausible utan informasjonskapslar", () => {
  assert.match(html, /Privacy-friendly analytics by Plausible/);
  assert.match(html, /src="https:\/\/plausible\.io\/js\/pa-zLwKfsUV57HIZfM4j6wLS\.js"/);
  assert.match(html, /plausible\.init\(/);
  assert.match(html, /customProperties/);
  assert.match(html, /transformRequest/);
  assert.match(html, /fergeruter-route-choice/);
  assert.match(html, /standal-trandal/);
  assert.match(html, /saebo-leknes/);
  assert.match(html, /\/dev\//);
  assert.doesNotMatch(html, /google-analytics|gtag\(|googletagmanager/i);
});

test("papirruta peikar på Fjord1 si PDF-fane, ikkje lokal fil", () => {
  assert.match(html, new RegExp(FJORD1_PDF.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(html, /href="ruter\.pdf"/);
  assert.doesNotMatch(html, /[?&]date=/);
});

test("sida har tilbakemeldingsdialog", () => {
  assert.match(html, /id="feedback-open"/);
  assert.match(html, /id="feedback-dialog"/);
  assert.match(html, /data-rating="yes"/);
  assert.match(html, /data-rating="no"/);
  assert.match(html, /id="feedback-comment"/);
  assert.match(html, /id="feedback-github"/);
  assert.match(html, /teitrand\/fergeruter\/issues\/new/);
});

test("header har ikkje ferjegrafikk mellom kaiene", () => {
  assert.doesNotMatch(html, /fjord-track|fjord-ferry|ferje\.png|kai-venstre|kai-hogre/);
  assert.match(html, /id="lede-status"/);
});

test("sida har den dekorative stiplede streken øverst", () => {
  assert.match(html, /class="skyline"/);
  assert.match(html, /assets\/styles\.css\?v=41/);
  assert.match(html, /assets\/app\.js\?v=41/);
  assert.match(app, /from "\.\/i18n\.js\?v=41"/);
  const css = readFileSync(new URL("../assets/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.skyline\s*\{[^}]*repeating-linear-gradient/s);
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /\.messages-bar-excerpt\s*\{[^}]*width:\s*100%/s);
  assert.match(css, /\.messages-bar-body\s*\{[^}]*width:\s*100%/s);
  assert.doesNotMatch(css, /1\.05fr 0\.95fr/);
  assert.doesNotMatch(css, /@media \(min-width: 860px\)/);
  const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  assert.match(sw, /fergeruter-dev-v41/);
  assert.match(sw, /function isTimetableJson/);
  assert.match(sw, /function isMessagesJson/);
  assert.match(sw, /staleWhileRevalidate\(request,\s*\{\s*notify: true/);
  assert.match(sw, /notifyType: "messages-updated"/);
  assert.match(sw, /event\.respondWith\(networkFirst\(request\)\)/);
});

test("appen sender namngjevne brukshendingar til Plausible", () => {
  const events = [
    "Visit ${getLang()}",
    "Visit pwa",
    "Language ${next}",
    "Day prev",
    "Day next",
    "Day today",
    "Stop ${option.value || \"all\"}",
    "Connection ${next || \"none\"}",
    "Messages ${btn.dataset.filter}",
    "Show past",
    "Hide past",
    "Show arrivals",
    "Hide arrivals",
    "Route ${next}",
    "Install app",
    "App installed",
    "Feedback yes",
    "Feedback no",
    "Feedback message",
  ];
  for (const event of events) {
    assert.match(app, new RegExp(event.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("track kallar plausible med namn og eigenskapar", () => {
  const calls = [];
  const previous = globalThis.window;
  globalThis.window = {
    plausible(name, opts) {
      calls.push({ name, opts });
    },
  };
  try {
    resetTestState();
    setLang("nn");
    track("Day next");
    track("Visit nn", null, { interactive: false });
    assert.equal(calls[0].name, "Day next");
    assert.deepEqual(calls[0].opts, {
      props: { lang: "nn", app: "web", route: "standal-trandal" },
    });
    assert.equal(calls[1].name, "Visit nn");
    assert.deepEqual(calls[1].opts, {
      props: { lang: "nn", app: "web", route: "standal-trandal" },
      interactive: false,
    });
    setTestState({ routeChoice: "1135" });
    track("Route 1135");
    assert.deepEqual(calls[2].opts.props, {
      lang: "nn",
      app: "web",
      route: "saebo-leknes",
    });
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

test("plausibleRoute er Standal–Trandal eller Sæbø–Leknes", () => {
  setLang("nn");
  assert.equal(plausibleRoute("1136"), "standal-trandal");
  assert.equal(plausibleRoute("1135"), "saebo-leknes");
  resetTestState();
  assert.equal(plausibleRoute(), "standal-trandal");
  setTestState({ routeChoice: "1135" });
  assert.deepEqual(plausibleContext({ foo: 1 }), {
    lang: "nn",
    app: "web",
    route: "saebo-leknes",
    foo: 1,
  });
});

test("track gjer ingenting utan plausible", () => {
  const previous = globalThis.window;
  globalThis.window = {};
  try {
    assert.doesNotThrow(() => track("Day next"));
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

test("appMode er web utan display-mode standalone", () => {
  assert.equal(appMode(), "web");
});

test("feedbackMailto kodar vurdering og kommentar", () => {
  setLang("nn");
  const url = feedbackMailto("yes", "Meir korrespondanse");
  assert.ok(url.startsWith(`mailto:${FEEDBACK_MAIL}?`));
  const decoded = decodeURIComponent(url);
  assert.match(decoded, /Tilbakemelding på Fergeruter 1136/);
  assert.match(decoded, /Ja, nyttig/);
  assert.match(decoded, /Meir korrespondanse/);
  assert.doesNotMatch(url, /Meir korrespondanse/);
  setLang("en");
  const en = decodeURIComponent(feedbackMailto("no", "Need Saturday"));
  assert.match(en, /Rating: No, something is missing/);
  assert.match(en, /Need Saturday/);
  setLang("nn");
});
