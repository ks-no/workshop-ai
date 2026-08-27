# OpenAPI Notes

Denne mappen inneholder tjenestekontrakter for workshop-miljøet.

## Prosesskatalog (`data/prosessdefinisjoner.json`)

Prosessdefinisjoner er organisert som en katalog i format `0.2.0`:

- `prosesser`: publiserte prosesser som kan startes i flyt
- `maler`: gjenbrukbare prosessmaler for redigering/kopiering
- `redigering`: valgfri metadata for forfatterstøtte (for eksempel `status`, `mal`, `eier`, `hjelpetekst`)
- `forfatterhjelp` i steg: valgfri skrivetips/hensikt per steg

## Endepunkt-atferd

### `sandbox-backend`

- `GET /api/prosesser` returnerer publiserte prosesser
- `GET /api/prosesser?inkluderMaler=true` returnerer publiserte prosesser + maler
- `POST /api/prosessoekter` kan kun starte prosesser fra `prosesser` (ikke `maler`)

### `tools-api`

- `list_processes` er kompatibel med både eldre array-format og katalog-format
- Svaret inneholder `prosesser` og felter for maler (`antallMaler`, `maler`) for kompatibilitet

## Oppdateringsregel

Ved endringer i prosessflyt eller API-responser, oppdater relevante spesifikasjoner i denne mappen samtidig.

`pnpm test:openapi` håndhever det. Sjekken sammenligner hver rute i koden med hver path i
spesifikasjonen, i begge retninger, og feiler på:

- en rute i koden som ikke er dokumentert, og en path i spesifikasjonen koden ikke svarer på
- feil metode - `POST` i spesifikasjonen der koden svarer på `PUT`
- **duplikate path-nøkler.** Dette er grunnen
  til at sjekken leser YAML på tekstnivå framfor å parse den - en parser kollapser
  dubletter før noen får se dem, og repoet har dessuten ingen parser å bruke
- en operasjon uten `security:`. Åpne ruter skal ha `security: []` eksplisitt, slik at
  fraværet ikke leses som en glipp
- en `security:` som er uenig med tilgangsbandet i koden. Kartet er `tilgang`-feltet på
  hver `Rute` i `routes.ts` og hver `Ressurs` i `ressurser.ts`: `aapen` → `security: []`,
  `egne-data` → ID-porten eller Maskinporten, `bred` → bare Maskinporten. Scopet må stemme
  med det ruten krever
- et kodeverk spesifikasjonen gjentar og som har kommet ut av takt med koden -
  `Samtykkestatus` og `Oppgavestatus` måles mot tilstandsmaskinene i `fiks-simulator`

Rutene hentes fra rutetabellene der de finnes, og skannes ut av kilden der de ikke gjør
det. Skanneren feiler på en bruk av `url.pathname` den ikke kjenner igjen, framfor å hoppe
over den: en rute skrevet på en ny form skal bli en feil, ikke et hull.

`node scripts/sjekk-openapi-dekning.ts --vis` skriver ut rutene koden faktisk har, med
tilgangsband.

