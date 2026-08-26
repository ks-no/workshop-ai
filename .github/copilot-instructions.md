# Copilot Instructions for `workshop-ai`

Use this file as project context when suggesting, generating, or editing code.

## Goal
This monorepo is a local sandbox for modern, dialog-based municipal services using synthetic data, mock integrations, and process-driven flows.

## How to run

### Recommended
```bash
./start.sh --mock     # fastest way in, no model download
./start.sh            # with the real model
./start.sh -d         # stop
```

`./start.sh` handles platform detection, model selection by available memory, and
verifies the model actually answers. Prefer it over raw `docker compose` - on macOS
in particular, plain `docker compose up` starts Ollama in a container where it cannot
reach Metal, and `--no-deps` is required. Run `./start.sh --help` for all flags.

### Basic checks (no running services needed)
```bash
pnpm lint            # tsc --noEmit
pnpm test            # referential integrity across datasets
pnpm test:kontrakt   # deterministic contract dump
```

`pnpm test:agent` and the other `test:agent*` / `test:*-matrikkel` scripts need the
stack up; `pnpm test:eval` needs a live model.

## Components and ports

See the service map in `AGENTS.md` - it is the maintained one, and it covers
`matrikkel-mock`, the two real MCP servers, and which services are core versus
ignorable. Do not duplicate it here; a second copy is how it went stale before.

## How it works (end-to-end)
1. User starts in `demo-gui` and selects a test person and process.
2. `demo-gui` starts/continues a process session in `sandbox-backend`.
3. `sandbox-backend` executes process steps from JSON process definitions.
4. Data steps read synthetic datasets from `data/` (household, income, etc.).
5. Consent-dependent steps interact with `fiks-simulator` before protected data access.
6. AI summary/explanation steps call `ai-gateway` (which can use Ollama locally).
7. Completion creates relevant outcomes/tasks and writes audit events.
8. `tools-api` and `process-agent` provide tool-driven/agent-driven access to the same capabilities.

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
- **Language: see `## Language` in `AGENTS.md`.** It is the maintained one, and it
  covers identifiers, the frozen wire format, prose, file-by-file language and comment
  language. Do not restate it here; a second copy is how it went stale before.
- Do not introduce new frameworks or heavy dependencies unless explicitly requested.
- Participant frontends are expected to live in their own project outside this repo,
  talking to the sandbox APIs; the repo-internal rules below apply to work done here.
- Frontend work follows the KS Digital design system. Components are documented at
  <https://designsystemet.no/no>; read `docs/designsystem.md` first for the sandbox
  mechanics - setup and the hard rules. The one that bites: never
  load `felles.css` and the design system CSS on the same page, because `felles.css` has
  no `@layer` and unlayered rules beat every layer.

