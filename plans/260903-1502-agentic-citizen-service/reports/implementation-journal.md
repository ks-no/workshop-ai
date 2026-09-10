# Delivery decisions

The original workspace contained a working single-service Next.js SFO app. The accepted change broadened its home into an AI-led citizen workspace while retaining `/sfo` and its APIs. Shared contracts enabled separate UI, domain and documentation work; the controller implemented model orchestration, storage, routes and integration.

The user selected Cloudflare AI Gateway with Gemma 4 during implementation. The unused local model installer was unmounted and removed; no local model runtime or duplicate model server remains. Keys were stored only in `.env.local` with owner-only file permissions.

Source quotes and human confirmation are separate facts: a quote's presence does not establish the correctness of a model interpretation. Review reproduced real multi-tab failures, which were fixed by binding mutations, deletes and downloads to case identity and revision, increasing revisions on reanalysis and resuming existing cases on start.

Live evidence drove the switch from constrained decoding to JSON mode with strict local validation and a bounded repair. The final Norwegian scenario exercised actual repair three times and completed without bypassing a validator. Further architecture detail belongs in the linked implementation docs, not this historical journal.

The user later selected Qwen 3.8 27B alongside Gemma. The coordinator now uses Qwen and the specialists use Gemma; per-role environment overrides take precedence over the legacy LLM_MODEL fallback. Each agent run records the selected model. The first real Qwen probe understood Vietnamese housing need and negated family/moving facts. Final mixed-model validation is recorded in the verification report.

The user then required Norwegian-default automatic reply-language selection, Python Microsoft Agent Framework, Oslo Punkt, an NO/EN interface switch and rich questions/Markdown/canvas. The framework now owns actual agent execution and a stable planner/fan-out/join graph; fixed branches emit skipped envelopes when unselected. Node retains domain checks, SQLite case memory and human consent, communicating over private pipes with one bounded Python child per analysis. Framework checkpointing is not claimed.

Real language tests exposed Norwegian fallback text and locale-formatted amounts such as Vietnamese 13.500. Full language names in specialist instructions, localized safe notices and locale-aware prose amount checks corrected these cases without loosening source fact extraction. Framework clients wrap SDK errors, so typed causes are inspected for sanitized, useful failure messages.

Punkt's Sass integration required a local compiler port unavailable to Turbopack in this host even after a reviewed escalation. The documented dev/build commands now use Next's supported Webpack compiler; the production build passed without that port dependency. Official Punkt assets are served locally.

A first long real-framework evaluation timed out at the Cloudflare coordinator's 90-second limit. That failure remains in live-model-evaluation.json. The focused Norwegian rerun completed the entire memory/correction/handoff path in 182.5 seconds across four analyses; the shorter multilingual/negation/unsupported groups also passed. Runtime errors remain visible rather than converted to simulated success.
