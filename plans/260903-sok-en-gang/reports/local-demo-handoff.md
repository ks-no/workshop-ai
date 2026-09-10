# Local demo handoff

Checked 2026-09-03. Work context: Søk én gang in this workspace.

## Outcome and version identity

Run the available app locally, exercise the complete demo in a real browser, repair
observed bugs, and provide self-run instructions. Keep changes limited to the demo;
no live Fiks integration, new AI architecture, or edits to synced references.

The workspace and its existing ZIP contain Next.js `sok-en-gang@1.0.0`. The referenced
«Design MVP» conversation describes a different dependency-free Node v5 project,
including policy objects, conversation memory, an action router and event envelopes.
No original v5 source or downloadable attachment was returned with that conversation.
That exact version has therefore **not** been verified. This delivery verifies and
repairs the actual Next.js workspace without claiming those missing features exist.

## Bug and repair

The free question «Hva hvis inntekten min går ned?» returned the generic out-of-scope
answer. «Men inntekten min er lavere nå.» had the same classification error. Both
returned `unknown` in a direct runtime probe; the first was reproduced in Chrome.

The classifier handled `gått … ned` and `lavere inntekt`, but missed the word order
and present tense in those questions. Added a phrase match anchored to income that
selects the existing `income-change` explanation. No rule calculation, data contract,
model capability, or workflow action was changed.

A regression test failed on the original code and passed after the fix. It checks
the question topic, unchanged register data/answers/assessment, absence of a receipt,
and preservation of out-of-scope/instruction filtering. A new browser test follows
both free questions through explicit correction with 390 000 kr, confirmation,
downloaded JSON receipt, and session deletion.

## Verification

- Final automated gates: 23 unit/service tests and 10 browser/API tests passed;
  typecheck, lint and production build passed. See [automated report](local-demo-automated-tests.md).
- Browser suite covers source inspection, normal calculation, explanation,
  confirmation, download, reload, next school year, missing/zero/high income,
  data outage recovery, mobile layout, keyboard start and automated accessibility.
- Downloaded correction receipt contains `manual-review`, `application.confirmed`,
  register income 612000, citizen income 390000, and exactly one local process event.
- Additional interactive Chrome checks: missing cohabitant and an incorrect SFO
  note both lead to manual review without a price. Canceling that correction and
  confirming the original facts restores the normal calculation.
- Rechecked the repaired free question in Chrome. It now explains how to use
  «Endre opplysninger». [Screenshot](../../../assets/screenshots/income-question-fixed.png).
- Inspected desktop landing/result and mobile result screenshots. No clipping or
  overlapping text observed. Interactive browser console and page-error logs were empty.

## User handoff and processes

For current startup and walkthrough instructions, see the
[Norwegian/English demo guide](../../../docs/demo-guide.md). The verification
and process details below describe the historical run recorded in this report.

Production preview is intentionally handed to the user at
[127.0.0.1:3210](http://127.0.0.1:3210): `npm start`, root execution session `63742`,
listener PID `53584`, workspace shown above. Reuse that server for immediate tryout.
The earlier server (PID 47092, execution session 73070) was stopped before rebuilding.
The isolated `sok-demo-check` browser was closed after deleting its test session;
test runners have finished and left no separate server.

Startup and local browser access required approved sandbox escalation because the
restricted execution environment returned `EPERM`. No application configuration
change or disabled access control was needed. The native app was asked to open the
preview and guide; its response was `queued` for display when this task is shown.

When the user finishes trying the handed-off preview, stop this task's server.
For future manually started runs, use Ctrl+C in the launch terminal. Recheck PID
ownership before stopping anything because process identifiers may be reused.

## Remaining limits

Original v5 source is needed to validate that specific implementation. Live Fiks,
BankID, municipal submission and an actual LLM were not part of this local run.
