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
node --test tests/test_status.mjs
```
