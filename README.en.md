# Søk én gang · Team Oslo

[Norsk bokmål](README.md) · **English**

A hackathon demo for preparing family/SFO, housing and moving matters in one conversation. Use synthetic test information only. Only explicitly approved KS workshop test applications are registered; no production government application is submitted.

## Architecture

- Next.js/React. The front page is a step-by-step guide built with Designsystemet (designsystemet.no); the conversational assistant at `/assistent` uses Oslo municipality’s Punkt design system and has Norwegian/English interfaces.
- Python and Microsoft Agent Framework: an AI model coordinates specialist analyses.
- SQLite case memory: 90 days for the front-page flow, 24 hours for `/assistent`, source excerpts, revisions and explicit human confirmation of facts.
- General questions require no personal lookup. A personalised SFO assessment can request consent to retrieve synthetic data from locally running official KS workshop APIs. Declining opens manual questions.
- AI can explain and suggest; it cannot confirm facts, make official decisions or submit applications.
- In the legacy `/assistent` view, services offer an end action: answer what is missing, contact the right person, an e-mail draft you review and send yourself, or a form filled from confirmed information. The SFO form is submitted to the KS sandbox as a test application and receives an application ID and a casework task. The agent recommends, the app checks, you carry it out.
- Model context is minimised and marked private/untrusted. Analysis stops if the agent receives capabilities beyond analysis.

## Interactive actions on the front page

Use the action selector to prepare email, forms, reminders, or a human review.
Edit the draft, review its saved contents, then approve execution. Email uses
a clearly labelled mock outbox. Reminders and the local review queue persist
in SQLite. Run `npm run start:reminders` alongside the app for in-app alerts.
See [interactive flow and action setup](docs/interactive-flow.md) for approval
contracts, operator access, retention and actual KS submission boundaries.

## Run locally

Requirements: Node.js 22.18 or newer and Python 3.11 or newer.

```bash
npm ci
npm run setup:backend
npm run setup:ks
```

Copy [`.env.example`](.env.example) to `.env.local` and fill in the server-side AI model settings. Start the KS services in one terminal:

```bash
npm run start:ks
```

Start the app in another terminal:

```bash
npm run dev
```

Open <http://127.0.0.1:3210/> for the «Søk én gang» step-by-step guide (the interface from the Figma prototype). The conversational assistant is at <http://127.0.0.1:3210/assistent>. The bilingual documentation and diagram viewer are at <http://127.0.0.1:3210/dokumentasjon>.

To share the demo with a tester on the same VPN:

```bash
npm run build
npm run start:vpn
```

The tester opens `http://<VPN-IP>:3210`. Allow incoming Node.js traffic if macOS asks. Use synthetic information only. Access lasts while the server runs and requires a VPN that allows direct traffic between clients.

The default test person is `person-022`, configurable through `KS_PERSON_ID`. There is no person selector in the app. These are synthetic workshop records, not public registers.

## Model providers

The four stages are `triage`, `draft`, `critic` and `polish`. Configure each
with `LLM_TRIAGE_MODEL`, `LLM_DRAFT_MODEL`, `LLM_CRITIC_MODEL` and
`LLM_POLISH_MODEL`. Unset stages fall back to the legacy coordinator/specialist
settings, then `LLM_MODEL`.

For an OpenAI-compatible endpoint, set `AI_PROVIDER=litellm`, `LLM_BASE_URL`
and `LLM_API_KEY`, and provide model names for all stages (or use `LLM_MODEL`).
HTTPS is required except for local loopback HTTP endpoints. If `AI_PROVIDER`
is unset and `LLM_BASE_URL` is present, this mode is selected automatically;
an invalid endpoint fails rather than switching providers.

Explicit `AI_PROVIDER=cloudflare` or `AI_PROVIDER=telenor` retains the existing
provider-specific credentials and model defaults. Credentials remain on the
server and only allowlisted model settings reach the Python process.

## Verification

See [Verifisering in the Norwegian README](README.md#verifisering) for the checks, and [package.json](package.json) for their executable definitions.

## Documentation

- [Demo guide (NO/EN)](docs/demo-guide.md)
- [Diagrams on GitHub (NO/EN)](docs/diagrams/README.md)
- [Architecture and boundaries (Norwegian)](docs/agentic-architecture.md)
