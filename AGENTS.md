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
- `apps/mcp-services` (`8083`): 20 tool endpoints wrapping backend + AI + matrikkel. Includes `suggest_step_tools`, `matrikkel_finn_veger`, `matrikkel_hent_eiendom`, `matrikkel_hent_eiere`. **Not the MCP protocol** — it self-reports `protocol: "mcp-style-http"` and speaks REST, with no JSON-RPC and no stdio/SSE transport, so no MCP client can connect. The tools do carry well-formed `inputSchema`.
- `apps/process-agent` (`8084`): agent API using MCP tools. Dynamically discovers which tools to call per step via `suggest_step_tools` — no hardcoded step names.

## Data and state model (important)
- Seed/reference data lives in `data/*.json` (tracked, read-only during normal runs).
- Runtime mutations go to `state/*.json` (gitignored), so demos do not dirty the repo.
- `lesJson` reads `state/` first and falls back to `data/`. `./start.sh --reset` clears `state/`.
- `apps/sandbox-backend` is TypeScript, split into modules (`ruter.ts`, `prosess.ts`,
  `ressurser.ts`, `regler.ts`, `tilstand.ts`, `revisjon.ts`, `typer.ts`, …).
  There is no `server.js` — `server.ts` only wires up the HTTP server.
  Node type-strips the `.ts` files directly; there is no build step.

## Process-engine behavior to preserve
- Flow is definition-driven (see `data/prosessdefinisjoner.json`), not UI-hardcoded.
- Seven step types exist (`apps/sandbox-backend/src/typer.ts`): `INFO`, `QUESTION`,
  `DATA_FETCH`, `CONSENT_REQUEST`, `SJEKK`, `SUMMARY`, `SUBMIT`. There is no `CONFIRMATION`.
- Actual sequence in the flagship case `reduced-kindergarten-payment`:
  `INFO` -> `DATA_FETCH` -> `CONSENT_REQUEST` -> `DATA_FETCH` -> `SJEKK` -> `SUMMARY` -> `SUBMIT`.
- The engine is linear: `stegIndex` only counts up. No branching, no conditional jumps.
- `SJEKK` is a deterministic rules evaluation in the backend. Decisions must stay
  reproducible and auditable — never move eligibility logic into the model. The model
  formulates (`SUMMARY`); it does not compute or decide.
- Consent gating is enforced before protected data reads; do not bypass this in UI or agent logic.
- Consent gating and audit are enforced centrally in `utforRessurs()`
  (`apps/sandbox-backend/src/ressurser.ts`), not per route. One catalog entry is
  simultaneously an HTTP endpoint, a valid `DATA_FETCH` target and a valid `SJEKK`
  target. Do not route around this.
- Audit events are first-class output (`state/revisjonslogg.json`); keep behavior observable.

## Naming: English for code, Norwegian for domain

This is the rule for every identifier you write in this repo.

**English** for anything technical — the plumbing a developer from any country would
recognise: `callModel`, `jsonResponse`, `readRequestBody`, `writeTrace`, `buildPrompt`,
`compilePathPattern`, `HttpError`, `readState`, `errorBody`, `newId`. Verbs are English
too: `find…`, `read…`, `write…`, `build…`, `validate…`, `check…`.

**Norwegian** for the domain — the words a Norwegian caseworker would use, and which have
no honest English equivalent in this context: `samtykke`, `inntekt`, `beregning`,
`prosessoekt`, `revisjonslogg`, `husstand`, `ordning`, `satser`, `foreldrebetaling`,
`matrikkel`, `soknad`, `steg`, `vilkaar`.

Mixed compounds are expected and correct: `getInntektForPerson`, `validateProsessvalg`,
`buildBeregning`, `hasValidSamtykke`. English verb, Norwegian domain noun.

**The wire format is frozen and stays Norwegian.** Field names in JSON responses and
endpoint paths are the contract every team builds against. Never rename these, even
though they look like ordinary words: `melding`, `feil`, `detalj`, `tekst`, `modell`,
`advarsel`, `syntetisk`, `godkjent`, `grunnlag`, `svar`, `steg`, `stegId`, `stegIndex`,
`oektsId`, `sporingsId`, `resultater`, `kontekst`, `intent`, `begrunnelse`, `verktoy`.
A local variable may be `message`; the response key stays `melding`.

The one place this does not apply is `ai-gateway`'s trace surface (`/trace`,
`state/ai-trace.jsonl`), which is developer tooling rather than service contract and is
English throughout: `timestamp`, `task`, `model`, `response`, `durationMs`, `failed`,
`error`. `sporingsId` is the exception there — it correlates with the domain field.

**Comments are English**, and only where they earn their place. Explain *why*, not *what* —
if a comment restates the code, delete it instead of translating it.

## Project conventions you must follow
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
- Quick checks that need no running services — run these first:
```bash
pnpm lint            # tsc --noEmit
pnpm test            # valider-data.js: referential integrity across all datasets
pnpm test:kontrakt   # starts its own backend + fiks on 18080/18081 against a fresh STATE_DIR
```
- `pnpm test:kontrakt` writes a normalised, deterministic dump — identifiers and
  timestamps are replaced with placeholders, so two runs of the same code are
  byte-identical. Use it as a regression gate around refactors:
```bash
pnpm test:kontrakt --ut state/foer.json
# ...refactor...
pnpm test:kontrakt --ut state/etter.json
diff state/foer.json state/etter.json
```
- These need the stack running (`./start.sh`):
```bash
pnpm test:agent
pnpm test:agent:nl
pnpm test:matrikkel-mock
pnpm test:mcp-matrikkel
pnpm test:agent:matrikkel
```
- Optional orchestrated startup script (model selection/reset): `./start.sh --help`.
- There is no CI. Nothing runs these automatically on push or PR.

## Integration edges and env vars
- In Compose, services call each other by container DNS (`http://sandbox-backend:8080`, etc.).
- Common env vars: `BACKEND_BASE_URL`, `AI_BASE_URL`, `MCP_BASE_URL`, `MATRIKKEL_BASE_URL`, `AI_PROVIDER`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `STATE_DIR`.
- `mcp-services` uses `MATRIKKEL_BASE_URL` (default `http://matrikkel-mock:8085`) to reach the Matrikkel mock.
- `ai-gateway` falls back to template text when the provider is unavailable, setting an
  `advarsel` field. Check `GET /helse` — it reports `modellNaaBar` plus a `feil` string
  explaining why. Status is always 200: the service is alive even when the model is not.
  `demo-gui` shows a banner on `/chat` and `/agent`, and `./start.sh` warns on startup.
- **All model calls go through one function**, `kallModell` in `apps/ai-gateway/src/server.js`.
  Adding a provider is one function with the signature `(prompt, temperatur, signal)`
  returning `{ tekst, modell }`, plus a branch in `kallModell`. Do not reintroduce
  per-provider copies of each task — that is what this replaced.
- Every model call is traced to `state/ai-trace.jsonl`: prompt, response, model, duration,
  and whether it failed. Read it at `GET /trace` (HTML) or `GET /trace.json` (JSON, filterable
  by `sporingsId`, `oppgave`, `antall`). This is the fastest way to see what the model
  actually received, before heuristics and validation touched it.
- Model calls time out after `AI_TIMEOUT_MS` (default 180000) and fall back rather than
  hanging.
- `/ai/*` request bodies put everything under `kontekst` — except `/ai/tolk-svar`, which
  takes `tekst` at the top level.
- `/ai/tolk-svar`, `/ai/velg-prosess` and `/ai/velg-verktoy` run heuristics first and only
  call the model when the heuristic does not match. `/ai/dialogforslag` and `/ai/risikosjekk`
  work but have no callers in the sandbox.

## Matrikkel integration pattern
- `apps/matrikkel-mock` owns synthetic matrikkel data (`data/matrikkel.json`) and exposes it over SOAP (Geointegrasjon path) and REST helper endpoints.
- `apps/mcp-services` wraps matrikkel via three tools: `matrikkel_finn_veger`, `matrikkel_hent_eiendom`, `matrikkel_hent_eiere`.
- `apps/mcp-services` also exposes `suggest_step_tools`: given a process step definition, calls `ai-gateway /ai/velg-verktoy` and returns which tools are relevant (context and/or validation).
- `apps/process-agent` calls `suggest_step_tools` on every QUESTION step to discover tools dynamically — no step IDs are hardcoded in the agent.

## Useful places before editing
- Architecture/context: `docs/architecture.md`, `docs/prosessmodell.md`, `docs/sikkerhet-og-personvern.md`.
- Contracts: `openapi/README.md`, `openapi/sandbox-backend.yaml`, `openapi/process-agent.yaml`, `openapi/mcp-services.yaml`, `openapi/matrikkel-mock.yaml`, `openapi/ai-gateway.yaml`.
- End-to-end behavior examples: `scripts/test-agent-flow.js`, `scripts/test-agent-natural-language.js`, `scripts/test-mcp-matrikkel.js`, `scripts/test-process-agent-matrikkel.js`.

