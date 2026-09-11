---
phase: 2
title: "Execution and durable jobs"
status: completed
priority: P1
dependencies: [1]
---

# Phase 2: Execution and durable jobs

## Overview

Execute approved email, KS application, reminder and contact/review actions with truthful durable outcomes.

## Requirements and architecture

- User-authorized mock email is the default and only email adapter in this delivery. Persist the exact approved recipient, subject and body in a mock outbox transaction; label every preview and receipt as simulated, no email sent. Keep an external adapter boundary for future SMTP without implementing it now. Mock data may support an explicitly labelled demo, never become manufactured source evidence or a real municipal decision.
- Persist attempt before IO. Known rejection before acceptance can fail; timeout, process loss or ambiguous completion is uncertain. No automatic resend or invented success. Preserve safe failure detail for the citizen.
- Keep the existing genuine KS workshop submission contract. Do not claim reviewed fields were transmitted unless its API accepts them. Apply the persisted uncertain-attempt policy to ambiguous external KS completion.
- Local forms/contact create real persisted local review requests linked to the exact approved payload. Citizen can read only own status; operator API requires configured server token, returns bounded fields and updates status with revision checks. Label it local throughout.
- Dedicated reminders store owner, draft, title/note, local date/time, IANA timezone, resolved UTC dueAt, status/version and notification. Default timezone Europe/Oslo; show date/time explicitly before approval. Reject impossible dates, past instants and DST gaps; choose/document ambiguity handling.
- Set case lifetime and cookie to 90 days; reminder must be due before expiry. Expiry/delete transaction removes owned jobs/notifications/review data. Worker verifies owner existence/expiry at claim time.
- Owned bounded worker scans due jobs, atomically creates one in-app notification and marks delivery in a transaction. Restart catches up overdue jobs; no page visit required. Edit/cancel compare job version and prevent races with delivery. Notifications display when the citizen returns; no OS push claim.

## Related code files

Modify `src/server/flow-service.ts`, `src/server/flow-store.ts`, `src/app/api/flow/route.ts`, `src/server/flow-http.ts`, `package.json`. Create narrowly scoped connector/job modules, worker entry point and owner/operator routes as implementation boundaries require. Add focused action/job integration tests.

## Implementation steps

1. Implement the durable mock email outbox and verify exact approved payload, explicit mock receipt and idempotent insertion.
2. Wire KS outcomes and transactional local review queue with authenticated operator transitions.
3. Add durable timezone-aware jobs, cancellation/edit APIs, one-notification transaction and startup recovery.
4. Wire deterministic worker lifecycle into documented launch commands; track and stop test worker processes.

## Success criteria

- [x] Approved mock email content is stored once; preview and receipt clearly say no actual email was sent.
- [x] KS returns its actual sandbox reference; local review is inspectable/updateable and never municipal submission.
- [x] Reminder created before server/worker restart fires once afterward, edits change due time, cancellation prevents notification.
- [x] Wrong-owner requests and invalid operator tokens fail; expiry/deletion prevents later private work.

## Risk assessment and rollback

SMTP is intentionally excluded under the user-authorized mock-email scope; no external delivery is claimed. External systems lack universal exactly-once semantics: uncertainty blocks automatic retry. Job delivery and deletion race: transactional ownership check/unique notification prevents orphans and duplicates. On worker failure keep pending jobs durable and expose operational failure; restart owned worker, never silently mark jobs delivered. Rollback stops owned workers before disabling routes and preserves durable records.
