# Innbyggerdialog Sandbox

En samarbeidsvennlig sandbox for hackathon og utforskning av moderne innbyggerdialog i kommunal sektor.

Målet er å gjøre det enkelt for interne og eksterne utviklingsteam å prototype dialogbaserte tjenester med syntetiske data, tydelige API-er, sporbarhet og mockede integrasjoner.

> **Deltaker på hackathon? Start med [`docs/deltakerstart.md`](docs/deltakerstart.md).**
> Én side med det du trenger den første timen: én kommando, fire URL-er, hvilken
> demobruker som hører til hvilken case, og tre feilsjekker. Kom tilbake hit når du
> vil ha hele bildet.

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

Åtte kjørende tjenester, null runtime-avhengigheter, fem komplette demo-case. På plass:

- samtykkeflyt med sperre på inntektsdata uten samtykke, håndhevet ett sted
- revisjonslogg over all datatilgang
- deterministisk vilkårsvurdering mot satser (`SJEKK`) — utenfor modellen, med vilje
- syntetiske data forankret i Folkeregisterets informasjonsmodell og KS Fiks beregnings-API
- KI-spor: hvert modellkall lagres med prompt og svar, lesbart på `GET /trace`
- evals av KI-laget: `pnpm test:eval`
- OpenAPI for alle seks tjenester, komplett og holdt i takt med koden av
  `pnpm test:openapi`: hver rute dokumentert, med `security:` per rute

Se `docs/veien-videre.md` for hva som gjenstår og hvilke arkitekturvalg som er åpne.

## Hvordan starte den

Du trenger **Docker** installert og startet. På macOS må du ha [Homebrew](https://brew.sh), så skriptet kan installere Ollama for deg. Node og pnpm trengs ikke for å kjøre sandboxen — bare for testskriptene.

**Vil du bare se noe kjøre? Start her:**

```bash
./start.sh --mock
```

Fire til sju minutter. Alt fungerer bortsett fra at KI-svarene er maltekst i
stedet for modellgenerert — flyten, samtykkesperren, revisjonsloggen og alle
API-ene er de samme. Dette er den riktige veien inn første gang, og den eneste
som ikke krever nedlasting av flere gigabyte.

Når du vil ha den ekte modellen:

```bash
./start.sh
```

Skriptet finner ut hvilken plattform du er på, velger modell ut fra minnet i
maskinen, starter tjenestene, og verifiserer at modellen faktisk svarer før den
melder klar.

**Sett av tid første gang: 12–25 minutter**, mer med en stor modell, og vesentlig
mer på delt konferansenett. Språkmodellen er fra 400 MB til 9 GB avhengig av hvor
mye minne du har. Senere oppstarter tar sekunder.

Skriptet spør før det laster ned. På macOS spør det i tillegg før det installerer Ollama, siden den kjører nativt der; på Linux og WSL kjører Ollama i container og installeres ikke. `./start.sh -y` hopper over alle spørsmål.

Stopp med `./start.sh -d`.

På Windows: kjør skriptet fra Git Bash eller WSL. Da får du plattformdeteksjon,
automatisk modellvalg basert på minnet i maskinen, og verifisering av at modellen
faktisk svarer.

`start.bat` og `stop.bat` finnes i repoet, men de er et nødløsningsalternativ, ikke en
ekvivalent: `start.bat` kjører blankt `docker compose up -d` og venter 15 sekunder.
Den tar ingen flagg — heller ikke `--mock` — laster ikke ned modell, og sjekker ikke
at noe faktisk kom opp. Foretrekk Git Bash eller WSL hvis du har valget.

### Valg

Du skal normalt ikke trenge noen av disse.

| Flagg | |
|---|---|
| `-m, --model MODEL` | Bruk en bestemt modell i stedet for den automatisk valgte |
| `-y, --yes` | Ikke spør før installasjon eller nedlasting |
| `--mock` | Kjør uten språkmodell. Raskeste vei inn, og redningen når nedlasting ikke er mulig |
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
curl -s http://localhost:8082/helse
```

`"modellNaaBar": true` betyr at provideren svarer og modellen er lastet ned. Er den `false`, følger et `feil`-felt som sier hvorfor. Merk at status alltid er 200 — tjenesten lever selv om modellen ikke gjør det, så det er `modellNaaBar` du skal lese.

Er modellen nede, faller `ai-gateway` tilbake til maltekst og setter et `advarsel`-felt. `/chat` og `/agent` viser en gul stripe når det skjer, og `./start.sh` advarer ved oppstart — men svarene i seg selv ser normale ut, så det er verdt å vite hvor du sjekker.

### Se hva modellen faktisk gjorde

```
http://localhost:8082/trace
```

Ett kall per linje, nyeste øverst, med full prompt og fullt svar før heuristikk og validering har vært innom — pluss varighet, modell og om det feilet. Samme data som JSON på `GET /trace.json`, med `?sporingsId=`, `?task=` og `?limit=`.

Sporet ligger i `state/ai-trace.jsonl` og nullstilles av `./start.sh --reset`.

Logger: `docker compose logs -f ai-gateway`.

### Manuell oppstart

`./start.sh` gjør dette for deg. Les skriptet hvis du vil se detaljene — det er kommentert.

macOS, med Ollama nativt på verten:

```bash
brew services start ollama    # ikke "ollama serve" — den dør når terminalen lukkes
ollama pull qwen2.5:14b
cp .env.example .env          # OLLAMA_BASE_URL=http://host.docker.internal:11434
docker compose up -d --no-deps sandbox-backend fiks-simulator ai-gateway \
  mcp-services process-agent matrikkel-mock demo-gui process-builder
```

`matrikkel-mock` må være med. `--no-deps` hopper over `mcp-services`' `depends_on`,
så uten den feiler alle `matrikkel_*`-verktøy og hele `fartsdempende-tiltak`-casen
med «fetch failed» mens alt annet ser normalt ut.

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

`./start.sh` starter alle sammen, så du trenger ikke velge. Kolonnen til venstre sier
hva du må bry deg om hvis noe feiler.

| | Tjeneste | Port | Rolle |
|---|---|---:|---|
| **Kjerne** | `sandbox-backend` | `8080` | Orkestrering, data, revisjon og prosesser |
| **Kjerne** | `fiks-simulator` | `8081` | Mock av samtykke, register og oppgaver |
| **Kjerne** | `ai-gateway` | `8082` | KI-støtte og forklaringer (Ollama, OpenRouter eller mock) |
| **Kjerne** | `matrikkel-mock` | `8085` | Mock av Kartverket Matrikkel Geointegrasjon BasisService |
| **Kjerne** | `demo-gui` | `3001` | Demo-app for innbyggerdialog |
| Nyttig | `process-builder` | `3000` | Prosessbygger for dialogflyter |
| Nyttig | `mcp-services` | `8083` | 25 verktøy over backend- og AI-tjenester (REST, ikke MCP-protokollen) |
| Nyttig | `process-agent` | `8084` | Generisk agent som guider bruker gjennom prosesser |
| Støtte | `ollama` | `11434` | Lokal LLM-runtime. Kjører ikke med `--mock`, og på macOS kjører den nativt utenfor Docker |
| Til editoren din | `brreg-mcp` | — | Ekte MCP (stdio) — oppslag i Enhetsregisteret |
| Til editoren din | `folkeregister-mcp` | — | Ekte MCP (stdio) — oppslag i Folkeregisteret |

**De to siste er ikke en del av demoflyten.** Ingenting i sandboxen snakker med dem —
de er ekte MCP-servere som en klient som Claude Code eller Cursor starter selv. De
fire verktøyene deres finnes også i `mcp-services` over REST, mot de samme
seed-filene, så de utvider ikke sandboxen. Vil du ha dem i editoren, se
`## Koble MCP-serverne til editoren din` under.

Ikke forveksle `mcp-services` med disse: den er REST, ikke MCP-protokollen, tross navnet.

**`matrikkel-mock` er kjerne, selv om den ser valgfri ut.** Uten den feiler alle
`matrikkel_*`-verktøy og hele `fartsdempende-tiltak`-casen med «fetch failed», mens
alt annet ser normalt ut.

Alle tjenestene kjører når `./start.sh` er ferdig:

- [http://localhost:3001](http://localhost:3001) — oversikt, start her
- [http://localhost:3001/chat](http://localhost:3001/chat)
- [http://localhost:3001/agent](http://localhost:3001/agent)
- [http://localhost:3001/stegvis](http://localhost:3001/stegvis)
- [http://localhost:3001/utforsker](http://localhost:3001/utforsker) — API-utforskeren: alle sju
  tjenestenes endepunkter, med skjema per rute og en `curl` som virker når den limes inn.
  Tokenet velges automatisk ut fra hjemmelen ruta krever: logg inn med ID-porten én gang,
  så hentes Maskinporten-tokenene av seg selv
- [http://localhost:3001/ds-eksempel](http://localhost:3001/ds-eksempel) — KS Digital sitt
  designsystem kjørende i sandboxen, med markup for hver komponent. Mal hvis du lager din
  egen frontend. Se `docs/designsystem.md`
- [http://localhost:3000](http://localhost:3000) — prosessbygger
- [http://localhost:8080/helse](http://localhost:8080/helse)
- [http://localhost:8081/helse](http://localhost:8081/helse)
- [http://localhost:8085/helse](http://localhost:8085/helse)
- [http://localhost:8082/helse](http://localhost:8082/helse)
- [http://localhost:8083/helse](http://localhost:8083/helse)
- [http://localhost:8084/helse](http://localhost:8084/helse)
- [http://localhost:8086/helse](http://localhost:8086/helse)
- [http://localhost:8080/docs](http://localhost:8080/docs)
- [http://localhost:8081/docs](http://localhost:8081/docs)
- [http://localhost:8082/docs](http://localhost:8082/docs)
- [http://localhost:8083/docs](http://localhost:8083/docs)
- [http://localhost:8084/docs](http://localhost:8084/docs)
- [http://localhost:8085/docs](http://localhost:8085/docs)
- [http://localhost:8086/docs](http://localhost:8086/docs)

Hver tjeneste serverer sin egen spesifikasjon på `/openapi.yaml`, og den samme
spesifikasjonen lest som JSON på `/openapi-ruter.json`. Den siste er det
API-utforskeren rendrer, og `pnpm test:openapi` holder begge i takt med koden.

Nye API-er:

- `GET /mcp/tools` pa `http://localhost:8083`
- `POST /agent/sessions` pa `http://localhost:8084`

## Koble MCP-serverne til editoren din

`brreg-mcp` og `folkeregister-mcp` er ekte MCP over stdio. De gir fire
oppslagsverktøy mot registerdataene — de samme oppslagene `mcp-services` allerede
eksponerer over REST, så de utvider ikke sandboxen. I Claude Code, fra repo-roten:

```bash
claude mcp add brreg -- node "$PWD/apps/brreg-mcp/src/server.js"
claude mcp add folkeregister -- node "$PWD/apps/folkeregister-mcp/src/server.js"
```

Detaljer, klientkonfigurasjon for andre editorer og verifisering med
`@modelcontextprotocol/inspector`: `apps/brreg-mcp/README.md`.

## Demo-bruker

Anbefalt demo-bruker for første flyt:

- `person-001` — `Maja Solberg`

Data finnes i `data/personer.json`. **`docs/testpersoner.md` er den genererte
oversikten over hele befolkningen** — 394 personer med alder, status, husstand og
en kolonne som sier om personen kan logge inn, bare være part, eller ingen av
delene. `docs/syntetiske-data.md` forklarer datagrunnlaget.

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

Gateoppslag kan kjore direkte mot Geonorge fra `mcp-services`, og `matrikkel-mock` starter fra seed-datasettet ved oppstart:

```bash
MATRIKKEL_MODE=live pnpm start:mcp
```

Sjekk hvilken datakilde `matrikkel-mock` faktisk bruker akkurat naa:

```bash
pnpm check:matrikkel-source
```

I `docker compose` er `mcp-services` satt opp med `MATRIKKEL_MODE=hybrid` som standard —
ikke `live`. `live` kaster videre ved nettfeil, så dårlig konferansenett gjør hvert
gateoppslag til en 500. `hybrid` prøver Geonorge først og faller tilbake til seed-dataene.
Kodens egen default uten miljøvariabel er `mock`, men den ser du bare hvis du starter
`mcp-services` utenfor compose.

`matrikkel-mock` starter fra `data/matrikkel.json` — 388 gater i 97 kommuner med koordinater —
og faller tilbake til live Geonorge-oppslag ved manglende treff. Den er den eneste
leseren av matrikkelseeden; `sandbox-backend` går over HTTP via `MATRIKKEL_BASE_URL`.

Hent matrikkeldata (REST-hjelpeendepunkt):

```bash
curl -s "http://localhost:8085/mock/matrikkel/eiendommer?gate=Storgata"
```

Hent én konkret adresse i matrikkel-mocken:

```bash
curl -s "http://localhost:8085/mock/matrikkel/eiendom-oppslag?adresse=Storgata%205"
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

Kjør en enkel end-to-end smoke test mot agenten:

```bash
npx pnpm test:agent
```

## Sjekker du kan kjøre

Disse krever ingen kjørende tjenester og ingen modell:

```bash
pnpm lint            # tsc --noEmit
pnpm test            # referanseintegritet og scenariodekning i datasettene
pnpm test:kontrakt   # starter egen backend + fiks og skriver en deterministisk dump
```

`pnpm test:kontrakt` normaliserer id-er og tidsstempler, så to kjøringer av samme
kode gir bit-identisk resultat. Bruk den som regresjonsport rundt refaktoreringer:

```bash
pnpm test:kontrakt --ut state/foer.json
# ...endre noe...
pnpm test:kontrakt --ut state/etter.json
diff state/foer.json state/etter.json
```

**Endrer du en prompt, kjør evalene.** `pnpm test:eval` scorer KI-laget mot
datasettene i `evals/`, med terskel per datasett og exit≠0 under. Den krever en
kjørende modell og nekter å score maltekst. Ta en baseline før du endrer, og
sammenlign etterpå — se `evals/README.md`.

Disse krever at stacken kjører: `pnpm test:agent`, `test:agent:nl`,
`test:matrikkel-mock`, `test:mcp-matrikkel`, `test:agent:matrikkel`,
`test:bergen-matrikkel`.

Bulk-smoketesten mot matrikkel-mocken sampler 40 gater og 25 adresser fra
seed-datasettet:

```bash
npx pnpm test:bergen-matrikkel
```

Den krever **nett**: adresser som bommer i seed-fila slår over på live
Geonorge-oppslag, og uten nett svarer matrikkel-mock 500.

De to MCP-serverne testes hver for seg, og de krever verken nett eller kjørende
stack — de spawnes som subprosess:

```bash
pnpm test:brreg-mcp
pnpm test:folkeregister-mcp
```

## Hvor syntetiske data ligger

Syntetiske data ligger under `data/`:

- `data/personer.json` — 369 personer
- `data/husstander.json` — 200 husstander
- `data/tenor/` — rå uttrekk fra Tenor, kilden importen bygger på
- `data/forventet-utfall.json` — hva hver husstand er ment å demonstrere, pinnet for `pnpm test`
- `data/inntekter.json`
- `data/barnehageplasser.json`
- `data/sfoplasser.json`
- `data/satser.json`
- `data/fritidsaktiviteter.json` og `data/fritidsdeltakelse.json` — grunnlaget for fritidskort
- `data/tjenestetilbud.json` — kommunale tilbud med målgruppe og kapasitet, grunnlaget for støttekontakt
- `data/matrikkel.json` — 388 gater og 18 349 eiendommer i 97 kommuner, lest av `matrikkel-mock`
- `data/eierforhold.json` — tinglyst eierskap per matrikkelenhet, slått sammen av `matrikkel-mock` ved innlasting
- `data/matrikkel.seed.json` — liten firegaters fixture for mockens egne tester
- `data/prosessdefinisjoner.json`
- `data/informasjonsmodeller.json`

`matrikkel-mock` er eneste leser av matrikkeldataene. `sandbox-backend` kaller den over
HTTP, så det finnes bare én matrikkel i sandkassen — den som også snakker SOAP.

Søknader, samtykker, oppgaver, meldinger, prosessøkter og revisjonslogg har **ingen**
fil i `data/`. De oppstår først under kjøring og finnes bare i `state/`, som er
gitignorert. Se `docs/syntetiske-data.md`.

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
5. Lagre filer som UTF-8 (Unicode) slik at norske tegn bevares korrekt

## Samarbeid

Dette repoet er lagt opp for flere team. Se:

- `CONTRIBUTING.md`
- `openapi/README.md`
- `docs/architecture.md`
- `docs/api-oversikt.md`
- `docs/api-foerst-integrasjoner.md`
- `docs/designsystem.md`
- `docs/veien-videre.md`

Anbefalt arbeidsform:

- ett team per tjeneste eller arbeidsstrøm
- små PR-er med tydelig scope
- dokumentasjon oppdateres sammen med kode
- API-kontrakter avklares før implementasjon
- bruk sandboxens referanseimplementasjoner hvis de sparer tid, men stå fritt til å lage egne løsninger oppå de samme API-ene

## Kjente begrensninger

- Tjenestene er bygget som en enkel null-avhengighets MVP, ikke som produksjonsklar applikasjon
- CI kjører `pnpm lint`, `pnpm test`, `pnpm test:sperrer`, `pnpm test:skjerming`,
  `pnpm test:samtykke`, `pnpm test:openapi` og `pnpm test:kontrakt` på PR. Evalene og
  stack-testene gjør den ikke — de krever en modell eller en kjørende stack
- Ingen persistensstrategi utover flate JSON-filer. `process-agent` holder sesjoner i
  minnet og mister dem ved restart
- Datasett og policyer er laget for demo og hackathon, ikke produksjon
- Ingen ekte integrasjoner mot Altinn, Fiks, ID-porten eller Maskinporten
- `mcp-services` er **ikke** MCP-protokollen, tross navnet. Se `docs/architecture.md`

## Viktige filer

- `docker-compose.yml`
- `pnpm-workspace.yaml`
- `package.json`
- `docs/architecture.md`
- `docs/api-foerst-integrasjoner.md`
- `docs/veien-videre.md`
- `docs/sikkerhet-og-personvern.md`
- `policies/data-policy.yaml`
