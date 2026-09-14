import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  FEEDBACK_MAIL,
  PWA_FIRST_KEY,
  appMode,
  feedbackMailto,
  highlightInstallHint,
  installHint,
  markPwaFirstOpen,
  plausibleContext,
  plausibleRoute,
  resetTestState,
  setTestState,
  track,
} from "../assets/app.js";
import { setLang } from "../assets/i18n.js?v=45";

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

test("sida har install-knapp og rettleiing når nettlesaren ikkje har eiga installering", () => {
  assert.match(html, /id="install-btn"/);
  assert.match(html, /id="install-dialog"/);
  assert.match(html, /data-install-hint="ios"/);
  assert.match(html, /data-install-hint="android"/);
  assert.match(html, /data-install-hint="desktop"/);
  assert.match(html, /id="install-close"/);
  assert.match(html, /SMS-om-trafikken/);
  assert.match(app, /beforeinstallprompt/);
  assert.match(app, /openInstallDialog/);
  assert.match(app, /how: "help"/);
  assert.match(app, /how: "native"/);
  const css = readFileSync(new URL("../assets/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.install-dialog/);
  assert.match(css, /\.install-steps\.is-likely/);
});

test("header har ikkje ferjegrafikk mellom kaiene", () => {
  assert.doesNotMatch(html, /fjord-track|fjord-ferry|ferje\.png|kai-venstre|kai-hogre/);
  assert.match(html, /id="lede-status"/);
  assert.match(html, /id="trip-filter"/);
});

test("sida har den dekorative stiplede streken øverst", () => {
  assert.match(html, /class="skyline"/);
  assert.match(html, /assets\/styles\.css\?v=45/);
  assert.match(html, /assets\/app\.js\?v=45/);
  assert.match(app, /from "\.\/i18n\.js\?v=45"/);
  const css = readFileSync(new URL("../assets/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.skyline\s*\{[^}]*repeating-linear-gradient/s);
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /\.messages-bar-excerpt\s*\{[^}]*width:\s*100%/s);
  assert.match(css, /\.messages-bar-body\s*\{[^}]*width:\s*100%/s);
  assert.doesNotMatch(css, /1\.05fr 0\.95fr/);
  assert.doesNotMatch(css, /@media \(min-width: 860px\)/);
  const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  assert.match(sw, /fergeruter-dev-v45/);
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
    "From ${value || \"all\"}",
    "To ${value || \"all\"}",
    "Swap direction",
    "Connection ${next || \"none\"}",
    "Messages ${btn.dataset.filter}",
    "Show past",
    "Hide past",
    "Show arrivals",
    "Hide arrivals",
    "Route ${next}",
    "Install app",
    "App installed",
    "PWA first open",
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

test("installHint kjenner att iOS, Android og desktop", () => {
  assert.equal(installHint({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }), "ios");
  assert.equal(
    installHint({ userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)" }),
    "ios"
  );
  assert.equal(
    installHint({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)", platform: "MacIntel", maxTouchPoints: 5 }),
    "ios"
  );
  assert.equal(
    installHint({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/128.0.0.0" }),
    "android"
  );
  assert.equal(
    installHint({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0" }),
    "desktop"
  );
  assert.equal(installHint(null), "desktop");
});

test("markPwaFirstOpen tel berre fyrste gong i PWA", () => {
  const storage = new MapStorage();
  assert.equal(markPwaFirstOpen(storage, "web"), false);
  assert.equal(storage.getItem(PWA_FIRST_KEY), null);
  assert.equal(markPwaFirstOpen(storage, "pwa"), true);
  assert.equal(storage.getItem(PWA_FIRST_KEY), "1");
  assert.equal(markPwaFirstOpen(storage, "pwa"), false);
});

test("highlightInstallHint merkar truleg plattform", () => {
  const previous = globalThis.document;
  const nodes = [
    { dataset: { installHint: "ios" }, classList: new FakeClassList(), attrs: {} },
    { dataset: { installHint: "android" }, classList: new FakeClassList(), attrs: {} },
    { dataset: { installHint: "desktop" }, classList: new FakeClassList(), attrs: {} },
  ];
  for (const node of nodes) {
    node.setAttribute = (name, value) => {
      node.attrs[name] = value;
    };
    node.removeAttribute = (name) => {
      delete node.attrs[name];
    };
  }
  globalThis.document = {
    querySelectorAll(sel) {
      assert.equal(sel, "[data-install-hint]");
      return nodes;
    },
  };
  try {
    assert.equal(highlightInstallHint("android"), "android");
    assert.equal(nodes[0].classList.has("is-likely"), false);
    assert.equal(nodes[1].classList.has("is-likely"), true);
    assert.equal(nodes[1].attrs["aria-current"], "true");
    assert.equal(nodes[2].attrs["aria-current"], undefined);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

class MapStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(key, String(value));
  }
}

class FakeClassList {
  constructor() {
    this.set = new Set();
  }
  toggle(name, force) {
    if (force) this.set.add(name);
    else this.set.delete(name);
  }
  has(name) {
    return this.set.has(name);
  }
}

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
