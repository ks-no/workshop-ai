# Action recovery

Outcome: recover failed approvals without losing case data or silently repeating uncertain submissions. Preserve useful sanitized errors and distinguish proven non-dispatch from unknown outcomes.

Scope: provider failure classification and read-only KS lookup; durable recovery with case ownership/status checks; explicit user attestation for externally verified non-submission; visible recovery controls. Never infer non-submission from an empty sandbox list (its storage can reset). No automatic resend, case deletion, or reset of existing attempts.

Acceptance: proven non-dispatch permits a new approved draft; uncertain/running claims block replay; matching KS receipts can be restored; manual resolution is recorded and requires explicit confirmation; foreign/stale recovery rejected; focused provider/store/API/browser checks, build and lint pass.

Status: complete.

Additional user request: replace the unexplained Family overview button with a compact invitation describing its value; add top/bottom spacing to wizard warnings and errors. Keep Designsystemet and verify at mobile width.

Validation: 185 unit tests, 7 browser journeys, production build/TypeScript, lint and diff checks passed. Mobile invitation screenshot inspected. Review caught a cross-step duplicate-submission bypass; guard now covers unresolved same-template KS drafts across steps, with regression coverage. Ambiguous competing attempts cannot claim the same receipt. Temporary browser server stopped.

Environment finding: live read-only KS availability check failed. Existing uncertain records were preserved; the new recovery UI requires actual receipt verification or explicit recorded user confirmation. KS stack must be available for remote submission/status checks.
