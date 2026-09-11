---
phase: 3
title: "Designsystemet and verification"
status: completed
priority: P1
dependencies: [1, 2]
---

# Phase 3: Designsystemet and verification

## Overview

Expose every architecture stage as a working accessible component and verify complete journeys.

## Requirements

Use installed Designsystemet controls in the wizard. Show source review, editable proposal, exact prepared preview, explicit approval, execution progress, truthful receipt/failure/uncertainty and next-step continuation. Add reminder edit/cancel and notification status, local-review reference/status and an authenticated operator interaction surface. Keep legacy assistant UI/provider behavior compatible.

## Related code files

Modify `src/components/sok-wizard.tsx`, `src/components/sok-wizard.module.css`, `tests/e2e/wizard.spec.ts`, relevant API/unit tests, `README.en.md`, owning Norwegian README, `docs/agentic-architecture.md` and `docs/integrations.md`. Add a review-queue UI only if needed to complete operator interaction.

## Implementation steps

1. Read current official Designsystemet component documentation and installed API types before changes; retain existing component patterns.
2. Separate edit and prepared-preview UI; any edit invalidates approval and repeats preparation. Keep recipient, full body/fields, destination and reminder timezone visible.
3. Show connector availability, pending/accepted/uncertain outcomes and durable reminder/review controls. Do not use mailto/ICS as the claimed completion of server execution; downloads can remain optional artifacts.
4. Verify keyboard focus, accessible names, error recovery, reload, mobile and no duplicate submission on rapid clicks.
5. Run narrow flow tests first, then Python/unit/typecheck/lint/build and relevant Playwright suites. Test mock-outbox persistence and worker restart with owned processes. Record unresolved environment failures honestly.
6. Update owning docs with real retention, scheduler launch, mock-email semantics, operator token, receipt meanings and connector boundaries; link source-owned configuration rather than duplicating it.

## Success criteria

- [x] Every displayed action produces the described effect or an explicit actionable failure.
- [x] Exact content is reviewable before approval; changes cannot reuse approval.
- [x] Browser flow resumes after restart and continues from persisted receipts/notifications.
- [x] All required checks pass or concrete environment blockers are reported without false completion.
- [x] Documentation and integration evidence agree with observable implementation.

## Risk assessment and rollback

Mock email never proves external delivery: preview and receipt explicitly label the simulation. Existing e2e expectations may encode mailto/calendar placeholders: update assertions to actual behavior, retaining coverage for original consent/security invariants. If UI state diverges from durable execution, reload server truth rather than retrying effects. Revert scoped UI changes without removing persisted receipts.
