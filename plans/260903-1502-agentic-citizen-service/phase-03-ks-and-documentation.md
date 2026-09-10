# Phase 3: KS workshop APIs and in-app documentation

## Outcome

Replace the authored data-import choice with calls to the official KS workshop sandbox, retire the standalone SFO page, and make the full MVP understandable in the app.

## Delivered

- Official `ks-no/workshop-ai` source is downloaded at pinned revision `656a5c69edbddad4b0e3f194c44289f12f09ef0d` by `npm run setup:ks`.
- `npm run start:ks` owns Digdir mock (8086), Fiks simulator (8081) and sandbox backend (8080), binds them to loopback and keeps authentication enabled.
- Server-side typed client obtains official test tokens without exposing them to browser, storage or AI context.
- Normal KS connection reads household, SFO and rates for configured `person-022`. There is no test-person chooser or authored fallback.
- Income and deterministic SFO assessment require explicit, revision-bound consent recorded by Fiks. Consent is checked again before both reads.
- Stored sources remove personal identifiers and retain selected wire fields, source URL, purpose and retrieval time.
- Conversation income cannot rewrite the KS assessment snapshot; differences require human review.
- `/sfo` redirects to `/`; old demo controls are absent.
- `/dokumentasjon` and `/om-demoen` provide NO/EN architecture, flows, limits and five local diagrams.

## Acceptance evidence

- Real KS integration: household, SFO, rates, income and assessment all retrieved; consent status `SAMTYKKET`.
- Typecheck, lint and production build pass.
- 84 TypeScript tests and 17 Python tests pass.
- Browser: 9 default flows pass; real KS consent/accessibility flow passes; real Cloudflare language, TXT and PDF flows pass. Typed-question model-backed assertions and board render passed; the final badge-bearing mobile tab locator was corrected and is covered by the default mobile suite.

## Boundaries

All KS people and register values are synthetic workshop data. No BankID, real register, municipal decision or submission exists. Local case deletion does not revoke the Fiks simulator's already-recorded consent/history.
