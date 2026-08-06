# AGENTS Guide

## What this repo is
- `workshop-ai` is a municipal-dialog sandbox: process-driven user flows over synthetic data, with explicit consent, policy checks, and audit trail.
- Services are intentionally split by responsibility (UI, orchestration, mocks, AI, tools, agent) and communicate over HTTP, not shared internal libraries.

## Service map (compose defaults)
- `apps/process-builder` (`3000`): process definition UI.
- `apps/demo-gui` (`3001`): citizen-facing demo flow.
- `apps/sandbox-backend` (`8080`): core process/session engine, data access, policy + audit.
- `apps/fiks-simulator` (`8081`): mock external integrations (consent/tasks/register-like endpoints).
- `apps/matrikkel-mock` (`8085`): mock of Kartverket Matrikkel Geointegrasjon BasisService (SOAP + REST helpers). Separate Docker image built from `apps/matrikkel-mock/Dockerfile`.
- `apps/ai-gateway` (`8082`): AI provider abstraction (`mock|ollama|openrouter`). Also exposes `POST /ai/velg-verktoy` for dynamic step-tool discovery.
- `apps/mcp-services` (`8083`): MCP-style tool endpoints wrapping backend + AI + matrikkel. Includes `suggest_step_tools`, `matrikkel_finn_veger`, `matrikkel_hent_eiendom`, `matrikkel_hent_eiere`.
- `apps/process-agent` (`8084`): agent API using MCP tools. Dynamically discovers which tools to call per step via `suggest_step_tools` — no hardcoded step names.

## Data and state model (important)
- Seed/reference data lives in `data/*.json` (tracked, read-only during normal runs).
- Runtime mutations go to `state/*.json` (gitignored), so demos do not dirty the repo.
- Backend code reflects this pattern via JSON read/write helpers in `apps/sandbox-backend/src/server.js`.

## Process-engine behavior to preserve
- Flow is definition-driven (see `data/prosessdefinisjoner.json`), not UI-hardcoded.
- Typical step sequence in practice: `INFO` -> `QUESTION` -> `DATA_FETCH` -> `CONSENT_REQUEST` -> `SUMMARY` -> `SUBMIT`.
- Consent gating is enforced before protected data reads; do not bypass this in UI or agent logic.
- Audit events are first-class output (`state/revisjonslogg.json`); keep behavior observable.

## Project conventions you must follow
- Keep Norwegian domain names/identifiers intact (`samtykke`, `inntekt`, `prosessokt`, etc.).
- Prefer existing endpoint patterns from current services and examples in `README.md` / `docs/api-oversikt.md`.
- When API behavior changes, update matching OpenAPI docs in `openapi/*.yaml`.
- Keep changes scoped to one app unless cross-service change is required.

## Developer workflows
- Install + run all services:
```bash
pnpm install
docker compose up --build
```
- Stop stack:
```bash
docker compose down -t 0
```
- Quick checks:
```bash
pnpm test
pnpm test:agent
pnpm test:agent:nl
pnpm test:matrikkel-mock
pnpm test:mcp-matrikkel
pnpm test:agent:matrikkel
```
- Optional orchestrated startup script (model selection/reset): `./start.sh --help`.

## Integration edges and env vars
- In Compose, services call each other by container DNS (`http://sandbox-backend:8080`, etc.).
- Common env vars: `BACKEND_BASE_URL`, `AI_BASE_URL`, `MCP_BASE_URL`, `MATRIKKEL_BASE_URL`, `AI_PROVIDER`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `STATE_DIR`.
- `mcp-services` uses `MATRIKKEL_BASE_URL` (default `http://matrikkel-mock:8085`) to reach the Matrikkel mock.
- `ai-gateway` may fall back to mock-like responses if model/provider is unavailable; verify with `/ai/klarsprak` when debugging.

## Matrikkel integration pattern
- `apps/matrikkel-mock` owns synthetic matrikkel data (`data/matrikkel.json`) and exposes it over SOAP (Geointegrasjon path) and REST helper endpoints.
- `apps/mcp-services` wraps matrikkel via three tools: `matrikkel_finn_veger`, `matrikkel_hent_eiendom`, `matrikkel_hent_eiere`.
- `apps/mcp-services` also exposes `suggest_step_tools`: given a process step definition, calls `ai-gateway /ai/velg-verktoy` and returns which tools are relevant (context and/or validation).
- `apps/process-agent` calls `suggest_step_tools` on every QUESTION step to discover tools dynamically — no step IDs are hardcoded in the agent.

## Useful places before editing
- Architecture/context: `docs/architecture.md`, `docs/prosessmodell.md`, `docs/sikkerhet-og-personvern.md`.
- Contracts: `openapi/README.md`, `openapi/sandbox-backend.yaml`, `openapi/process-agent.yaml`, `openapi/mcp-services.yaml`, `openapi/matrikkel-mock.yaml`, `openapi/ai-gateway.yaml`.
- End-to-end behavior examples: `scripts/test-agent-flow.js`, `scripts/test-agent-natural-language.js`, `scripts/test-mcp-matrikkel.js`, `scripts/test-process-agent-matrikkel.js`.

