/**
 * Vanilla-appen importerer core med `?v=<versjon>` for å sprenge nettlesarcachen
 * (sjå tests/test_sw.mjs). Vite treng ikkje det: byggjet får hash i filnamna.
 *
 * Utan dette tillegget ville `../../assets/i18n.js?v=81` (frå core) og
 * `../../assets/i18n.js` (frå web/) bli to ulike modular med kvar sin språkvariabel.
 * Vi fjernar derfor `?v=<tal>` på relative importar før Vite løyser dei, så kvar fil
 * blir éin modul uansett kven som importerer han. Andre spørjestrengar (`?raw`,
 * `?url` osv.) blir ikkje rørte.
 */
const VERSION_QUERY = /\?v=\d+$/;

export function stripVersionQuery() {
  return {
    name: "fergeruter:strip-version-query",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!VERSION_QUERY.test(source) || !/^\.{1,2}\//.test(source)) return null;
      return this.resolve(source.replace(VERSION_QUERY, ""), importer, { ...options, skipSelf: true });
    },
  };
}
