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
- `OLLAMA_MODEL` (standard `qwen2.5:0.5b`)
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL` (standard `mistralai/mistral-7b-instruct:free`)

Ved feil hos ekstern provider fallbacker gatewayen automatisk til `mock-ai-gateway`.

Med standard `docker compose up --build` startes og pulles Ollama-modellen automatisk via tjenestene `ollama` og `ollama-pull`.

