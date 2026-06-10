# Innbyggerdialog Sandbox

En samarbeidsvennlig sandbox for hackathon og utforskning av moderne innbyggerdialog i kommunal sektor.

Målet er å gjøre det enkelt for interne og eksterne utviklingsteam å prototype dialogbaserte tjenester med syntetiske data, tydelige API-er, sporbarhet og mockede integrasjoner.

## Hva sandkassen er

Sandboxen er en lokal utviklingsarena for å utforske hvordan innbyggere kan møte kommunen gjennom en dialogbasert flyt i stedet for tradisjonelle skjemaer.

Første demo-case er:

- `Redusert foreldrebetaling i barnehage`

Arkitekturen er lagt opp for samarbeid mellom flere team, med tydelige grenser mellom frontend, backend, simulatorer, policyer og datasett.

## Designprinsipp for hackathon

Sandboxen skal gi teamene **høy autonomi**, men også **nok støtte til at de faktisk rekker å levere noe i løpet av hackathonet**.

Det betyr i praksis:

- vi tilbyr felles kapabiliteter som API-er
- vi tilbyr referanseimplementasjoner som støtte
- vi unngår å låse teamene til én bestemt frontend, ett bestemt prosessformat eller ett bestemt verktøy
- vi prioriterer enkle integrasjonsflater og god dokumentasjon over tunge interne rammeverk

Referanseimplementasjonene i repoet, som `process-builder` og `demo-gui`, skal derfor forstås som **hjelpemidler og eksempler**, ikke som tvungne måter å bygge løsningene på.

## Status

Dette repoet inneholder første versjon av:

- monorepo-struktur
- dokumentasjonsgrunnlag
- policyfiler
- syntetiske eksempeldata med norske filnavn og norske felt
- OpenAPI-skjeletter
- app-mapper og ansvar per tjeneste

Applikasjonene finnes nå som en kjørbar, lettvekts MVP med enkle Node-tjenester og statiske grensesnitt. Neste steg er å videreutvikle funksjonalitet, kvalitet og utvikleropplevelse.

## Hvordan starte den

Installer avhengigheter:

```bash
pnpm install
```

Bygg og start alle tjenester:

```bash
docker compose up --build
```

## Hvordan stoppe den

```bash
docker compose down
```

## Oversikt over tjenester og porter

| Tjeneste | Port | Rolle |
|---|---:|---|
| `process-builder` | `3000` | Prosessbygger for dialogflyter |
| `demo-gui` | `3001` | Demo-app for innbyggerdialog |
| `sandbox-backend` | `8080` | Orkestrering, data, revisjon og prosesser |
| `fiks-simulator` | `8081` | Mock av samtykke, register og oppgaver |
| `ai-gateway` | `8082` | Mock av AI-støtte og forklaringer |

Planlagte URL-er når tjenestene er implementert:

- [http://localhost:3000](http://localhost:3000)
- [http://localhost:3001](http://localhost:3001)
- [http://localhost:8080/health](http://localhost:8080/health)
- [http://localhost:8081/health](http://localhost:8081/health)
- [http://localhost:8082/health](http://localhost:8082/health)
- [http://localhost:8080/docs](http://localhost:8080/docs)
- [http://localhost:8081/docs](http://localhost:8081/docs)
- [http://localhost:8082/docs](http://localhost:8082/docs)

## Demo-bruker

Anbefalt demo-bruker for første flyt:

- `person-001` — `Maja Solberg`

Data finnes i `data/personer.json`.

## Demo-flyt

Første fungerende demo skal støtte denne flyten:

1. Velg testbruker `Maja Solberg`
2. Start prosess `Redusert foreldrebetaling`
3. Hent husstandsdata
4. Vis husstand til bruker
5. Be om samtykke for inntektsdata
6. Bruker gir samtykke
7. Hent inntektsdata
8. AI-gateway lager oppsummering i klarspråk
9. Bruker bekrefter
10. Søknad sendes inn
11. Oppgave opprettes i Fiks-simulator
12. Revisjonslogg viser hendelsene

Andre tilgjengelige demo-case:

- `Redusert betaling i SFO`
- `Behovsavklaring for støttekontakt`

Demo-GUI-en er nå prosessdrevet og leser steg direkte fra valgt prosessdefinisjon.
Demo-GUI-en bruker også prosessøkt-API i backend for å starte flyter, lagre svar og utføre steg.

## Eksempel på API-kall

Hent personer:

```bash
curl http://localhost:8080/api/personer
```

Hent husstand for demo-bruker:

```bash
curl http://localhost:8080/api/personer/person-001/husstand
```

Forsøk å hente inntekt før samtykke:

```bash
curl http://localhost:8080/api/personer/person-001/inntekt
```

Opprett samtykke i simulator:

```bash
curl -X POST http://localhost:8081/fiks/samtykke \
  -H "Content-Type: application/json" \
  -d '{
    "personId": "person-001",
    "formaal": "Vurdere rett til redusert foreldrebetaling",
    "dataKilder": ["inntekt"]
  }'
```

## Hvor syntetiske data ligger

Syntetiske data ligger under `data/`:

- `data/personer.json`
- `data/husstander.json`
- `data/inntekter.json`
- `data/barnehageplasser.json`
- `data/soknader.json`
- `data/samtykker.json`
- `data/prosessdefinisjoner.json`
- `data/informasjonsmodeller.json`

## Hvordan legge til nye prosesser

1. Legg ny prosessdefinisjon i `data/prosessdefinisjoner.json`
2. Eller opprett den direkte i prosessbyggeren på `http://localhost:3000`
3. Oppdater eksempel eller dokumentasjon i `examples/demoprosesser/`
4. Dokumenter nødvendig API-bruk i `docs/prosessmodell.md`
5. Hvis prosessen krever nye regler, oppdater relevante filer i `policies/`

## Hvordan legge til nye syntetiske datasett

1. Legg til ny JSON-fil i `data/`
2. Beskriv datasettet i `docs/syntetiske-data.md`
3. Oppdater katalog- eller API-dokumentasjon i `docs/api-oversikt.md`
4. Marker alle poster med `syntetisk: true` der det er relevant

## Samarbeid

Dette repoet er lagt opp for flere team. Se:

- `CONTRIBUTING.md`
- `docs/architecture.md`
- `docs/api-oversikt.md`
- `docs/api-foerst-integrasjoner.md`

Anbefalt arbeidsform:

- ett team per tjeneste eller arbeidsstrøm
- små PR-er med tydelig scope
- dokumentasjon oppdateres sammen med kode
- API-kontrakter avklares før implementasjon
- bruk sandboxens referanseimplementasjoner hvis de sparer tid, men stå fritt til å lage egne løsninger oppå de samme API-ene

## Kjente begrensninger

- Tjenestene er bygget som en enkel null-avhengighets MVP, ikke som produksjonsklar applikasjon
- Docker Compose starter tjenestene, men løsningen mangler fortsatt robust feilhåndtering, tester og persistensstrategi
- OpenAPI-filene er fortsatt enklere skjeletter enn full API-dokumentasjon
- Datasett og policyer er laget for demo og hackathon, ikke produksjon
- Ingen ekte integrasjoner mot Altinn, Fiks, ID-porten eller Maskinporten

## Viktige filer

- `docker-compose.yml`
- `pnpm-workspace.yaml`
- `package.json`
- `docs/architecture.md`
- `docs/api-foerst-integrasjoner.md`
- `docs/sikkerhet-og-personvern.md`
- `policies/data-policy.yaml`
