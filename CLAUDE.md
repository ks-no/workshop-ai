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

Status as of 2026-09-10. Everything below is on `main` and pushed. This section is
working state, not instructions - the durable facts live in `AGENTS.md`, and the
portal's own `README.md` documents the surface. Delete this section once the work
it describes is finished.

## What was done

`apps/innbyggerportal` was merged as a disk-reading demo with no login and no
wiring. It is now a real client of the sandbox:

- **ID-porten login.** `requireLogin({ clientId: "innbyggerportal" })` from
  `apps/shared/client/felles.ts`, real authorization_code + PKCE against
  `digdir-mock`. `/callback` swaps the code. The portal serves `felles.ts` itself
  at `/delt/felles.ts`, so it does not depend on `demo-gui` running.
- **The person comes from the token.** `pid` resolves via `GET /api/personer`,
  which returns exactly one row for a citizen token. `GET /api/innbyggere` was
  deleted: it listed every adult in the kommune, which is the surface a citizen
  token exists to prevent.
- **The kommune follows the citizen.** `kommuneFor()` reads `bostedsadresse`.
  There is no kommune configured anywhere any more.
- **Two cards driven by real calls**: the tilgangsoversikt (below) and the top
  status box (below).
- **Front page at `/`**, Min side moved to `/minside`.

## The top status box ("Aktuelt for deg")

`byggPaaminnelser()` in `src/minside.ts`. Four triggers, pushed in this order, so
the carousel shows deadlines first. Every one is a **fact in the data, never a
judgement**:

| # | Trigger | Reads | Colour | Button |
|---|---|---|---|---|
| 1 | Deadline approaching | the kalender events | danger/warning | "Se samtykkene dine" (samtykke deadlines only) |
| 2 | Application with a caseworker | `state/oppgaver.json` | info | "Se saksgangen" |
| 3 | Unread post | `state/forsendelser.json` | info | "Åpne postkassen" |
| 4 | A place paid for with no application | betalinger + `data/satser.json` | success | "Start søknaden" |

1. Takes the kalender list, drops what has passed, keeps only `danger` and
   `warning`, takes the top two. The list is already sorted nearest-first. Behind
   it: legeerklæringer, politiattester, samtykker, income deadlines and KRR.
2. Every row in the oppgave queue with your `personId`. "Les mer" lists one line
   per oppgave.
3. Forsendelser where `mottaker.digitalId` is your fødselsnummer.
4. For each of barnehage, SFO and fritid: does the household pay for such a
   place, and is there **no** application for the matching prosess?
   `PROSESS_PER_PLASS` is the three-line mapping. The wording is deliberately
   careful - "Søknaden avgjør om dere har rett, ikke denne siden" - because
   having a place and no application says the application was not sent, not that
   it would be granted.

It de-duplicates: send an SFO application and the SFO reminder disappears,
replaced by trigger 2.

`gaaTil()` in the client jumps to the card that answers the reminder, using
`knapp-samtykker`, `saker` and `tjeneste-postkasse`. Those ids exist because the
reminder needs them; do not remove them.

## Verified, and not

**Verified against running services**: the whole login round trip; `/tilganger`
for a real citizen; the page across six kommuner plus an adressebeskyttet person
(`person-031`, keeps Oslo through masking) and one with no registered address
(`person-375`, falls back to "Kommunen" with no crest); triggers 1, 2 and 4;
`/api/testbrukere` (304 eligible, 8 shown); every served client script parses;
every `krevEl`/`element` id resolves in the markup; `demo-gui` and
`process-builder` still work after the `felles.ts` change.

**Not verified**: trigger 3 has never fired, because `state/forsendelser.json` is
only written by a SUBMIT step in a full prosessøkt, which needs the model. The
code was taken over verbatim and reads the file with the same predicate the
tjenester card already uses, but nobody has seen it run.

**Nothing has been looked at in a browser.** The front page has a wave SVG, blobs
and its own palette. That is the kind of thing that looks wrong without anything
failing.

## Outstanding

- **`GET /api/minside/{personId}` does not check the token.** It is currently the
  way around the pid binding in `sandbox-backend`. The fix is ~15 lines with
  `createVerifier` from `digdir-mock/src/verify.ts` (the arrow four services
  already use), comparing `pid` to the subject. Accept `aud: sandbox-backend`
  rather than minting a second audience, or the browser needs two tokens.
- **Four cards still read consent-gated data off disk**: inntekt, legeerklæring,
  politiattest and kontaktinfo, bypassing `runRessurs`. Endpoints exist for all
  four under `/api/personer/{personId}/...`. A citizen's browser cannot read
  samtykke directly - `fiks-simulator` refuses ID-porten tokens on all six
  samtykke surfaces with `KREVER_MASKINPORTEN` - so the kalender's samtykke rows
  need a new `GET /api/personer/:personId/samtykker` in `sandbox-backend`. It
  already has `tilstand.samtykker` loaded and `samtykkerFor()` in `regler.ts`,
  so it is a short route plus the OpenAPI entry.
- **Triggers 4 and the tilgangsoversikt card overlap.** "Har dere søkt om
  redusert foreldrebetaling?" sits directly above a card that already says
  "Krever samtykke" for the same ordning. Two boxes about one thing. They say
  different things (one that no application was sent, the other what the rules
  answer), but it reads as noise and is worth merging.

## Coordinate before merging

`feat/frontendMinSide` carries parallel work on the same files by another author,
and has moved several times during this work (latest seen: `0a836dc`). It built
its own version of the compose/launcher wiring, the login and the callback page,
and it still has the Stavanger lock and `GET /api/innbyggere` that `main` removed.
Check what it holds before merging it, and agree who owns which file. The front
page on `main` had its Stavanger identity removed (crest, name, and the claim to
imitate stavanger.kommune.no) because the kommune now follows the citizen and the
front page is pre-login, so there is no citizen to read a kommune from.

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
