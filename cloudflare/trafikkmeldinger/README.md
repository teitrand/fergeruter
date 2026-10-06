# Trafikkmeldingar

Cloudflare Worker på gratisplanen som gjer Fjord1-trafikkmeldingar ferske for Fergeorakelet.

`GET` hentar Fjord1 sitt Ibexa-view `https://www.fjord1.no/api/ezp/v2/views` (typen `traffic_message`, same kall som `scripts/fetch_trafikkmeldinger.py`) og svarar JSON med CORS. Svaret blir hurtiglagra i 2 minutt (`Cache-Control: public, max-age=120`), så Fjord1 ikkje blir spurt for kvar vitjing. Feil frå Fjord1 blir ståande i 45 sekund, så eit nedetid ikkje utløyser nye POST for kvart nettlesarkall. GrafQL på `www.fjord1.no/graphql` svarar 404 og blir ikkje brukt.

Workeren har ingen cron og treng inga GitHub-løyndom. Han startar ikkje `update-trafikkmeldinger.yml`. Den jobben, med GitHub sin `*/5`-cron, er reserve for `data/trafikkmeldinger.json` og blir ofte køyrd berre nokre gonger i døgnet.

## Kvifor worker, og ikkje berre cron

Fila på GitHub blir berre skriven om når meldingane er endra. `fetchedAt` blir ståande, så ho er ikkje eit hjarteslag. Nettlesaren reknar kopien som gammal etter 8 minutt og må då ha ei fersk kjelde. Å starte workflowen oftare ville framleis late Pages bruke tid, og nettlesaren ville gått til `r.jina.ai` mellom commitane. Det ville òg gitt over hundre Actions-køyringar i døgnet. Workeren svarar sjølv, med kort kant-cache.

`r.jina.ai` ligg att i nettlesaren berre om dette endepunktet feilar.

Nodane i JSON-svaret har same form som `normalizeFjord1Node` i `assets/app.js` ventar (`id`, `heading`, `content`, `date`, `validFrom.timestamp`, …). Klassifiseringa (1136 / 1135 / kombi) skjer i nettlesaren, ikkje her. `id` er base64 av `DomainContent:<ibexa-id>`, same format som Python-skriptet.

## URL

`workers.dev`-underdomenet høyrer til Cloudflare-kontoen og står ikkje i repoet. Konstanten under er den nettlesaren kallar. Ho må vere lik `MESSAGES_API_URL` i `src/index.js` og `FJORD1_MESSAGES_API` i `assets/app.js` (testen sjekkar det).

```
https://fergeruter-trafikkmeldinger.fergeruter-teitrand.workers.dev/
```

Den adressa er den wrangler gav ved deploy. Endrar ho seg, oppdater `MESSAGES_API_URL` og `FJORD1_MESSAGES_API` saman og auk `?v=`.

## Oppsett

1. Opprett ein Cloudflare-konto om du ikkje har ein. Gratisplanen inkluderer Workers. Signaltur-workeren bruker same konto.
2. Frå denne mappa:

```bash
npx wrangler login
npx wrangler deploy
```

3. Sjekk URL-en wrangler skriv ut:

```bash
curl -sS -D- "https://fergeruter-trafikkmeldinger.fergeruter-teitrand.workers.dev/" | head
```

Svaret skal vere JSON med `messages`, og headerane `access-control-allow-origin: *` og `cache-control: public, max-age=120`. Live URL er `https://fergeruter-trafikkmeldinger.fergeruter-teitrand.workers.dev/`.

## Stopp

Slett workeren eller trekk tilbake ruta. Då går nettlesaren tilbake til `data/trafikkmeldinger.json` og, om den er gammal, til `r.jina.ai`.
