# Documentation hub and About integration

Status: BLOCKED on shared runtime and unfinished KS integration. Page production work is implemented; browser acceptance is not complete.

## Owning changes

- `/dokumentasjon`: NO/EN documentation hub using the existing locale context and Punkt controls. Covers MVP, actual Microsoft Agent Framework graph, Cloudflare Qwen/Gemma, typed answers, Markdown, board, memory and human gates, local setup, KS sandbox and limitations.
- `/om-demoen`: rewritten for the current Team Oslo assistant, privacy, sources and human control. No standalone SFO navigation.
- Page-specific shell/CSS only; no shared UI/backend/config/dependency changes.
- Five Mermaid sources and SVGs updated for Node/Python/Cloudflare and official KS API boundaries, separate income consent, snapshot SFO assessment and local memory lifecycle. Standalone gallery regenerated with matching sources; added reading-size control for wide diagrams on mobile.
- Architecture and Vietnamese run/demo guide updated. Includes setup:ks/start:ks and default ports/person, distinct data consent/fact confirmation/final approval, and no claim that local deletion revokes upstream consent.

## Verified

- Scoped ESLint for `src/app/dokumentasjon` and `src/app/om-demoen/page.tsx` passes.
- No new page errors in the first TypeScript run; existing failures were unfinished KS/domain integration (`demoData`, missing `readSfoAssessment`, `ProcessEnv`). Full typecheck does not pass yet.
- All local links in the two owned Markdown docs resolve.
- All five Mermaid sources parsed and rendered. SVG screenshots visually inspected; public Mermaid copies match their owning sources.
- Standalone gallery passes all five tabs, zoom, reading-size, SVG/source downloads, no external requests/page errors and no mobile page overflow.

## Blocking evidence

The temporary app server was started for read-only page checks at 127.0.0.1:3210, listener PID41956/tool session29040. It was stopped cleanly with Ctrl+C. No server remains owned by this task.

Installed `node_modules/@oslokommune/punkt-react/dist/punkt-react.js` and `.cjs` currently begin with:

```js
if (typeof window === 'undefined') { globalThis.window = globalThis; }
```

After the first GET `/dokumentasjon` (200), server logs repeatedly report `TypeError: Cannot destructure property 'protocol' of 'window.location' as it is undefined`. A fresh page request then shows `Internal Server Error`, preventing NO/EN and mobile acceptance. This global server-window shim was not introduced by this task; do not claim the pages passed browser verification.

The first browser test also used a wrong select ID; that test error was corrected. Punkt generates `documentation-locale-input` and `documentation-diagram-input`. The second run with corrected selectors confirmed the separate HTTP500 issue.

`assistant-ks.ts` already calls `readSfoAssessment`, but at the last inspection the provider/domain integration had not landed. Prose/diagrams for KS assessment match the accepted integration boundary and host callback intent; final claims must be reconciled against its completed implementation and live evidence.

The controller and domain agent were observed errored with an upstream response-service HTTP404, so integration could not be resolved in this delegate's ownership.

## Resume

1. Repair the shared Punkt server shim and finish provider/domain changes; preserve this task's page ownership.
2. Start the single app on3210. Run `/private/tmp/sok-diagrams-tooling/check-pages.mjs` for NO/EN, persisted navigation/reload, all5 diagram images/source downloads/zoom and mobile375 overflow.
3. Inspect generated docs/about desktop/mobile screenshots under `/private/tmp/sok-diagrams-tooling/`. Run final accessibility checks with the UI worker.
4. Reconcile SFO assessment and consent purpose to the final provider/domain contract; update all diagram artifacts together if needed.
5. Full root type/lint/build/browser and real KS verification remain integration gates.
