# Postman

**Det ligger ingen collection her, med vilje.** Postman importerer OpenAPI direkte, og
en håndholdt collection ved siden av spesifikasjonene ville blitt en andre sannhet som
driver fra koden. Importer i stedet.

## Importer

`File → Import` og pek på filene i `openapi/` - én per API-tjeneste.

Alle sju API-tjenestene serverer også spesifikasjonen sin mens de kjører, så du kan importere
via URL i stedet: `http://localhost:<port>/openapi.yaml`. Hvilken port hver tjeneste har,
står i `apps/shared/tjenester.json` og på dashboardet <http://localhost:3001> - samme
kilde som API-utforskeren leser, så den kan ikke drive fra koden slik en tabell her ville
gjort.

Sett en environment-variabel `basisUrl` per tjeneste, eller bruk `http://localhost:<port>`
direkte.

**Rutene krever token.** `AUTH_ENFORCE` er på som standard, og alt som ikke er
uttrykkelig åpent svarer 401 uten `Authorization`. Hent et token med
`node scripts/token.ts` - eller la <http://localhost:3001/utforsker> velge det riktige
tokenet for ruta og gi deg en `curl` som virker.

## Dekningsgrad

**Hver spesifikasjon dekker hver rute i koden**, med `security:` per rute.
Rutetallene står ikke her: `pnpm test:openapi` skriver dem ut per tjeneste, og et tall i
denne fila ville vært en kopi som ryker ved neste rute.

Beregningsendepunktet - det eneste som speiler et ekte KS-API - er beskrevet i
`openapi/fiks-simulator.yaml` med lenke til
[det ekte register-API-et](https://developers.fiks.ks.no/api/register-skatteoginntektsopplysninger-beregning-api-v1.json).

`pnpm test:openapi` sammenligner kode og spesifikasjon i begge retninger og feiler i CI
på en udokumentert rute, en dokumentert rute som ikke finnes, feil metode, en duplikat
path-nøkkel, en manglende `security:` eller et kodeverk som har kommet ut av takt. Finner
du likevel et avvik, er det en feil å melde - ikke lenger et forventet etterslep.
