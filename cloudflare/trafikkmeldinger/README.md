# Trafikkmeldingar

Cloudflare Worker på gratisplanen som gjer Fjord1-trafikkmeldingar ferske for Fergeorakelet.

Workeren har to oppgåver:

1. **HTTP.** `GET` hentar Fjord1 sitt Ibexa-view `https://www.fjord1.no/api/ezp/v2/views` (typen `traffic_message`, same kall som `scripts/fetch_trafikkmeldinger.py`) og svarar JSON med CORS. Svaret blir hurtiglagra i 2 minutt (`Cache-Control: public, max-age=120`), så Fjord1 ikkje blir spurt for kvar vitjing. GrafQL på `www.fjord1.no/graphql` svarar 404 og blir ikkje brukt.
2. **Cron.** `*/10 * * * *` (UTC) startar GitHub-workflowen `update-trafikkmeldinger.yml` på `main` med `workflow_dispatch`. Det held `data/trafikkmeldinger.json` oppdatert når meldingsteksten faktisk endrar seg. GitHub sin eigen `*/5`-cron er reserve, men blir ofte køyrd berre nokre gonger i døgnet.

## Kvifor worker, og ikkje berre cron

Fila på GitHub blir berre skriven om når meldingane er endra. `fetchedAt` blir ståande, så ho er ikkje eit hjarteslag. Nettlesaren reknar kopien som gammal etter 8 minutt og må då ha ei fersk kjelde. Å starte workflowen oftare ville framleis late Pages bruke tid, og nettlesaren ville gått til `r.jina.ai` mellom commitane. Workeren svarar sjølv, med kort kant-cache.

`r.jina.ai` ligg att i nettlesaren berre om dette endepunktet feilar.

Nodane i JSON-svaret har same form som `normalizeFjord1Node` i `assets/app.js` ventar (`id`, `heading`, `content`, `date`, `validFrom.timestamp`, …). Klassifiseringa (1136 / 1135 / kombi) skjer i nettlesaren, ikkje her. `id` er base64 av `DomainContent:<ibexa-id>`, same format som Python-skriptet.

## URL

`workers.dev`-underdomenet høyrer til Cloudflare-kontoen og står ikkje i repoet. Konstanten under er den nettlesaren kallar. Ho må vere lik `MESSAGES_API_URL` i `src/index.js` og `FJORD1_MESSAGES_API` i `assets/app.js` (testen sjekkar det).

```
https://fergeruter-trafikkmeldinger.teitrand.workers.dev/
```

`teitrand.workers.dev` løyste ikkje då workeren blei lagd inn. Etter deploy skriv `wrangler` ut den faktiske URL-en. Er ho annleis, oppdater begge konstantane og auk cache-tallet `?v=` slik docs seier.

## Oppsett

Workflow-fila `.github/workflows/update-trafikkmeldinger.yml` må liggje på `main` før cron-kallet verkar. Ho gjer det allereie. HTTP-endepunktet treng henne ikkje.

1. Opprett ein Cloudflare-konto om du ikkje har ein. Gratisplanen inkluderer Workers og Cron Triggers. Signaltur-workeren bruker same konto.
2. Frå denne mappa:

```bash
npx wrangler login
npx wrangler deploy
```

3. Sjekk URL-en wrangler skriv ut:

```bash
curl -sS -D- "https://fergeruter-trafikkmeldinger.<underdomene>.workers.dev/" | head
```

Svaret skal vere JSON med `messages`, og headerane `access-control-allow-origin: *` og `cache-control: public, max-age=120`. Om underdomenet ikkje er `teitrand`, oppdater `MESSAGES_API_URL` og `FJORD1_MESSAGES_API` til den URL-en, auk `?v=` i `index.html`, `sw.js` og `assets/app.js`, og få endringa ut via `dev`.

4. Lag eller gjenbruk ein fine-grained personal access token på GitHub, same type som signaltur-workeren:

   - GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens**
   - Repository access: berre `teitrand/fergeruter`
   - Permissions: **Actions** → **Read and write**
   - Ingenting anna

   Løyndommen er per worker. Tokenet du alt har på `fergeruter-signaltur-cron` blir ikkje kopiert hit. Lim inn verdien på nytt:

```bash
npx wrangler secret put GITHUB_TOKEN
```

   Ikkje legg tokenet i git. Utan løyndommen svarar HTTP-endepunktet likevel, men cron-køyringa feilar og `data/trafikkmeldinger.json` blir berre oppdatert når GitHub sin eigen cron tilfeldigvis går.

5. Bekreft eit cron-slag i Cloudflare-dashbordet (Workers → workeren → **Logs** / **Cron Triggers**), eller køyr workflowen **Oppdater trafikkmeldingar** manuelt ein gong. Ho committer berre når meldingsteksten er endra.

## Stopp

Cloudflare-dashbordet → workeren → **Triggers**: slå av cron om du berre vil stoppe GitHub-kalla. HTTP-endepunktet kan stå. For å ta ned alt: slett workeren eller trekk tilbake ruta. Då går nettlesaren tilbake til `data/trafikkmeldinger.json` og, om den er gammal, til `r.jina.ai`.
