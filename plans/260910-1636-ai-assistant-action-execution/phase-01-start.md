---
phase: 1
title: "Contracts, persisted draft and planner boundary"
status: completed
priority: P1
dependencies: []
---

# Phase 1: Contracts, persisted draft and planner boundary

## Overview

Make Node authoritative for exact approval, permitted actions and durable transitions. Preserve Python MAF and legacy assistant behavior.

## Requirements and architecture

- Introduce prepare → execute: prepare validates citizen edits against the current proposal, stores normalized immutable payload plus draftId, stepId, caseId and revision, and returns a reviewable draft. Execute accepts draftId/current revision, never fresh editable execution content.
- Tie approval to the exact stored payload; editing invalidates/replaces the draft. Reject case mismatch, stale revision, unavailable connector, illegal recipient/template, unknown fields and modified immutable facts.
- Store durable action attempts with unique draft identity, state pending/running/succeeded/failed/uncertain, payload and receipt. Atomic SQLite claims are authoritative across processes; in-memory locks remain a local convenience.
- Replay a completed draft returns the same receipt even after case revision advanced. A replay with conflicting identity never sends again. Receipt persistence precedes the next planner turn.
- Planner only proposes bounded schemas. Preserve sourced fact checks, consent, private context minimization, model selection and visible inference failures.

## Related code files

Modify `src/domain/flow-types.ts`, `src/server/flow-store.ts`, `src/server/flow-service.ts`, `src/server/flow-model.ts`, `src/app/api/flow/route.ts`, and targeted `tests/flow-service.test.ts`/`tests/flow-http.test.ts`. Modify `backend/agent_runtime.py` only for the flow-specific planner graph if needed; preserve its legacy graph.

## Implementation steps

1. Capture focused existing flow/Python baseline after the main merge.
2. Add additive persistence and strict prepare/execute contracts, compatibility parsing for old stored cases, and owner-bound reads.
3. Implement atomic draft/attempt state transitions and recovery of interrupted execution as uncertain.
4. Pass outcomes and available connector capabilities into bounded next-step planning; enforce everything again at execution.

## Success criteria

- [x] Stale/wrong-case/modified/unapproved calls cause zero connector IO.
- [x] Concurrent claim has one winner; completed replay gives the same receipt.
- [x] Restart after external dispatch never silently retries; sources and previous outcomes survive.
- [x] Legacy assistant contract and Python tests retain existing behavior.

## Risk assessment and rollback

SQLite JSON case saves can overwrite parallel worker data: keep jobs/attempts in dedicated tables and transact changes with revision checks. If current helpers cannot preserve atomic claims, introduce a narrow transaction helper rather than broad store replacement. Roll back UI/API wiring without dropping historical attempts or receipts.
