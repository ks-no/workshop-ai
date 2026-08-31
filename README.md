<p align="center">
  <img src="docs/assets/ks-digital-logo.png" alt="KS Digital" width="360">
</p>

# Innbyggerdialog Sandbox

En samarbeidsvennlig sandkasse for hackathon og utforskning av moderne innbyggerdialog i kommunal sektor.

Målet er å gjøre det enkelt for interne og eksterne utviklingsteam å prototype kommunale tjenester med syntetiske data, tydelige API-er, sporbarhet og mockede integrasjoner. Hvilken form tjenesten får - dialog, skjema, oversikt, varsling eller noe annet - er teamets valg.

## Før du begynner

Dette må du ha installert på maskinen din:

| Hva                               | Trengs til | Hent den |
|-----------------------------------|---|---|
| **Docker**, installert og startet | å kjøre sandkassen. Det eneste kravet for `./start.sh --mock` | [docs.docker.com](https://docs.docker.com/get-docker/) |
| **git**                           | å hente repoet | [git-scm.com](https://git-scm.com/downloads) |
| **Node 22.18 eller nyere**        | å hente et token (`node scripts/token.ts`), og å kjøre testskriptene. **Nesten alle API-kall krever token**, så i praksis trenger du Node så snart du gjør noe selv | [nodejs.org](https://nodejs.org/en/download) |
| **pnpm**                          | å kjøre `pnpm <skript>` i det hele tatt. `pnpm install` i tillegg bare til `pnpm lint`, live reload på Windows, og Bedrock-provideren - verken sandkassen eller de andre testskriptene trenger et `pnpm install` | [pnpm.io](https://pnpm.io/installation) |
| **Homebrew** (bare macOS)         | at skriptet kan installere Ollama for deg. Ikke nødvendig med `--mock` | [brew.sh](https://brew.sh) |

Har du allerede Node, er `corepack enable` som regel nok til å få pnpm - `package.json`
sier hvilken versjon som skal brukes. Følger ikke Corepack med din Node-versjon, tar
lenken over de andre veiene.

Sjekk at du har det:

```bash
docker --version && node --version && git --version
```

**Portene `3000`, `3001`, `8080`–`8087` og `11434` må være ledige.** Er en av dem
opptatt, står det i `docs/feilsoking.md` hvordan du finner ut hvilken.

**Sett av tid første gang: 4-7 minutter** med `./start.sh --mock`, **12–25 minutter**
med språkmodell, og vesentlig mer på delt konferansenett. Språkmodellen er fra 400 MB
til 9 GB avhengig av hvor mye minne maskinen har. Senere oppstarter tar sekunder.

På Windows: kjør fra Git Bash (følger med Git for Windows) eller [WSL](https://learn.microsoft.com/windows/wsl/install) - se [«På Windows»](#på-windows) lenger ned.

> [!NOTE]
> **Deltaker på hackathon? Denne filen er ikke inngangen din.** Tre sider, i rekkefølge:
>
> 1. [`docs/oppdraget.md`](docs/oppdraget.md) - hva dere skal lage, og hva som er fritt
> 2. [`docs/deltakerstart.md`](docs/deltakerstart.md) - én kommando, URL-ene, hvilken
>    demobruker som hører til hvilken case, første eget API-kall, og feilsøking
> 3. [`docs/bygg-selv.md`](docs/bygg-selv.md) - egen frontend på egen port, egne
>    tjenester, og hva som er frosset
>
> Kom tilbake hit når du vil ha hele bildet: alle flagg, porter og kjente begrensninger.

## Hva sandkassen er

Sandkassen er en lokal utviklingsarena for å utforske hvordan innbyggere kan møte kommunen. Demoene her er dialogbaserte fordi en samtale var raskeste vei til å ta i bruk alle API-ene samtidig - ikke fordi dialog er svaret. Se `docs/oppdraget.md`.

Seks demo-case er publisert; `Redusert foreldrebetaling i barnehage` er
flaggskipet og det eneste som er dekket av en informasjonsmodell. Casene og hvilken
testbruker som hører til hver, står i `docs/deltakerstart.md`.

Arkitekturen er lagt opp for samarbeid mellom flere team, med tydelige grenser mellom frontend, backend, simulatorer, policyer og datasett.

## Designprinsipp for hackathon

Høy autonomi, og nok støtte til at teamene faktisk rekker å levere: felles API-er og enkle integrasjonsflater, uten å låse noen til én bestemt frontend, ett bestemt prosessformat eller ett bestemt verktøy. Referanseimplementasjonene i repoet, som `process-builder` og `demo-gui`, er hjelpemidler og eksempler - ikke tvungne måter å bygge løsningene på.

## Status

Ti kjørende tjenester, én valgfri avhengighet i kjøretid, seks komplette demo-case. På plass:

- samtykkeflyt med sperre på inntektsdata uten samtykke, håndhevet ett sted
- revisjonslogg over all datatilgang
- deterministisk vilkårsvurdering mot satser (`SJEKK`) - utenfor modellen, med vilje
- syntetiske data forankret i Folkeregisterets informasjonsmodell og KS Fiks beregnings-API
- KI-spor: hvert modellkall lagres med prompt og svar, lesbart på `GET /trace`
- evals av KI-laget: `pnpm test:eval`
- OpenAPI for alle åtte API-tjenestene, komplett og holdt i takt med koden av
  `pnpm test:openapi`: hver rute dokumentert, med `security:` per rute

## Hvordan starte den

Kravene til maskinen står under [«Før du begynner»](#før-du-begynner).

**Vil du bare se noe kjøre? Start her:**

```bash
./start.sh --mock
```

Fire til sju minutter. Alt fungerer bortsett fra at KI-svarene er maltekst i
stedet for modellgenerert - flyten, samtykkesperren, revisjonsloggen og alle
API-ene er de samme. Dette er den riktige veien inn første gang, og den eneste
som ikke krever nedlasting av flere gigabyte.

Når du vil ha den ekte modellen:

```bash
./start.sh
```

Skriptet finner ut hvilken plattform du er på, velger modell ut fra minnet i
maskinen, starter tjenestene, og verifiserer at modellen faktisk svarer før den
melder klar.

Tidsbruken første gang står under [«Før du begynner»](#før-du-begynner); en stor modell
legger seg i overkant av det. Skriptet spør før det laster ned. På macOS spør det i tillegg før det installerer Ollama, siden den kjører nativt der; på Linux og WSL kjører Ollama i container og installeres ikke. `./start.sh -y` hopper over alle spørsmål.

Stopp med `./start.sh -d`.

### På Windows

Kjør skriptet fra Git Bash eller WSL. Da får du plattformdeteksjon,
automatisk modellvalg basert på minnet i maskinen, og verifisering av at modellen
faktisk svarer.

`start.bat` og `stop.bat` finnes i repoet, men de er et nødløsningsalternativ, ikke en
ekvivalent. `start.bat` sjekker portene, lager `.env` hvis den mangler, og venter til alle
ti tjenestene svarer på `/helse`. Den tar `--reset`, `--reload`, `-d`, `--down` og
`--help`, men ingen modellflagg. **Den kjører alltid uten
språkmodell** - den laster verken ned eller velger modell, så alt annet enn maltekst
ville vært en tom lovnad. Vil du ha en ekte modell, bruk Git Bash eller WSL og
`./start.sh`. Foretrekk uansett den veien hvis du har valget.

### Valg

Du skal normalt ikke trenge noen av disse.

| Flagg | |
|---|---|
| `-m, --model MODEL` | Bruk en bestemt modell i stedet for den automatisk valgte |
| `-y, --yes` | Ikke spør før installasjon eller nedlasting |
| `--mock` | Kjør uten språkmodell. Raskeste vei inn, og redningen når nedlasting ikke er mulig |
| `--reload` | Start Node-tjenestene på nytt så kodeendringer blir live. Det du trenger oftest etter første endring |
| `--reset` | Tøm `state/` og start fra kildedataene igjen |
| `-d, --down` | Stopp alt |
| `-h, --help` | Hjelp |

> [!WARNING]
> **`--reset` er ikke bare en reset.** Den tømmer `state/` og starter deretter alt på
> vanlig måte - inkludert modellnedlasting. Kjørte du `--mock`, skriv
> **`./start.sh --mock --reset`**, ellers begynner den å laste ned flere gigabyte.

### Hva skriptet gjør for deg

**Plattform** oppdages automatisk:

| Plattform | Hvordan Ollama kjøres |
|---|---|
| macOS | Nativt på verten. Docker Desktop når ikke Metal på Apple Silicon, så Ollama i container ville blitt ren CPU-inferens. |
| Linux med NVIDIA-GPU | I container, med `docker-compose.gpu.yml` |
| Linux og WSL ellers | I container, uten GPU |

**Modell** velges ut fra minnet på maskinen: 32 GB RAM eller mer gir `qwen2.5:14b`, 12 GB eller mer gir `qwen2.5:7b`, under det `qwen2.5:0.5b`.

Har du et NVIDIA-kort, leses også VRAM, og det mest restriktive av de to avgjør - en modell som får plass i RAM men ikke i VRAM blir splittet mot CPU og går tregt. Apple Silicon har unified memory, så der er RAM riktig tall.

Har du satt `OLLAMA_MODEL` i miljøet eller i `.env`, brukes den i stedet. `.env` opprettes fra `.env.example` hvis den mangler.

**Til slutt bekreftes det at modellen svarer.** Sier skriptet `⚠️ The model is NOT connected`, virker sandkassen fortsatt - men AI-svarene er maler. Vanligste årsak er at Ollama har stoppet.

### Kildedata og kjøringstilstand

`data/` er kildedata og skrives aldri til. Alt tjenestene endrer under kjøring havner i `state/`, som er gitignorert. En demokjøring skitner derfor ikke til arbeidstreet - kjører du en flyt og deretter `git status`, skal den være ren.

`./start.sh --reset` nullstiller `state/`. Se `docs/syntetiske-data.md`, også for hvordan du deler en prosess du har laget i byggeren.

### Hvis noe ikke virker

Kontroller at modellen er koblet på:

```bash
curl -s http://localhost:8082/helse
```

`"modellNaaBar": true` betyr at provideren svarer og modellen er lastet ned. Er den `false`, følger et `feil`-felt som sier hvorfor. Merk at status alltid er 200 - tjenesten lever selv om modellen ikke gjør det, så det er `modellNaaBar` du skal lese.

Er modellen nede, faller `ai-gateway` tilbake til maltekst og setter et `advarsel`-felt. `/chat` og `/agent` viser en gul stripe når det skjer, og `./start.sh` advarer ved oppstart - men svarene i seg selv ser normale ut, så det er verdt å vite hvor du sjekker.

Kontroller at alle tjenestene kjører:

```bash
docker compose ps
```

Alle skal stå som `healthy`.

Alt annet - `401` på alt, «fetch failed» på matrikkel-oppslag, maltekst du ikke ba
om, port opptatt, en container som ikke blir `healthy`, treg modellnedlasting og
hvordan du nullstiller - står i `docs/feilsoking.md`: ett symptom per avsnitt, med
årsak og løsning.

### Se hva modellen faktisk gjorde

```
http://localhost:8082/trace
```

Ett kall per linje, nyeste øverst, med full prompt og fullt svar før heuristikk og validering har vært innom - pluss varighet, modell og om det feilet. Samme data som JSON på `GET /trace.json`, med `?sporingsId=`, `?task=` og `?limit=`.

Sporet ligger i `state/ai-trace.jsonl` og nullstilles av `./start.sh --reset`.

Logger: `docker compose logs -f ai-gateway`.

### Manuell oppstart

`./start.sh` gjør dette for deg. Les skriptet hvis du vil se detaljene - det er kommentert.

macOS, med Ollama nativt på verten:

```bash
brew services start ollama    # ikke "ollama serve" - den dør når terminalen lukkes
ollama pull qwen2.5:14b
cp .env.example .env          # OLLAMA_BASE_URL=http://host.docker.internal:11434
docker compose up -d --no-deps sandbox-backend fiks-simulator ai-gateway \
  tools-api process-agent matrikkel-mock digdir-mock pasientjournal-mock \
  demo-gui process-builder
```

**Hele listen må med** - særlig `digdir-mock` og `matrikkel-mock`, som svikter stille
når de mangler. Hvordan de feiler står i punktlista under
[tjenesteoversikten](#oversikt-over-tjenester-og-porter).

`--no-deps` er nødvendig for å hoppe over `depends_on: ollama` i `ai-gateway`, som
ellers drar opp container-Ollama - men det er også grunnen til at listen må være
komplett: `--no-deps` slår av `depends_on` for *alle* tjenestene, `digdir-mock`
inkludert.

Linux og WSL, alt i Docker:

```bash
cp .env.example .env          # OLLAMA_BASE_URL=http://ollama:11434
docker compose up -d
```

Med NVIDIA-GPU: legg til `-f docker-compose.gpu.yml`. Verifiser at Docker har GPU-tilgang med `docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi` - feiler den, mangler [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).

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

`./start.sh` starter alle sammen, så du trenger ikke velge.

Tjenestene, portene og rollene deres ligger i `apps/shared/tjenester.json`, og
<http://localhost:3001> viser dem med levende helsestatus og en lenke rett inn i
API-utforskeren for hver.

Fire ting tabellen ikke sier, og som er verdt å vite før noe feiler:

- **`digdir-mock` (`8086`) utsteder alle tokens.** Er den nede, svarer hvert autentisert
  kall 401 mens `docker compose ps` ser helt frisk ut, fordi tokenfeilen svelges i
  klienten. Den skal alltid med når du starter tjenester manuelt.
- **`matrikkel-mock` (`8085`) er kjerne, selv om den ser valgfri ut.** Uten den feiler
  alle `matrikkel_*`-verktøy og hele `fartsdempende-tiltak`-casen med «fetch failed»,
  mens alt annet ser normalt ut.
- **`tools-api` (`8083`) er REST, ikke MCP.** Den svarer `protocol: "rest"`.
  `/mcp/*`-stiene står igjen - de er wire-format. Navnehistorikken står i
  `apps/tools-api/README.md`.
- **`brreg-mcp` og `folkeregister-mcp` har ingen port og er ikke del av demoflyten.** De
  er ekte MCP over stdio, som en klient som Claude Code eller Cursor starter selv. De
  fire verktøyene deres finnes også i `tools-api` over REST, mot de samme
  seed-filene, så de utvider ikke sandkassen. Se avsnittet under.

Hver API-tjeneste serverer sin egen spesifikasjon på `/openapi.yaml`, samme spesifikasjon
lest som JSON på `/openapi-ruter.json`, og en lesbar side på `/docs`. Den midterste er det
API-utforskeren rendrer, og `pnpm test:openapi` holder alle tre i takt med koden.


## Koble MCP-serverne til editoren din

`brreg-mcp` og `folkeregister-mcp` er ekte MCP over stdio. De gir fire
oppslagsverktøy mot registerdataene - de samme oppslagene `tools-api` allerede
eksponerer over REST, så de utvider ikke sandkassen. I Claude Code, fra repo-roten:

```bash
claude mcp add brreg -- node "$PWD/apps/brreg-mcp/src/server.ts"
claude mcp add folkeregister -- node "$PWD/apps/folkeregister-mcp/src/server.ts"
```

Detaljer, klientkonfigurasjon for andre editorer og verifisering med
`@modelcontextprotocol/inspector`: `apps/brreg-mcp/README.md`.

## Demo-brukere

Det finnes ikke én demo-bruker som passer alle casene - velg bruker etter case i
tabellen i `docs/deltakerstart.md` §3, som er pinnet i `data/deltakercaser.json`.
Til flaggskipcaset *Redusert foreldrebetaling (barnehage)* passer `person-001`
`Maja Solberg`; i flere av de andre casene gir hun korrekt avslag, så der velger
du bruker fra tabellen.

Data finnes i `data/personer.json`. **`docs/testpersoner.md` er den genererte
oversikten over hele befolkningen** - 394 personer med alder, status, husstand og
en kolonne som sier om personen kan logge inn, bare være part, eller ingen av
delene. `docs/syntetiske-data.md` forklarer datagrunnlaget.

## Demo-flyt

Flaggskipcaset *Redusert foreldrebetaling (barnehage)* kjører hele kjeden i én økt:
husstanden hentes og vises, samtykke innhentes før inntektsdata leses, vilkårene
vurderes deterministisk i backend, KI-laget oppsummerer i klarspråk, innbyggeren
bekrefter, søknaden sendes inn og oppretter en oppgave i Fiks-simulatoren - og
revisjonsloggen viser hver datatilgang underveis.

Demo-GUI-en er prosessdrevet: stegene leses fra valgt prosessdefinisjon, og flyten
kjøres via prosessøkt-API-et i backend. Alle seks casene, og hvilken testbruker som
hører til hver, står i tabellen i `docs/deltakerstart.md` §3, pinnet i
`data/deltakercaser.json`.

## Eksempel på API-kall

**Kall krever token.** `AUTH_ENFORCE` er på som standard, og alt som ikke er uttrykkelig
åpent svarer `401` uten `Authorization`-header.

```bash
export TOKEN=$(node scripts/token.ts --innbygger person-001)
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/personer/person-001/husstand
```

Ett token er én person: `person-001`s token åpner ikke `person-031`s data - det gir
`403`. `pnpm token` treffer pnpms egen innebygde kommando, så kall skriptet direkte.

Åpne ruter trenger ingenting: `/helse`, `/docs`, `/openapi.yaml`, `/api/prosesser`,
`/api/katalog/*`, `/api/regler/satser`. `GET /api/katalog/ressurser` oppgir `tilgang` og
`kreverSamtykke` per rute, så du kan lese ut av API-et selv hva som krever hva.

**Videre:**

- <http://localhost:3001/utforsker> - hver rute med skjema, riktig token valgt
  automatisk, og en `curl` som virker når den limes inn. Raskeste vei til et enkeltkall.
- `examples/curl/README.md` - flytene: hele barnehagesøknaden i rekkefølge, og de tre
  ulike svarene samme URL gir avhengig av token og samtykke. `pnpm test:kokebok` kjører
  hvert kall i filen, så et eksempel som ikke virker er en reell feil.


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
sammenlign etterpå - se `evals/README.md`.

Disse krever at stacken kjører: `pnpm test:agent`, `test:agent:nl`,
`test:matrikkel-mock`, `test:tools-matrikkel`, `test:agent:matrikkel`,
`test:bergen-matrikkel`.

Bulk-smoketesten mot matrikkel-mocken sampler 40 gater og 25 adresser fra
seed-datasettet:

```bash
pnpm test:bergen-matrikkel
```

Den krever **nett**: adresser som bommer i seed-filen slår over på live
Geonorge-oppslag, og uten nett svarer matrikkel-mock 500.

De to MCP-serverne testes hver for seg, og de krever verken nett eller kjørende
stack - de spawnes som subprosess:

```bash
pnpm test:brreg-mcp
pnpm test:folkeregister-mcp
```

## Hvor syntetiske data ligger

Syntetiske data ligger under `data/`:

- `data/personer.json` - 394 personer
- `data/husstander.json` - 200 husstander
- `data/tenor/` - rå uttrekk fra Tenor, kilden importen bygger på
- `data/forventet-utfall.json` - hva hver husstand er ment å demonstrere, pinnet for `pnpm test`
- `data/inntekter.json`
- `data/barnehageplasser.json`
- `data/sfoplasser.json`
- `data/satser.json`
- `data/fritidsaktiviteter.json` og `data/fritidsdeltakelse.json` - grunnlaget for fritidskort
- `data/tjenestetilbud.json` - kommunale tilbud med målgruppe og kapasitet, grunnlaget for støttekontakt
- `data/legeerklaeringer.json` - legeerklæringer til TT-kort, lest av `pasientjournal-mock`
- `data/matrikkel.json` - 388 gater og 18 349 eiendommer i 97 kommuner, lest av `matrikkel-mock`
- `data/eierforhold.json` - tinglyst eierskap per matrikkelenhet, slått sammen av `matrikkel-mock` ved innlasting
- `data/matrikkel.seed.json` - liten firegaters fixture for mockens egne tester
- `data/prosessdefinisjoner.json`
- `data/informasjonsmodeller.json`

`matrikkel-mock` er eneste leser av matrikkeldataene. `sandbox-backend` kaller den over
HTTP, så det finnes bare én matrikkel i sandkassen - den som også snakker SOAP.

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
- `docs/designsystem.md`

## Kjente begrensninger

- Tjenestene er bygget som en enkel MVP uten byggesteg, ikke som produksjonsklar
  applikasjon. Én avhengighet finnes i kjøretid - AWS-SDK-en `ai-gateway` bruker til
  Bedrock - og den lastes først når den provideren brukes, så `docker compose up`
  klarer seg uten `pnpm install`
- CI kjører sjekkene som verken trenger modell eller kjørende stack. Listen står i
  `.github/workflows/ci.yml`, med en kommentar per steg om hva det fanger - den er
  kilden, og `pnpm test:docs` feiler hvis en doc gjengir den feil. Evalene og
  stack-testene er bevisst utenfor: de krever en modell eller en oppe stack
- Ingen persistensstrategi utover flate JSON-filer. `process-agent` holder sesjoner i
  minnet og mister dem ved restart
- Datasett og policyer er laget for demo og hackathon, ikke produksjon
- Ingen ekte integrasjoner mot Altinn eller Fiks. ID-porten og Maskinporten er
  mocket i `digdir-mock`, og **håndhevingen er ekte**: `AUTH_ENFORCE` er på, tokener
  verifiseres mot utstederens nøkler, og pid-bindingen holder. Det som er forenklet er
  klientassertionen - den valideres på form, ikke signatur. Se
  `apps/digdir-mock/README.md`
- `tools-api` er REST, ikke MCP. Bare `/mcp/*`-stiene bærer prefikset videre, som
  wire-format. Se `docs/architecture.md`

## Viktige filer

- `docs/deltakerstart.md` - start her hvis du er deltaker
- `docs/ordliste.md` - forvaltningstermene forklart slik de brukes i sandkassen
- `apps/shared/tjenester.json` - tjenestene, portene, rollene. Sannhetskilden
- `data/` - de syntetiske datasettene. `docs/syntetiske-data.md` forklarer dem
- `openapi/` - én spesifikasjon per API-tjeneste, holdt i takt av `pnpm test:openapi`
- `policies/` - datapolicy, KI-policy, tilgangspolicy
- `docker-compose.yml`, `package.json`, `tsconfig.json`
