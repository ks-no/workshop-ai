import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import type { FlowCase, FlowExecution, FlowOutcome } from '../domain/flow-types';
import type {
  ActionDraft,
  ActionAttempt,
  FlowActivity,
  MockEmail,
  FlowReminder,
  FlowNotification,
  FlowReview,
  ReminderInput,
} from '../domain/flow-action-types';
import { assistantDatabase } from './assistant-store';
import { CaseError } from './case-service';
import { checklistKeys } from '../domain/family-overview';
import type { ChecklistMark } from '../domain/flow-action-types';
const now = () => new Date().toISOString();
function db() {
  const d = assistantDatabase();
  d.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS flow_artifacts (id TEXT PRIMARY KEY, case_id TEXT NOT NULL, kind TEXT NOT NULL, effect_key TEXT, body TEXT NOT NULL, UNIQUE(case_id,kind,effect_key));
    CREATE INDEX IF NOT EXISTS flow_artifacts_owner ON flow_artifacts(case_id,kind);`);
  return d;
}
function owner(caseId: string) {
  const d = db();
  const row = d.prepare('SELECT expires FROM flows WHERE id=? AND expires>?').get(caseId, Date.now()) as
    { expires: number } | undefined;
  if (!row) throw new CaseError('Saken er slettet eller utløpt.', 401);
  return row;
}
function all<T>(caseId: string, kind: string): T[] {
  return (
    db()
      .prepare('SELECT body FROM flow_artifacts WHERE case_id=? AND kind=? ORDER BY rowid')
      .all(caseId, kind) as { body: string }[]
  ).map((r) => JSON.parse(r.body));
}
function get<T>(caseId: string, kind: string, id: string): T {
  const row = db()
    .prepare('SELECT body FROM flow_artifacts WHERE case_id=? AND kind=? AND id=?')
    .get(caseId, kind, id) as { body: string } | undefined;
  if (!row) throw new CaseError('Oppføringen finnes ikke i denne saken.', 404);
  return JSON.parse(row.body);
}
function write(caseId: string, kind: string, value: { id: string }, effectKey: string | null = null) {
  db()
    .prepare(
      'INSERT INTO flow_artifacts(id,case_id,kind,effect_key,body) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',
    )
    .run(value.id, caseId, kind, effectKey, JSON.stringify(value));
}
function transaction<T>(work: () => T): T {
  const d = db();
  d.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    d.exec('COMMIT');
    return result;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}
export function deleteFlowArtifacts(caseId: string) {
  db().prepare('DELETE FROM flow_artifacts WHERE case_id=?').run(caseId);
}
export function invalidateDrafts(caseId: string) {
  for (const draft of all<ActionDraft>(caseId, 'draft'))
    if (draft.status === 'prepared') {
      draft.status = 'superseded';
      write(caseId, 'draft', draft);
    }
}
function assertCurrentSession(session: FlowCase, expectedRevision = session.revision) {
  const row = db().prepare('SELECT body FROM flows WHERE id=? AND expires>?').get(session.id, Date.now()) as
    { body: string } | undefined;
  if (!row) throw new CaseError('Saken er slettet eller utløpt.', 401);
  const stored: FlowCase = JSON.parse(row.body);
  if (
    stored.revision !== expectedRevision ||
    stored.step?.id !== session.step?.id ||
    !isDeepStrictEqual(stored.step?.proposal, session.step?.proposal)
  ) {
    throw new CaseError('Saken er endret. Last inn siste versjon før du godkjenner.', 409);
  }
}
export function prepareAction(
  session: FlowCase,
  execution: FlowExecution,
  persist?: (session: FlowCase) => void,
): ActionDraft {
  owner(session.id);
  if (
    session.step?.kind !== 'action' ||
    !session.step.proposal ||
    execution.type !== session.step.proposal.type
  )
    throw new CaseError('Ingen samsvarende handling å godkjenne.', 409);
  if (execution.type === 'reminder') reminderDueAt(execution, session.expiresAt);
  return transaction(() => {
    assertCurrentSession(session, persist ? session.revision - 1 : session.revision);
    const current = all<ActionDraft>(session.id, 'draft')
      .filter((draft) => draft.stepId === session.step?.id)
      .at(-1);
    if (current && ['running', 'uncertain'].includes(current.status))
      throw new CaseError('En tidligere utførelse må avklares før du kan lage et nytt utkast.', 409);
    invalidateDrafts(session.id);
    const draft: ActionDraft = {
      id: randomUUID(),
      stepId: session.step!.id,
      revision: session.revision,
      execution: structuredClone(execution),
      proposal: structuredClone(session.step!.proposal!),
      createdAt: now(),
      status: 'prepared',
    };
    persist?.(session);
    write(session.id, 'draft', draft);
    return draft;
  });
}
export function activityForCase(caseId: string): FlowActivity {
  owner(caseId);
  recoverAbandonedAttempts(Date.now(), caseId);
  return {
    draft:
      all<ActionDraft>(caseId, 'draft')
        .filter((d) => d.status !== 'superseded')
        .at(-1) ?? null,
    attempts: all(caseId, 'attempt'),
    outbox: all(caseId, 'outbox'),
    reminders: all(caseId, 'reminder'),
    notifications: all(caseId, 'notification'),
    reviews: all(caseId, 'review'),
    checklist: all(caseId, 'checklist'),
  };
}
export function setChecklistMark(caseId: string, key: string, checked: boolean, version: number): ChecklistMark {
  if (!checklistKeys.has(key)) throw new CaseError('Dette sjekkpunktet finnes ikke.', 400);
  return transaction(() => {
    owner(caseId);
    const current = all<ChecklistMark>(caseId, 'checklist').find(mark => mark.key === key);
    if ((current?.version ?? 0) !== version) throw new CaseError('Sjekklisten er endret i en annen fane. Last inn siste versjon.', 409);
    const mark = { id: current?.id ?? randomUUID(), key, checked, version: version + 1, updatedAt: now() };
    write(caseId, 'checklist', mark, key);
    return mark;
  });
}
export async function executeApprovedAction(
  session: FlowCase,
  draftId: string,
  execute: (execution: FlowExecution) => Promise<FlowOutcome>,
  persist: (session: FlowCase) => void,
): Promise<FlowOutcome> {
  owner(session.id);
  const claim = transaction(() => {
    const draft = get<ActionDraft>(session.id, 'draft', draftId);
    const previous = all<ActionAttempt>(session.id, 'attempt').find((a) => a.draftId === draftId);
    if (previous?.status === 'completed' && previous.outcome)
      return { draft, attempt: previous, completed: previous.outcome };
    if (previous)
      throw new CaseError(
        'Utførelsen er påbegynt eller utfallet er usikkert. Den blir ikke sendt på nytt automatisk.',
        409,
      );
    assertCurrentSession(session);
    if (
      draft.status !== 'prepared' ||
      draft.revision !== session.revision ||
      draft.stepId !== session.step?.id ||
      !isDeepStrictEqual(draft.proposal, session.step?.proposal)
    )
      throw new CaseError('Utkastet er endret. Kontroller og godkjenn et nytt utkast.', 409);
    if (draft.execution.type === 'reminder') reminderDueAt(draft.execution, session.expiresAt);
    const attempt: ActionAttempt = {
      id: randomUUID(),
      draftId,
      status: 'running',
      leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
      ownerPid: process.pid,
      ownerHost: hostname(),
      createdAt: now(),
      outcome: null,
      error: null,
    };
    draft.status = 'running';
    write(session.id, 'draft', draft);
    write(session.id, 'attempt', attempt, `${draft.stepId}:${draft.revision}`);
    return { draft, attempt, completed: null };
  });
  if (claim.completed) return claim.completed;
  try {
    const outcome = await execute(structuredClone(claim.draft.execution));
    transaction(() => {
      owner(session.id);
      const row = db().prepare('SELECT body FROM flows WHERE id=?').get(session.id) as { body: string };
      const latest: FlowCase = JSON.parse(row.body);
      if (latest.revision !== claim.draft.revision) {
        // Keep corrections made while the executor was awaiting I/O and attach its real receipt.
        if (!latest.outcomes.some((existing) => existing.id === outcome.id)) latest.outcomes.push(outcome);
        latest.revision++;
        persist(latest);
        Object.assign(session, latest);
      } else {
        persist(session);
      }
      claim.draft.status = 'completed';
      claim.attempt.status = 'completed';
      claim.attempt.outcome = outcome;
      write(session.id, 'draft', claim.draft);
      write(session.id, 'attempt', claim.attempt, draftId);
    });
    return outcome;
  } catch {
    transaction(() => {
      if (!db().prepare('SELECT id FROM flows WHERE id=? AND expires>?').get(session.id, Date.now())) return;
      claim.draft.status = 'uncertain';
      claim.attempt.status = 'uncertain';
      claim.attempt.error = 'Utførelsen ble avbrutt. Kontroller utfallet før du gjør noe mer.';
      write(session.id, 'draft', claim.draft);
      write(session.id, 'attempt', claim.attempt, draftId);
    });
    throw new CaseError(
      'Utfallet er usikkert. Handlingen blir ikke utført på nytt automatisk. Kontroller kvittering eller kontakt lokal operatør før du fortsetter.',
      409,
    );
  }
}
function effect<T extends { id: string }>(caseId: string, kind: string, key: string, make: () => T): T {
  return transaction(() => {
    owner(caseId);
    const row = db()
      .prepare('SELECT body FROM flow_artifacts WHERE case_id=? AND kind=? AND effect_key=?')
      .get(caseId, kind, key) as { body: string } | undefined;
    if (row) return JSON.parse(row.body);
    const value = make();
    write(caseId, kind, value, key);
    return value;
  });
}
export function recordMockEmail(
  caseId: string,
  outcomeId: string,
  input: Pick<MockEmail, 'to' | 'subject' | 'body'>,
): MockEmail {
  return effect(caseId, 'outbox', outcomeId, () => ({
    id: randomUUID(),
    outcomeId,
    ...input,
    status: 'mock-recorded',
    createdAt: now(),
  }));
}
/** Reject gaps and repeated wall-clock times rather than silently picking a DST offset. */
export function reminderDueAt(input: ReminderInput, expiresAt: string, nowMs = Date.now()): string {
  const time = input.time ?? '09:00';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new CaseError('Oppgi en gyldig dato og et klokkeslett.');
  const local = `${input.date}T${time}:00`;
  const nominal = Date.parse(`${local}Z`);
  if (!Number.isFinite(nominal) || new Date(nominal).toISOString().slice(0, 19) !== local)
    throw new CaseError('Datoen finnes ikke.');
  const format = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Oslo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const matches = [1, 2]
    .map((offset) => nominal - offset * 3600000)
    .filter((t) => format.format(t).replace(' ', 'T') === local.slice(0, 16));
  if (matches.length !== 1)
    throw new CaseError(
      'Klokkeslettet finnes ikke eller forekommer to ganger ved sommertid. Velg et annet klokkeslett.',
    );
  if (matches[0] <= nowMs) throw new CaseError('Påminnelsen må være i fremtiden.');
  if (matches[0] >= Date.parse(expiresAt)) throw new CaseError('Påminnelsen må være før saken utløper.');
  return new Date(matches[0]).toISOString();
}
export function createReminder(
  caseId: string,
  outcomeId: string,
  input: ReminderInput,
  expiresAt: string,
): FlowReminder {
  return effect(caseId, 'reminder', outcomeId, () => ({
    ...input,
    time: input.time ?? '09:00',
    id: randomUUID(),
    outcomeId,
    version: 1,
    dueAt: reminderDueAt(
      input,
      new Date(Math.min(owner(caseId).expires, Date.parse(expiresAt))).toISOString(),
    ),
    timezone: 'Europe/Oslo',
    status: 'scheduled',
    createdAt: now(),
  }));
}
export function editReminder(
  caseId: string,
  id: string,
  version: number,
  input: ReminderInput,
): FlowReminder {
  return transaction(() => {
    const own = owner(caseId);
    const r = get<FlowReminder>(caseId, 'reminder', id);
    if (r.version !== version || r.status !== 'scheduled')
      throw new CaseError('Påminnelsen er endret eller allerede utløst.', 409);
    Object.assign(r, input, {
      time: input.time ?? '09:00',
      dueAt: reminderDueAt(input, new Date(own.expires).toISOString()),
      version: r.version + 1,
    });
    write(caseId, 'reminder', r);
    return r;
  });
}
export function cancelReminder(caseId: string, id: string, version: number): FlowReminder {
  return transaction(() => {
    owner(caseId);
    const r = get<FlowReminder>(caseId, 'reminder', id);
    if (r.version !== version || r.status !== 'scheduled')
      throw new CaseError('Påminnelsen er endret eller allerede utløst.', 409);
    r.status = 'cancelled';
    r.version++;
    write(caseId, 'reminder', r);
    return r;
  });
}
export function readNotification(caseId: string, id: string): FlowNotification {
  return transaction(() => {
    owner(caseId);
    const n = get<FlowNotification>(caseId, 'notification', id);
    n.readAt ??= now();
    write(caseId, 'notification', n);
    return n;
  });
}
export function createReview(
  caseId: string,
  outcomeId: string,
  input: Pick<FlowReview, 'title' | 'summary' | 'recipient'>,
): FlowReview {
  return effect(caseId, 'review', outcomeId, () => ({
    ...input,
    id: randomUUID(),
    outcomeId,
    status: 'queued',
    reply: null,
    version: 1,
    createdAt: now(),
    updatedAt: now(),
  }));
}
export function listReviews() {
  processExpiredArtifacts();
  return (
    db().prepare("SELECT case_id,body FROM flow_artifacts WHERE kind='review'").all() as {
      case_id: string;
      body: string;
    }[]
  ).map((r) => ({ caseId: r.case_id, ...(JSON.parse(r.body) as FlowReview) }));
}
export function updateReview(
  caseId: string,
  id: string,
  version: number,
  status: FlowReview['status'],
  reply: string | null,
): FlowReview {
  return transaction(() => {
    owner(caseId);
    const r = get<FlowReview>(caseId, 'review', id);
    if (r.version !== version) throw new CaseError('Køoppføringen er endret.', 409);
    Object.assign(r, { status, reply, version: r.version + 1, updatedAt: now() });
    write(caseId, 'review', r);
    return r;
  });
}
export function processExpiredArtifacts(nowMs = Date.now()) {
  const d = db();
  const exists = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='flows'").get();
  if (!exists) return;
  d.prepare('DELETE FROM flow_artifacts WHERE case_id NOT IN (SELECT id FROM flows WHERE expires>?)').run(
    nowMs,
  );
}
export function processDueReminders(nowMs = Date.now()): number {
  return transaction(() => {
    processExpiredArtifacts(nowMs);
    normalizeAbandonedAttempts(nowMs);
    let count = 0;
    const rows = db().prepare("SELECT case_id,body FROM flow_artifacts WHERE kind='reminder'").all() as {
      case_id: string;
      body: string;
    }[];
    for (const row of rows) {
      const r: FlowReminder = JSON.parse(row.body);
      if (r.status !== 'scheduled' || Date.parse(r.dueAt) > nowMs) continue;
      const n: FlowNotification = {
        id: randomUUID(),
        reminderId: r.id,
        title: r.title,
        body: r.note,
        createdAt: new Date(nowMs).toISOString(),
        readAt: null,
      };
      write(row.case_id, 'notification', n, r.id);
      r.status = 'fired';
      r.version++;
      write(row.case_id, 'reminder', r);
      count++;
    }
    return count;
  });
}

/** Never retry a claimed action: a dead worker or expired lease makes its outcome uncertain. */
function normalizeAbandonedAttempts(nowMs: number, caseId?: string): number {
  const rows = db()
    .prepare(
      "SELECT case_id,body FROM flow_artifacts WHERE kind='attempt'" + (caseId ? ' AND case_id=?' : ''),
    )
    .all(...(caseId ? [caseId] : [])) as { case_id: string; body: string }[];
  let count = 0;
  for (const row of rows) {
    const attempt: ActionAttempt = JSON.parse(row.body);
    if (attempt.status !== 'running') continue;
    const leaseEnd = attempt.leaseExpiresAt
      ? Date.parse(attempt.leaseExpiresAt)
      : Date.parse(attempt.createdAt) + 120_000;
    let ownerGone = false;
    if (attempt.ownerPid && attempt.ownerHost === hostname()) {
      try {
        process.kill(attempt.ownerPid, 0);
      } catch (error) {
        ownerGone = (error as NodeJS.ErrnoException).code === 'ESRCH';
      }
    }
    if (!ownerGone && Number.isFinite(leaseEnd) && leaseEnd > nowMs) continue;
    const draft = get<ActionDraft>(row.case_id, 'draft', attempt.draftId);
    attempt.status = 'uncertain';
    attempt.error =
      'Utførelsen ble avbrutt eller tok for lang tid. Utfallet er usikkert; handlingen blir ikke sendt på nytt automatisk.';
    draft.status = 'uncertain';
    write(row.case_id, 'attempt', attempt);
    write(row.case_id, 'draft', draft);
    count++;
  }
  return count;
}
export function recoverAbandonedAttempts(nowMs = Date.now(), caseId?: string): number {
  return transaction(() => normalizeAbandonedAttempts(nowMs, caseId));
}
