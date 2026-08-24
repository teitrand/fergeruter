# Fergeruter 1136

Statisk oversikt over **trafikkmeldingar frå Fjord1** og **rutetabellen** for Standal–Trandal (rute 1136).

Rutetabellen blir lasta ned **éin gong** frå Entur. Sida byter berre visning mellom dei to alternativa **Frå Trandal** og **Frå Standal**, utan nye API-kall. Tabellen blir berre henta på nytt når innhaldet faktisk er endra.

## Kjelder

- Trafikkmeldingar: [fjord1.no/trafikkmeldingar](https://www.fjord1.no/trafikkmeldingar) via Fjord1 sitt GraphQL-endepunkt
- Rutetabell: [Entur Journey Planner](https://developer.entur.org/), lagra i `data/ruter.json`
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
```

## GitHub Pages

Sida vert publisert automatisk til GitHub Pages ved push til `main`, via arbeidsflyten `Publiser til GitHub Pages`. Den slår på Pages for dette repoet sjølv, og påverkar ikkje Pages på andre repo.

URL etter fyrste køyring: `https://teitrand.github.io/fergeruter/`
