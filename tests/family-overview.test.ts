import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { NextRequest } from 'next/server';
import { supportMap, familyTimeline } from '../src/domain/family-overview';
import { activityForCase, cancelReminder, createReminder } from '../src/server/flow-action-store';
import { createFlowCase, deleteFlowCase, loadFlowCase, saveFlowCase } from '../src/server/flow-store';
import { chooseFlowAction } from '../src/server/flow-service';
import { POST } from '../src/app/api/flow/activity/route';
import { FLOW_COOKIE } from '../src/server/flow-http';

const directory = mkdtempSync(join(tmpdir(), 'family-overview-'));
process.env.ASSISTANT_DATA_DIR = directory;
const state = globalThis as typeof globalThis & { assistantDb?: DatabaseSync };
after(() => { state.assistantDb?.close(); delete state.assistantDb; rmSync(directory, { recursive: true, force: true }); });

test('support map separates missing data from confirmed facts and opens the exact selected template', () => {
  const session = createFlowCase(); session.situation = 'Vi trenger hjelp med boutgifter.';
  const before = supportMap(session);
  assert.equal(before.length, 4);
  assert.ok(before.every(service => service.requirements.every(field => !field.confirmed)));
  session.sources.push({ id: 'source', kind: 'answers', title: 'Ditt svar', text: '12000', at: session.createdAt });
  session.facts.push({ id: 'rent', key: 'monthly_rent', label: 'Husleie', value: '12000', origin: 'citizen', status: 'proposed', sourceId: 'source', quote: '12000', detail: '', createdAt: session.createdAt });
  assert.equal(supportMap(session)[1].requirements[0].confirmed, false);
  session.facts[0].status = 'confirmed';
  assert.deepEqual(supportMap(session)[1].requirements[0], { id: 'monthly_rent', label: 'Månedlig husleie (kr)', confirmed: true, value: '12000', source: 'Ditt svar' });
  chooseFlowAction(session, 'form', 'housing-allowance');
  assert.equal(session.step?.proposal?.type, 'form');
  if (session.step?.proposal?.type === 'form') assert.equal(session.step.proposal.templateId, 'housing-allowance');
  assert.throws(() => chooseFlowAction(session, 'form', 'invented'), /tjenestekatalogen/);
  assert.throws(() => chooseFlowAction(session, 'email', 'housing-allowance'), /tjenestekatalogen/);
  deleteFlowCase(session.id);
});

test('checklist API persists readiness without approving facts, with owner and version checks', async () => {
  const session = createFlowCase(), other = createFlowCase();
  session.situation = 'Dokumenter til SFO'; saveFlowCase(session);
  const before = loadFlowCase(session.id);
  const send = (body: object) => POST(new NextRequest('http://localhost/api/flow/activity', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `${FLOW_COOKIE}=${session.id}`, Origin: 'http://localhost' }, body: JSON.stringify(body) }));
  const command = { action: 'checklist', caseId: session.id, key: 'sfo-reduced-payment:document:0', checked: true, version: 0 };
  assert.equal((await send({ ...command, caseId: other.id })).status, 409);
  assert.equal((await send({ ...command, key: 'invented' })).status, 400);
  assert.equal((await send(command)).status, 200);
  assert.equal((await send(command)).status, 409);
  assert.deepEqual(loadFlowCase(session.id), before);
  state.assistantDb?.close(); delete state.assistantDb;
  assert.equal(activityForCase(session.id).checklist?.[0].checked, true);
  assert.deepEqual(activityForCase(other.id).checklist, []);
  assert.equal((await send({ ...command, checked: false, version: 1 })).status, 200);
  assert.equal(activityForCase(session.id).checklist?.[0].checked, false);
  deleteFlowCase(session.id);
  assert.throws(() => activityForCase(session.id), /utløpt/);
  deleteFlowCase(other.id);
});

test('timeline orders real events and reflects cancelled reminders rather than original receipts', () => {
  const session = createFlowCase();
  const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const reminder = createReminder(session.id, 'outcome-reminder', { title: 'Følg opp', date, time: '12:00', note: 'Min påminnelse' }, session.expiresAt);
  session.outcomes.push({ id: 'outcome-reminder', kind: 'reminder', title: 'Gammel tittel', reference: 'OLD', detail: 'Planlagt', localOnly: true, recipient: null, status: 'scheduled', createdAt: session.createdAt, revision: 1, payload: { date } });
  cancelReminder(session.id, reminder.id, reminder.version);
  const timeline = familyTimeline(session, activityForCase(session.id));
  assert.equal(timeline.filter(entry => entry.id === reminder.id).length, 1);
  assert.ok(!timeline.some(entry => entry.title === 'Gammel tittel'));
  assert.equal(timeline.at(-1)?.status, 'Avbrutt');
  assert.equal(timeline.at(-1)?.scheduled, false);
  assert.ok(timeline.every((entry, index) => !index || Date.parse(entry.at) >= Date.parse(timeline[index - 1].at)));
  deleteFlowCase(session.id);
});
