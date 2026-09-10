# Code-quality review

Date: 2026-09-03. Scope: the completed local, synthetic SFO prototype, after the controller's specification-compliance pass. Read-only review of the requested domain, provider, service, route, UI, test, architecture and integration files. No source changes or new application processes.

## Findings

### P2 — A delayed history refresh can erase the confirmed screen

Location: `src/components/citizen-journey.tsx:136–137`; trigger in `src/components/explanation-panel.tsx:26`; affected rendering at `src/components/citizen-journey.tsx:208`.

`refreshAudit` replaces the entire current session with an asynchronous GET response. There is no cancellation or ordering check. Asking an explanation starts this refresh, but the user can immediately continue to confirmation. If the GET captured the unconfirmed session and its response arrives after the confirmation response, it overwrites the new session with `receipt: null`. The screen remains `done`, whose content requires a receipt, so the completed journey goes blank. A delayed response can similarly replace a more recent assessment.

Reproduction sequence: complete an assessment; ask an explanation; hold the subsequent GET `/api/case` response after it has captured the unconfirmed session; confirm the case and wait for the receipt screen; release the held GET response. The source writes the stale session unconditionally. This is a source-verified response-ordering defect; the browser interleaving was not executed during this bounded review.

Fix: apply only the refreshed audit entries to the still-current case, or cancel/reject stale refresh responses using case identity and request ordering. Include a focused delayed-response regression check.

### P2 — Concurrent creation can exceed the documented 200-session limit

Location: `src/server/case-service.ts:23–28`, insertion at `src/server/case-service.ts:37`.

The session-count check occurs before awaiting provider responses. Every concurrent call can observe the same capacity, suspend at `Promise.all`, then insert its own session without another capacity check. The limit documented in README and architecture therefore is not an invariant of the service. This affects the existing providers as well: their methods return promises, and parallel direct service calls can all reach the await before any insertion.

Minimal reproduction in a clean service process: call `Promise.all(Array.from({ length: 201 }, () => createCase('standard', true)))`. All 201 calls pass the initial empty-store check and can return sessions. This deterministic interleaving follows from the current code; a separate process was not started during this review.

Fix: check capacity immediately before the synchronous insertion, or reserve capacity before awaiting and release it on failure. Verify that concurrent creation never retains more than 200 sessions.

## Verified boundaries

- Confirmation recalculates on the server, requires explicit confirmation and complete required answers, and is idempotent. Subsequent assessment updates reject confirmed cases.
- Citizen corrections replace the answer set while preserving registry data. Missing income is not interpreted as zero; citizen-provided income routes to manual review. Household/general corrections stop the price estimate.
- The optional model receives the question only and returns a validated topic. Controlled templates produce explanation text, and the explanation service does not assign to assessment, answers or receipt.
- Expired sessions are rejected on access, and audit history is capped at 100 entries. The concurrent session-cap issue is reported above.
- Local synthetic data, absent authentication/integration/database, and demonstration pricing are explicit scope decisions, not findings.

## Verification context

The controller reported a successful production build, 20 passing unit/service tests, and 8 passing browser/API tests including axe checks. This review inspected those tests but did not rerun the suites. Neither reported interleaving has existing regression coverage in the reviewed tests. No P0 or P1 findings.

Status: DONE_WITH_CONCERNS

## Resolution review — 2026-09-03

Both findings are resolved in the targeted source review:

- `src/components/citizen-journey.tsx:136–144` now uses a functional state update, rejects absent/different/confirmed cases, and merges only bounded audit entries. A delayed history response cannot overwrite answers, assessment or receipt, or restore a deleted session. `tests/e2e/journey.spec.ts:125–148` exercises the reported ordering by holding the history response until the receipt is displayed.
- `src/server/case-service.ts:37–39` rechecks capacity after all asynchronous work, immediately before synchronous insertion. No other creation can interleave between that check and insertion in the documented single-process runtime. `tests/session-boundaries.test.ts:5–14` submits 201 concurrent creates and requires exactly 200 successes plus one 503 rejection; the same file also checks expiry.

No remaining actionable findings in these fixes. The controller reports 22 passing unit/service tests. Final production build and browser-suite execution remain with the controller; this resolution review inspected the targeted code and tests without starting processes or rerunning suites.

Status: DONE
