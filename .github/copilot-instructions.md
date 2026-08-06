# Copilot Instructions for `workshop-ai`

Use this file as project context when suggesting, generating, or editing code.

## Goal
This monorepo is a local sandbox for modern, dialog-based municipal services using synthetic data, mock integrations, and process-driven flows.

## How to run

### Recommended (all services)
```bash
pnpm install
docker compose up --build
```

### Stop
```bash
docker compose down -t 0
```

### Optional GPU Ollama setup
```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d
```

### Basic checks
```bash
pnpm test
pnpm test:agent
```

## Components and ports
- `apps/process-builder` (`3000`): process builder UI for defining dialog flows.
- `apps/demo-gui` (`3001`): reference citizen-facing demo UI.
- `apps/sandbox-backend` (`8080`): process orchestration, synthetic data APIs, policy checks, and audit trail.
- `apps/fiks-simulator` (`8081`): mock external services (consent, tasks, register-like behavior).
- `apps/ai-gateway` (`8082`): AI abstraction layer (mock/Ollama/OpenRouter modes).
- `apps/mcp-services` (`8083`): MCP-style tools exposed over HTTP.
- `apps/process-agent` (`8084`): generic agent that guides users through process definitions.
- `ollama` (`11434`, Docker): local LLM runtime used by AI-related services.

## How it works (end-to-end)
1. User starts in `demo-gui` and selects a test person and process.
2. `demo-gui` starts/continues a process session in `sandbox-backend`.
3. `sandbox-backend` executes process steps from JSON process definitions.
4. Data steps read synthetic datasets from `data/` (household, income, etc.).
5. Consent-dependent steps interact with `fiks-simulator` before protected data access.
6. AI summary/explanation steps call `ai-gateway` (which can use Ollama locally).
7. Completion creates relevant outcomes/tasks and writes audit events.
8. `mcp-services` and `process-agent` provide tool-driven/agent-driven access to the same capabilities.

## Important folders
- `apps/`: runnable services and UIs.
- `data/`: synthetic datasets and process/session-related seed data.
- `docs/`: architecture, APIs, process model, privacy/security notes.
- `openapi/`: service contracts; update when endpoints or schemas change.
- `policies/`: access/data/AI policy definitions.
- `scripts/`: validation and flow test utilities.

## Development guidance for Copilot
- Keep changes minimal and scoped to one app unless cross-service changes are requested.
- Preserve the process-driven model; avoid hardcoding flow logic in UI when a process definition should drive behavior.
- Prefer existing endpoint and payload patterns from current service code.
- When editing API behavior, update matching specs in `openapi/`.
- **Naming: English for code, Norwegian for domain.** Technical identifiers are English
  (`callModel`, `jsonResponse`, `writeTrace`, `buildPrompt`, `HttpError`), domain terms
  stay Norwegian (`samtykke`, `inntekt`, `beregning`, `prosessoekt`, `revisjonslogg`,
  `ordning`, `satser`). Mixed compounds are correct: `getInntektForPerson`.
- **Never rename wire-format fields.** JSON response keys and endpoint paths are the
  contract teams build against: `melding`, `feil`, `tekst`, `modell`, `advarsel`,
  `godkjent`, `svar`, `stegId`, `oektsId`, `sporingsId`, and the rest. A local variable
  may be `message`; the response key stays `melding`. See AGENTS.md for the full rule.
- Comments in English, and only where they explain *why*. Delete a comment that merely
  restates the code rather than translating it.
- Do not introduce new frameworks or heavy dependencies unless explicitly requested.

