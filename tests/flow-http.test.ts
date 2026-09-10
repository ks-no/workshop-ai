import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { NextRequest } from 'next/server';
import { DELETE, GET, POST } from '../src/app/api/flow/route';
import { POST as uploadDocument } from '../src/app/api/flow/document/route';
import { GET as downloadOutcome } from '../src/app/api/flow/outcome/route';
import { FLOW_COOKIE } from '../src/server/flow-http';
import { createFlowCase, deleteFlowCase, loadFlowCase, saveFlowCase } from '../src/server/flow-store';
import type { FlowCase } from '../src/domain/flow-types';

const directory = mkdtempSync(join(tmpdir(), 'flow-http-tests-'));
const priorDataDirectory = process.env.ASSISTANT_DATA_DIR;
process.env.ASSISTANT_DATA_DIR = directory;
const origin = 'http://127.0.0.1:3210';
// No model transport is configured here: the planner must fall back to rules without any network call.
const fixtureConfig = { LLM_BASE_URL: '', LLM_API_KEY: '', LLM_MODEL: 'http-tests' };
const previousEnv = new Map<string, string | undefined>();
const createdIds = new Set<string>();
let previousFetch: typeof globalThis.fetch;
let networkCalls = 0;
beforeEach(() => {
  previousFetch = globalThis.fetch;
  for (const [key, value] of Object.entries(fixtureConfig)) { previousEnv.set(key, process.env[key]); process.env[key] = value; }
  networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error('No network call may happen in this suite'); };
});
afterEach(() => {
  globalThis.fetch = previousFetch;
  for (const [key, value] of previousEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  previousEnv.clear();
  for (const id of createdIds) deleteFlowCase(id);
  createdIds.clear();
});
after(() => {
  const state = globalThis as typeof globalThis & { assistantDb?: DatabaseSync };
  state.assistantDb?.close(); delete state.assistantDb;
  if (priorDataDirectory === undefined) delete process.env.ASSISTANT_DATA_DIR;
  else process.env.ASSISTANT_DATA_DIR = priorDataDirectory;
  rmSync(directory, { recursive: true, force: true });
});

function newCase(): FlowCase { const current = createFlowCase(); createdIds.add(current.id); return current; }
function request(method: 'POST' | 'DELETE', body: unknown, cookieCase?: FlowCase) {
  return new NextRequest(`${origin}/api/flow`, { method, headers: {
    'Content-Type': 'application/json', Origin: origin, Host: new URL(origin).host,
    ...(cookieCase ? { Cookie: `${FLOW_COOKIE}=${cookieCase.id}` } : {}),
  }, body: JSON.stringify(body) });
}
async function post(body: unknown, cookieCase?: FlowCase) {
  const response = await POST(request('POST', body, cookieCase));
  return { status: response.status, body: await response.json(), response };
}

test('start creates a case with a protected cookie, resumes it, and GET reads it without a model call', async () => {
  const created = await post({ action: 'start' });
  assert.equal(created.status, 201);
  createdIds.add(created.body.session.id);
  const cookie = created.response.headers.get('set-cookie')!;
  assert.ok(cookie.includes(`${FLOW_COOKIE}=${created.body.session.id}`));
  assert.match(cookie, /httponly/i);
  assert.match(cookie, /samesite=strict/i);
  assert.equal(created.body.model.available, false);
  const current = loadFlowCase(created.body.session.id);
  const resumed = await post({ action: 'start' }, current);
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.session.id, current.id);
  assert.equal(resumed.response.headers.get('set-cookie'), null);
  const read = await GET(new NextRequest(`${origin}/api/flow`, { headers: { Cookie: `${FLOW_COOKIE}=${current.id}` } }));
  assert.equal(read.status, 200);
  assert.equal((await read.json()).session.id, current.id);
  const anonymous = await GET(new NextRequest(`${origin}/api/flow`));
  assert.equal((await anonymous.json()).session, null);
  assert.equal(networkCalls, 0);
});

test('every command advances one revision, the rule planner answers when no model is configured, and case identity is enforced', async () => {
  const current = newCase();
  const other = newCase();
  const before = loadFlowCase(current.id);
  for (const command of [{ action: 'input', text: 'Feil sak.' }, { action: 'answers', answers: [] }, { action: 'approve', facts: [] }, { action: 'execute', execution: { type: 'contact' } }, { action: 'skip' }, { action: 'continue' }, { action: 'retry' }]) {
    const rejected = await post({ ...command, caseId: other.id, revision: current.revision }, current);
    assert.equal(rejected.status, 409, command.action);
    assert.deepEqual(loadFlowCase(current.id), before);
  }
  const stale = await post({ action: 'input', text: 'Gammel revisjon.', caseId: current.id, revision: current.revision + 5 }, current);
  assert.equal(stale.status, 409);

  const first = await post({ action: 'input', text: 'Jeg har mistet jobben og har barn på SFO.', caseId: current.id, revision: current.revision }, current);
  assert.equal(first.status, 200, first.body.error);
  let state = first.body.session as FlowCase;
  assert.equal(state.revision, current.revision + 1);
  assert.equal(state.status, 'step');
  assert.equal(state.step?.by, 'rule');
  assert.equal(state.step?.kind, 'review');
  assert.deepEqual(state.step?.fetch, ['husstand', 'inntekt', 'sfo']);
  assert.ok(state.events.some(event => event.type === 'failed'));

  const wrongStep = await post({ action: 'answers', answers: [{ key: 'household', value: 'x' }], caseId: state.id, revision: state.revision }, current);
  assert.equal(wrongStep.status, 409);
  assert.equal(loadFlowCase(current.id).revision, state.revision, 'A rejected command leaves the stored revision untouched.');

  const approved = await post({ action: 'approve', facts: [], remove: [], fetch: [], note: '', caseId: state.id, revision: state.revision }, current);
  assert.equal(approved.status, 200, approved.body.error);
  state = approved.body.session;
  assert.equal(state.step?.kind, 'ask');
  assert.deepEqual(state.ks.declined, ['husstand', 'inntekt', 'sfo']);

  const answered = await post({ action: 'answers', answers: [{ key: 'household', value: '2 voksne, 1 barn' }, { key: 'household_income_annual', value: '152000' }, { key: 'sfo_place', value: 'Borgund SFO, 2. trinn' }], note: '', caseId: state.id, revision: state.revision }, current);
  assert.equal(answered.status, 200, answered.body.error);
  state = answered.body.session;
  assert.equal(state.step?.kind, 'action');
  assert.equal(state.step?.proposal?.type, 'form');
  assert.equal(state.facts.filter(fact => fact.status === 'confirmed').length, 3);

  const mismatch = await post({ action: 'execute', execution: { type: 'contact' }, caseId: state.id, revision: state.revision }, current);
  assert.equal(mismatch.status, 409);
  const skipped = await post({ action: 'skip', caseId: state.id, revision: state.revision }, current);
  assert.equal(skipped.status, 200, skipped.body.error);
  state = skipped.body.session;
  assert.equal(state.history.at(-1)?.result, 'Hoppet over av deg');
  assert.ok(state.step);
  const nothingActed = await post({ action: 'continue', caseId: state.id, revision: state.revision }, current);
  assert.equal(nothingActed.status, 409);
  assert.equal(networkCalls, 0);
});

test('receipts download only for the cookie case, and delete requires the exact case and revision', async () => {
  const current = newCase();
  const other = newCase();
  const stored = loadFlowCase(current.id);
  stored.outcomes.push({ id: '22222222-3333-4444-8555-666666666666', kind: 'reminder', title: 'Send flyttemelding', reference: 'PAAMINNELSE-TEST', detail: 'Test', createdAt: new Date().toISOString(), revision: 1, localOnly: true, recipient: null, payload: { date: '2030-01-01', time: null, note: 'Husk.' } });
  saveFlowCase(stored);
  const foreign = await downloadOutcome(new NextRequest(`${origin}/api/flow/outcome?caseId=${current.id}&outcomeId=${stored.outcomes[0].id}`, { headers: { Cookie: `${FLOW_COOKIE}=${other.id}` } }));
  assert.equal(foreign.status, 409);
  const receipt = await downloadOutcome(new NextRequest(`${origin}/api/flow/outcome?caseId=${current.id}&outcomeId=${stored.outcomes[0].id}`, { headers: { Cookie: `${FLOW_COOKIE}=${current.id}` } }));
  assert.equal(receipt.status, 200);
  assert.match(await receipt.text(), /PAAMINNELSE-TEST[\s\S]*2030-01-01/);

  for (const [caseId, revision] of [[other.id, stored.revision], [current.id, stored.revision + 1]] as const) {
    const response = await DELETE(request('DELETE', { caseId, revision }, current));
    assert.equal(response.status, 409);
    assert.equal(loadFlowCase(current.id).id, current.id);
  }
  const deleted = await DELETE(request('DELETE', { caseId: current.id, revision: stored.revision }, current));
  assert.equal(deleted.status, 200);
  assert.throws(() => loadFlowCase(current.id), /slettet eller utløpt/);
  assert.match(deleted.headers.get('set-cookie')!, /sok-flow-session=;/);
  assert.equal(loadFlowCase(other.id).id, other.id);
});

test('document upload checks case identity and revision before extraction, then stores the text as a citizen source', async () => {
  const current = newCase();
  const other = newCase();
  const before = loadFlowCase(current.id);
  const form = (caseId: string, revision: number) => {
    const data = new FormData();
    data.set('caseId', caseId); data.set('revision', String(revision));
    data.set('file', new File(['Lønnsslipp: brutto lønn 32 000 kr i august 2026.'], 'lonnsslipp.txt', { type: 'text/plain' }));
    return new NextRequest(`${origin}/api/flow/document`, { method: 'POST', headers: { Origin: origin, Host: new URL(origin).host, Cookie: `${FLOW_COOKIE}=${current.id}` }, body: data });
  };
  for (const [caseId, revision] of [[other.id, current.revision], [current.id, current.revision + 1]] as const) {
    const response = await uploadDocument(form(caseId, revision));
    assert.equal(response.status, 409);
    assert.deepEqual(loadFlowCase(current.id), before);
  }
  const accepted = await uploadDocument(form(current.id, current.revision));
  assert.equal(accepted.status, 200);
  const state = (await accepted.json()).session as FlowCase;
  assert.equal(state.sources.length, 1);
  assert.equal(state.sources[0].kind, 'document');
  assert.equal(state.step, null, 'Before the first description the document waits for the planner.');
  assert.equal(networkCalls, 0);
});
