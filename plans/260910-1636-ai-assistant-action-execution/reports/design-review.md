# Design review — 2026-09-10

Status: reviewed for implementation, with explicit integration limits.

- Approval: prepare stores exact normalized content and execute uses draftId/revision; edits require new preparation. Source review is not action approval.
- Concurrency: SQLite unique action identity and transactional claim, not process-local locks, prevent duplicate dispatch. Replay precedes generic stale-revision handling for the same completed draft.
- Uncertain sends: external KS acceptance followed by crash cannot be proven exactly once. Persist running before IO; recover as uncertain, never auto-resend. A persisted request identity aids investigation, not an exactly-once guarantee.
- Permissions: browser cookie owns case, jobs and receipts; explicit same-origin writes and server operator token protect queue transitions. Planner/catalogue do not authorize arbitrary destinations or template IDs.
- Retention: 90-day case and cookie lifetime bound reminder scheduling. Expiry/delete cancels/removes owned jobs and queue data; worker checks owner inside transaction. No promise that deleted external email is recalled.
- Timezones: date regex alone is insufficient. Validate actual calendar date, local time and timezone; resolve UTC before approval and reject impossible DST times. Default Europe/Oslo is visible.
- Effects: Email means persisted mock outbox, never actual sending; KS means actual synthetic workshop reference, local human review means actual local queue item. No government connector or inbox delivery is fabricated.
- Runtime compatibility: keep flow planner bounded and preserve the four-agent assistant/provider behavior after main merge.
- Verification: exact mock-outbox persistence and an actual restartable durable worker complement unit tests. Production SMTP is outside this delivery.

No design contradiction remains between the three phases. Historical plans are completed and impose no active dependency. CLI global index warning does not invalidate the canonical plan files.
