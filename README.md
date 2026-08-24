# Fergeruter 1136

Statisk oversikt over **trafikkmeldingar frå Fjord1** og **neste ferjeavganger** for sambandet Standal–Trandal–Sæbø–Skår–Valderøya–Store Kalvøy (rute 1136).

## Kjelder

- Trafikkmeldingar: [fjord1.no/trafikkmeldingar](https://www.fjord1.no/trafikkmeldingar) via Fjord1 sitt GraphQL-endepunkt
- Avganger i sanntid: [Entur Journey Planner](https://developer.entur.org/)
- Papir-ruteplan: [`ruter.pdf`](ruter.pdf) (kan vere eldre enn Entur-data)

Fjord1 tillèt ikkje CORS frå nettlesaren, så meldingane blir henta av eit skript og lagra i `data/trafikkmeldinger.json`. GitHub Action oppdaterer fila kvart 15. minutt på `main`.

## Køyre lokalt

```bash
python3 scripts/fetch_trafikkmeldinger.py
python3 -m http.server 8080
```

Opne [http://localhost:8080](http://localhost:8080).

## Testar

```bash
python3 -m unittest discover -s tests -v
```

## GitHub Pages

Slå på Pages under *Settings → Pages* med kjelde **Deploy from a branch**, branch `main`, mappe `/ (root)`. Etter merge ligg sida på `https://<brukar>.github.io/fergeruter/`.
