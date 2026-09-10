# Interactive assistant and actions

The front page uses [Designsystemet](https://designsystemet.no/no/components).
Its component registry is [flow-components.ts](../src/domain/flow-components.ts):
question form, evidence review, email draft, application draft, reminder editor,
human review, and completion summary. Uploads, notifications and the activity
history are host-controlled UI. Models return validated data, never runnable UI.

## Family overview

After starting a case, click **Familieoversikt** above the current wizard step.
The **Støttekart** connects your situation to the registered SFO, housing, moving
and general-request services. These are options to explore, not eligibility
recommendations. Cards show confirmed/missing requirements and open the exact
selected form through the existing draft approval flow.

**Sjekkliste** shows required facts with their sources and lets you mark which
suggested documents you have ready. Marks survive reload and server restart,
are isolated per case and use version checks across tabs. They neither upload
files nor approve facts or applications; actual requirements may need confirmation
with the recipient. They expire/delete with the case.

**Tidslinje** combines saved case steps, uploads, outcomes, current reminders and
local review updates. Reminder times use Europe/Oslo and are not represented as
official application deadlines. The overview uses existing data without additional
model calls. Return to the wizard to edit/cancel reminders or continue the case.

## Planning and approval

The existing Python Microsoft Agent Framework runtime runs one bounded planner
turn using `LLM_FLOW_MODEL`, falling back to the triage model setting. Node owns
source verification, case revisions, allowed components and action execution.
An informational answer can finish without collecting personal data or executing
an action. When inference fails, the app labels its deterministic fallback.
The citizen can also explicitly choose an action.

`POST /api/flow` handles `input`, `answers`, `approve` (evidence/data access),
`choose`, `review-facts`, `prepare`, `execute`, `skip`, `continue`, and `retry`.
Commands include the cookie-owned `caseId` and current `revision`. The UI first
prepares an immutable snapshot of the edited action. It shows that saved content
and executes only after a second approval referencing its `draftId`. Edits and
case corrections invalidate the old draft. The former raw `execution` payload
on the `execute` command is intentionally rejected.

SQLite claims execution before any effect. Replaying a completed draft returns
its receipt without repeating the action. An interrupted dispatch is blocked
from retry: a running or uncertain record may require checking the external
system. A network failure is not proof that the external system did nothing.

## What actions actually do

| Action | Result |
|---|---|
| Email | Explicit mock: stores the exact approved recipient, subject and body in a private local outbox. No email is sent. No email credentials are needed. |
| KS application | Calls the existing workshop `POST /api/soknader` and keeps the returned application/task IDs. Its API accepts person/process/tracing metadata; edited form fields and documents remain local, not transmitted attachments. |
| Other forms | Saves a prepared local form and provides the official service link. Does not claim municipal submission. |
| Human review | Creates a local review-queue entry with the exact approved summary. Operators can read, update status and reply; citizens see the reply in their case. It is not sent to NAV or a municipality. |
| Reminder | Persists an Oslo-local time resolved to UTC; a separate worker creates one in-app notification when due. Editing and cancelling use version checks. |

## Run reminders

Run alongside the app, from the same project directory and with the same
`ASSISTANT_DATA_DIR`:

```bash
npm run start:reminders
```

The worker checks every 30 seconds, survives browser closure, catches up after
server downtime, and exits cleanly on SIGINT/SIGTERM. Keep this command running
under your deployment's process supervisor. Browser polling only displays the
saved notifications; it does not schedule them. Notifications are in-app, not
push notifications or emails.

Dates use `Europe/Oslo`; missing times default to 09:00. Impossible or ambiguous
daylight-saving times are rejected. Reminders must be in the future and before
case expiry. Current reminders can be edited/cancelled in the activity panel;
calendar exports are optional and already-imported calendars are not updated.

## Local operator queue

Set a private `FLOW_REVIEW_TOKEN` in `.env.local`. The endpoint is disabled when
it is unset. Operators call `GET /api/review-queue` with
`Authorization: Bearer <token>`. To reply, `POST` JSON containing `caseId`, `id`,
`version`, `status` (`queued`, `in-progress`, `resolved`) and `reply` (text or
null), with the same authorization header. Versions are returned by GET and
stale updates return 409. Do not expose this token in client bundles or URLs.
This is local demo operator access, not production staff authentication.

## Storage and boundaries

Flow cases and their HttpOnly cookies last 90 days from creation, so reminders
can outlive a browser session. Legacy `/assistent` cases retain their 24-hour
lifetime. Case deletion removes drafts, outbox messages, jobs, notifications and
local reviews. Expired artifacts are removed on access or by the worker. Only
synthetic test information should be used in this hackathon application.

The agent process receives only allowlisted model configuration, not operator
credentials. The browser's opaque case cookie scopes actions and artifacts;
same-origin writes and schemas protect HTTP boundaries. Source review confirms
only explicitly submitted visible facts. Internal data/MCP adapters and real
government production submissions remain integration boundaries, not simulated
connections.
