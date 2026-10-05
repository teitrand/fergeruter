# Signaltur-cron

Cloudflare Worker på gratisplanen er klokka for signaltur-loggen. Cron Triggers (UTC) startar GitHub Actions-workflowen `log-signalturar.yml` på `main`.

- `7,37 4-21 * * *` — :07 og :37 frå 04 til 21 UTC
- `7 22 * * *` — 22:07 UTC

GitHub har same cron som reserve. Sjå `.github/workflows/log-signalturar.yml`.

Workflow-fila må liggje på `main` før deploy. Elles svarar GitHub 404 på dispatch.

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
