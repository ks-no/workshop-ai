# AI Gateway

Ansvar:

- levere dialogforslag
- generere oppsummering
- forklare databruk
- gi klarspråk og enkel risikosjekk
- velge prosess og verktøy, og tolke fritekstsvar
- tilby kontrollert generell LLM-chat for hackathon-team

Stack: Node.js med innebygd HTTP-server, null avhengigheter. Ingen SDK — providerne
kalles med rå `fetch`.

## Endepunkter

Alle AI-endepunkter er `POST`:

| Endepunkt | Bruk | Kalles av |
|---|---|---|
| `/ai/oppsummering` | Formulerer `SUMMARY`-steget | `sandbox-backend` |
| `/ai/tolk-svar` | Ja/nei/ukjent-klassifisering | `process-agent`, `mcp-services` |
| `/ai/velg-prosess` | Matcher fritekst mot prosess | `process-agent` |
| `/ai/velg-verktoy` | Velger MCP-verktøy per steg | `mcp-services` |
| `/ai/klarsprak` | Klarspråk-omskriving | ingen — fritt vilt |
| `/ai/forklar-databruk` | Forklarer hvilke data som brukes | ingen — fritt vilt |
| `/ai/dialogforslag` | Foreslår neste replikk | ingen — fritt vilt |
| `/ai/risikosjekk` | Enkel risikovurdering | ingen — fritt vilt |
| `/ai/dommer` | Scorer en tekst mot et kriterium (LLM-as-judge) | `scripts/eval.js` |
| `/ai/chat` | Generell LLM-tilgang via modellklasse | hackathon-applikasjoner |

**Kroppsformat:** alt innhold ligger under `kontekst`, *unntatt* `/ai/tolk-svar` som
tar `tekst` på toppnivå.

```bash
curl -s -X POST http://localhost:8082/ai/klarsprak \
  -H "Content-Type: application/json" \
  -d '{"kontekst":{"tjeneste":"barnehage"},"sprak":"nb"}'

curl -s -X POST http://localhost:8082/ai/tolk-svar \
  -H "Content-Type: application/json" \
  -d '{"tekst":"ja, det er greit"}'
```

`/ai/chat` tar meldinger med rollene `system`, `user` og `assistant`. Klienten kan
bare angi abstrakt `modellklasse`: `fast`, `standard` eller `advanced`. Provider og
faktisk modellnavn velges av gatewayen, ikke av klienten.

```bash
curl -s -X POST http://localhost:8082/ai/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer secret-token-1" \
  -d '{
    "meldinger":[
      {"rolle":"system","innhold":"Du hjelper en innbygger med kommunale tjenester."},
      {"rolle":"user","innhold":"Hvordan søker jeg om barnehageplass?"}
    ],
    "modellklasse":"standard",
    "sporingsId":"team-01-demo"
  }'
```

## Heuristikk først, modell som fallback

`tolk-svar`, `velg-prosess` og `velg-verktoy` kjører en heuristikk **først** og går bare
til modellen når den ikke treffer med nok trygghet. Alle modellsvar går gjennom
`parseJsonObjekt` og en `validerX`-whitelist som avviser hallusinerte id-er. Det er
derfor `"ja"` svarer med `modell: "heuristisk-tolkning"` uten å røre modellen i det hele tatt.

## Modellen tar ikke avgjørelser

`byggPrompt` legger inn eksplisitte sperrer for `oppsummering`: gjengi tall, beløp,
datoer og navn nøyaktig, ikke regn ut noe selv, ikke innvilg eller avslå. Vilkårs-
vurderingen er `SJEKK`-steget i `sandbox-backend`, deterministisk og etterprøvbart.
Se `ai-no-decisions` i `policies/ai-policy.yaml`.

Provider-modus:

- `AI_PROVIDER=mock` (standard, ingen ekstern modell)
- `AI_PROVIDER=ollama` (lokal gratis modell via Ollama, kjrt i Docker Compose)
- `AI_PROVIDER=openrouter` (billige/gratis modeller via OpenRouter)
- `AI_PROVIDER=openai`
- `AI_PROVIDER=anthropic`

Valgfrie miljovariabler:

- `OLLAMA_BASE_URL` (standard `http://localhost:11434`)
- `OLLAMA_MODEL` (standard `qwen2.5:7b`)
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL` (standard `mistralai/mistral-7b-instruct:free`)
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL`

Modellklasser rutes sentralt:

- `AI_MODEL_FAST_PROVIDER`, `AI_MODEL_FAST`
- `AI_MODEL_STANDARD_PROVIDER`, `AI_MODEL_STANDARD`
- `AI_MODEL_ADVANCED_PROVIDER`, `AI_MODEL_ADVANCED`

Hvis modellklasse ikke er oppgitt brukes `standard`. Hvis en klasse ikke er konfigurert,
faller den tilbake til `AI_PROVIDER` og providerens standard modellvariabel.

## Auth, rate limit og inputgrenser

`/ai/chat` kan beskyttes med enkel team-token-auth:

- `AI_AUTH_ENABLED=false` er lokal standard
- `AI_TEAM_TOKENS_JSON='{"team-01":"secret-token-1"}'`

Token sendes som `Authorization: Bearer <team-token>` og mappes til intern team-ID.
Rå token skrives ikke til trace.

Enkel in-memory rate limit gjelder per team:

- `AI_RATE_LIMIT_RPM=60`
- `AI_TEAM_DAILY_REQUEST_LIMIT=` valgfri dagskvote
- `AI_MAX_INPUT_CHARS=50000`

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
modellen er ikke lastet ned, API-nøkkel mangler, modellnavn mangler, eller `AI_PROVIDER=mock`.
Merk at status alltid er 200: tjenesten *lever* selv om modellen ikke gjør det.

`demo-gui` sjekker dette ved sidelast og viser en gul stripe på `/chat` og `/agent` når
modellen ikke er koblet på. Enkeltsvar som faller tilbake vises også i samtalen.

`./start.sh` gjør et ekte `/ai/klarsprak`-kall til slutt og advarer tydelig hvis svaret
har `advarsel`.

## KI-spor

Alle modellkall går gjennom én funksjon, `callModel`. Trace styres med
`AI_TRACE_MODE`:

- `metadata` er standard og lagrer ikke prompt eller modellrespons
- `full` lagrer prompt og respons, omtrent som tidligere
- `off` skriver ikke trace

Trace skrives som JSONL til `state/ai-trace.jsonl`. Feltene er engelske, siden sporet
er utviklerverktøy og ikke tjenestekontrakt: `timestamp`, `sporingsId`, `task`,
`provider`, `model`, `modelClass`, `temperature`, `durationMs`, `failed`, `error`,
og eventuelt `inputTokens`/`outputTokens`.

- `http://localhost:8082/trace` — HTML, nyeste øverst
- `GET /trace.json` — samme som JSON, med `?sporingsId=`, `?task=` og `?limit=`

Med `AI_TRACE_MODE=full` ser du hva modellen faktisk fikk, før heuristikk og validering
har vært innom. Sporet nullstilles av `./start.sh --reset`.

```bash
curl -s "http://localhost:8082/trace.json?task=oppsummering&limit=1"
```

## Timeout

Alle kall mot modellen avbrytes etter `AI_TIMEOUT_MS` (standard 180000). Uten det henger
et kall ubestemt når Ollama er treg eller halvveis oppe, og det ser ut som at sandboxen
har hengt seg. Ved timeout får du vanlig fallback med
`advarsel: "Provider ollama feilet: Modellen svarte ikke innen 180000 ms"`.

Vanligste årsak på macOS: Ollama har stoppet. `ollama serve` kjørt manuelt i en terminal
dør når vinduet lukkes — bruk `brew services start ollama` og sjekk med
`brew services list | grep ollama`.

## Legge til en ny provider

Provider-laget er ett sted. `callModel` tar en objektkontrakt med blant annet `prompt`,
`systemPrompt`, `temperature`, `task`, `modelClass`, `sporingsId` og `signal`.
Provider-funksjonene returnerer samme interne format: `{ tekst, modell, usage? }`.
Provider-spesifikke responser lekker ikke videre i systemet.

## macOS: kjør Ollama nativt

`docker compose up` starter Ollama i en container, som ikke får Metal-tilgang på Apple
Silicon og bare ser Docker-VM-ens minne. `docker-compose.gpu.yml` er NVIDIA-only og har
ingen effekt. Kjør heller Ollama nativt og resten i Docker:

```bash
brew services start ollama
ollama pull qwen2.5:14b
# .env: AI_PROVIDER=ollama, OLLAMA_BASE_URL=http://host.docker.internal:11434
docker compose up -d --no-deps sandbox-backend fiks-simulator ai-gateway \
  mcp-services process-agent demo-gui process-builder matrikkel-mock
```

`--no-deps` er nødvendig fordi `ai-gateway` har `depends_on: ollama`, som ellers drar
opp container-Ollama likevel.

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
