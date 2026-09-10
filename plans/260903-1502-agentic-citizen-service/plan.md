---
title: "agentic-citizen-service"
description: ""
status: completed
priority: P1
effort: ""
tags: []
created: 2026-09-03
---

# agentic-citizen-service

## Overview

Replace the SFO-only home with an actual model-backed citizen assistant. Reuse the
accepted multi-service direction: coordinator, parallel family/housing/moving
specialists, shared sourced memory, document extraction, explicit human gates.
Retire the standalone `/sfo` journey and use the shared assistant with the official local KS workshop APIs.

## Outcome and boundaries

- Norwegian service UI, accepts natural-language Norwegian/English/Vietnamese.
- Norwegian Bokmål replies by default; the latest citizen question or explicit preference
  selects the reply language. Short ambiguous follow-ups retain case language; original
  quotations are not translated and uploads do not choose the response language.
- Real inference via user-selected Cloudflare AI Gateway and Gemma 4 26B A4B.
  Server-only credentials, schema-validated outputs and visible failures; no simulated AI.
  Latest accepted routing: Qwen 3.8 27B coordinator, Gemma 4 specialists; each run records its selected model.
- Three completed preparation workflows: family/SFO assessment, housing evidence
  checklist and handoff, moving checklist and handoff. Housing eligibility/amounts
  are not invented; no live government submission or authentic register access.
- Persistent per-browser case memory with messages, cited claims, explicit fact
  confirmations/rejections, source snapshots, agent runs, revisions and local receipts.
- Extract text from TXT and text-based PDF; cite exact quote and page/line. Reject
  unsupported/scanned documents clearly. Documents are untrusted input.
- Automatic planning/analysis and allowlisted source reads; human confirmation for
  facts, resolving conflicts and final handoff. No model can commit/confirm actions.
- Latest user decision: Oslo Punkt React components, fonts, styles and icons for
  the assistant. NO/EN interface selection, typed follow-ups, safe Markdown and canvas.
- Python Microsoft Agent Framework replaces hand-written model transport and
  workflow scheduling. Existing domain rules, case memory and human gates remain.
- Five accurate, rendered/exportable diagrams and short running/demo instructions.
- No change to sources/, no live personal data, deployments or public messages. User-authorized Cloudflare inference uses their account.

## Inspected evidence

Next.js 16, React 19, TypeScript, zod, node:test, Playwright and local providers are
already installed. Existing API routes are under src/app/api; SFO calculation is
pure in src/domain/rules.ts. Existing tests passed 23 unit + 10 browser cases.
Old SFO server currently owns 127.0.0.1:3210 (PID 53584); stop it before rebuilding.
Docs under docs/ describe only the old single-service experience and must be updated.
No git repo; source changes stay in this workspace and ZIP.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Actual coordinator and specialized model runs with bounded schemas | P1 |
| 2 | Shared sourced memory, documents, deterministic verification and human control | P1 |
| 3 | Multi-service UI, full browser verification, five rendered diagrams | P1 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Phase 1: Agentic service](./phase-01-start.md) | Delivered, integrated verification pending |
| 2 | [Python framework and Punkt](./phase-02-framework-and-punkt.md) | Delivered |
| 3 | [KS workshop APIs and documentation](./phase-03-ks-and-documentation.md) | Verification in progress |

## Success Criteria

- [ ] Unscripted input selects relevant catalogue services; negation and uncertainty do not become confirmed facts.
- [ ] Selected specialists run separately with observable start/completion and bounded context; failures remain visible.
- [ ] Claims cite exact text in a stored source. No unsupported citation/value enters accepted facts.
- [ ] One confirmed fact is reused across services; conflicting replacements require explicit resolution.
- [ ] Reload/server restart preserves unexpired case; deletion removes the case and its embedded documents/memory.
- [ ] Document upload extracts actual text with page/line references; errors preserve earlier memory.
- [ ] Confirmation requires a current revision, no unresolved proposed/conflicting facts, completed analysis and explicit checkbox; receipt is idempotent.
- [ ] Three service preparation flows produce concrete checklists and sourced handoff; SFO rule computation remains deterministic.
- [ ] Model failure is visibly a failure, never presented as successful AI. Live model tests recorded separately from adapter tests.
- [x] `/sfo` redirects to the shared assistant; unit/API/browser cases cover agentic flows, KS consent, human gates, mobile and accessibility.
- [ ] Architecture, workflow, sequence, data flow and lifecycle diagrams correspond to implemented paths and are viewable offline.
- [ ] Actual coordinator/specialist replies follow question language, retain language for short follow-ups, and preserve original source quotations.

## Work ownership

Controller: shared types, memory store, model adapter, orchestrator/API, package/config,
integration, model runtime and final validation. UI worker: new assistant components
and scoped CSS, home /sfo routing, metadata, new browser tests. Domain worker: service
catalogue, deterministic specialists/tools, claim verification utilities and unit tests.
Documentation worker: five Mermaid sources/SVGs and architecture/run documentation.
No overlapping edits; communicate stable interfaces before implementation.

## Validation and rollback

Review the design before source edits. Test isolated domain/model contracts first,
then full unit/type/lint/build and old/new browser flows. Evaluate a real model with
novel multilingual/negated/conflicting inputs and preserve actual results. Retire the legacy `/sfo` journey and keep rollback within workspace artifacts. Stop only processes owned by this
task. Do not claim production/legal readiness or a verified live integration.

<!-- slug: agentic-citizen-service -->
