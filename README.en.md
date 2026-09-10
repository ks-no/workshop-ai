# Søk én gang · Team Oslo

[Norsk bokmål](README.md) · **English**

A hackathon demo for preparing family/SFO, housing and moving matters in one conversation. Use synthetic test information only. No application is submitted.

## Architecture

- Next.js/React with Oslo municipality’s Punkt design system and Norwegian/English interfaces.
- Python and Microsoft Agent Framework: an AI model coordinates specialist analyses.
- SQLite case memory for 24 hours, source excerpts, revisions and explicit human confirmation of facts.
- General questions require no personal lookup. A personalised SFO assessment can request consent to retrieve synthetic data from locally running official KS workshop APIs. Declining opens manual questions.
- AI can explain and suggest; it cannot confirm facts, make official decisions or submit applications.
- Model context is minimised and marked private/untrusted. Analysis stops if the agent receives capabilities beyond analysis.

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

Open <http://127.0.0.1:3210/>. The bilingual documentation and diagram viewer are at <http://127.0.0.1:3210/dokumentasjon>.

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
