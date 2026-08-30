# Agentreglar

## Deploy

Gå **alltid** via `dev` før produksjon. Aldri opne feature-PR mot `main`.

`dev` skal **alltid vere føre `main`**: alt som er i prod skal òg liggje på testhosten, pluss det som ikkje er sleppt enno.

1. Lag feature-grein frå `dev`
2. Opne PR mot `dev` (`base_branch: dev`)
3. Test på [testhosten](https://teitrand.github.io/fergeruter/dev/)
4. Først når det er greitt: PR eller merge frå `dev` til `main`

`main` er produksjon ([teitrand.github.io/fergeruter](https://teitrand.github.io/fergeruter/)).

Ikkje merg `main` rett inn i `dev`-greina. På `main` ligg testhosten som mappa `dev/`; ein full merge ville kopiert den mappa inn på testhost-greina. Synk i staden rotfilene (index, assets, data, testar).
