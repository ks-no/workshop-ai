# OpenAPI Notes

Denne mappen inneholder tjenestekontrakter for workshop-miljoet.

## Prosesskatalog (`data/prosessdefinisjoner.json`)

Prosessdefinisjoner er organisert som en katalog i format `0.2.0`:

- `prosesser`: publiserte prosesser som kan startes i flyt
- `maler`: gjenbrukbare prosessmaler for redigering/kopiering
- `redigering`: valgfri metadata for forfatterstotte (for eksempel `status`, `mal`, `eier`, `hjelpetekst`)
- `forfatterhjelp` i steg: valgfri skrivetips/hensikt per steg

## Endepunkt-adferd

### `sandbox-backend`

- `GET /api/prosesser` returnerer publiserte prosesser
- `GET /api/prosesser?inkluderMaler=true` returnerer publiserte prosesser + maler
- `POST /api/prosessoekter` kan kun starte prosesser fra `prosesser` (ikke `maler`)

### `mcp-services`

- `list_processes` er kompatibel med baade eldre array-format og katalog-format
- Svaret inneholder `prosesser` og felter for maler (`antallMaler`, `maler`) for kompatibilitet

## Oppdateringsregel

Ved endringer i prosessflyt eller API-responser, oppdater relevante spesifikasjoner i denne mappen samtidig.

