import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createFlowCase, saveFlowCase } from '../src/server/flow-store';
import { assistantDatabase } from '../src/server/assistant-store';
import {
  activityForCase,
  cancelReminder,
  createReminder,
  createReview,
  editReminder,
  executeApprovedAction,
  prepareAction,
  processDueReminders,
  recordMockEmail,
  recoverAbandonedAttempts,
  reminderDueAt,
  updateReview,
} from '../src/server/flow-action-store';
import { GET, POST } from '../src/app/api/review-queue/route';
import type { FlowOutcome } from '../src/domain/flow-types';
const directory = mkdtempSync(join(tmpdir(), 'flow-actions-'));
process.env.ASSISTANT_DATA_DIR = directory;
after(() => {
  assistantDatabase().close();
  rmSync(directory, { recursive: true, force: true });
});
const input = { title: 'Husk fristen', date: '2026-10-15', time: '09:00', note: 'Se saken' };
function setup() {
  const s = createFlowCase();
  s.expiresAt = new Date(Date.now() + 90 * 86400000).toISOString();
  s.step = {
    id: randomUUID(),
    kind: 'action',
    title: 'Test',
    message: '',
    rationale: '',
    by: 'rule',
    model: null,
    createdAt: s.createdAt,
    revision: s.revision,
    durationMs: 0,
    questions: [],
    factIds: [],
    fetch: [],
    next: null,
    proposal: { type: 'reminder', ...input },
  };
  saveFlowCase(s);
  assistantDatabase().prepare('UPDATE flows SET expires=? WHERE id=?').run(Date.parse(s.expiresAt), s.id);
  return s;
}
test('Oslo date validation rejects impossible dates, gaps, repeats, past and expiry', () => {
  const expires = '2027-01-01T00:00:00Z',
    now = Date.parse('2026-01-01T00:00:00Z');
  assert.equal(reminderDueAt({ ...input, time: null }, expires, now), '2026-10-15T07:00:00.000Z');
  for (const [date, time] of [
    ['2026-02-30', '09:00'],
    ['2026-03-29', '02:30'],
    ['2026-10-25', '02:30'],
    ['2025-12-01', '09:00'],
    ['2027-01-02', '09:00'],
  ])
    assert.throws(() => reminderDueAt({ ...input, date, time }, expires, now));
});
test('reminders persist across reconnect, fire once and enforce owner/CAS/cancellation', () => {
  const s = setup(),
    other = setup();
  const future = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const args = { ...input, date: future };
  const r = createReminder(s.id, 'one', args, s.expiresAt);
  assert.equal(createReminder(s.id, 'one', args, s.expiresAt).id, r.id);
  assert.throws(() => cancelReminder(other.id, r.id, r.version));
  assert.throws(() => editReminder(s.id, r.id, 9, args));
  const cancelled = createReminder(s.id, 'two', args, s.expiresAt);
  cancelReminder(s.id, cancelled.id, 1);
  assistantDatabase().close();
  delete (globalThis as typeof globalThis & { assistantDb?: unknown }).assistantDb;
  assert.equal(processDueReminders(Date.parse(r.dueAt) + 1), 1);
  assert.equal(processDueReminders(Date.parse(r.dueAt) + 1), 0);
  assert.equal(activityForCase(s.id).notifications.length, 1);
  assert.equal(activityForCase(other.id).notifications.length, 0);
  assert.throws(() => editReminder(s.id, r.id, 2, args));
});
test('immutable approval rejects stale drafts and repeated execution only returns receipt', async () => {
  const s = setup();
  s.step!.proposal = {
    type: 'reminder',
    ...input,
    date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  };
  saveFlowCase(s);
  const ex = { type: 'reminder' as const, ...input, date: (s.step!.proposal as { date: string }).date };
  const old = prepareAction(s, ex),
    draft = prepareAction(s, ex);
  let calls = 0;
  const outcome: FlowOutcome = {
    id: randomUUID(),
    kind: 'reminder',
    title: 'Test',
    reference: 'T',
    detail: 'Created',
    createdAt: s.createdAt,
    revision: s.revision,
    localOnly: true,
    recipient: null,
    payload: {},
  };
  const execute = async () => {
    calls++;
    return outcome;
  };
  await assert.rejects(executeApprovedAction(s, old.id, execute, saveFlowCase));
  assert.equal((await executeApprovedAction(s, draft.id, execute, saveFlowCase)).id, outcome.id);
  assert.equal((await executeApprovedAction(s, draft.id, execute, saveFlowCase)).id, outcome.id);
  assert.equal(calls, 1);
});
test('interrupted execution remains uncertain and cannot be resent', async () => {
  const s = setup();
  s.step!.proposal = {
    type: 'reminder',
    ...input,
    date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  };
  saveFlowCase(s);
  const draft = prepareAction(s, {
    type: 'reminder',
    ...input,
    date: (s.step!.proposal as { date: string }).date,
  });
  let calls = 0;
  const execute = async (): Promise<FlowOutcome> => {
    calls++;
    throw new Error('disconnected');
  };
  await assert.rejects(executeApprovedAction(s, draft.id, execute, saveFlowCase));
  await assert.rejects(executeApprovedAction(s, draft.id, execute, saveFlowCase));
  assert.equal(calls, 1);
  assert.equal(activityForCase(s.id).attempts[0].status, 'uncertain');
});
test('mock outbox is exact and queue requires configured operator token with CAS replies', async () => {
  const s = setup();
  const mail = { to: 'test@example.org', subject: 'Exact', body: 'Original approved body' };
  const m = recordMockEmail(s.id, 'mail', mail);
  assert.equal(recordMockEmail(s.id, 'mail', { ...mail, body: 'changed' }).body, mail.body);
  assert.equal(m.status, 'mock-recorded');
  const recipient = {
    id: 'test',
    name: 'Test',
    role: 'Help',
    organisation: 'Local',
    email: null,
    phone: null,
    url: null,
    hours: null,
    note: '',
  };
  const review = createReview(s.id, 'review', { title: 'Review', summary: 'Citizen text', recipient });
  delete process.env.FLOW_REVIEW_TOKEN;
  assert.equal((await GET(new NextRequest('http://localhost/api/review-queue'))).status, 503);
  process.env.FLOW_REVIEW_TOKEN = 'test-only-token';
  assert.equal((await GET(new NextRequest('http://localhost/api/review-queue'))).status, 401);
  const request = new NextRequest('http://localhost/api/review-queue', {
    method: 'POST',
    headers: { authorization: 'Bearer test-only-token', 'content-type': 'application/json' },
    body: JSON.stringify({ caseId: s.id, id: review.id, version: 1, status: 'resolved', reply: 'Svar' }),
  });
  assert.equal((await POST(request)).status, 200);
  assert.equal(activityForCase(s.id).reviews[0].reply, 'Svar');
  assert.throws(() => updateReview(s.id, review.id, 1, 'queued', null));
});
test('expired cases remove all private artifacts without firing orphan reminders', () => {
  const s = setup();
  recordMockEmail(s.id, 'cleanup', { to: 'a@b.no', subject: 'Private', body: 'Remove' });
  assistantDatabase()
    .prepare('UPDATE flows SET expires=? WHERE id=?')
    .run(Date.now() - 1, s.id);
  processDueReminders();
  assert.equal(
    (
      assistantDatabase()
        .prepare('SELECT count(*) AS count FROM flow_artifacts WHERE case_id=?')
        .get(s.id) as { count: number }
    ).count,
    0,
  );
});
test('concurrent execution and a restarted running attempt never invoke the effect twice', async () => {
  const s = setup();
  const execution = {
    type: 'reminder' as const,
    ...input,
    date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  };
  const draft = prepareAction(s, execution);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const outcome: FlowOutcome = {
    id: randomUUID(),
    kind: 'reminder',
    title: 'T',
    reference: 'T',
    detail: 'T',
    createdAt: s.createdAt,
    revision: s.revision,
    localOnly: true,
    recipient: null,
    payload: {},
  };
  const execute = async () => {
    calls++;
    await gate;
    return outcome;
  };
  const first = executeApprovedAction(s, draft.id, execute, saveFlowCase);
  await assert.rejects(executeApprovedAction(s, draft.id, execute, saveFlowCase));
  release();
  await first;
  assert.equal(calls, 1);
  const restarted = setup();
  const abandoned = prepareAction(restarted, execution);
  const attempt = {
    id: randomUUID(),
    draftId: abandoned.id,
    status: 'running',
    createdAt: s.createdAt,
    outcome: null,
    error: null,
  };
  assistantDatabase()
    .prepare('INSERT INTO flow_artifacts(id,case_id,kind,effect_key,body) VALUES(?,?,?,?,?)')
    .run(attempt.id, restarted.id, 'attempt', abandoned.id, JSON.stringify(attempt));
  assistantDatabase().close();
  delete (globalThis as typeof globalThis & { assistantDb?: unknown }).assistantDb;
  await assert.rejects(executeApprovedAction(restarted, abandoned.id, execute, saveFlowCase));
  assert.equal(calls, 1);
});

test('stale process cannot supersede a draft or execute after another revision was saved', async () => {
  const session = setup();
  const execution = {
    type: 'reminder' as const,
    ...input,
    date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  };
  const draft = prepareAction(session, execution);
  const newer = structuredClone(session);
  newer.revision++;
  saveFlowCase(newer);
  assert.throws(() => prepareAction(session, execution));
  let calls = 0;
  await assert.rejects(
    executeApprovedAction(
      session,
      draft.id,
      async () => {
        calls++;
        throw new Error('must not execute');
      },
      saveFlowCase,
    ),
  );
  assert.equal(calls, 0);
  assert.equal(activityForCase(session.id).draft?.id, draft.id);
});

test('actual standalone worker fires once and stays deduplicated after stop and restart', async () => {
  const session = setup();
  const reminder = createReminder(
    session.id,
    randomUUID(),
    { ...input, date: new Date(Date.now() + 86400000).toISOString().slice(0, 10) },
    session.expiresAt,
  );
  reminder.dueAt = new Date(Date.now() - 1000).toISOString();
  assistantDatabase()
    .prepare('UPDATE flow_artifacts SET body=? WHERE id=?')
    .run(JSON.stringify(reminder), reminder.id);
  async function runWorker() {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/reminder-worker.mts'], {
      cwd: process.cwd(),
      env: { ...process.env, ASSISTANT_DATA_DIR: directory },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = once(child, 'exit');
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Worker startup timed out')), 10000);
        let output = '';
        child.stdout.on('data', (chunk) => {
          output += String(chunk);
          if (output.includes('Reminder scheduler started.')) {
            clearTimeout(timeout);
            resolve();
          }
        });
        child.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.once('exit', (code) => {
          clearTimeout(timeout);
          reject(new Error(`Worker exited early: ${code}`));
        });
      });
      assert.equal(activityForCase(session.id).notifications.length, 1);
    } finally {
      child.kill('SIGTERM');
      const [code] = await exited;
      assert.equal(code, 0);
    }
  }
  await runWorker();
  await runWorker();
  assert.equal(activityForCase(session.id).notifications.length, 1);
});

test('leases and dead worker processes become uncertain without retry; new steps remain available', async () => {
  const session = setup();
  const execution = {
    type: 'reminder' as const,
    ...input,
    date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  };
  const draft = prepareAction(session, execution);
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  const pid = child.pid;
  await once(child, 'exit');
  const { hostname } = await import('node:os');
  const attempt = {
    id: randomUUID(),
    draftId: draft.id,
    status: 'running',
    createdAt: new Date().toISOString(),
    leaseExpiresAt: new Date(Date.now() + 120000).toISOString(),
    ownerPid: pid,
    ownerHost: hostname(),
    outcome: null,
    error: null,
  };
  assistantDatabase()
    .prepare('INSERT INTO flow_artifacts(id,case_id,kind,effect_key,body) VALUES(?,?,?,?,?)')
    .run(attempt.id, session.id, 'attempt', draft.id, JSON.stringify(attempt));
  assert.equal(activityForCase(session.id).attempts[0].status, 'uncertain');
  assert.throws(() => prepareAction(session, execution));
  session.step!.id = randomUUID();
  saveFlowCase(session);
  const next = prepareAction(session, execution);
  assert.notEqual(next.id, draft.id);
  assert.equal(activityForCase(session.id).attempts[0].status, 'uncertain');

  const older = setup();
  const oldDraft = prepareAction(older, execution);
  const legacy = {
    id: randomUUID(),
    draftId: oldDraft.id,
    status: 'running',
    createdAt: new Date().toISOString(),
    outcome: null,
    error: null,
  };
  assistantDatabase()
    .prepare('INSERT INTO flow_artifacts(id,case_id,kind,effect_key,body) VALUES(?,?,?,?,?)')
    .run(legacy.id, older.id, 'attempt', oldDraft.id, JSON.stringify(legacy));
  assert.equal(recoverAbandonedAttempts(Date.parse(legacy.createdAt) + 119999, older.id), 0);
  assert.equal(recoverAbandonedAttempts(Date.parse(legacy.createdAt) + 120000, older.id), 1);
  assert.equal(activityForCase(older.id).draft?.status, 'uncertain');
});

test('proposal integrity and a reminder becoming overdue reject before an attempt is claimed', async (t) => {
  const session = setup();
  const execution = {
    type: 'reminder' as const,
    ...input,
    date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  };
  const draft = prepareAction(session, execution);
  const modified = structuredClone(session);
  modified.step!.proposal = { type: 'reminder', ...input, title: 'Unapproved replacement' };
  assert.throws(() => prepareAction(modified, execution));
  await assert.rejects(
    executeApprovedAction(
      modified,
      draft.id,
      async () => {
        throw new Error('must not execute');
      },
      saveFlowCase,
    ),
  );
  const due = reminderDueAt(execution, session.expiresAt);
  t.mock.method(Date, 'now', () => Date.parse(due) + 1);
  await assert.rejects(
    executeApprovedAction(
      session,
      draft.id,
      async () => {
        throw new Error('must not execute');
      },
      saveFlowCase,
    ),
  );
  assert.equal(activityForCase(session.id).attempts.length, 0);
  assert.equal(activityForCase(session.id).draft?.status, 'prepared');
});

test('an actual receipt is appended without overwriting corrections made while execution awaited I/O', async () => {
  const session = setup();
  const execution = {
    type: 'reminder' as const,
    ...input,
    date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  };
  const draft = prepareAction(session, execution);
  const outcome: FlowOutcome = {
    id: randomUUID(),
    kind: 'reminder',
    title: 'Created',
    reference: 'REAL',
    detail: 'Actual receipt',
    createdAt: session.createdAt,
    revision: session.revision,
    localOnly: true,
    recipient: null,
    payload: {},
  };
  const corrected = structuredClone(session);
  corrected.revision++;
  corrected.situation = 'Correction from another process';
  corrected.step!.id = randomUUID();
  await executeApprovedAction(
    session,
    draft.id,
    async () => {
      await Promise.resolve();
      saveFlowCase(corrected);
      session.situation = 'Stale callback state';
      return outcome;
    },
    saveFlowCase,
  );
  const row = assistantDatabase().prepare('SELECT body FROM flows WHERE id=?').get(session.id) as {
    body: string;
  };
  const stored = JSON.parse(row.body);
  assert.equal(stored.situation, corrected.situation);
  assert.equal(stored.step.id, corrected.step!.id);
  assert.equal(stored.revision, corrected.revision + 1);
  assert.equal(stored.outcomes.filter((item: FlowOutcome) => item.id === outcome.id).length, 1);
  assert.equal(activityForCase(session.id).attempts[0].status, 'completed');
});
