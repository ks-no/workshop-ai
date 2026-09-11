@AGENTS.md

<!--
AGENTS.md is the canonical instruction file for this repo, and nearly every coding agent
reads it directly: Codex, Cursor, Copilot's coding agent, VS Code, Gemini CLI, Windsurf,
Zed, Aider, Junie, Jules and others.

Claude Code is the exception. It discovers CLAUDE.md only, so this file exists to point
at AGENTS.md; the line above is Claude Code's import syntax and is expanded at session
start. It is a real file rather than a symlink so that a Windows clone without
core.symlinks (Developer Mode or Administrator) still gets the instructions.

Any tool that reads CLAUDE.md literally rather than expanding the import should read
AGENTS.md instead. Do not copy the instructions into this file: one canonical source.
-->

---

# Handover: innbyggerportal (`:3002`)

Status as of 2026-09-11. Everything below is on `main` and pushed. This section is
working state, not instructions - the durable facts live in `AGENTS.md`. Delete it
once the work it describes is finished.

**The portal documents itself. Read these before changing it, and update them with
the code rather than restating them here:**

| Document | What it holds |
| --- | --- |
| `apps/innbyggerportal/README.md` | The surface: what each card shows and from where, the service map, the login round trip, the application form, and how frontend and backend divide the work |
| `apps/innbyggerportal/gjennomgang.md` | A security test with evidence, a code-quality review, and prioritised recommendations |

## Where it stands

`apps/innbyggerportal` is a real client of the sandbox, not a disk-reading demo. It
has three pages:

- **`/`** - pre-login front page. Deliberately carries no kommune identity: it sits
  in front of the login, so there is no citizen to read a kommune from.
- **`/minside`** - profile, ongoing case, services, calendar, the "Aktuelt for deg"
  carousel, and the "Hva du kan søke på" card with consent switches.
- **`/soknad?prosess=<id>`** - the application form. The process definition drawn as
  one form: `QUESTION` steps become the fields the citizen fills, `DATA_FETCH` steps
  become the blocks the kommune fills, `INFO` becomes the ingress.

**The form fills itself as far as consent reaches.** Each `DATA_FETCH` block calls the
same resource the step would call, with the citizen's own token. `200` gives filled
fields, `403 mangler_samtykke` gives a locked block with the switch in it, and a URL
with an unanswered `{svar.…}` says so and fills in when the answer arrives. Submitting
runs a real prosessøkt to `SUBMIT`, so the søknad is the one the stepwise flow makes.

**A rejection is an outcome, not an error.** A `SJEKK` that says no sets the økt to
`AVVIST`, and every further call answers 400. The loop stops there and shows
`avvistMelding`. It also says no søknad was registered, because the engine decides
before `SUBMIT`.

## Verified

The whole login round trip, in a browser, for several citizens. The form in both
directions: rejection for `person-009` on redusert foreldrebetaling, and a submitted
søknad for `person-036` that Min side picks up as "Pågående sak". The consent switch
unlocking an income block without a page reload. An answer-dependent `DATA_FETCH`
filling as the street name is typed. Dark mode and larger text carrying from the front
page into Min side. No horizontal scroll at 400px. Every mermaid diagram rendered, not
just checked.

The multi-source consent list was verified by injecting a three-source row: no case in
the seed needs more than one today, but the wire format is a list and the backend
flattens across alternatives.

## Outstanding

The two security findings are the top of the list. Both are in
`apps/innbyggerportal/gjennomgang.md` with reproductions:

- **`GET /api/minside/{personId}` does not check the token**, and it reads four files
  the backend gates behind consent: `inntekter.json`, `krr.json`,
  `legeerklaeringer.json`, `politiattester.json`. The read leaves no audit row either,
  which contradicts what `docs/sikkerhet-og-personvern.md` promises. Fix by moving the
  gated cards onto the backend, the way the tilgang card and the form already work.
- **`state` is used unvalidated after login** (`apps/shared/client/felles.ts:491`), so
  a crafted authorize link redirects the citizen off-site right after a successful
  login. Shared code: this hits `demo-gui` too. One line.

From the code review, verified against the code:

- `TILGANGSVISNING[post.status]` has no fallback and sits outside the `try/catch`, so
  an unknown status from the backend stops the card with no message.
- Min side has no `h1` anywhere; `overskrift()` only allows `h2`-`h4`.
- The consent switches have no sequence guard, so two rapid toggles can paint a stale
  state over a newer one.
- `lesSamtykker()` swallows network errors, 401 and 500 into the same empty state.
- The three page scripts each carry their own copy of `lag`, `avsnitt`, `overskrift`,
  `merkelapp`, `kortblokk` and `hentJson`, and `soknad.ts` shadows `alternativVerdi`
  and `alternativLabel` that already exist in `felles.ts`.
- **The portal has no tests.** The repo has around 25 `scripts/test-*.ts` and none
  covers it.

Still open from before: "Aktuelt for deg" and the tilgang card can say the same thing
twice about one ordning.

## The local model

`ai-gateway` is reached at exactly one point: the `SUMMARY` step the engine requires
before `SUBMIT`. Three things are true about it today, and all three are worth knowing
before touching it:

- **It fails.** `AI_PROVIDER=ollama` with `qwen2.5:7b`, but the Ollama container holds
  `qwen2.5-coder:7b` and `qwen2.5:14b`. The call 404s and the gateway falls back to
  maltekst, marked `modell: "mock-ai-gateway (fallback)"`.
- **The portal never shows the answer.** Nothing reads `resultater["oppsummering"]`.
  The step runs because the engine demands it, and the text is discarded.
- **The portal ignores `advarsel`.** `warnAboutFallback` in `felles.ts` exists for
  this and all four demo-gui pages call it. The portal does not, so nobody learns the
  answer was template text.

The prompt carries the whole context as raw JSON - contact details, the rule's
grunnlag, the citizen's free text, and income figures where the case reads them. With
`ollama` that stays on the machine. With `openrouter`, `bedrock` or Telenor AI Factory
it does not.

## Traps worth knowing

- **Client page scripts need `export {}` at the top.** They load as
  `<script type="module">` already, so it only makes the type view match runtime -
  but without it `moduleDetection: "legacy"` treats them as global scripts and
  their `krevEl` and `Tjeneste` collide with the globals in `felles.ts`. Each
  `client/tsconfig.json` must also include `../../../shared/client/**/*.ts`.
- **`digdir-mock` generates its keys at startup.** `docker compose up -d` hands it
  new ones, and a token already sitting in a tab stops verifying. Restart the
  services that verify tokens when that happens.
- **A page load of Min side writes a batch of audit rows**, one `runRessurs` per
  case behind `/tilganger`. Correct, but it fills `state/revisjonslogg.json` fast.
- **`node --watch` reloads a changed `server.ts` inside the running container.** No
  `docker compose restart` is needed for a code change, and HTML and client `.ts` are
  read per request, so they need nothing at all. A hard refresh in the browser is the
  only step.
- **The doc checker validates mermaid.** Every node label must be quoted, and a
  diagram naming five or more services must name all twelve. A two-character node
  shape like `[(...)]` trips the quoting rule - use `("...")`.
- **`pgrep`/`pkill` on the host matches processes inside the containers.** The
  containers run `node --watch apps/.../server.ts` on the shared kernel, so a broad
  `pkill -f "apps/.*/src/server.ts"` kills the service inside Compose, not just a
  local one.
