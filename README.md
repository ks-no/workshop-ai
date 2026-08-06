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

Du trenger **Docker** installert og startet. På macOS må du ha [Homebrew](https://brew.sh), så skriptet kan installere Ollama for deg. Node og pnpm trengs ikke for å kjøre sandboxen — bare for testskriptene.

```bash
./start.sh
```

Det er alt. Skriptet finner ut hvilken plattform du er på, sørger for at en språkmodell er tilgjengelig, starter tjenestene, og verifiserer at modellen faktisk er koblet på før den melder klar.

Første gang må en språkmodell lastes ned — fra 400 MB til 9 GB avhengig av hvor mye minne maskinen din har. Sett av tid til det; senere oppstarter tar sekunder.

Skriptet spør før det laster ned. På macOS spør det i tillegg før det installerer Ollama, siden den kjører nativt der; på Linux og WSL kjører Ollama i container og installeres ikke. `./start.sh -y` hopper over alle spørsmål.

Stopp med `./start.sh -d`.

### På Windows

Kjør `start.bat` fra ledeteksten eller PowerShell:

```bat
start.bat
```

Den tar de samme flaggene som `start.sh` (`-m`, `--mock`, `--reset`, `-d`, `-h`), og
verifiserer på samme måte at modellen faktisk svarer før den melder klar. Forskjellen er
at Ollama kjører i Docker Compose sammen med tjenestene, ikke nativt — så det er ingen
plattform- eller GPU-deteksjon å gjøre. Stopp med `start.bat -d` eller `stop.bat`.

Har du Git Bash eller WSL, virker `./start.sh` også, og gir deg automatisk modellvalg
basert på minnet i maskinen.

### Valg

Du skal normalt ikke trenge noen av disse.

| Flagg | |
|---|---|
| `-m, --model MODEL` | Bruk en bestemt modell i stedet for den automatisk valgte |
| `-y, --yes` | Ikke spør før installasjon eller nedlasting |
| `--mock` | Kjør uten språkmodell. Redningsflagget når nedlasting ikke er mulig |
| `--reset` | Glem alle tidligere demokjøringer og start fra kildedataene |
| `-d, --down` | Stopp alt |
| `-h, --help` | Hjelp |

### Hva skriptet gjør for deg

**Plattform** oppdages automatisk:

| Plattform | Hvordan Ollama kjøres |
|---|---|
| macOS | Nativt på verten. Docker Desktop når ikke Metal på Apple Silicon, så Ollama i container ville blitt ren CPU-inferens. |
| Linux med NVIDIA-GPU | I container, med `docker-compose.gpu.yml` |
| Linux og WSL ellers | I container, uten GPU |

**Modell** velges ut fra minnet på maskinen: 32 GB RAM eller mer gir `qwen2.5:14b`, 12 GB eller mer gir `qwen2.5:7b`, under det `qwen2.5:0.5b`.

Har du et NVIDIA-kort, leses også VRAM, og det mest restriktive av de to avgjør — en modell som får plass i RAM men ikke i VRAM blir splittet mot CPU og går tregt. Apple Silicon har unified memory, så der er RAM riktig tall.

Har du satt `OLLAMA_MODEL` i miljøet eller i `.env`, brukes den i stedet. `.env` opprettes fra `.env.example` hvis den mangler.

**Til slutt bekreftes det at modellen svarer.** Sier skriptet `⚠️ The model is NOT connected`, virker sandboxen fortsatt — men AI-svarene er maler. Vanligste årsak er at Ollama har stoppet.

### Kildedata og kjøringstilstand

`data/` er kildedata og skrives aldri til. Alt tjenestene endrer under kjøring havner i `state/`, som er gitignorert. En demokjøring skitner derfor ikke til arbeidstreet — kjører du en flyt og deretter `git status`, skal den være ren.

`./start.sh --reset` nullstiller `state/`. Se `docs/syntetiske-data.md`, også for hvordan du deler en prosess du har laget i byggeren.

### Hvis noe ikke virker

Kontroller at modellen er koblet på:

```bash
curl -s -X POST http://localhost:8082/ai/klarsprak \
  -H "Content-Type: application/json" \
  -d '{"kontekst":{"tjeneste":"test"},"sprak":"nb"}'
```

Svaret skal ha `"modell": "ollama:<modell>"` og **ingen** `advarsel`-felt. Ser du `"mock-ai-gateway (fallback)"`, er ikke modellen tilgjengelig. Grensesnittene viser ikke `advarsel`-feltet, så svarene ser normale ut selv når de kommer fra maler — det er derfor denne sjekken finnes.

Logger: `docker compose logs -f ai-gateway`.

### Manuell oppstart

`./start.sh` gjør dette for deg. Les skriptet hvis du vil se detaljene — det er kommentert.

macOS, med Ollama nativt på verten:

```bash
brew services start ollama    # ikke "ollama serve" — den dør når terminalen lukkes
ollama pull qwen2.5:14b
cp .env.example .env          # OLLAMA_BASE_URL=http://host.docker.internal:11434
docker compose up -d --no-deps sandbox-backend fiks-simulator ai-gateway \
  mcp-services process-agent demo-gui process-builder
```

`--no-deps` hindrer at `depends_on: ollama` i `ai-gateway` drar opp container-Ollama.

Linux og WSL, alt i Docker:

```bash
cp .env.example .env          # OLLAMA_BASE_URL=http://ollama:11434
docker compose up -d
```

Med NVIDIA-GPU: legg til `-f docker-compose.gpu.yml`. Verifiser at Docker har GPU-tilgang med `docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi` — feiler den, mangler [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).

Forhåndslast alle anbefalte modeller, for eksempel før en workshop med dårlig nett:

```bash
docker compose --profile models up ollama-pull-all
```

Modellene er `qwen2.5:0.5b` (raskest), `qwen2.5:7b` (balansert), `qwen2.5:14b` (best av Qwen-variantene), `llama3.1:8b` og `mistral-nemo`.

## Hvordan stoppe den

```bash
./start.sh -d
```

Eller direkte med `docker compose down`. På macOS kjører Ollama utenfor Docker og stoppes med `brew services stop ollama` hvis du vil frigjøre minnet.

## Oversikt over tjenester og porter

| Tjeneste | Port | Rolle |
|---|---:|---|
| `process-builder` | `3000` | Prosessbygger for dialogflyter |
| `demo-gui` | `3001` | Demo-app for innbyggerdialog |
| `sandbox-backend` | `8080` | Orkestrering, data, revisjon og prosesser |
| `fiks-simulator` | `8081` | Mock av samtykke, register og oppgaver |
| `matrikkel-mock` | `8085` | Mock av Kartverket Matrikkel Geointegrasjon BasisService |
| `ai-gateway` | `8082` | KI-støtte og forklaringer (Ollama, OpenRouter eller mock) |
| `ollama` | `11434` | Lokal LLM-runtime for billige/gratis modeller |
| `mcp-services` | `8083` | 20 verktøy over backend- og AI-tjenester (REST, ikke MCP-protokollen) |
| `process-agent` | `8084` | Generisk agent som guider bruker gjennom prosesser |

Alle tjenestene kjører når `./start.sh` er ferdig:

- [http://localhost:3000](http://localhost:3000)
- [http://localhost:3001](http://localhost:3001)
- [http://localhost:3001/chat](http://localhost:3001/chat)
- [http://localhost:3001/agent](http://localhost:3001/agent)
- [http://localhost:8080/health](http://localhost:8080/health)
- [http://localhost:8081/health](http://localhost:8081/health)
- [http://localhost:8085/health](http://localhost:8085/health)
- [http://localhost:8082/health](http://localhost:8082/health)
- [http://localhost:8083/health](http://localhost:8083/health)
- [http://localhost:8084/health](http://localhost:8084/health)
- [http://localhost:8080/docs](http://localhost:8080/docs)
- [http://localhost:8081/docs](http://localhost:8081/docs)
- [http://localhost:8085/docs](http://localhost:8085/docs)
- [http://localhost:8082/docs](http://localhost:8082/docs)

Nye API-er:

- `GET /mcp/tools` pa `http://localhost:8083`
- `POST /agent/sessions` pa `http://localhost:8084`

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
- `Søknad om fritidskort-støtte`
- `Søknad om fartsdempende tiltak`

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

Opprett agentsesjon (generisk prosessguide):

```bash
curl -s -X POST http://localhost:8084/agent/sessions \
  -H "Content-Type: application/json" \
  -d '{"personId":"person-001"}'
```

Liste tilgjengelige MCP-tools:

```bash
curl -s http://localhost:8083/mcp/tools
```

Hent matrikkeldata (REST-hjelpeendepunkt):

```bash
curl -s "http://localhost:8085/mock/matrikkel/eiendommer?gate=Storgata"
```

Hent matrikkeldata (SOAP, Geointegrasjon-sti):

```bash
curl -s -X POST http://localhost:8085/geointegrasjon/matrikkel/wsapi/v1/BasisService \
  -H "Content-Type: text/xml; charset=utf-8" \
  -d '<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:mat="http://rep.geointegrasjon.no/Matrikkel/Basis/xml.wsdl/2012.01.31">
  <soapenv:Body>
    <mat:HentMatrikkelenhet>
      <matrikkelId>matr-storg-003</matrikkelId>
    </mat:HentMatrikkelenhet>
  </soapenv:Body>
</soapenv:Envelope>'
```

Kjor en enkel end-to-end smoke test mot agenten:

```bash
npx pnpm test:agent
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
- `openapi/README.md`
- `docs/architecture.md`
- `docs/api-oversikt.md`
- `docs/api-foerst-integrasjoner.md`
- `docs/veien-videre.md`

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
- `docs/veien-videre.md`
- `docs/sikkerhet-og-personvern.md`
- `policies/data-policy.yaml`
