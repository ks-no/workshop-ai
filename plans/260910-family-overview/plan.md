# Family overview

Status: complete

Outcome: add a visible Family overview to the existing wizard, with a service support map, persistent interactive document checklist, and chronological timeline. Reuse Designsystemet, the registered form catalogue and existing SQLite artifacts. No extra model calls, generated eligibility claims, new frameworks, or changes to approved-action execution.

Implementation: derive service cards and requirements from form templates and confirmed facts; let users open the exact selected template through existing approval flow. Save document-readiness marks with cookie ownership and version checks; they never confirm facts or upload documents. Derive timeline from real sources, history, outcomes, current reminder state and review updates. Expose overview with a visible button from every active case.

Review: explicit template selection must reject unknown IDs; checklist keys must belong to catalogue and writes use case identity plus CAS. Retention/deletion reuse artifact cleanup. Missing data stays missing; only supported services appear. Future reminder dates are shown as reminders, not official deadlines.

Acceptance:
- [x] Support map links to correct form and shows confirmed/missing requirements and sources.
- [x] Document checklist persists across reload, rejects stale/foreign writes and cannot approve facts/actions.
- [x] Timeline uses current real statuses, including edited/cancelled reminders and local/mock labels.
- [x] Keyboard/mobile browser journey, focused tests, typecheck/lint/build pass.

Validation: 177 unit tests passed; five existing wizard browser tests and the new mobile/keyboard overview journey passed. Production build (including TypeScript) and lint passed. Independent review found no blocking issues. Browser testing caught and fixed inactive-tab CSS visibility and the service selector label association. Screenshots verified at 375px width; temporary test server stopped after execution.
