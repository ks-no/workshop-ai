# Independent assistant review

Review scope: the assistant server/domain modules, assistant API routes and UI.
Threat model: one local server process, synthetic demo data, a browser with
multiple tabs, and untrusted model/document output. No enterprise infrastructure
requirements were added. Production code was not edited.

**Final verdict: original findings resolved by targeted re-verification.** Four
concrete failures were reproduced and reported to the controller, who fixed the
production code. No unresolved actionable finding remains within this review's
stated scope. The original findings below are retained as audit history; their
line references describe the code before correction.

## Correction verification

| Original finding | Current correction | Re-verification |
|---|---|---|
| Reanalysis reused consent revision | `src/server/assistant-service.ts:73` invalidates analysis before capturing its new revision. | Same-input reanalysis increments the revision; an old revision is rejected by the mutation lock. |
| Shared cookie selected the wrong case | `src/app/api/assistant/route.ts:14` requires case ID in mutations and checks it at line 36. Delete validates identity and revision at line 53. Receipt validates both at `src/app/api/assistant/receipt/route.ts:10`. | Old case ID with a replacement cookie returns 409 for handoff and delete, preserving the new case. Receipt returns 409 for wrong case or stale revision and 200 for a matching prepared case/version. |
| Automatic start deleted another tab's case | `src/app/api/assistant/route.ts:28` resumes a valid cookie case. | Actual POST start returns 200 with the same case ID and retains its stored data. |
| Unqualified model claims | `src/components/assistant-case-panel.tsx:37,60,64` labels interpretations and explains the citation boundary. `src/domain/assistant-verification.ts:80` adds a bounded numeric/action check. | All three original fabricated amount/submission strings are blocked, with three blocked events and safe summaries retained. UI source inspection confirms interpretation notices and separate fixed SFO calculation. |

Consent now also binds `${caseId}:${revision}` in the UI. Local receipt links
carry both values. These checks address stale browser state without relying on
cookies alone to prove which case the citizen reviewed.

The amount/action guard is deliberately bounded. It checks token presence and
some Norwegian/English phrases; it does not prove entailment, correctly
interpret every negation, cover all languages, or make quoted content true.
The final docs and UI disclose that limitation. This review does not extend the
accepted product into automatic semantic verification.

## P1 — Reanalysis can change the plan without changing the consent revision

**Owner:** `src/server/assistant-service.ts:72–74, 146` and
`src/app/api/assistant/route.ts:37`.

`analyzeCase` captures the existing revision and replaces generated services
without increasing it. `analyzedRevision` is then set to that same revision.
The handoff gate and UI checkbox bind consent only to the numeric revision
(`assistant-case-panel.tsx:76–77`). A fresh analysis in a second tab can therefore
replace the plan after the first tab reviewed and checked its confirmation box.

**Reproduction:** analyze one case with a schema-valid planner selecting
`moving`, keeping its displayed revision `2`. Reanalyze the same case with a
schema-valid planner selecting `housing`, without adding a message or changing
facts. Call `withAssistantLock(id, 2, …prepareHandoff(true))`, as the old tab does.

**Observed:** the old view described `moving` at revision `2`; the accepted
receipt contained `serviceIds: ["housing"]`, also at revision `2`. No stale
revision error occurred.

**Required correction:** every replacement of reviewable analysis must get a
new consent version, or handoff must also validate a unique analysis identifier.
An old checkbox must not authorize a newer result from the same facts.

## P1 — Shared-cookie replacement applies an old tab's action to another case

**Owner:** `src/app/api/assistant/route.ts:13–17, 33–40` and
`src/components/assistant-workspace.tsx:91–95`.

Mutation commands include a revision but no expected case ID. The server selects
the target entirely from the browser cookie. Cookies are shared between tabs.
After another tab deletes and recreates the case, the old tab still displays
the old case while sending the new cookie. Case revisions restart at `1`, so
the old and new cases can easily have the same revision.

**Reproduction:** prepare case A for `moving` at revision `2`. Keep its old UI
snapshot. Delete A and create/prepare case B for `housing`, also at revision `2`.
Invoke the actual POST route with B's cookie and the old displayed command
`{"action":"handoff","confirmed":true,"revision":2}`.

**Observed:** HTTP `200`; the returned case ID was B and its new receipt listed
`housing`. The citizen's old view concerned A and `moving`. The same missing
identity binding also affects message and delete actions. The UI additionally
ignores snapshots with another case ID at `assistant-workspace.tsx:41`, so the
mutation response does not repair the stale view.

**Required correction:** include and validate the expected case identity for
case-specific commands, deletion and receipt access, and surface a changed-case
response instead of silently retaining the old view.

## P1 — Automatic start silently deletes a case created in another tab

**Owner:** `src/app/api/assistant/route.ts:26–28` and
`src/components/assistant-workspace.tsx:99–103`.

`start` unconditionally deletes the case in the current cookie. The UI invokes
`start` automatically when its in-memory snapshot has no case; it is not an
explicit delete action and has no confirmation or expected case identity.

**Reproduction:** open two empty tabs. In B, start a conversation and leave its
case saved. In stale-empty A, send the first message. A's `ensureSession` sends
`start` with the shared cookie now pointing to B. A direct invocation of that
actual route was also tested using an existing stored case.

**Observed:** HTTP `201`, `oldCaseStillExists: false`, `newCaseCreated: true`.
The previous conversation and embedded sources disappear without the
**Avslutt og slett → Slett saken** confirmation.

**Required correction:** starting should reuse an existing valid cookie case
or reject the stale start; destruction should remain an explicit, identity-bound
operation. Changing mutation case IDs alone does not fix this path.

## P2 — Model interpretations are mixed with checked results without qualification

**Owner:** `src/server/assistant-service.ts:104, 129–134, 150` and
`src/components/assistant-case-panel.tsx:36, 59, 63`.

The verifier checks only whether `finding.quote` exists in an allowed source.
It then stores and displays arbitrary `finding.text` beside that citation.
Coordinator and specialist summaries are copied directly into the citizen UI;
the specialist summary overwrites the deterministic preparation summary.
Consequently a schema-valid answer can claim eligibility, invent an amount or
say a submission happened without failing any source check.

**Reproduction:** use the existing injected-model seam and validate the response
through its supplied schema. Return a housing finding with text
`Du har rett til 10000 kroner i bostøtte hver måned.` and quote the actual
`guidance-housing` sentence defining bostøtte. Return a coordinator summary
`Søknaden er allerede sendt til kommunen.` and a specialist summary claiming
the monthly amount.

**Observed:** all three strings remained in the resulting case; the finding
received a valid line-1 citation to the generic housing definition. There were
`0` blocked events. No entitlement calculation or submission occurred.

**Required correction:** preserve the requested generated interpretations, but
identify them clearly as model interpretations and keep the deterministic
checks/results distinct. Explain beside model findings that quote validation
establishes provenance, not confirmation of the interpretation; obvious
unsupported amount or completed-action claims need a bounded handling policy.
This finding does not demand suppressing all generative output or claiming
automatic semantic verification. The disclosed provenance-only trust model is
reasonable; the unqualified presentation did not communicate that boundary.

## Verification and limits

The reproductions used real service/store/route functions with schema-valid
injected model responses, matching the project's existing adapter-test seam.
SQLite was isolated in temporary directories, then closed and removed. No
production case, secret, live personal data or external model call was used.
This establishes failures in the application boundary; it does **not** claim
the live model emitted the fabricated examples.

The review also traced document extraction, source selection, human fact
resolution, expired-row cleanup, lock release and receipt persistence. The
single-process lock is appropriate for the stated local-demo scope. Existing
fact changes increment revisions and invalidate analysis; unresolved facts and
failed specialists block handoff. No model path directly creates a receipt.

Exact quote matching is provenance, not truth or semantic entailment. Proposed
fact booleans and income-basis interpretations still need human review; this is
already disclosed and was not separately reported as automatic confirmation.
Housing/moving checklists may retain tasks for a person after local handoff;
that is intentional preparation behavior, not an eligibility decision.

The controller owns live model evaluation, including its transport adjustment
from constrained JSON Schema output to JSON mode with a schema instruction and
strict local validation. This review did not repeat live model calls or the
other agents' full test/build/browser runs. Targeted checks above use isolated
SQLite and schema-valid injected outputs; they are application-boundary evidence,
not a claim that every live model output is accurate.

The five Mermaid diagrams were reconciled with the corrected case/version
contract and Cloudflare boundaries, parsed and rendered successfully. The
standalone gallery passed all five tabs, zoom, SVG/source export, no external
requests, no page errors and no mobile page overflow. Rendered screenshots were
visually inspected, including the updated interpretation/provenance data flow.

Status: DONE
Summary: Four original findings corrected and targeted regression checks passed.
Remaining model interpretation and live-provider limits are explicitly disclosed.

## Final adapter reconciliation

Read-only inspection of `src/server/assistant-model.ts` confirms the later format
repair remains bounded to two attempts per agent run, shares the original
deadline, and only returns data after the same strict schema validation. HTTP
and fetch failures exit without retry. Rejected content can be sent back to the
same provider for correction; no rejected proposal reaches case memory first.
A narrow body-stream failure caveat was reproduced: a successful HTTP header
response whose body rejects with a transport TypeError enters the same catch as
malformed JSON and triggers a second attempt. The isolated injected Response
returned `bodyStreamFailureAttempts: 2`; no live network call was used. This
contradicted a blanket no-network-retry claim and was reported to the controller.
The controller separated body reading from JSON parsing. Re-running the same
isolated reproduction now rejects after exactly one attempt; this caveat is
resolved and no additional actionable finding remains.
New adapter regression tests and live evaluation remain owned by the controller;
this follow-up did not repeat them. Architecture, demo commands and the sequence
diagram were reconciled with the new behavior.
