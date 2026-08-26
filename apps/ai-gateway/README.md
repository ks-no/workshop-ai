# AI Gateway

**For deg som skal bruke eller endre KI-laget.** Ett API foran modellene: oppsummering,
tolkning, klarspråk og frie spørsmål fra innbygger — med sperrer som kjører i kode,
provider-bytte uten restart, og fullt spor av hvert modellkall. Lurer du bare på om
modellen er koblet på, hopp til «Er modellen koblet på?».

Stack: Node.js med innebygd HTTP-server, null avhengigheter. Ingen SDK — providerne
kalles med rå `fetch`.

## Endepunkter

Ti, alle `POST`:

| Endepunkt | Bruk | Kalles av |
|---|---|---|
| `/ai/oppsummering` | Formulerer `SUMMARY`-steget | `sandbox-backend` |
| `/ai/tolk-svar` | Ja/nei/ukjent-klassifisering | `process-agent`, `tools-api` |
| `/ai/velg-prosess` | Matcher fritekst mot prosess | `process-agent` |
| `/ai/velg-verktoy` | Velger MCP-verktøy per steg | `tools-api` |
| `/ai/klarsprak` | Klarspråk-omskriving | ingen — fritt vilt |
| `/ai/forklar-databruk` | Forklarer hvilke data som brukes | ingen — fritt vilt |
| `/ai/dialogforslag` | Foreslår neste replikk | ingen — fritt vilt |
| `/ai/risikosjekk` | Enkel risikovurdering | ingen — fritt vilt |
| `/ai/sporsmaal` | Fritt spørsmål fra innbygger, midt i en flyt | `demo-gui /chat`, `tools-api` |
| `/ai/dommer` | Scorer en tekst mot et kriterium (LLM-as-judge) | `scripts/eval.ts` |

**Kroppsformat:** alt innhold ligger under `kontekst`, *unntatt* `/ai/tolk-svar` og
`/ai/sporsmaal`, som tar `tekst` på toppnivå.

```bash
curl -s -X POST http://localhost:8082/ai/klarsprak \
  -H "Content-Type: application/json" \
  -d '{"kontekst":{"tjeneste":"barnehage"},"sprak":"nb"}'

curl -s -X POST http://localhost:8082/ai/tolk-svar \
  -H "Content-Type: application/json" \
  -d '{"tekst":"ja, det er greit"}'

# Uten satser i kontekst avvises spørsmål om inntektsgrenser i stedet for å gjettes på.
curl -s -X POST http://localhost:8082/ai/sporsmaal \
  -H "Content-Type: application/json" \
  -d "{\"tekst\":\"hva er inntektsgrensen for gratis kjernetid?\",\"sprak\":\"nb\",
       \"kontekst\":{\"tjeneste\":\"Redusert foreldrebetaling\",
       \"satser\":$(curl -s http://localhost:8080/api/regler/satser)}}"
```

## Sperrene på `/ai/sporsmaal`

Dette er det eneste endepunktet der en innbygger skriver fritekst og får fritekst
tilbake. Alle andre KI-svar gjengir enten en verdi `sandbox-backend` allerede har
avgjort, eller er en klassifisering som valideres mot en hviteliste. Her komponerer
modellen, og da er promptinstrukser alene ingen sperre.

Sperrene ligger i `src/sporsmaalsperrer.ts` — en modul uten avhengigheter, holdt utenfor
`server.ts` fordi den fila kaller `server.listen` på toppnivå og derfor ikke kan
importeres av en test. `pnpm test:sperrer` dekker dem og kjører i CI uten stack og uten
modell.

| Sperre | Fanger |
|---|---|
| `injeksjon` | «ignorer instruksjonene», rolleovertakelse, kodeblokker, over 500 tegn. Modellen kalles ikke |
| `manglende-grunnlag:<tema>` | Spørsmål om et tema det ikke finnes kilde for. Modellen kalles ikke |
| `beslutning` | «du har rett til», «jeg innvilger», «avslag» — med unntak for å gjengi et utfall som står ordrett i grunnlaget |
| `ikke-utfort` | «søknaden er sendt inn» når `flyt.soknadSendt` er `false` |
| `tall` | Beløp som ikke finnes i grunnlaget. Bare tall ≥ 1000 eller merket med `kr`/`%` sjekkes, så årstall og stegtellere gir ikke falske treff |
| `identifikator` | Fødselsnummer eller orgnr som ikke står i grunnlaget |
| `promptlekkasje` | Svaret gjengir promptstrukturen |
| `lengde` | Over 800 tegn |

Personvernspørsmål går ikke til modellen i det hele tatt. De besvares fra `PERSONVERN` i
samme modul. En oppdiktet personvernpåstand har ingen kjennetegn en kodesjekk kan finne —
verken tall eller beslutning — og «opplysningene lagres ikke uten samtykke» er flytende,
troverdig og ikke sant om dette systemet.

**Endepunktet har ingen dataadgang av seg selv.** Det slår ingenting opp og kaller ikke
`sandbox-backend` for data. Derfor kan det ikke omgå samtykkesperren i `utforRessurs()` —
det finnes ikke noe å omgå. Ikke gi det en dataklient mot backend.

Slår en sperre inn, beholdes ekte modell-id med suffikset `(sperret)`, slik at
`GET /trace` fortsatt viser hva modellen faktisk svarte. En sperre som skjuler
bevismaterialet er verre enn ingen.

## Heuristikk først, modell som fallback

`tolk-svar`, `velg-prosess` og `velg-verktoy` kjører en heuristikk **først** og går bare
til modellen når den ikke treffer med nok trygghet. Alle modellsvar går gjennom
`parseJsonObject` og en `validate*`-whitelist som avviser hallusinerte id-er. Det er
derfor `"ja"` svarer med `modell: "heuristisk-tolkning"` uten å røre modellen i det hele tatt.

## Modellen tar ikke avgjørelser

`buildPrompt` legger inn eksplisitte sperrer for `oppsummering`: gjengi tall, beløp,
datoer og navn nøyaktig, ikke regn ut noe selv, ikke innvilg eller avslå. Vilkårs-
vurderingen er `SJEKK`-steget i `sandbox-backend`, deterministisk og etterprøvbart.
Se `ai-no-decisions` i `policies/ai-policy.yaml`.

Provider-modus:

- `AI_PROVIDER=mock` (kodens default, ingen ekstern modell — men se under)
- `AI_PROVIDER=ollama` (lokal gratis modell via Ollama, kjørt i Docker Compose)
- `AI_PROVIDER=openrouter` (billige/gratis modeller via OpenRouter)
- `AI_PROVIDER=bedrock` (AWS Bedrock, Anthropic-modeller — se eget avsnitt under)

Merk at kodens default er `mock`, men både `.env.example` og `docker-compose.yml`
setter `ollama`. Siden `./start.sh` kopierer `.env.example` til `.env`, er den
effektive standarden i en kjørende sandkasse `ollama`.

Valgfrie miljovariabler:

- `OLLAMA_BASE_URL` (standard `http://localhost:11434`)
- `OLLAMA_MODEL` (standard `qwen2.5:7b`)
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL` (standard `mistralai/mistral-7b-instruct:free`)
- `BEDROCK_AWS_REGION`, `BEDROCK_AWS_ACCESS_KEY_ID`, `BEDROCK_AWS_SECRET_ACCESS_KEY`, `BEDROCK_AWS_SESSION_TOKEN`, `BEDROCK_MODEL_ID`

`AI_PROVIDER` og de variablene bare setter *startverdien*. Se `/admin` under for å
bytte mens tjenesten kjører.

## Bytt provider uten restart: `/admin`

```
http://localhost:8082/admin
```

En side som viser hvilken provider som er aktiv og lar deg bytte mellom
mock/ollama/openrouter/bedrock — og for Bedrock, hvilken modell — med et par klikk.
Byttet gjelder umiddelbart og skrives til `state/ai-provider-override.json`, som
overstyrer `AI_PROVIDER`/`BEDROCK_MODEL_ID` fra miljøet ved neste oppstart. Fila er
i `state/` sammen med resten av kjøretidsdataene: gitignored, nullstilt av
`./start.sh --reset`.

Samme ting via API:

```bash
curl -s http://localhost:8082/admin/providers.json

curl -s -X POST http://localhost:8082/admin/provider \
  -H "Content-Type: application/json" \
  -d '{"provider":"bedrock","bedrockModel":"eu.anthropic.claude-haiku-4-5-20251001-v1:0"}'
```

`provider` valideres mot en hviteliste og `bedrockModel` mot listen i `BEDROCK_MODELS`
(`src/server.ts`) — en ukjent verdi for begge gir 400, ikke et forsøk på å bruke den.

Lagt inn som en fjerde provider, ikke en erstatning: koden fortsatt velger mellom
`callOllama`/`callOpenRouter`/`callBedrock` i `callModel`, akkurat som beskrevet i
"Legge til en ny provider" under. En eventuell femte provider er samme oppskrift —
en funksjon med signaturen `(prompt, temperatur, signal)`, en gren i `callModel`, og
et navn lagt til i `AI_PROVIDERS`.

### AWS Bedrock

Gatewayen kaller Bedrock med rå `fetch` og signerer selv med AWS Signature Version 4
(`node:crypto`, ingen AWS SDK — samme "ingen SDK"-linje som resten av tjenesten). Se
`signAwsRequestV4`/`callBedrock` i `src/server.ts`. Modellene i `/admin` er en
kuratert liste (`BEDROCK_MODELS`), ikke hentet live fra AWS.

Du får utdelte AWS-nøkler, ferdig begrenset til `bedrock:InvokeModel` på de riktige
modellene — hvordan de ble laget er ikke noe du trenger å tenke på. Legg dem i `.env`:

```
BEDROCK_AWS_REGION=eu-north-1
BEDROCK_AWS_ACCESS_KEY_ID=...
BEDROCK_AWS_SECRET_ACCESS_KEY=...
BEDROCK_AWS_SESSION_TOKEN=...
BEDROCK_MODEL_ID=eu.anthropic.claude-sonnet-4-5-20250929-v1:0
```

`docker-compose.yml` plukker `BEDROCK_AWS_*` og `BEDROCK_MODEL_ID` opp fra `.env`
automatisk (se `ai-gateway`-tjenesten der) — ingenting annet å konfigurere. Modellen
kan også velges om i `/admin` uten restart.

Kun Anthropic-modeller er støttet: `callBedrock` bygger requesten i Anthropics
Messages-format (`anthropic_version: "bedrock-2023-05-31"`). Titan, Nova, Llama og
Mistral på Bedrock har hver sin body-form og er ikke bygget.

## Er modellen koblet på?

Ved feil hos provideren faller gatewayen tilbake til `mock-ai-gateway` og setter et
`advarsel`-felt. Du får fortsatt velformet norsk tekst — bare fra en mal. Det er tre
steder å oppdage det:

```bash
curl -s http://localhost:8082/helse
```

```json
{ "provider": "ollama", "modell": "ollama:qwen2.5:14b", "modellNaaBar": true }
```

`modellNaaBar: false` kommer med et `feil`-felt som sier hvorfor — Ollama er ikke nåbar,
modellen er ikke lastet ned, `OPENROUTER_API_KEY` mangler, `BEDROCK_AWS_ACCESS_KEY_ID`/$
`BEDROCK_AWS_SECRET_ACCESS_KEY` mangler, eller `AI_PROVIDER=mock`. Merk at status alltid er
200: tjenesten *lever* selv om modellen ikke gjør det. Som for OpenRouter sjekker
Bedrock-sjekken bare at nøklene er satt — den kaller ikke AWS, så en feil nøkkel eller
en modell IAM-policyen ikke tillater rapporteres som tilgjengelig og feiler først på
neste faktiske kall.

`demo-gui` sjekker dette ved sidelast og viser en gul stripe på `/chat` og `/agent` når
modellen ikke er koblet på. Enkeltsvar som faller tilbake vises også i samtalen.

`./start.sh` gjør et ekte `/ai/klarsprak`-kall til slutt og advarer tydelig hvis svaret
har `advarsel`.

## KI-spor

Alle modellkall går gjennom én funksjon, `callModel`, som skriver én JSONL-linje per
kall til `state/ai-trace.jsonl`. Feltene er engelske, siden sporet er utviklerverktøy
og ikke tjenestekontrakt: `timestamp`, `sporingsId`, `task`, `provider`, `model`,
`temperature`, `prompt`, `response`, `durationMs`, `failed`, `error`.

- `http://localhost:8082/trace` — HTML, nyeste øverst, prompt og svar utfellbart
- `GET /trace.json` — samme som JSON, med `?sporingsId=`, `?task=` og `?limit=`

Dette er der du ser hva modellen faktisk fikk, før heuristikk og validering har vært
innom. Sporet nullstilles av `./start.sh --reset`.

```bash
curl -s "http://localhost:8082/trace.json?task=oppsummering&limit=1"
```

## Timeout

Alle kall mot modellen avbrytes etter `AI_TIMEOUT_MS` (standard 180000). Uten det henger
et kall ubestemt når Ollama er treg eller halvveis oppe, og det ser ut som at sandkassen
har hengt seg. Ved timeout får du vanlig fallback med
`advarsel: "Provider ollama feilet: Modellen svarte ikke innen 180000 ms"`.

Vanligste årsak på macOS: Ollama har stoppet. `ollama serve` kjørt manuelt i en terminal
dør når vinduet lukkes — bruk `brew services start ollama` og sjekk med
`brew services list | grep ollama`.

## Legge til en ny provider

Provider-laget er ett sted. `callModel` velger mellom `callOllama`, `callOpenRouter` og
`callBedrock`, som alle tar `(prompt, temperatur, signal)` og returnerer
`{ tekst, modell }`. En ny provider er én funksjon med den signaturen pluss en gren i
`callModel` — ikke seks kopier slik det var før.

**Én gren er ikke helt sant i dag.** Providernavnet står også som literal i
`checkProvider` og i fire fallback-strenger, så en femte provider berører flere steder
enn dette avsnittet lover. Å samle dem i én tabell er en avgrenset opprydding.

## macOS: kjør Ollama nativt

`docker compose up` starter Ollama i en container, som ikke får Metal-tilgang på Apple
Silicon og bare ser Docker-VM-ens minne. `docker-compose.gpu.yml` er NVIDIA-only og har
ingen effekt. Kjør heller Ollama nativt og resten i Docker:

```bash
brew services start ollama
ollama pull qwen2.5:14b
# .env: AI_PROVIDER=ollama, OLLAMA_BASE_URL=http://host.docker.internal:11434
docker compose up -d --no-deps sandbox-backend fiks-simulator ai-gateway \
  tools-api process-agent matrikkel-mock digdir-mock demo-gui process-builder
```

`--no-deps` er nødvendig fordi `ai-gateway` har `depends_on: ollama`, som ellers drar
opp container-Ollama likevel. Men det slår av `depends_on` for alle, så `digdir-mock`
må navngis eksplisitt — uten den svarer hvert autentisert kall `401`.

Enklere: `./start.sh` gjør dette, med riktig liste.

Med standard `docker compose up --build` startes `ollama`, men modeller pulles ikke automatisk.

Pull valgt modell eksplisitt:

```bash
OLLAMA_MODEL=qwen2.5:7b docker compose --profile pull up ollama-pull-selected
```

GPU-støtte i Docker (NVIDIA):

- https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html

Start med GPU-override når Docker GPU-støtte er aktivert:

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d
```

Verifiser Docker GPU-tilgang:

```bash
docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
```

Eksempel p modellvalg:

- `OLLAMA_MODEL=qwen2.5:0.5b`
- `OLLAMA_MODEL=qwen2.5:7b`
- `OLLAMA_MODEL=qwen2.5:14b`
- `OLLAMA_MODEL=llama3.1:8b`
- `OLLAMA_MODEL=mistral-nemo`

