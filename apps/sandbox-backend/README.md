# Sandbox Backend

Ansvar:

- eksponere API-er for GUI og prosessbygger
- håndtere prosessdefinisjoner
- lese syntetiske data med norske feltnavn
- håndheve policyer
- skrive revisjonslogg
- kalle Fiks-simulator og AI-gateway

## Stack

Node.js med innebygd HTTP-server, skrevet i TypeScript. Node fjerner typene selv
når filen lastes, så det finnes **ingen byggsteg** — `node src/server.ts` kjører
direkte, og `docker compose up` trenger ingen `pnpm install`. Krever Node ≥ 22.18.

`pnpm lint` (`tsc --noEmit`) typesjekker uten å produsere output.

## Filene

| Fil | Ansvar |
|---|---|
| `server.ts` | Oppstart. Ingenting annet. |
| `routes.ts` | Rutetabell for orkestrering: prosessøkter, prosess-CRUD, revisjonslogg. Delegerer alt dataoppslag til `ressurser.ts`. |
| `ressurser.ts` | **Den delte ressurskatalogen.** Én oppføring blir samtidig et HTTP-endepunkt, et gyldig `DATA_FETCH`-mål og et gyldig `SJEKK`-mål. |
| `prosess.ts` | Stegmotoren. `stegHandlers` har én håndterer per stegtype. |
| `vilkaar.ts` | Vilkårsvurdering mot `data/satser.json`. Rent og synkront: `grunnlag` kommer inn som parameter, så et utfall kan pinnes uten kjørende tjenester. `evaluateVilkaar` er eneste vei inn; `regelHandlers` er privat og har én håndterer per regeltype. |
| `alder.ts` | `alderVed`. Delt av `vilkaar.ts`, `scripts/valider-data.js` og `scripts/importer-tenor.js`, som før hadde hver sin kopi. |
| `regler.ts` | I/O-halvdelen av vilkårsvurderingen: henter beregningen fra Fiks, og samtykkepredikatene. |
| `state.ts` | Lesing og skriving av datasett, og oppslagshjelpere. `readJson` leser `state/` først med `data/` som fallback. |
| `types.ts` | Domenetypene. Stegtyper og regeltyper er lukkede unioner, så en ny variant uten håndterer blir en kompileringsfeil. |
| `routing.ts`, `errors.ts`, `http.ts`, `config.ts`, `revisjon.ts` | Småting. |

## Utvidelsespunkter

Skal du legge til noe i workshopen, er det nesten alltid ett av disse fire
stedene — se `docs/prosessmodell.md` for hele oppskriften:

1. ny flyt → `data/prosessdefinisjoner.json`
2. ny ordning → `data/satser.json`
3. ny datakilde eller sjekk → `ressurser.ts`
4. ny regeltype → `regelHandlers` i `vilkaar.ts` (privat; `evaluateVilkaar` er inngangen)

## Testing

```bash
pnpm test           # validerer seed-data og scenariodekning
pnpm lint           # typesjekk
pnpm test:kontrakt --ut foer.json   # normalisert dump av alle endepunkter
```

`test:kontrakt` starter backend og fiks-simulator på egne porter mot en fersk
`STATE_DIR`, så den kan kjøre samtidig med `docker compose` uten å røre den
delte kjøringstilstanden. Ta en dump før en endring og en etter, og diff dem.
