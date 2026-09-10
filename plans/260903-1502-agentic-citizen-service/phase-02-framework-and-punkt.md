---
title: "Python Agent Framework and Punkt interface"
status: in-progress
---

# Accepted extension

The user explicitly chose Python Microsoft Agent Framework for maintainability,
Oslo Punkt React/styles/icons, NO/EN interface selection, typed follow-up questions,
Markdown tables/bold and a visual case canvas. Preserve the existing real Cloudflare
Qwen/Gemma inference, sourced memory, language adaptation and human consent.

## Implementation boundaries

- Python Microsoft Agent Framework owns Agent execution and a stable WorkflowBuilder
  planner/fan-out/join graph. Every branch emits, with skipped envelopes for services
  not selected. Only selected services make model calls.
- Next.js owns cookie/session identity, SQLite case data, source/value validation,
  deterministic SFO checks, uploads and explicit current-revision human consent.
- Private JSONL child-process transport carries bounded jobs and tool callbacks.
  No second HTTP server; each owned child exits after its analysis or parent loss.
- Framework core/provider releases are pinned. One provider format repair uses the
  original deadline; HTTP failures do not retry. No automatic official submission.
- Punkt React components and local official assets supply the assistant interface.
  NO/EN preference controls UI; question language independently selects AI replies.
- Typed inputs submit citizen assertions through the existing message path; facts
  still require confirmation. Markdown cannot execute HTML or fetch remote images.

## Acceptance

- [ ] Real Cloudflare calls run through Python Agent Framework, with selected branches observable.
- [ ] Existing source, scalar, memory, concurrency and consent regressions remain green.
- [ ] Python transport tests cover real SDK request construction, repair limits and failures.
- [ ] NO/EN UI choice persists; default Norwegian and automatic answer language work.
- [ ] Typed questions, safe Markdown and canvas operate on the actual case in a browser.
- [ ] Punkt components, fonts/icons, mobile layout and accessibility are verified.
- [ ] Five diagrams and setup instructions match the delivered architecture.
- [ ] Clean shareable ZIP excludes credentials, case data and virtual environments.

## Ownership and verification

Controller owns runtime, Node bridge/orchestration, shared contracts and packaging.
UI worker owns assistant components, translations, Punkt styles/assets and browser
tests. Domain worker owns framework adapter/graph tests and prose guard regressions.
Docs worker owns architecture, demo guide and diagrams. No overlapping file edits.

Run Python transport/graph tests, TypeScript domain/API tests and build, then real
mixed-model and browser journeys. Keep `/sfo` working as the separate legacy demo.
Leave one tracked localhost:3210 preview for the user after successful verification.
