# Fergeruter 1136

Statisk oversikt over **trafikkmeldingar frå Fjord1** og **seilingsplanen** for rute 1136 Standal–Trandal–Sæbø–Skår–Valderøya–Store Kalvøy.

Sida viser heile dagen som ei samanhengande tidslinje med alle anløpa i rekkjefølgje, og ei **Nå**-linje som fortel om ferja ligg til kai eller er på veg. Posisjonen er i utgangspunktet rekna ut frå rutetabellen. Når Entur sender køyretøyposisjon for rute 1136, visest den som sanntid. Etter siste passasjertur (t.d. onsdag på Valderøya) reknar sida med at ferja går tilbake til Standal utan passasjerar og ligg der over natta — den turen står ikkje i Entur.

Rutetabellen blir lasta ned frå Entur og lagra i `data/ruter.json`. Han blir berre henta på nytt når innhaldet faktisk er endra. Trafikkmeldingar og rutetabell kjem frå lokale JSON-filer; nettlesaren kallar Entur berre for valfri køyretøyposisjon (CORS er open).

## Kjelder

- Trafikkmeldingar: [fjord1.no/trafikkmeldingar](https://www.fjord1.no/trafikkmeldingar) via Fjord1 sitt GraphQL-endepunkt
- Rutetabell: [Entur Journey Planner](https://developer.entur.org/), lagra i `data/ruter.json`
- Sanntidsposisjon: [Entur SIRI VM](https://developer.entur.no/open-data/realtime) (`datasetId=MOR`, `LineRef=MOR:Line:1136`) når ferja rapporterer. Små ferjer som 1136 kan vere utan køyretøy i straumen, særleg utanom rutetid.
- AIS-kart: [NAIS / Kystverket](https://nais.kystverket.no/) for M/F Kvernes (MMSI 257297400). BarentsWatch sitt AIS-API er gratis under NLOD, men krev innlogging med klient-id og hemmelegheit, så det passar ikkje på ei statisk GitHub Pages-side.
- Papir-ruteplan: [`ruter.pdf`](ruter.pdf)

Fjord1 tillèt ikkje CORS frå nettlesaren, så meldingane blir henta av eit skript til `data/trafikkmeldinger.json`.

## Køyre lokalt

```bash
python3 scripts/fetch_trafikkmeldinger.py
python3 scripts/fetch_ruter.py
python3 -m http.server 8080
```

Opne [http://localhost:8080](http://localhost:8080).

## Språk

Sida er på **nynorsk**, **engelsk** og **tysk**. Vel språk øvst til høgre; valet blir hugsa i nettlesaren. Fyrste gongen gjettar sida ut frå språket i nettlesaren (tysk og engelsk), elles nynorsk.

Stadnamn og trafikkmeldingane frå Fjord1 står på originalspråket.

## Installerbar app (PWA)

Sida kan installerast på telefonen frå nettlesaren (Chrome: **Installer app**, Safari på iOS: Del → **Legg til på heimeskjerm**). Då opnast ho som ei eiga app utan adressefelt, og rutetabellen verkar òg utan nett.

**Google Play:** Ein PWA kan pakkast inn som Trusted Web Activity (t.d. med [PWABuilder](https://www.pwabuilder.com/) / Bubblewrap) og lastast opp til Play. Det er eige utgjevararbeid: Google Play-utviklarkonto, personvernerklæring, skjermbilete, innhaldsvurdering og Digital Asset Links på domenet. Sjølve koden her er klar for det; Play-butikken krev framleis den manuelle publiseringa.

## Oppdatering

- Trafikkmeldingar: kvart 15. minutt på `main`
- Rutetabell: last ned att **berre når tabellen er endra**:

```bash
python3 scripts/fetch_ruter.py
```

eller køyr GitHub Action **Oppdater rutetabell** manuelt. Det er ingen dagleg/automatisk nedlasting mot Entur.

## Testar

```bash
python3 -m unittest discover -s tests -v
node --test --test-concurrency=1 tests/test_status.mjs tests/test_i18n.mjs
```

## GitHub Pages

Sidefilene ligg i rota, så Pages kan servere dei direkte frå `main`. Dette må stillast inn éin gong:

*Settings → Pages → Build and deployment → Source:* **Deploy from a branch**, branch `main`, mappe `/ (root)`.

Deretter ligg sida på `https://teitrand.github.io/fergeruter/`, og alle push til `main` — også dei automatiske oppdateringane av trafikkmeldingane — blir publiserte utan vidare.

Pages er per repo, så dette påverkar ikkje andre repo som har Pages på.
