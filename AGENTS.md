# AGENTS Guide

## What this repo is
- `workshop-ai` is a municipal-dialog sandbox: process-driven user flows over synthetic data, with explicit consent, policy checks, and audit trail.
- Services are intentionally split by responsibility (UI, orchestration, mocks, AI, tools, agent) and communicate over HTTP, not shared internal libraries.

## Service map (compose defaults)
- `apps/process-builder` (`3000`): process definition UI.
- `apps/demo-gui` (`3001`): citizen-facing demo flow.
- `apps/sandbox-backend` (`8080`): core process/session engine, data access, policy + audit.
- `apps/fiks-simulator` (`8081`): mock external integrations (consent/tasks/register-like endpoints).
- `apps/ai-gateway` (`8082`): AI provider abstraction (`mock|ollama|openrouter`).
- `apps/mcp-services` (`8083`): MCP-style tool endpoints wrapping backend + AI.
- `apps/process-agent` (`8084`): agent API using MCP tools.

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
```
- Optional orchestrated startup script (model selection/reset): `./start.sh --help`.

## Integration edges and env vars
- In Compose, services call each other by container DNS (`http://sandbox-backend:8080`, etc.).
- Common env vars: `BACKEND_BASE_URL`, `AI_BASE_URL`, `MCP_BASE_URL`, `AI_PROVIDER`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `STATE_DIR`.
- `ai-gateway` may fall back to mock-like responses if model/provider is unavailable; verify with `/ai/klarsprak` when debugging.

## Useful places before editing
- Architecture/context: `docs/architecture.md`, `docs/prosessmodell.md`, `docs/sikkerhet-og-personvern.md`.
- Contracts: `openapi/README.md`, `openapi/sandbox-backend.yaml`, `openapi/process-agent.yaml`.
- End-to-end behavior examples: `scripts/test-agent-flow.js`, `scripts/test-agent-natural-language.js`.

