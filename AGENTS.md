# AGENTS Guide

## What this repo is
- `workshop-ai` is a municipal-dialog sandbox: process-driven user flows over synthetic data, with explicit consent, policy checks, and audit trail.
- Services are intentionally split by responsibility (UI, orchestration, mocks, AI, tools, agent) and communicate over HTTP, not shared internal libraries.

## Service map (compose defaults)
- `apps/process-builder` (`3000`): process definition UI.
- `apps/demo-gui` (`3001`): dashboard at `/`, then three citizen-facing entrances —
  `/chat`, `/agent` and `/stegvis`. Shares `apps/shared-ui/felles.css` and `felles.js`
  with `process-builder`, both served at `/assets/*`.
- `apps/sandbox-backend` (`8080`): core process/session engine, data access, policy + audit.
- `apps/fiks-simulator` (`8081`): mock external integrations (consent/tasks/register-like endpoints).
- `apps/matrikkel-mock` (`8085`): mock of Kartverket Matrikkel Geointegrasjon BasisService (SOAP + REST helpers). Runs from the shared `node:24-alpine` image on the same `./:/workspace` bind mount as every other service; `apps/matrikkel-mock/Dockerfile` exists only for running it standalone.
- `apps/ai-gateway` (`8082`): AI provider abstraction (`mock|ollama|openrouter|bedrock`). Switch live, no restart, at `GET /admin` (or `POST /admin/provider`) — persisted to `state/ai-provider-override.json`, which overrides `AI_PROVIDER`/`BEDROCK_MODEL_ID` on next boot. Also exposes `POST /ai/velg-verktoy` for dynamic step-tool discovery.
- `apps/mcp-services` (`8083`): 25 tool endpoints wrapping backend + AI + matrikkel. Includes `suggest_step_tools`, `matrikkel_finn_veger`, `matrikkel_hent_eiendom`, `matrikkel_hent_eiere`. **Not the MCP protocol** — it self-reports `protocol: "mcp-style-http"` and speaks REST, with no JSON-RPC and no stdio/SSE transport, so no MCP client can connect. The tools do carry well-formed `inputSchema`.
- `apps/brreg-mcp`, `apps/folkeregister-mcp` (no port): **these two are real MCP** — JSON-RPC 2.0 over stdio, newline-delimited, verified against `@modelcontextprotocol/inspector`. They are standalone servers for an external client (Claude Code, Cursor) to spawn; nothing in the sandbox talks to them. In particular `mcp-services` does **not** — it reads the same `data/brreg.seed.json` and `data/folkeregister.seed.json` off disk and exposes its own REST equivalents, so the four brreg/folkeregister tools exist twice, in two protocols. Their compose entries only keep the containers alive on an idle stdin; they are not a dependency of anything.
- `apps/process-agent` (`8084`): agent API using the tool endpoints. Discovers which tools to call per step via `suggest_step_tools` — but **also carries hardcoded shortcuts** for the `fartsdempende-tiltak` case: step ids `velg-gate`, `hent-gate`, `boliger-bekreft` and `begrunnelse`, plus the tool name `matrikkel_finn_veger`. The dynamic path is real; it is not the only path.

## Data and state model (important)
- **Five files under `data/` are generated and must not be hand-edited:**
  `personer.json`, `husstander.json`, `inntekter.json`, `folkeregister.seed.json` and
  `eierforhold.json`. `scripts/importer-tenor.js` builds all five, plus
  `docs/testpersoner.md`, from two sources: `data/kuratert.json` (the 51 hand-authored
  threshold fixtures) and `data/tenor/*.json` (the raw extracts). Edit a curated row in
  `personer.json` directly and the next import reverts it — so `pnpm test` compares the
  curated rows against `kuratert.json` and fails instead.
- The import **rebuilds**; it used to be additive, which meant a second run was a no-op
  and the data could only grow, never be cleaned. Ids stay stable because `personId` and
  `husstandId` are read back from `personer.json` as a ledger; `--glem-id-er` assigns
  from scratch and gives the same result on unchanged input.
- **Three pure domain modules carry rules that more than one caller needs**, for the same
  reason `alder.ts` does: `foedselsnummer.ts` (modulus 11 and Skatteetaten's +80 synthetic
  marker), `handleevne.ts` (who may act, and on whose behalf — shared with `digdir-mock`),
  and `vilkaar.ts` (the vedtak). None of them may import `regler.ts`.
- Seed/reference data lives in `data/*.json` (tracked, read-only during normal runs).
- Runtime mutations go to `state/*.json` (gitignored), so demos do not dirty the repo.
- `readJson` (`state.ts`) reads `state/` first and falls back to `data/`.
  `./start.sh --reset` clears `state/`.
- `apps/sandbox-backend` is TypeScript, split into modules (`routes.ts`, `prosess.ts`,
  `ressurser.ts`, `vilkaar.ts`, `alder.ts`, `regler.ts`, `state.ts`, `revisjon.ts`, `types.ts`, `routing.ts`,
  `errors.ts`, `config.ts`, `http.ts`).
  There is no `server.js` — `server.ts` only wires up the HTTP server.
  Node type-strips the `.ts` files directly; there is no build step.

## Process-engine behavior to preserve
- Flow is definition-driven (see `data/prosessdefinisjoner.json`), not UI-hardcoded.
- Seven step types exist (`apps/sandbox-backend/src/types.ts`): `INFO`, `QUESTION`,
  `DATA_FETCH`, `CONSENT_REQUEST`, `SJEKK`, `SUMMARY`, `SUBMIT`. There is no `CONFIRMATION`.
- Actual sequence in the flagship case `reduced-kindergarten-payment`:
  `INFO` -> `DATA_FETCH` -> `CONSENT_REQUEST` -> `DATA_FETCH` -> `SJEKK` -> `SUMMARY` -> `SUBMIT`.
- The engine is linear: `stegIndex` only counts up. No branching, no conditional jumps.
- `SJEKK` is a deterministic rules evaluation in the backend. Decisions must stay
  reproducible and auditable — never move eligibility logic into the model. The model
  formulates (`SUMMARY`); it does not compute or decide.
- **Eligibility logic lives in one place: `vilkaar.ts`.** `evaluateVilkaar` is the only way
  in; `regelHandlers` is private, so a new rule type does not widen the interface. The
  module is pure and synchronous — the income basis arrives as a parameter — so an outcome
  can be pinned with a literal `tilstand` object and no running services. `regler.ts` is
  the I/O half (the Fiks beregning, the samtykke predicates) and `vilkaar.ts` must never
  import it back: that arrow is what keeps a rules test from paying for a 2048-bit RSA
  keypair at module load.
  **`scripts/valider-data.js` imports the rule rather than mirroring it.** It used to
  carry its own copy of every rule, so `data/forventet-utfall.json` — the pinned
  outcomes the workshop text rests on — was validated against the copy. Never reintroduce
  a second implementation for the gate's convenience, and never regenerate
  `forventet-utfall.json` from the rules: an oracle derived from what it tests cannot
  fail. `alderVed` lives in `alder.ts` for the same reason, shared by the rules, the gate
  and `scripts/importer-tenor.js`.
- Consent gating is enforced before protected data reads; do not bypass this in UI or agent logic.
- A citizen may ask a free question at any point (`POST /ai/sporsmaal`). That path is
  **stateless by design**: it never calls `/svar`, `/handling` or `/neste`, and it never
  changes `stegIndex`. The flow pauses and is redisplayed; it does not move. Keep it that
  way — the engine is linear, so a question mistaken for an answer is unrecoverable.
- The audit entry for a consented read records the purpose from the **consent**, not the
  catalogue label. Purpose limitation is the reason consent was asked for.
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
- Keep Norwegian domain names/identifiers intact (`samtykke`, `inntekt`, `prosessokt`, etc.).
- Use UTF-8 Unicode encoding for code, JSON, YAML, Markdown, and script files in the repo.
- Prefer existing endpoint patterns from current services and examples in `README.md` / `docs/api-oversikt.md`.
- When API behavior changes, update matching OpenAPI docs in `openapi/*.yaml`.
- Keep changes scoped to one app unless cross-service change is required.

## Frontend: the KS Digital design system
- `docs/designsystem.md` is the reference for any frontend work, and
  `http://localhost:3001/ds-eksempel` is it running. Read the doc before writing markup;
  it carries the `ds-` class API, the token names and the rules below.
- The design system ships as **plain CSS** (`apps/shared-ui/ds-base.css` +
  `ds-ksdigital.css`, vendored from `@ks-digital/designsystem-themes`, refreshed by
  `pnpm ds:hent`). That is the only reason it fits a repo with no dependencies and no
  build step. Do not reach for the React or Angular packages here.
- **Never load `felles.css` and the design system CSS on the same page.** `felles.css` has
  no `@layer`, and unlayered rules outrank every layer in the cascade, so it silently
  overrides `@layer ds` and `@layer ksd`: Inter disappears and every button variant
  collapses to the same blue. It looks like the stylesheet failed to load. It did not — it
  was overridden. To override the design system deliberately, declare `@layer side;` (it
  lands after `ksd`) and put your rules there.
- Never edit the two vendored files. `pnpm ds:hent` overwrites them.
- `demo-gui` and `process-builder` keep their existing look. A new frontend is a new file,
  because those two are what other teams read to understand the sandbox.
- The naming rule above still applies. Class names are technical, so they are English;
  the wire format stays Norwegian no matter how the UI is styled.

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
pnpm test:sperrer    # guardrails on /ai/sporsmaal as pure functions
pnpm test:vilkaar    # the vedtak in vilkaar.ts, as pure functions against fixtures
pnpm test:foedselsnummer  # modulus 11 and the +80 synthetic marker, pure functions
pnpm test:handleevne      # who may act and on whose behalf, pure functions
pnpm test:kontrakt   # starts its own backend + fiks on 18080/18081 against a fresh STATE_DIR
```
- After editing source files in `apps/`, restart the affected containers so Node picks up the changes:
```bash
./start.sh --reload          # recreates all Node services (picks up compose config changes too)
docker compose restart sandbox-backend demo-gui   # targeted restart if you only changed those two
```
  Source files are volume-mounted (`./:/workspace`), so no image rebuild is needed — a restart is enough.
- All nine Node services (`sandbox-backend`, `demo-gui`, `ai-gateway`, `mcp-services`,
  `process-agent`, `fiks-simulator`, `process-builder`, `matrikkel-mock`, `digdir-mock`) are
  volume-mounted and run via `scripts/dev.sh`, which selects the right watcher automatically:
  - **Linux** and **macOS with Docker Desktop 4.15+** (VirtioFS default): `node --watch` — inotify
    events propagate natively; restarts are immediate.
  - **Windows** (Docker Desktop with project on Windows filesystem, `C:\...`): `nodemon --legacy-watch`
    polling — inotify does not propagate through Docker Desktop's 9P volume mount, so `start.bat`
    sets `WATCH_POLL=1` to switch to polling automatically.
  Any file you save is detected and the Node process restarts — **no manual action needed for normal
  code edits**. Watch for the log line `Change detected in '...'` (inotify) or `restarting due to changes...`
  (nodemon) to confirm it triggered.
- `matrikkel-mock` used to be the exception — a baked image with no volume mount, so every seed
  change needed `--build`. It no longer is: it reads the work tree like the rest, and
  `apps/matrikkel-mock/Dockerfile` survives only for running it standalone outside Compose.
- `./start.sh --reload` is still useful when you change `docker-compose.yml` itself (e.g. environment
  variables), since `--watch` only restarts the Node process, not the container.
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
pnpm test:bergen-matrikkel
pnpm test:mcp-matrikkel
pnpm test:agent:matrikkel
```
- Optional orchestrated startup script (model selection/reset): `./start.sh --help`.
- **Touching either MCP server's transport? Verify against a real client, not the
  test script.** `scripts/test-brreg-mcp.js` and `test-folkeregister-mcp.js`
  implement the client side themselves, so they prove the two halves agree — not
  that the framing matches the spec. The first version used LSP `Content-Length`
  framing instead of MCP's newline-delimited JSON: both tests passed while every
  real client hung on `initialize`. Check with
  `npx -y @modelcontextprotocol/inspector --cli node apps/brreg-mcp/src/server.js --method tools/list`.
- CI (`.github/workflows/ci.yml`) runs `lint`, `test`, `test:sperrer`, `test:vilkaar`,
  `test:foedselsnummer`, `test:handleevne`, `test:skjerming`, `test:samtykke`,
  `test:openapi` and `test:kontrakt` on every PR
  and on push to main, and uploads the contract dump as an artifact. It deliberately
  does **not** run `test:eval` (needs a live model) or the `test:agent*` scripts
  (need the compose stack up) — run those locally.
- All eight services have a `healthcheck` in `docker-compose.yml`, and `mcp-services`
  and `process-agent` wait on `condition: service_healthy`. `./start.sh` still polls
  `/helse` itself, since the macOS path uses `--no-deps`.

## Integration edges and env vars
- In Compose, services call each other by container DNS (`http://sandbox-backend:8080`, etc.).
- Common env vars: `BACKEND_BASE_URL`, `AI_BASE_URL`, `MCP_BASE_URL`, `MATRIKKEL_BASE_URL`, `AI_PROVIDER`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `BEDROCK_AWS_REGION`, `BEDROCK_AWS_ACCESS_KEY_ID`, `BEDROCK_AWS_SECRET_ACCESS_KEY`, `BEDROCK_AWS_SESSION_TOKEN`, `BEDROCK_MODEL_ID`, `STATE_DIR`.
- `mcp-services` uses `MATRIKKEL_BASE_URL` (default `http://matrikkel-mock:8085`) to reach the Matrikkel mock.
- `ai-gateway` falls back to template text when the provider is unavailable, setting an
  `advarsel` field. Check `GET /helse` — it reports `modellNaaBar` plus a `feil` string
  explaining why. Status is always 200: the service is alive even when the model is not.
  `demo-gui` shows a banner on `/chat` and `/agent`, and `./start.sh` warns on startup.
- **All model calls go through one function**, `callModel` in `apps/ai-gateway/src/server.js`.
  Adding a provider is one function with the signature `(prompt, temperatur, signal)`
  returning `{ tekst, modell }`, plus a branch in `callModel`. Do not reintroduce
  per-provider copies of each task — that is what this replaced.
- Every model call is traced to `state/ai-trace.jsonl`: prompt, response, model, duration,
  and whether it failed. Read it at `GET /trace` (HTML) or `GET /trace.json` (JSON, filterable
  by `sporingsId`, `task`, `limit`). This is the fastest way to see what the model
  actually received, before heuristics and validation touched it.
- Model calls time out after `AI_TIMEOUT_MS` (default 180000) and fall back rather than
  hanging.
- **`/ai/sporsmaal` is the one endpoint where a citizen writes free text and gets free
  text back, so its guardrails run in code, not only in the prompt.** They live in
  `apps/ai-gateway/src/sporsmaalsperrer.js`, a dependency-free module kept separate from
  `server.js` because that file calls `server.listen` at the top level and cannot be
  imported by a test. `pnpm test:sperrer` covers them and runs in CI — it needs neither
  the stack nor a model. The endpoint has no data access of its own: it answers only from
  the grounding the caller sends, which is what makes it structurally unable to reach
  consent-gated data. Do not give it a backend data client.
  Two topics never reach the model at all: prompt-injection attempts, and privacy
  questions, which are answered from `PERSONVERN` in that module. An invented privacy
  claim has no tell a code check can find — no number, no decision — so it gets a fixed
  answer instead.
- **Changing a prompt? Run the evals.** `pnpm test:eval` scores the AI layer against
  datasets in `evals/`, with a pass threshold per dataset and a non-zero exit below it.
  `evals/ai-policy.json` is the executable form of `ai-no-decisions`: the model phrases,
  it does not compute or decide. Baseline before, compare after — see `evals/README.md`.
  Deliberately kept out of CI, since it needs a running model.
- `/ai/*` request bodies put everything under `kontekst` — except `/ai/tolk-svar` and
  `/ai/sporsmaal`, which take `tekst` at the top level.
- `/ai/tolk-svar`, `/ai/velg-prosess` and `/ai/velg-verktoy` run heuristics first and only
  call the model when the heuristic does not match. Four endpoints work but have no code
  callers in the sandbox: `/ai/dialogforslag`, `/ai/risikosjekk`, `/ai/klarsprak` (only
  `start.sh` probes it) and `/ai/forklar-databruk`. They are there for teams to use.
- `MATRIKKEL_DATA_FILE` overrides the file `matrikkel-mock` seeds from; the default is
  `data/matrikkel.json` — 388 streets and 18349 properties across the 97 kommuner the
  population lives in, fetched from Geonorge by `node scripts/hent-matrikkel.js`.
  `data/matrikkel.seed.json` remains as the small four-street fixture the mock's own
  tests point at. **Ownership is not in either file:** it lives in
  `data/eierforhold.json` (`EIERFORHOLD_DATA_FILE`) and is merged in at load, because
  title is in the grunnbok and not the matrikkel. `eiere` is only in the response from
  `/mock/matrikkel/eiendommer` when `personId` is given.
- `mcp-services` uses `MATRIKKEL_BASE_URL` (default `http://matrikkel-mock:8085`) for mock
  lookups, and `MATRIKKEL_MODE=live|mock|hybrid` for street lookups. **Two different
  defaults, and the distinction matters:** the code default is `mock`
  (`apps/mcp-services/src/server.js:10`), but compose sets `hybrid`
  (`docker-compose.yml:200`) — so `hybrid` is what you actually run. Not `live`: `live`
  rethrows on network failure, so bad conference wifi turns every street lookup into a
  500. `hybrid` tries Geonorge first and falls back to the seed data.
  Compose now defaults to `mock`, because the seed holds every Bergen street and a live
  lookup has nothing left to add.
  `MATRIKKEL_MODE` is read only by `mcp-services`; `matrikkel-mock` always falls back to
  live when a lookup misses the seed, and returns HTTP 500 — not 404 — when the network
  is down.

## Matrikkel integration pattern
- `apps/matrikkel-mock` owns synthetic matrikkel data seeded from `data/matrikkel.json`, and it exposes that over SOAP (Geointegrasjon path) and REST helper endpoints. When a lookup is missing from seed data, the mock may fall back to live Geonorge address lookups.
- **It is the only reader of the matrikkel seed.** `sandbox-backend` reaches it over HTTP via `MATRIKKEL_BASE_URL`; nothing else opens the file. Keeping two read paths meant keeping two copies of the same post-processing in step by hand.
- `data/matrikkel.seed.json` is the small curated fixture; keep it small, readable, and deterministic.
- `mcp-services` kan gjore direkte gateoppslag mot Geonorge adresse-API i `live`-modus, uten lokal Norges-kopi.
- `apps/mcp-services` wraps matrikkel via three tools: `matrikkel_finn_veger`, `matrikkel_hent_eiendom`, `matrikkel_hent_eiere`.
- `matrikkel_hent_eiendom` og `matrikkel_hent_eiere` kan brukes med eksakt adresse, for eksempel `Storgata 5`.
- `apps/mcp-services` also exposes `suggest_step_tools`: given a process step definition, calls `ai-gateway /ai/velg-verktoy` and returns which tools are relevant (context and/or validation).
- `apps/process-agent` calls `suggest_step_tools` on every QUESTION step to discover tools
  dynamically. It *additionally* hardcodes step ids and one tool name for the
  `fartsdempende-tiltak` case — see the service map above. Improving that agent is a
  hackathon task, not a bug to fix before the event.

## Useful places before editing
- Architecture/context: `docs/architecture.md`, `docs/prosessmodell.md`, `docs/sikkerhet-og-personvern.md`.
- Frontend and styling: `docs/designsystem.md`, and `apps/demo-gui/src/ds-eksempel.html` for working markup.
- Contracts: `openapi/README.md`, `openapi/sandbox-backend.yaml`, `openapi/process-agent.yaml`, `openapi/mcp-services.yaml`, `openapi/matrikkel-mock.yaml`, `openapi/ai-gateway.yaml`.
- End-to-end behavior examples: `scripts/test-agent-flow.js`, `scripts/test-agent-natural-language.js`, `scripts/test-mcp-matrikkel.js`, `scripts/test-process-agent-matrikkel.js`, `scripts/test-bergen-matrikkel-bulk.js`.

