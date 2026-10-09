# React-skalet (web/)

Vite + React i vanleg JavaScript (JSX) med JSDoc. Vanilla-appen i `/` og `/dev/` er uendra;
skalet byggjer til `web/dist/` og blir ikkje publisert enno (PR 6).

```sh
npm ci                 # i rota av repoet (npm workspaces: packages/core og web)
npm run dev:web        # http://localhost:5173/ (?rute=kombi fungerer lokalt)
npm run build:web      # web/dist/ med index.html, hash-filer, data/ og sw.js
npm run test:web       # teiknar <App> med fast data via Vite SSR
```

## Oppbygging

- `src/model/`: rein tilstandsmodell utan React/DOM. Byggjer `ctx`, `ev` og `view` til
  `packages/core` og gjer om til rader (`timeline.js`) og statuslinje (`header.js`).
  Testa mot vanilla-appen i `tests/test_web.mjs` (køyrer i CI utan node_modules).
- `src/state.js`: UI-reduceren (samband, dag, språk, vis tidlegare).
- `src/hooks/`: `useAppData` (data/*.json) og `useClock` (minuttikk).
- `src/components/`: Header (språk, tittel, samband, statuslinje), DayNav, Timeline, Footer.
  Same klassenamn som vanilla-appen, så `assets/styles.css` blir brukt som han er.

## ?v= i core

Core importerer med `?v=<versjon>` for vanilla-appen. `build/strip-version-query.js` fjernar
`?v=<tal>` på relative importar før Vite løyser dei. Utan det blir `assets/i18n.js` to modular
(éin med og éin utan `?v=`), og språkbytet når berre den eine.

## Data og service worker

- `build/repo-data.js`: `vite` serverar `data/*.json` frå rota; byggjet legg ein kopi i
  `dist/data/`. Ved publisering skal `VITE_DATA_BASE` peike på dei levande filene.
- `scripts/build-sw.mjs`: lagar `dist/sw.js` frå `sw.js` i rota med precache av byggjet og
  eigne cachenamn (`fergeruter-web-<hash>`). Han blir ikkje registrert før PR 6.
