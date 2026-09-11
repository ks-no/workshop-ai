---
title: AI assistant actions and durable follow-up
date: 2026-09-10
summary: "Delivered exact approval, mock outbox, reminders and local review; local verification passed with live integration limits."
---

# AI assistant actions and durable follow-up

## What happened

The step planner already produced useful proposals, but email/calendar/contact actions mostly recorded handoff intent. The implementation now stores exact approved drafts, durable execution attempts and truthful receipts. Designsystemet components expose editing, approval, uploads and activity. Python MAF keeps the flow model override while preserving the legacy assistant.

SQLite claims, lease recovery and cross-process revision checks prevent duplicate effects and protect corrections. Real reminder scheduling survives worker restart. The local review queue has an operator-token API. KS continues to return genuine synthetic workshop receipts; reviewed fields remain local when the workshop contract accepts only metadata.

## Decision

The user explicitly allowed mock email: persist an exact mock outbox and clearly state no email was sent. No SMTP integration or public publishing. Cases and owned artifacts expire after 90 days; reminder dates stay within retention.

## Final verification

Controller reports 174/174 unit tests, 29/29 Python tests, full lint and final production build/type validation passing. All four review findings were fixed and approved with 21 focused checks. Browser suites passed 5 wizard and 12 shared cases; four opt-in live cases were skipped and one ungated live-only case excluded. Two screenshot reruns passed but are not additional unique cases. Desktop approval and 375px mobile handoff were readable with no overflow. The worker restart test verified one notification.

The live-provider attempt hit the existing 30-second browser timeout. Successful browser runs used real APIs/SQLite with the model disabled and labelled deterministic fallback; they do not verify live AI or real KS end to end. Email remains mocked, local records/scheduler are real, and production government services are not connected. Owned port-3211 servers were stopped; the user's port-3210 server was untouched. All plan phases completed with these limits recorded. AgentWiki publish skipped.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
