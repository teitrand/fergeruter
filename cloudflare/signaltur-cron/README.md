# Signaltur-cron

Cloudflare Worker på gratisplanen er klokka for signaltur-loggen. Cron Triggers (UTC) startar GitHub Actions-workflowen `log-signalturar.yml` på `main`.

- `7,37 4-21 * * *` — :07 og :37 frå 04 til 21 UTC

Siste slag er 21:37 UTC. Det er 23:37 norsk sommertid og 22:37 vintertid, så kvelden landar rundt 23:07 utan å gå over midnatt. `22:07` UTC er 00:07 i Oslo i sommar og ville logga ein tom ny dag. Siste signaltur (20:20, framme 20:35 Oslo) blir fanga neste slag etterpå: 18:37 UTC i sommar og 19:37 UTC i vinter.

GitHub har same cron som reserve. Sjå `.github/workflows/log-signalturar.yml`.

Workflow-fila må liggje på `main` før deploy. Elles svarar GitHub 404 på dispatch.

## Runner som ikkje kjem

GitHub kan ta imot `workflow_dispatch` og likevel aldri gje jobben ein runner. Då står ho i om lag 15 minutt og blir merkt **failure**, sjølv om ingen steg har køyrt. E-posten seier at jobben feila. Annotasjonen er «The job was not acquired by Runner of type hosted even after multiple attempts».

Workeren ventar ikkje heile det kvar gong. Dei fleste køyringane har runner innan 15 sekund, og då er vakta ferdig. Er det framleis ingen runner etter 12 minutt, avbryt han køyringa og kallar `rerun` på **same** køyring. Det blir ikkje ein ny workflow-run. Det nye forsøket køyrer i concurrency-gruppa, så han ventar om reservecronen alt loggar, og ferskskapssjekken i `scripts/signaltur_loop.py` hoppar over om `updatedAt` er under 20 minutt. Landar forsøk to, er konklusjonen på køyringa suksess, ikkje failure.

12 minutt er innanfor veggtida på 15 minutt for cron på gratisplanen, og før GitHub sin eigen 15-minuttsgrense. Sjølve ventinga bruker ikkje CPU. Reservecronen som GitHub startar sjølv, blir ikkje overvaka av workeren. Han går sjeldan.

Vakta ligg i denne workeren, ikkje i workflow-fila. Ho verkar fyrst etter `npx wrangler deploy`. Tokenet treng framleis berre Actions, les og skriv: avbrot og rerun bruker same løyvet.

## Oppsett

1. Opprett ein Cloudflare-konto. Gratisplanen inkluderer Cron Triggers.
2. Frå denne mappa:

```bash
npx wrangler login
```

3. Lag ein fine-grained personal access token på GitHub:

   - GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
   - Resource owner: brukaren eller organisasjonen som eig `teitrand/fergeruter`
   - Repository access: berre `teitrand/fergeruter`
   - Permissions: **Actions** → **Read and write**
   - Ingenting anna. Generer tokenet.

4. Lim tokenet inn som løyndom (namnet skal vere `GITHUB_TOKEN`):

```bash
npx wrangler secret put GITHUB_TOKEN
```

5. Deploy:

```bash
npx wrangler deploy
```

Tokenet blir liggande som Cloudflare-løyndom. Ikkje legg det i git.

## Stopp

Cloudflare-dashbordet → workeren → **Triggers**: slå av cron. Slå òg av workflowen **Logg signalturar** på GitHub, så reservecronen ikkje held fram åleine.
