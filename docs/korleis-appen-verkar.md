# Korleis Fergeorakelet hentar, sjekkar og set saman informasjon

Dette dokumentet skal vere nok til å byggje appen opp att. Det skildrar kva kvar kjede er, kva som blir lagra, kva som blir rekna ut i nettlesaren, og kva som *ikkje* er bevis.

Klokka er alltid veggtid i `Europe/Oslo`. Datoar er `YYYY-MM-DD` i den sona. Avgangar i JSON er `HH:MM:SS`.

Appen heiter Fergeorakelet. Ho er ei statisk side på GitHub Pages. Det finst ingen eigen tenar. Alt som må hentast frå Entur eller Fjord1 anten blir skrive til JSON av GitHub Actions, eller blir henta rett frå nettlesaren der API-et har CORS.

## 1. Kva sida viser

To samband, éi ferje om gongen:

| Kode | Samband | Kjelde |
| --- | --- | --- |
| 1136 | Standal–Trandal–Sæbø–Skår, og nokre dagar Valderøya–Store Kalvøy | Entur `MOR:Line:1136`, lagra i `data/ruter.json` |
| 1135 | Sæbø–Leknes | Entur `MOR:Line:1135`, same fil |
| kombi | Sæbø–Leknes–Skår–Trandal–Standal som éi rute | Transkribert frå FRAM-PDF til `data/kombirute.json`. Ligg ikkje i Entur |

Kaien Lekneset hos Entur blir normalisert til Leknes.

Heimkai er fyrste `from` i dagen, i praksis Standal. Etter siste passasjertur reknar sida med at ferja går tom tilbake til Standal om det finst eit tilsvarande hol i tabellen. Den tomturen står ikkje i Entur.

Fartya som er namngjevne i meldingar og kombirute er M/F Geiranger (916 69 321) og M/F Kvernes (916 69 340, MMSI 257297400). Signaltur-telefonen i ruteheftet er 91 66 93 40.

## 2. Filer ein må ha

```
index.html              skalet, cache-bust ?v=
assets/app.js           all oppførsel
assets/i18n.js          nn, en, de
assets/styles.css
sw.js                   service worker
manifest.webmanifest
data/ruter.json         1136 og 1135
data/kombirute.json     kombinasjonsruta
data/korrespondanse.json
data/trafikkmeldinger.json
data/signalturar.json   sju dagar med bestilt / ikkje utført
scripts/fetch_ruter.py
scripts/fetch_korrespondanse.py
scripts/fetch_trafikkmeldinger.py
scripts/build_kombirute.py
scripts/log_signalturar.py
.github/workflows/      cron og deploy
tests/                  node:test og unittest
```

`?v=` på `app.js`, `i18n.js` og `styles.css` må vere det same talet i `index.html`, `sw.js` (både cache-namn `fergeruter-vN` / `fergeruter-dev-vN` og precache-URL-ar) og importen i `app.js`. Testane i `tests/test_sw.mjs` og `tests/test_plausible.mjs` låser talet. Når JS eller CSS endrar seg, auk talet i alle desse samstundes. Gamal service worker slepper elles ikkje den nye fila.

## 3. Skjema

### `data/ruter.json`

Skriven av `scripts/fetch_ruter.py`.

- `source`, `fetchedAt`
- `hjorundfjordQuays`: kaier der tur mot Valderøya/Store Kalvøy er tomflytting (fotnote 4)
- `lines["1136"]` og `lines["1135"]`: `lineId`, `publicCode`, `lineName`, `legs[]`

Kvart bein:

| Felt | Meining |
| --- | --- |
| `id` | `MOR:ServiceJourney:…#0`. Same id blir brukt att kvar dag ruta går. `#0` blir strippa før samanlikning |
| `from`, `to` | Kai utan «ferjekai» / «kai» |
| `departure`, `arrival` | `HH:MM:SS` |
| `activeDates` | Datoane beinet gjeld. Filtrering er medlemskap, ikkje vekedag |
| `signal` | `null`, eller `{ minutesBefore, text, phone }` |
| `notices` | Fritekst frå Entur |
| `requestStop` | Entur sitt flagg. Signaltur i denne appen kjem frå PDF-lista under, ikkje frå dette flagget åleine |

Signaltur blir sett av `PDF_SIGNAL_1136` i `fetch_ruter.py`, fotnote 1) og 3) i FRAM-PDF for 1136 (17.08.26). Nøkkelen er daggruppe (`mtthf`, `wednesday`, `saturday`, `sunday`), frå-kai og avgang `HHMM`. 1) er 60 minutt, 3) er 180. Telefonen er 91 66 93 40. Eit bein som ikkje står i den lista er ikkje signaltur, sjølv om Entur-notisen seier noko anna. Standal 07:40 er vanleg rute; Trandal 08:00 laurdag på same omløp kan vere signal.

### `data/kombirute.json`

Skriven av `scripts/build_kombirute.py` frå ein hardkoda transkripsjon av FRAM-PDF (per no 18.11.25). Ikkje parse PDF i CI. Ved ny PDF: oppdater kjelde-URL og transkripsjonen, køyr skriptet, sjå at testane i `tests/test_kombirute.py` stemmer.

- `crossingMinutes`: overfartstid per par, t.d. `"Sæbø–Leknes": 15`
- `legs[]` har `days` (`weekday`, `saturday`, `sunday`, …) i staden for `activeDates`
- `signal` er ofte `null` på kombibeina. PDF-notisen er «berre på signal seinast 1 time før», men loggen i `signalturar.json` tek berre bein frå `ruter.json` som har `signal` og `activeDates`

Neste fylte celle i PDF-en er neste stopp. Ankomst = avgang + overfartstid. Éi ferje, éi samanhengande rute. Overlappande signalturar i PDF-en (Skår og Leknes samstundes) er ikkje tomflytting.

### `data/korrespondanse.json`

Skriven av `scripts/fetch_korrespondanse.py` frå Entur.

- Solavågen og Hundeidvika via Festøya–Standal (samband 1049 er vegen ut av fjorden, men styrer ikkje 1136-tabellen)
- Buss 133 Leknes–Øye blir vist når aktiv tabell har Leknes (1135 eller kombi)

### `data/trafikkmeldinger.json`

Skriven av `scripts/fetch_trafikkmeldinger.py` frå Fjord1 sitt Ibexa-view `https://www.fjord1.no/api/ezp/v2/views`. GraphQL på `www.fjord1.no/graphql` svarar 404. Sida `https://www.fjord1.no/trafikkmeldingar` er menneske-kjelda.

Melding:

| Felt | Meining |
| --- | --- |
| `id` | Fjord1-id, eller `live:` + hash når ho kjem frå nettlesaren |
| `heading`, `text` | Originalspråk, ikkje omsett |
| `publishedAt`, `validFrom`, `validTo` | ISO |
| `connectionNumber` | 132 er 1136, 134 er 1135 |
| `isLocal` | Treff på 1136/1135/1049 eller stadnamn i Hjørundfjorden / Festøya |
| `routeMode` | `1136`, `1135` eller `kombi`, sjå avsnitt 6 |
| `isRouteControl` | Om meldinga får lov å byte tabell |
| `kind` | `cancelled`, `delay`, `normal`, `capacity`, `info` |

Jobben køyrer kvart 5. minutt på `main` (`.github/workflows/update-trafikkmeldinger.yml`) og committer berre når innhaldet er endra. `dev` skal ikkje overskrive denne fila. Testhosten les produksjonsfila.

### `data/signalturar.json`

Skriven av `scripts/log_signalturar.py` kvart 30. minutt, cron `*/30 4-21 * * *` i UTC (06:00–23:30 norsk sommertid), berre på `main`. Workflow: `.github/workflows/log-signalturar.yml`.

```json
{
  "keptDays": 7,
  "updatedAt": "2026-10-02T01:17:20+02:00",
  "days": {
    "2026-10-01": [
      {
        "id": "MOR:ServiceJourney:1136_102_9150000047474169",
        "from": "Standal",
        "to": "Trandal",
        "departure": "06:45:00",
        "status": "booked"
      }
    ]
  }
}
```

`status` er `booked` eller `skipped`. `observedAt` er når loggen fyrst skreiv statusen, ikkje når nokon ringde. `skippedAt` kjem om ein tur som var `booked` seinare blir avlyst. Sju dagar medrekna i dag. Eldre datoar blir sletta. Ein tur som først er `skipped` blir aldri skriven om til `booked`. `booked` kan bli `skipped` om eit seinare svar viser avlysing. `observedAt` blir ståande.

Entur har berre driftsdagen. Dagar før loggen starta kan ikkje fyllast inn. Første observasjon som betyr noko er etter tingefristen, og berre om turen faktisk ligg i `estimatedCalls`. At turen manglar i feeden er ikkje bevis på at ho var bestilt (avlysinga dett ut etter ei stund, og fullførte turar dett òg ut).

## 4. Entur: rutetabell

`fetch_ruter.py` spør `https://api.entur.io/journey-planner/v3/graphql` med header `ET-Client-Name: teitrand-fergeruter`.

Spørjinga hentar `line(id)` for `MOR:Line:1136` og `MOR:Line:1135`: service journeys, kall, kai, tid, notisar. Skriptet

1. strippar «ferjekai» / «kai» og byter Lekneset → Leknes
2. merkar signal berre når frå-kai, klokkeslett og daggruppe står i `PDF_SIGNAL_1136`
3. legg `activeDates` frå kalenderen til journeyen
4. skriv fila berre som ein heil erstatning

Køyr manuelt, eller workflow **Oppdater rutetabell** (`workflow_dispatch`). Ingen dagleg cron. Nettlesaren les fila. Han spør ikkje Journey Planner for sjølve tabellen.

Korrespondanse blir henta i same workflow av `fetch_korrespondanse.py`.

## 5. Entur: sanntid (SIRI VM)

Nettlesaren, berre medan fana er synleg og klokka er innanfor rutevindauget ± 30 minutt:

```
https://api.entur.io/realtime/v1/rest/vm?datasetId=MOR&LineRef=MOR:Line:1136
https://api.entur.io/realtime/v1/rest/vm?datasetId=MOR&LineRef=MOR:Line:1135
```

1136 blir spurd fyrst. 1135 berre om 1136 ikkje gav fersk posisjon. I kombimodus blir sanntid brukt berre om Kvernes rapporterer.

Eit svar er ferskt i 3 minutt (`LIVE_MAX_AGE_MS`). Poll kvart 55. sekund. Feil doblar backoff frå 1 minutt opp til 15. Skjult fane hentar ikkje.

Frå VehicleActivity blir det trekt ut: `journeyRef`, destinasjon (lista blir kutta til neste kjende kai), forseinking (`PT…` eller sekund), posisjon, `atStop`, stoppnamn, `originAimed`, faktisk avgang.

Posisjon nærare enn 250 m frå kai-koordinata i `QUAY_COORDS` reknast som liggjande ved den kaia. Koordinata (0,0) blir forkasta.

`leftOrigin`:

- faktisk avgangstid → har lagt frå
- `atStop` på startkaien → ligg
- `atStop` på ein annan kai, eller meir enn 250 m frå startkaien → har lagt frå
- elles ukjent

Forseinking blir lagt på vanleg rute, og på signaltur berre når ferja faktisk har lagt frå kai. Ein signaltur som ikkje går skal ikkje få «40 min forsinka».

Små ferjer manglar ofte i VM, særleg utanom rutetid. Då gjeld tabellklokka.

## 6. Fjord1: trafikkmeldingar og kva tabell som gjeld

### Innhenting

1. GitHub Actions skriv `data/trafikkmeldinger.json` på `main`.
2. Nettlesaren hentar fila kvart 3. minutt (`cache: no-cache`). Testhost `/dev/` hentar produksjons-URL (`…/fergeruter/data/trafikkmeldinger.json`), ikkje kopien under `/dev/`.
3. Er `fetchedAt` eldre enn 8 minutt, spør nettlesaren Fjord1 direkte. GraphQL på `www.fjord1.no/graphql` har ikkje CORS frå `teitrand.github.io`. Då blir HTML-sida `https://www.fjord1.no/trafikkmeldingar` lese via `https://r.jina.ai/`. Nye meldingar blir fletta inn på `heading|text` og får id `live:…`. Dei blir òg lagra i `localStorage` (`fergeruter-messages-v1`) slik at kombirute kan visast før nettverket svarar. Actions-jobben bruker ikkje den vegen. Han les Ibexa REST-viewet, fordi GraphQL-endepunktet svarar 404 for den jobben.

### Klassifisering av tekst

Same uttrykk i Python og JS:

| Treff | `kind` / modus |
| --- | --- |
| `innstilt` og `normal drift`, utan kombi | `normal` / tabell 1136. «Normal drift» vinn over eit laust «innstilt» |
| `kombinasjon`, `kombirute`, `kombinert rute`, eller både 1135 og 1136 innstilt | `kombi` |
| 1136 innstilt, ikkje 1135, og teksten er ikkje berre eit utval av avgangar | heile tabellen blir 1135 |
| utval (`følgjande avgangar`, `avgangar innstilt`, `avgang kl.`) | blir på 1136, og dei nemnde avgangane blir merkte innstilte |
| berre 1049 / Festøya / Hundeidvika | styrer ikkje tabellen |
| `forsink` | `delay` |
| `kapasitet`, `farleg last` (òg skrivefeilen kapasitet) | `capacity` |

Nyaste gyldige lokale melding styrer. Gyldigheit som er «heile døgnet» hos Fjord1 blir halden ut Oslo-dagen. Tekst som seier «òg på laurdag» kan halde kombirute etter CMS-`validTo`. Datoar i teksten (òg nynorsk vekedag) avgrensar vindauget. «Normal drift frå klokka HH:MM» byter tilbake same dag, ikkje dagen før.

`?rute=1136|1135|kombi` og `?frå=` verkar berre på localhost og `/dev/`. Produksjon ignorerer dei.

Ved normal drift vel brukaren 1136 eller 1135. Valet ligg i `localStorage` (`fergeruter-route-choice`). Når meldinga tvingar 1135 eller kombi, visest den tabellen i begge sambanda.

Enkilde avgangar som er innstilte i teksten blir `fra-kai|HH:MM:SS` i eit sett. Dei får raud «Innstilt» og blir tekne ut av «kvar er ferja».

## 7. Entur: avlysing og om ein signaltur er bestilt

Entur har ikkje eit felt «bestilt». Det som finst er `cancellation: true` på `estimatedCalls` i Journey Planner, og nokre gonger ein kort SIRI-SX-tekst «Bestilling ikke mottatt». SX-teksten gjeld berre i tidsvindauget til turen og blir ikkje brukt som kjelde. Avlysinga i GraphQL varer lenger, men dett òg ut. Situasjons-id i SX og ET er ikkje dei same og skal ikkje koplast.

Nettlesaren spør, samstundes med VM:

```
query Cancelled($start: DateTime!) {
  s0: stopPlace(id: "NSR:StopPlace:…") {
    estimatedCalls(
      startTime: $start
      timeRange: 86400
      numberOfDepartures: 40
      includeCancelledTrips: true
      whiteListed: { lines: ["MOR:Line:1136", "MOR:Line:1135"] }
    ) { cancellation serviceJourney { id } }
  }
}
```

`$start` er midnatt i Oslo for i dag. Stoppa er frå-kaiane på dagens bein som finst i `STOP_PLACES` (Standal 39713, Trandal 58521, Sæbø 58765, Skår 41385, Leknes 58766, Valderøya 61752, Store Kalvøy 58525).

To mengder blir lagra:

- `cancelledJourneys`: `cancellation: true`
- `seenJourneys`: alle id-ar i svaret

Service journey-id blir brukt på fleire datoar. Avlysingsmengda gjeld berre i dag. Ein vanleg tur som er avlyst i dag får «Innstilt». Ein signaltur som er avlyst får «Ikkje utført», ikkje «Innstilt». Avlyste bein blir tekne ut av `runningLegs`, så «No»-linja ikkje seier at ferja er på veg på ein tur som ikkje går.

### Når etiketten er «Bestilt signaltur»

Grøn etikett (`signal.booked`, CSS `--ok` / `.stop-tag-booked`). Før fristen står det alltid «På signal» med `tel:` til 91 66 93 40.

For **i dag**, etter fristen (`avgang − minutesBefore`):

1. Loggen seier `skipped` → ikkje bestilt.
2. Sanntid seier at denne turen ikkje la frå kai, eller at ein seinare tur er den som blir køyrd, → ikkje bestilt («Ikkje utført»).
3. Loggen seier `booked` → bestilt.
4. Siste Entur-svar er frå i dag, turen er ikkje avlyst, og svaret kom etter fristen:
   - turen låg i svaret (`seenJourneys`) → bestilt. Id-en blir hugsa i `confirmedBooked` ut økta.
   - turen var hugsa slik tidlegare i økta → bestilt, òg om eit seinare svar ikkje lenger har kallet.
   - ankomst er passert og ingen av punkta over stemmer → **ikkje** bestilt. Då står «På signal». Mangelen på avlysing etter at kallet har dette ut er ikkje bevis.
   - ankomst er ikkje passert → bestilt. Fram til ankomst er «ikkje i avlyst-lista etter fristen» nok, fordi turen enno skal liggje i feeden.

Eit trykk på avgangen opnar eit vindauge. Der står korleis signalturen verkar, telefonnummeret, og om vi reknar turen som bestilt. Teksten seier at Entur ikkje oppgjev når bestillinga kom inn, berre at turen ikkje var avlyst etter fristen. Om loggen har `observedAt`, visest det tidspunktet som «vi registrerte det fyrste gong». Vindauget seier òg at den som tinga kan gjere om, og at Entur då kan avlyse, så ein bør ringje sjølv om ein vil vere sikker.

Dette er grunnen til at 06:45 fredag 2. oktober stod som «På signal» / «Gått» medan 07:05 stod som «Bestilt signaltur». 07:05 hadde ikkje komme fram enno, så regelen før ankomst trekte. 06:45 hadde ankomst 07:00, loggen for 2. oktober var tom (cron hadde ikkje skrive morgonturen enno), og den gamle regelen kravde logg etter ankomst. No held økta på merkelappen når Entur har synt turen utan avlysing etter fristen.

For **ein annan dag** finst ikkje dagens avlysingsmengd. Berre loggen: `booked` → grøn etikett og «Gått», `skipped` → «Ikkje utført», ingenting → «På signal» utan påstand om at turen gjekk.

### Når «No»-linja seier at signalturen går

`signalVerdict`:

- annan dag: `skipped` berre om loggen seier det
- i dag, fersk posisjon, same tur, har lagt frå kai → `running` (òg om Entur har avlyst, dersom båten faktisk gjekk)
- avlyst i dag, eller logg `skipped`, og posisjonen ikkje viser avgang → `skipped`
- etter avgangstid, fersk posisjon, framleis på startkaien → `skipped`
- ein seinare tur er den VM følgjer → denne signalturen er `skipped`, med mindre ho alt er sett som bestilt (loggen, eller ho låg i feeden utan avlysing etter fristen). Returen 07:05 skal ikkje gjere utturen 06:45 om til «Ikkje utført»
- elles ingen dom. Då gjeld tabellklokka

`sailingDoneAt`: ein `skipped` signaltur i dag er ferdig ved avgangstid, så han dett ut av den synlege lista når «tidlegare avgangar» er skjult.

## 8. Korleis «No» blir rekna ut

`currentStatus`:

1. `ferryStatus` på `runningLegs` (utan innstilte og utan avlyste).
2. Før fyrste avgang: ligg på frå-kaia.
3. Mellom avgang og ankomst: «på veg mot {kai}». Framdrift er lineær mellom klokkesletta.
4. Mellom ankomst og neste avgang på same kai: «ligg til kai». Opphald på minst 20 minutt er liggetid (matpause), med eigen tekst.
5. Mellom ankomst og neste avgang på ein annan kai, og tabellen ikkje er kombi: tomflytting.
6. Etter siste ankomst: ferdig på den kaia om det er heimkai eller kombi. Elles tomtur heim i det kortaste holet tabellen har mellom dei kaiane, deretter «ferdig på Standal».
7. Om VM er fersk: signaltur som har lagt frå kai overstyrer med destinasjon og forseinking. Signaltur som ikkje har lagt frå kai overstyrer med «ikkje utført». Vanleg rute får forseinking lagt på tabellteksten.

Filtra frå/til endrar kva rader som visest, ikkje kvar ferja er. Reise med mellomstopp følgjer same ferje. Skår→Standal går via Sæbø/Trandal. Leknes→Standal i vanleg rute byter ferje på Sæbø og får ventetid. Korrespondanse blir merkt på avgang og ankomst, ikkje som eigne rader.

## 9. Nettlesaren

Oppstart i `assets/app.js`:

1. språk (`fergeruter-lang-chosen`, elles `navigator.languages`; `no`/`nb`/`nn` → nynorsk)
2. service worker
3. `loadMessages`, `loadRoutes`, `loadSignalLog`
4. minutt-tikk som oppdaterer nedteljing og sanntid

Rutetabellen blir òg lesen frå `localStorage` (`fergeruter-timetable-v1`) med ein gong, så sida verkar utan nett. Fingeravtrykket ignorerer `fetchedAt` på meldingar, men ser innhaldet.

Service worker (`sw.js`):

| Filer | Strategi |
| --- | --- |
| `ruter.json`, `kombirute.json`, `korrespondanse.json` | stale-while-revalidate, varslar klienten om tabellen er ny |
| `trafikkmeldinger.json` | network-first, varslar `messages-updated` |
| `signalturar.json` | network-first, utan varsel |
| html, css, js | network-first |
| resten | stale-while-revalidate |

Cache-nøkkelen for `/data/` droppar `?t=`. `/dev/` har eige cachenamn `fergeruter-dev-vN`, så testhosten ikkje skriv over produksjon.

Plausible blir ikkje lasta på localhost eller `/dev/`. Hendingar og eigenskapar står i README. Ingen informasjonskapslar.

Tilbakemelding går til `mailto:teitrand@hotmail.com` og GitHub Issues. Det blir ikkje lagra i appen.

PWA: `manifest.webmanifest`, installer-knapp, rettleiing der nettlesaren ikkje har `beforeinstallprompt`. Ingen push. Det krev tenar.

## 10. Deploy

`main` er produksjon: https://teitrand.github.io/fergeruter/

`dev` er testhost: https://teitrand.github.io/fergeruter/dev/

Pages-miljøet godtek berre `main`. Derfor:

1. Feature-grein frå `dev`. PR mot `dev`. Aldri feature-PR mot `main`.
2. Workflow **Publiser testhost til /dev/** kopierer `dev` inn som mappa `dev/` på `main` (`rsync`, utan `.git`, `.github` og `dev`).
3. Når testhosten er grei: kopier rotfilene frå `dev` til `main` (index, assets, scripts, tests, workflows, nye datafiler). Ikkje merg `main` inn i `dev`. `main` inneheld `dev/`-mappa, og ein merge ville lagt den mappa inn på `dev`.
4. Ikkje kopier `data/trafikkmeldinger.json` frå `dev` til `main`. Produksjon si fil er nyare, fordi jobben berre skriv på `main`. Det same gjeld `data/signalturar.json` etter at loggen har begynt å gå: ta med fila fyrste gong ho blir innført, og la jobben på `main` eige ho etterpå.

`pages.yml` kan setje saman både rot og `/dev/` om Pages blir bytt til GitHub Actions. Til dess publiserer GitHub si innebygde Pages-kjelde frå `main`, og `dev/`-mappa er testhosten.

## 11. Testar

CI (`.github/workflows/test.yml`) på kvar push og PR:

```bash
python -m unittest discover -s tests -v
node --test --test-concurrency=1 \
  tests/test_status.mjs tests/test_i18n.mjs tests/test_plausible.mjs \
  tests/test_route_mode.mjs tests/test_sw.mjs
```

Python-testar lastar skript med `importlib` frå filsti. `unittest discover` har `tests/` på `sys.path`, så `import scripts.…` verkar ikkje.

Det som må halde:

- Tabellbyte frå meldingstekst, inkludert delvis innstilling, nynorsk dato, og at 1049 ikkje styrer 1136
- Signaltur som ligg til kai etter avgang er ikkje utført. Signaltur som har lagt frå kai er på veg, med forseinking
- Avlyst kveldssignaltur 20:00/20:20 gjer ikkje «på veg mot Standal» når ferja ligg der
- Etter fristen og eit Entur-svar utan avlysing: bestilt. Før fristen, eller utan svar: ikkje bestilt
- Etter ankomst: bestilt berre om loggen seier det, eller turen var sett i feeden etter fristen
- Logg `skipped` blir ikkje bestilt att, heller ikkje om Entur har gløymt avlysinga
- Loggen viser bestilt og ikkje utført på ein tidlegare dato
- Kombirute-transkripsjonen stemmer med byggaren
- Cache-versjonen i SW, HTML og JS er den same

## 12. Byggje opp att

1. Statisk `index.html` som lastar `assets/app.js?v=N` som modul og `assets/i18n.js`.
2. Legg inn dei tre tabellfilene. Køyr `fetch_ruter.py` og `fetch_korrespondanse.py` mot Entur med `ET-Client-Name`. Bygg kombirute frå PDF-transkripsjonen, ikkje frå Entur.
3. Implementer Oslo-klokke, `activeDates` / `days`, og `ferryStatus` som i avsnitt 8.
4. Hent Fjord1 til JSON. Klassifiser med uttrykka i avsnitt 6. La nyaste lokale melding velje 1136, 1135 eller kombi. Delvis innstilling merkar rader, ho byter ikkje tabell.
5. Poll SIRI VM i rutevindauget. Stol på posisjon berre i 3 minutt. Rekn avgang frå `leftOrigin`.
6. Poll GraphQL-avlysingar for dagen. Ta avlyste bein ut av posisjonsrekninga. Signaltur som er avlyst er «Ikkje utført».
7. Etter tingefristen: grøn «Bestilt signaltur» berre etter reglane i avsnitt 7. Hugs sett tur ut økta. Ikkje gjett bestilt etter ankomst berre fordi kallet manglar.
8. Cron på `main` som skriv `signalturar.json` i sju dagar. `skipped` er sticky. Turar som ikkje er i feeden blir ikkje logga.
9. Service worker som i avsnitt 9, med eige cachenamn på `/dev/`.
10. Sjekk med testane i avsnitt 11 før produksjon. Slepp via `dev`, ikkje med feature-PR mot `main`.
