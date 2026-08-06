# AI Gateway

Ansvar:

- levere dialogforslag
- generere oppsummering
- forklare databruk
- gi klarspråk og enkel risikosjekk
- velge prosess og verktøy, og tolke fritekstsvar

Stack: Node.js med innebygd HTTP-server, null avhengigheter. Ingen SDK — providerne
kalles med rå `fetch`.

## Endepunkter

Åtte, alle `POST`:

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

Valgfrie miljovariabler:

- `OLLAMA_BASE_URL` (standard `http://localhost:11434`)
- `OLLAMA_MODEL` (standard `qwen2.5:7b`)
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL` (standard `mistralai/mistral-7b-instruct:free`)

## ⚠️ Fallback er stille — sjekk alltid

Ved feil hos provideren faller gatewayen automatisk tilbake til `mock-ai-gateway` og
setter et `advarsel`-felt. **GUI-ene viser ikke det feltet.** Du får fortsatt velformet
norsk tekst — bare fra en mal, ikke fra en modell. Dette er den vanligste kilden til
forvirring i sandboxen.

Verifiser:

```bash
curl -s -X POST http://localhost:8082/ai/klarsprak \
  -H "Content-Type: application/json" \
  -d '{"kontekst":{"tjeneste":"barnehage"},"sprak":"nb"}'
```

Riktig: `"modell": "ollama:qwen2.5:14b"`, ingen `advarsel`.
Galt: `"modell": "mock-ai-gateway (fallback)"` og
`"advarsel": "Provider ollama feilet: fetch failed"`.

Vanligste årsak på macOS: Ollama har stoppet. `ollama serve` kjørt manuelt i en terminal
dør når vinduet lukkes — bruk `brew services start ollama` og sjekk med
`brew services list | grep ollama`.

Merk også at ingen `fetch` mot modellen har timeout. Er Ollama treg eller halvveis oppe,
henger kallet ubestemt i stedet for å feile.

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

