# AI Gateway

Ansvar:

- levere mockede dialogforslag
- generere oppsummering
- forklare databruk
- gi klarspråk og enkel risikosjekk

Planlagt stack:

- Node.js med innebygd HTTP-server i første MVP

Provider-modus (MVP):

- `AI_PROVIDER=mock` (standard, ingen ekstern modell)
- `AI_PROVIDER=ollama` (lokal gratis modell via Ollama, kjrt i Docker Compose)
- `AI_PROVIDER=openrouter` (billige/gratis modeller via OpenRouter)

Valgfrie miljovariabler:

- `OLLAMA_BASE_URL` (standard `http://localhost:11434`)
- `OLLAMA_MODEL` (standard `qwen2.5:7b`)
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL` (standard `mistralai/mistral-7b-instruct:free`)

Ved feil hos ekstern provider fallbacker gatewayen automatisk til `mock-ai-gateway`.

Med standard `docker compose up --build` startes `ollama`, men modeller pulles ikke automatisk.

Pull valgt modell eksplisitt:

```bash
OLLAMA_MODEL=qwen2.5:7b docker compose --profile pull up ollama-pull-selected
```

GPU-stotte i Docker (NVIDIA):

- https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html

Start med GPU-override nar Docker GPU-stotte er aktivert:

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

