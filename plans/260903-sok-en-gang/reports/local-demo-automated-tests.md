# Local demo automated test report

Date: 2026-09-03. Scope: independent baseline verification, followed by review and full verification after the main task's explanation-classifier repair. No application source, tests, configuration, dependencies, or synced references were changed by this verification task.

## Summary

Final result: type checking, 23 unit/service tests, linting, production build, and 10 browser tests passed. The baseline also passed before the scoped repair, with 22 unit/service and 9 browser tests. This verifies the implemented demo and repaired question flow against the suite; it is not an assessment of unimplemented v5 features or live integrations.

Runtime: Node.js v24.16.0, npm 11.13.0, Next.js 16.3.4, installed Google Chrome through the repository's Playwright configuration.

## Final review and results after the repair

Reviewed `src/server/explanation-service.ts`, `tests/explanation.test.ts`, and `tests/e2e/journey.spec.ts`, together with the explanation panel and the explanation, assessment, receipt, session, and deletion contracts. No concrete regression found. The classifier's added pattern recognizes income followed by present-tense decrease or lower-income phrasing. Instruction-like input is still rejected before income matching. It selects the existing controlled explanation; it does not update answers, run an assessment, or confirm a case.

The new unit test exercises both previously missed questions, an existing job-loss question, SFO-price wording, an unrelated benefit question, and instruction-like wording. It also checks preservation of source data, answers, assessment, and the absence of a receipt.

| Gate | Final result | Evidence |
|---|---|---|
| `npm run typecheck` | PASS | Exit 0; no diagnostics |
| `npm test` | PASS | 23 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo; runner duration 118.141917 ms |
| `npm run lint` | PASS | Exit 0; no diagnostics |
| `npm run build` | PASS | Exit 0; successful compilation, TypeScript validation, and static-page generation; no reported warnings |
| `npm run test:e2e` | PASS | 10 passed in 22.8 seconds; 1 worker, 0 retries; approved escalation to reuse the local server |

The new browser journey passed with actual UI interactions and HTTP contracts: both free-text questions return correction guidance without changing answers or assessment; the user then supplies 390,000 kr separately, confirms, and downloads the JSON receipt. The downloaded document preserves registered income of 612,000 kr, contains citizen income of 390,000 kr, has `basedOn: citizen`, `status: manual-review`, `event: application.confirmed`, and exactly one local process event. Ending the demo returns to the start page and the session API returns 401. All previous browser cases and sampled axe checks also pass.

## Baseline results before the repair

| Gate | Result | Evidence |
|---|---|---|
| `npm run typecheck` | PASS | Exit 0; no diagnostics |
| `npm test` | PASS | 22 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo; runner duration 312.033541 ms |
| `npm run lint` | PASS | Exit 0; no diagnostics |
| `npm run build` | PASS | Exit 0; successful compilation, TypeScript validation, and 9 static-page generation tasks; no reported warnings |
| `npm run test:e2e` | PASS after environment escalation | 9 passed in 16.8 seconds; 1 worker, 0 retries |

The unit/service suite covers deterministic SFO amounts and boundaries, citizen corrections, missing and invalid income, explicit retrieval choice, provider failure, confirmation requirements and idempotency, session deletion/expiry/capacity, and explanation behavior. Optional model behavior is tested using controlled responses already present in the suite; no real model or external integration was used.

The browser suite covers the complete citizen journey, provenance, questions, confirmation, reload and receipt download, future vision, changed and missing income, explicit recovery from a provider outage, mobile layout at 375 × 812, keyboard start, no-reduction results, API boundaries, the about page, and a delayed-response regression. Existing axe checks reported zero violations in the sampled pages and states. The full journey's assertion reported no external browser requests.

## Baseline environment diagnostic

The first sandboxed browser command failed before any browser tests ran. It could not reuse the local server and its configured startup attempt returned:

```text
Error: listen EPERM: operation not permitted 127.0.0.1:3210
Error: Process from config.webServer was not able to start. Exit code: 1
```

The browser suite was rerun with approved sandbox escalation. It successfully reused the main task's existing production server and passed without source or configuration changes. A non-blocking runner warning reported that `NO_COLOR` was ignored because `FORCE_COLOR` was set.

## Process ownership and artifacts

The baseline production server was owned by the main task (`npm start`, tracked execution session 73070, Node PID 47092). The main task subsequently stopped that server before the final build.

The final browser run reused the main task's rebuilt production server, tracked execution session 63742. After final tests, port 3210 had one listener: Node PID 53584 on `127.0.0.1:3210`. It was deliberately left running for the user's tryout. This verification task left no test-owned server to stop. The main task was notified as soon as all server-using verification work ended in each pass. The only final runner warning was the same non-blocking `NO_COLOR`/`FORCE_COLOR` warning.

These generated artifacts now correspond to the final browser run:

- [Playwright HTML report](../../../playwright-report/index.html)
- [Desktop assessment screenshot](../../../assets/screenshots/assessment-desktop.png)
- [Mobile result screenshot](../../../assets/screenshots/result-mobile.png)
- [Future vision screenshot](../../../assets/screenshots/future-desktop.png)

## Limits and next steps

Coverage percentages and performance metrics were not collected; these gates do not establish exhaustive accessibility, security, or feature coverage. No application test failures or concrete review blockers remain in the verified final scope. The deterministic classifier still supports a bounded set of phrases rather than arbitrary language understanding; the repaired phrases are covered at service and browser levels. No broader work or additional optional test run is required for this scoped repair.
