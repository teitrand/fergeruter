import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const FJORD1_PDF =
  "https://www.fjord1.no/ruteoversikt/moere-og-romsdal/standal-trandal-valderoeya-store-kalvoey/(page)/pdf";

test("index.html lastar Plausible utan informasjonskapslar", () => {
  assert.match(html, /Privacy-friendly analytics by Plausible/);
  assert.match(html, /src="https:\/\/plausible\.io\/js\/pa-zLwKfsUV57HIZfM4j6wLS\.js"/);
  assert.match(html, /plausible\.init\(\)/);
  assert.doesNotMatch(html, /google-analytics|gtag\(|googletagmanager/i);
});

test("papirruta peikar på Fjord1 si PDF-fane, ikkje lokal fil", () => {
  assert.match(html, new RegExp(FJORD1_PDF.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(html, /href="ruter\.pdf"/);
  assert.doesNotMatch(html, /[?&]date=/);
});
