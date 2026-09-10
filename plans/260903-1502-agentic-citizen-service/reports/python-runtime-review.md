# Python runtime verification and scoped review

Status: DONE
Date: 2026-09-03

The real Microsoft Agent Framework adapter and workflow pass the replacement tests. No unresolved blocker was found in the reviewed runtime, bridge, service callbacks, or public assistant routes.

## Verification

- `npm test`: 82 TypeScript tests passed. This includes ten retained model/schema/configuration tests and the service/HTTP identity, grounding, revision, consent, and recovery regressions.
- `npm run test:backend`: 17 Python tests passed. Tests use the actual framework `Agent`, `OpenAIChatCompletionClient`, OpenAI SDK, and `WorkflowBuilder`; only HTTP inference transport or explicit host inference is controlled. No external request or dotenv read was needed.
- `npm run typecheck` and `npx eslint tests/assistant-model.test.ts`: passed.
- Additional actual-process check: after a workflow emitted its first host request, closing parent stdin caused the child to exit cleanly within three seconds, with no stderr and no surviving process.

The Python tests verify the Cloudflare HTTPS account endpoint, private gateway/authentication headers, model prefix removal and role-specific models, JSON object response format, disabled storage/thinking, token limit, and SDK retries set to zero. Invalid schema output receives at most one repair; repeated malformed or truncated output and local string/array/citation limits remain rejected. Both attempts share one timeout. HTTP, connection, timeout, interrupted-body, and invalid HTTP-envelope failures do not create extra requests or expose private provider details.

Graph tests verify one selected specialist plus two skipped branches, an empty selection, all three selected specialists starting concurrently before any completes, and a failed specialist reaching the join while the other results survive.

## Review findings

One concrete regression was reproduced and fixed by the production owner: error unwrapping descended past an OpenAI connection/timeout error into its lower-level transport cause, replacing useful Cloudflare guidance with a generic Python-setup error. The final tests now require distinct redacted authentication, quota, HTTP, and connection/timeout messages.

The reviewed trust boundaries remain intact:

- Public command schemas are strict and expose neither `hostModels` nor an inference callback. API paths call `analyzeCase(session)` without an override. The host inference path is selected only through a server-side function argument (`assistant-service.ts`, workflow call and `model` handler).
- The runtime emits a fixed set of host methods from executor code. Model output is parsed as schema-bound data; it does not select callbacks or provide executable tools. The host separately checks proposed facts, exact citations, and deterministic service preparation.
- Cookie case identity and revision are checked before mutations. Analysis creates a fresh revision; current-analysis consent and unresolved-fact gates remain enforced before handoff. The full service/HTTP suite covers these invariants.
- The bridge starts an owned child without a shell or public port, discards stderr, bounds protocol output and run duration, and terminates on completion/error. The Python listener cancels pending workflow work when its parent pipe closes.

Changes in this assignment are limited to `tests/assistant-model.test.ts`, `backend/test_agent_runtime.py`, and this report. Production changes were made by their assigned owner.
