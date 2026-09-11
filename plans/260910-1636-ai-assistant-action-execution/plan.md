---
title: "AI assistant action execution"
description: "Complete the approved interactive planner, exact-draft action execution, durable reminders and local human review."
status: completed
priority: P1
branch: flow/ai-factory-step-planner
tags: [feature, frontend, backend, api]
blockedBy: []
blocks: []
created: 2026-09-10
---

# AI assistant action execution

## Outcome and constraints

Implement the user-provided architecture PDF: citizen components → Node orchestrator → Python MAF planner → ask/review/action → exact-draft approval → permission-checked executor → persistent receipt → next planning step. Hold the full requested scope. Use Designsystemet for wizard components. Preserve the legacy four-agent assistant, main-branch model/provider behavior, KS consent gates and deterministic rules. The branch checkout and merge of main precede implementation.

Reuse the existing wizard, strict flow schemas, sourced memory, SQLite, Python runtime and KS workshop connector. Add a clearly labelled persisted mock email outbox, durable in-app reminders, and an actual local human-review queue. Local review is explicitly not a municipal submission. No invented NAV/government integrations, production authentication, public deployment, or external messages without citizen approval. Optional MCP remains an adapter boundary, not a required new dependency.

## Evidence and dependencies

Inspected flow types, service, store, model and API, Python runtime, README.en.md and architecture/integration docs. Existing email merely opens a mail client; reminders produce calendar files; contact/local forms only record intent. KS forms already create sandbox applications. Existing plans are completed historical deliveries; no unfinished blocking plan was found. More than eight files are justified by the existing domain/API/UI/runtime boundaries; three phases avoid introducing a parallel application framework.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Contracts, persisted draft and planner boundary](./phase-01-start.md) | Completed |
| 2 | [Execution and durable jobs](./phase-02-execution-and-durable-jobs.md) | Completed |
| 3 | [Designsystemet and verification](./phase-03-designsystemet-and-verification.md) | Completed |

## Acceptance criteria

- [x] Planner asks missing information, presents sourced evidence, prepares actions, and loops using truthful receipts; it cannot execute directly.
- [x] Prepare stores an exact immutable draft; execute approves its draftId and current revision. Editing requires a new draft and approval.
- [x] Concurrent/repeated execution cannot duplicate an effect; interrupted external sends are uncertain and never automatically retried.
- [x] The mock outbox stores exactly the approved message once and clearly states no email was sent. SMTP is outside this delivery by explicit user decision.
- [x] KS sandbox submission keeps its real receipt; human review creates an actual local queue item with operator-token access and visible status.
- [x] Reminders survive restart, notify once when due, and support edit/cancel. Timezone is explicit and due dates stay inside the 90-day case lifetime.
- [x] Expiry/deletion removes owned jobs and private queue data; no worker processes orphaned records.
- [x] Designsystemet screens cover editing, approval, execution failure/uncertainty, receipts, reminder management and review status with keyboard/mobile access.
- [x] Focused tests, Python tests, full unit, lint, typecheck, build and relevant browser checks pass; real scheduler/KS evidence is distinguished from explicitly mocked email.

## Review and delivery

[Design review](./reports/design-review.md) resolves approval, duplicate effects, uncertain sends, ownership and timezones. Update only owning README/integration/architecture surfaces when behavior lands. No credentials are assumed. The CLI scaffolding succeeded; its optional global index was unwritable, so these Markdown files remain canonical.

## Delivery status

All three phases are complete. Unit/Python tests, lint, production build and applicable browser checks passed. Live-provider/browser verification remains explicitly limited; see [verification](./reports/verification.md).
