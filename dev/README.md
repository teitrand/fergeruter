# Fergeruter 1136

Statisk oversikt over **trafikkmeldingar frå Fjord1** og **seglingsplanen** for Hjørundfjorden. Til vanleg viser sida rute **1136** Standal–Trandal–Sæbø–Skår–Valderøya–Store Kalvøy. Når Fjord1 innstiller 1136 (eller innfører kombirute), byter sida tabell automatisk.

Sida viser heile dagen som ei samanhengande tidslinje med alle anløpa i rekkjefølgje, og ei **No**-linje som fortel om ferja ligg til kai eller er på veg. Posisjonen er i utgangspunktet rekna ut frå den aktive tabellen. Når Entur sender køyretøyposisjon for 1136 eller 1135, visest den som sanntid. Etter siste passasjertur (t.d. onsdag på Valderøya) reknar sida med at ferja går tilbake til Standal utan passasjerar og ligg der over natta — den turen står ikkje i Entur.

Rutetabellane for 1136 og 1135 blir lasta ned frå Entur og lagra i `data/ruter.json`. Dei blir berre henta på nytt når innhaldet faktisk er endra. Kombinasjonsruta ligg ikkje i Entur; ho er transkribert frå FRAM-PDF til `data/kombirute.json`. Trafikkmeldingar og rutetabell kjem frå lokale JSON-filer; nettlesaren kallar Entur berre for valfri køyretøyposisjon (CORS er open).

## Kjelder

- Trafikkmeldingar: [fjord1.no/trafikkmeldingar](https://www.fjord1.no/trafikkmeldingar) via Fjord1 sitt GraphQL-endepunkt
- Rutetabell 1136 og 1135: [Entur Journey Planner](https://developer.entur.org/), lagra i `data/ruter.json` (`lines.1136` og `lines.1135`). Kai **Lekneset** blir normalisert til **Leknes**.
- Kombinasjonsrute: [FRAM-PDF frå 18.11.25](https://frammr.no/_f/p2/i2e02cdba-2cdc-4a23-b9bf-f6a6bd437bbe/kombinasjonsrute-sabo-leknes-skar-trandal-standal-20251118.pdf), transkribert til `data/kombirute.json` (ikkje Entur).
- Sanntidsposisjon: [Entur SIRI VM](https://developer.entur.no/open-data/realtime) (`datasetId=MOR`, `LineRef=MOR:Line:1136` og `1135`) når ferja rapporterer. Små ferjer kan vere utan køyretøy i straumen, særleg utanom rutetid. I kombimodus brukast sanntid berre om Kvernes rapporterer; elles melding + tidslinje.
- AIS-kart: [NAIS / Kystverket](https://nais.kystverket.no/) for M/F Kvernes (MMSI 257297400). BarentsWatch sitt AIS-API er gratis under NLOD, men krev innlogging med klient-id og hemmelegheit, så det passar ikkje på ei statisk GitHub Pages-side.
- Papir-ruteplan 1136: [Fjord1 rute 1136 (PDF)](https://www.fjord1.no/ruteoversikt/moere-og-romsdal/standal-trandal-valderoeya-store-kalvoey/(page)/pdf)

## Tre tabellar og ruteval

| Modus | Tabell | Når |
| --- | --- | --- |
| `1136` | Entur 1136 | Normal drift, eller «normal drift» sjølv om teksten òg seier innstilt |
| `1135` | Entur 1135 Sæbø–Leknes | 1136 er innstilt, og det er ikkje kombirute |
| `kombi` | `data/kombirute.json` | Teksten har `kombinasjon` / `kombirute` / `kombinert rute`, eller både 1135 og 1136 er innstilt |

Nyaste **gyldige lokale** Fjord1-melding styrer valet. Banneret viser framleis Fjord1-teksten, pluss ei merknad og lenke til FRAM-PDF-en når kombiruta er aktiv.

Korrespondansar: Solavågen og Hundeidvika via Festøya→Standal som før. Når aktiv tabell har **Leknes** (kombirute eller 1135), kjem òg buss **133 Leknes–Øye**.

Fjord1 tillèt ikkje CORS frå nettlesaren, så meldingane blir henta av eit skript til `data/trafikkmeldinger.json`.

## Køyre lokalt

```bash
python3 scripts/fetch_trafikkmeldinger.py
python3 scripts/fetch_ruter.py
python3 -m http.server 8080
```

Opne [http://localhost:8080](http://localhost:8080). På localhost (og `/dev/`) kan du tvinge tabell med `?rute=kombi`, `?rute=1135` eller `?rute=1136`. På produksjon styrer berre ekte driftsmeldingar.

## Språk

Sida er på **nynorsk**, **engelsk** og **tysk**. Ho byter automatisk til språket i nettlesaren (norsk, engelsk eller tysk). Trykk på eit flagg øvst til høgre for å overstyre; det valet blir hugsa i nettlesaren.

Stadnamn og trafikkmeldingane frå Fjord1 står på originalspråket.

## Installerbar app (PWA)

Sida kan installerast på telefonen frå nettlesaren (Chrome: **Installer app**, Safari på iOS: Del → **Legg til på heimeskjerm**). Då opnast ho som ei eiga app utan adressefelt, og rutetabellen verkar òg utan nett.

Rutetabellen (~400 KB) blir lagra i nettlesaren. Ved oppdatering av sida visest den lagra tabellen med ein gong; i bakgrunnen sjekkar sida om FRAM har gjeve ut ny rute. **Trafikkmeldingar** og **sanntidsposisjon** blir henta på nytt kvar gong, fordi dei kan skifte raskt og styrer kva tabell som er i bruk og kor ferja er no.

**Google Play:** Ein PWA kan pakkast inn som Trusted Web Activity (t.d. med [PWABuilder](https://www.pwabuilder.com/) / Bubblewrap) og lastast opp til Play. Det er eige utgjevararbeid: Google Play-utviklarkonto, personvernerklæring, skjermbilete, innhaldsvurdering og Digital Asset Links på domenet. Sjølve koden her er klar for det; Play-butikken krev framleis den manuelle publiseringa.

## Produksjon og testhost

Produksjon er [teitrand.github.io/fergeruter](https://teitrand.github.io/fergeruter/) frå **`main`**. Testutgåva ligg på [teitrand.github.io/fergeruter/dev/](https://teitrand.github.io/fergeruter/dev/).

Pages kjem framleis frå `main` (legacy). Testhosten blir derfor kopiert inn som mappa `dev/` på `main` ved kvar push til greina `dev` (arbeidsflyta **Publiser testhost til /dev/**).

`github-pages`-miljøet tillèt berre `main`, så Actions-deploy frå `dev` feilar. Når de byter Pages til **GitHub Actions** (Settings → Pages → Source), kan `.github/workflows/pages.yml` køyrast frå `main` og publisere både rot og `/dev/` i same steg.

- **Alltid via `dev` før prod.** `dev` skal vere føre `main`. Feature-grein frå `dev` → PR mot `dev` → test på `/dev/` → først då merge `dev` → `main`. Ikkje opne feature-PR mot `main`.
- Service worker på `/dev/` har eige scope og eige cache-namn, så testinga ikkje stal cache frå prod
- Plausible tel ikkje på `/dev/` (same som localhost)
- Trafikkmelding-jobben køyrer framleis berre på `main`

## Oppdatering

- Trafikkmeldingar: kvart 5. minutt på `main` (tetteste GitHub Actions tillèt). Nettlesaren sjekkar fila **kvart minutt** mens sida er open, og med ein gong når fana blir synleg att, så innstilling og kombirute visest så snart den nye fila er ute.
- Rutetabell 1136+1135 og korrespondansar (inkl. 133): last ned att **berre når tabellen er endra**. Nettlesaren viser sist lagra tabell med ein gong og oppdaterer i bakgrunnen:

```bash
python3 scripts/fetch_ruter.py
python3 scripts/fetch_korrespondanse.py
```

eller køyr GitHub Action **Oppdater rutetabell** manuelt. Det er ingen dagleg/automatisk nedlasting mot Entur.

- Kombirute: når FRAM legg ut ny PDF, oppdater URL-en i `scripts/build_kombirute.py` og køyr:

```bash
python3 scripts/build_kombirute.py
```

Ikkje parse PDF automatisk i CI.

## Statistikk

Sida brukar [Plausible](https://plausible.io/) for å telje vitjingar og **kva folk faktisk trykkjer på**. Det er utan informasjonskapslar og utan personopplysningar. Lokal utvikling på `localhost` og testhosten `/dev/` blir ikkje telt.

I Plausible-panelet ser du:

- Vitjingar, kjelder og utgåande lenkjer (t.d. Fjord1 og NAIS)
- Språk og om sida er open i nettlesar eller som installert app (`lang` og `app` på kvar vitjing; krev eigenskapar/custom properties)
- Eigne hendingar for bruken av sida. Legg dei til som **mål (goals)** i Plausible (Site settings → Goals). Du kan òg la Plausible foreslå mål frå hendingar som allereie er sende inn.

| Hending | Når |
| --- | --- |
| `Visit nn` / `Visit en` / `Visit de` | Sidan lastar (anonymt, tel ikkje mot bounce) |
| `Visit pwa` | Sidan er open som installert app |
| `Language nn` / `en` / `de` | Nokon byter språk |
| `Day prev` / `Day next` / `Day today` | Blad i rutetabellen |
| `Stop all` / `Stop Standal` / … | Filter på stoppestad |
| `Connection none` / `solavagen` / `hundeidvika` | Korrespondanse |
| `Messages local` / `route` / `issues` | Filter på trafikkmeldingar |
| `Show past` / `Hide past` | Vis eller skjul tidlegare anløp |
| `Install app` / `App installed` | Installer-knappen, og når appen faktisk er lagt til |
| `Feedback yes` / `Feedback no` | Tommel opp/ned i tilbakemeldingsruta |
| `Feedback message` | Nokon sender ei skriftleg melding |

Sjølve meldingsteksten blir **ikkje** send til Plausible.

## Tilbakemelding

Nedst på sida ligg **Gje tilbakemelding**. Brukarane kan svare ja/nei (anonymt) og eventuelt skrive ei melding som opnar e-post til vedlikehaldaren, eller opne eit GitHub-issue.

## Testar

```bash
python3 -m unittest discover -s tests -v
node --test --test-concurrency=1 tests/test_status.mjs tests/test_i18n.mjs tests/test_plausible.mjs tests/test_route_mode.mjs tests/test_sw.mjs
```
