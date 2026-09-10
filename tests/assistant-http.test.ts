import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { NextRequest } from 'next/server';
import { POST, DELETE } from '../src/app/api/assistant/route';
import { GET as downloadReceipt } from '../src/app/api/assistant/receipt/route';
import { POST as uploadDocument } from '../src/app/api/assistant/document/route';
import { ASSISTANT_COOKIE } from '../src/server/assistant-http';
import { createAssistantCase, deleteAssistantCase, loadAssistantCase, saveAssistantCase, withAssistantLock } from '../src/server/assistant-store';
import { addMessage, analyzeCase, prepareHandoff } from '../src/server/assistant-service';
import { guidanceSources, prepareService } from '../src/domain/service-catalogue';
import type { AssistantCase } from '../src/domain/assistant-types';

const directory = mkdtempSync(join(tmpdir(), 'assistant-http-tests-'));
const priorDataDirectory = process.env.ASSISTANT_DATA_DIR;
process.env.ASSISTANT_DATA_DIR = directory;
const createdIds = new Set<string>();
const origin = 'http://127.0.0.1:3210';
const fixtureConfig = { LLM_BASE_URL: '', LLM_API_KEY: '', LLM_MODEL: 'http-tests' };
const previousEnv = new Map<string, string | undefined>();
let previousFetch: typeof globalThis.fetch;
let modelCalls = 0;
beforeEach(() => {
  previousFetch = globalThis.fetch;
  for (const [key, value] of Object.entries(fixtureConfig)) { previousEnv.set(key, process.env[key]); process.env[key] = value; }
  modelCalls = 0;
  globalThis.fetch = async () => { modelCalls++; throw new Error('This request must be rejected before model inference'); };
});
afterEach(() => {
  globalThis.fetch = previousFetch;
  for (const [key, value] of previousEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  previousEnv.clear();
  for (const id of createdIds) deleteAssistantCase(id);
  createdIds.clear();
});
after(() => {
  const state = globalThis as typeof globalThis & { assistantDb?: DatabaseSync };
  state.assistantDb?.close(); delete state.assistantDb;
  if (priorDataDirectory === undefined) delete process.env.ASSISTANT_DATA_DIR;
  else process.env.ASSISTANT_DATA_DIR = priorDataDirectory;
  rmSync(directory, { recursive: true, force: true });
});

function newCase(): AssistantCase {
  const current = createAssistantCase();
  createdIds.add(current.id);
  addMessage(current, 'Jeg ønsker hjelp til å forberede flytting.');
  saveAssistantCase(current);
  return current;
}
function request(method: 'POST' | 'DELETE', body: unknown, cookieCase?: AssistantCase) {
  return new NextRequest(`${origin}/api/assistant`, { method, headers: {
    'Content-Type': 'application/json', Origin: origin, Host: new URL(origin).host,
    ...(cookieCase ? { Cookie: `${ASSISTANT_COOKIE}=${cookieCase.id}` } : {}),
  }, body: JSON.stringify(body) });
}
function receiptRequest(cookieCase: AssistantCase, caseId: string, revision: number) {
  const params = new URLSearchParams({ caseId, revision: String(revision) });
  return new NextRequest(`${origin}/api/assistant/receipt?${params}`, { headers: { Cookie: `${ASSISTANT_COOKIE}=${cookieCase.id}` } });
}
function handoffCase() {
  const current = newCase();
  current.sources.push(...guidanceSources());
  current.services = [prepareService('moving', current, 'A controlled API fixture')];
  current.services[0].checks = current.services[0].checks.map(check => check.status === 'missing' ? { ...check, status: 'human' as const } : check);
  current.services[0].status = 'needs-review';
  current.status = 'ready'; current.analyzedRevision = current.revision;
  prepareHandoff(current, true);
  saveAssistantCase(current);
  return current;
}

test('start resumes the cookie case without replacing or deleting its stored memory', async () => {
  const current = newCase();
  const other = newCase();
  const before = loadAssistantCase(current.id);
  const response = await POST(request('POST', { action: 'start' }, current));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.session.id, current.id);
  assert.deepEqual(body.session, before);
  assert.deepEqual(loadAssistantCase(current.id), before);
  assert.equal(loadAssistantCase(other.id).id, other.id);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(modelCalls, 0);
});

test('start without a valid cookie creates one case with a protected session cookie', async () => {
  const response = await POST(request('POST', { action: 'start' }));
  assert.equal(response.status, 201);
  const body = await response.json();
  createdIds.add(body.session.id);
  assert.equal(loadAssistantCase(body.session.id).id, body.session.id);
  const cookie = response.headers.get('set-cookie')!;
  assert.ok(cookie.includes(`${ASSISTANT_COOKIE}=${body.session.id}`));
  assert.match(cookie, /httponly/i);
  assert.match(cookie, /samesite=strict/i);
  assert.equal(modelCalls, 0);
});

test('structured question answers are stored as the citizen confirmation without a second fact action', async () => {
  const current = newCase();
  const quote = 'Flyttedato: 2026-12-09.';
  const response = await POST(request('POST', { action: 'answers', caseId: current.id, revision: current.revision, message: quote,
    answers: [{ key: 'move_date', value: '2026-12-09', quote }] }, current));
  assert.equal(response.status, 200);
  const body = await response.json();
  const fact = body.session.facts.find((item: { key: string }) => item.key === 'move_date');
  assert.equal(fact.value, '2026-12-09');
  assert.equal(fact.status, 'confirmed');
  assert.ok(fact.confirmedAt);
  assert.equal(body.session.facts.some((item: { status: string }) => ['proposed', 'conflict'].includes(item.status)), false);
});

test('every JSON mutation rejects a different case ID even when both case revisions match', async () => {
  const current = newCase();
  const other = newCase();
  assert.equal(current.revision, other.revision);
  const originalCurrent = loadAssistantCase(current.id);
  const originalOther = loadAssistantCase(other.id);
  const commands = [
    { action: 'message', message: 'Nye opplysninger i feil samtale.' }, { action: 'analyze' },
    { action: 'fact', factId: randomUUID(), decision: 'confirm' },
    { action: 'fact', factId: randomUUID(), decision: 'reject' },
    { action: 'connect-ks' }, { action: 'income-consent', approved: true }, { action: 'ks-access', approved: true }, { action: 'handoff', confirmed: true },
  ];
  for (const command of commands) {
    const response = await POST(request('POST', { ...command, caseId: other.id, revision: current.revision }, current));
    assert.equal(response.status, 409, command.action);
    assert.deepEqual(loadAssistantCase(current.id), originalCurrent);
    assert.deepEqual(loadAssistantCase(other.id), originalOther);
  }
  assert.equal(modelCalls, 0);
});

test('document upload checks case identity and revision before extraction or model inference', async () => {
  const current = newCase();
  const other = newCase();
  const before = loadAssistantCase(current.id);
  for (const [caseId, revision] of [[other.id, current.revision], [current.id, current.revision - 1]] as const) {
    const form = new FormData();
    form.set('caseId', caseId); form.set('revision', String(revision));
    form.set('file', new File(['An actual text fixture with enough readable words.'], 'test.txt', { type: 'text/plain' }));
    const response = await uploadDocument(new NextRequest(`${origin}/api/assistant/document`, { method: 'POST', headers: { Origin: origin, Host: new URL(origin).host, Cookie: `${ASSISTANT_COOKIE}=${current.id}` }, body: form }));
    assert.equal(response.status, 409);
    assert.deepEqual(loadAssistantCase(current.id), before);
  }
  assert.equal(modelCalls, 0);
});

test('delete rejects a different case ID and stale revision and only deletes the explicitly current case', async () => {
  const current = newCase();
  const other = newCase();
  const before = loadAssistantCase(current.id);
  for (const [caseId, revision] of [[other.id, current.revision], [current.id, current.revision - 1]] as const) {
    const response = await DELETE(request('DELETE', { caseId, revision }, current));
    assert.equal(response.status, 409);
    assert.deepEqual(loadAssistantCase(current.id), before);
    assert.equal(loadAssistantCase(other.id).id, other.id);
  }
  const response = await DELETE(request('DELETE', { caseId: current.id, revision: current.revision }, current));
  assert.equal(response.status, 200);
  assert.throws(() => loadAssistantCase(current.id), /slettet eller utløpt/);
  assert.equal(loadAssistantCase(other.id).id, other.id);
  assert.match(response.headers.get('set-cookie')!, /sok-assistant-session=;/);
  assert.equal(modelCalls, 0);
});

test('receipt download requires the cookie case identity and the exact confirmed revision', async () => {
  const current = handoffCase();
  const other = handoffCase();
  for (const [caseId, revision] of [[other.id, current.revision], [current.id, current.revision - 1]] as const) {
    const response = await downloadReceipt(receiptRequest(current, caseId, revision));
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.session, undefined);
    assert.equal(body.sources, undefined);
  }
  const response = await downloadReceipt(receiptRequest(current, current.id, current.revision));
  assert.equal(response.status, 200);
  const packet = await response.json();
  assert.equal(packet.id, current.id);
  assert.equal(packet.handoff.revision, current.revision);
  assert.match(response.headers.get('content-disposition')!, /attachment/);
  assert.equal(modelCalls, 0);
});

test('idempotent handoff still rejects another case identity or an earlier revision', async () => {
  const current = handoffCase();
  const other = handoffCase();
  const before = loadAssistantCase(current.id);
  for (const [caseId, revision] of [[other.id, current.revision], [current.id, current.revision - 1]] as const) {
    const response = await POST(request('POST', { action: 'handoff', caseId, revision, confirmed: true }, current));
    assert.equal(response.status, 409);
    assert.deepEqual(loadAssistantCase(current.id), before);
  }
  const response = await POST(request('POST', { action: 'handoff', caseId: current.id, revision: current.revision, confirmed: true }, current));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).session, before);
  assert.equal(modelCalls, 0);
});

test('consent for an earlier analysis cannot hand off a newly generated plan with unchanged facts', async () => {
  const current = newCase();
  current.sources.push(...guidanceSources());
  current.services = [prepareService('moving', current, 'Previously reviewed plan')];
  current.status = 'ready'; current.analyzedRevision = current.revision;
  saveAssistantCase(current);
  const reviewedRevision = current.revision;
  const analyzed = await withAssistantLock(current.id, reviewedRevision, async session => {
    await analyzeCase(session, async (_system, context, schema, role) => {
      modelCalls++;
      if (context !== null && typeof context === 'object' && 'draft' in context) {
        return schema.parse(role === 'critic' ? { verdict: 'PASS', gaps: [], notes: '' } : { answer: (context as { draft: string }).draft });
      }
      const input = context as { service?: unknown };
      return schema.parse(input.service
        ? { summary: 'Ny spesialistplan.', findings: [], questions: [] }
        : { summary: 'En ny plan krever ny bekreftelse.', services: [{ id: 'moving', reason: 'Innbyggeren ba om ny analyse.' }], facts: [], questions: [], unsupported: [] });
    });
    session.services[0].checks = session.services[0].checks.map(check => check.status === 'missing' ? { ...check, status: 'human' as const } : check);
    session.services[0].status = 'needs-review';
    saveAssistantCase(session);
    return session;
  });
  assert.notEqual(analyzed.status, 'error', analyzed.error || 'Framework analysis failed');
  assert.equal(analyzed.revision, reviewedRevision + 1);
  assert.deepEqual(analyzed.facts, current.facts);
  const staleConsent = await POST(request('POST', { action: 'handoff', caseId: current.id, revision: reviewedRevision, confirmed: true }, current));
  assert.equal(staleConsent.status, 409);
  assert.equal(loadAssistantCase(current.id).handoff, null);
  const consent = await POST(request('POST', { action: 'handoff', caseId: current.id, revision: analyzed.revision, confirmed: true }, current));
  assert.equal(consent.status, 200);
  assert.equal((await consent.json()).session.handoff.revision, analyzed.revision);
  assert.equal(modelCalls, 4); // triage + one specialist (moving) + critic + polish
});
