import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { assistantDatabase } from '../src/server/assistant-store';
import { createFlowCase, saveFlowCase, loadFlowCase } from '../src/server/flow-store';
import { chooseFlowAction } from '../src/server/flow-service';
import { activityForCase, executeApprovedAction, prepareAction } from '../src/server/flow-action-store';
import { checkActionReceipt } from '../src/server/flow-action-recovery';
import { KsDemoError, type KsDemoApplication } from '../src/providers/ks-demo-client';
import { POST } from '../src/app/api/flow/activity/route';
import { FLOW_COOKIE } from '../src/server/flow-http';

const directory = mkdtempSync(join(tmpdir(), 'action-recovery-'));
process.env.ASSISTANT_DATA_DIR = directory;
after(() => { assistantDatabase().close(); rmSync(directory, { recursive: true, force: true }); });
async function failed(error: Error) {
  const session = createFlowCase(); session.situation = 'SFO';
  chooseFlowAction(session, 'form', 'sfo-reduced-payment'); saveFlowCase(session);
  const execution = { type: 'form' as const, fields: {} };
  const draft = prepareAction(session, execution);
  await assert.rejects(executeApprovedAction(session, draft.id, async () => { throw error; }, saveFlowCase));
  return { session, draft, execution, attempt: activityForCase(session.id).attempts[0] };
}
const send = (caseId: string, body: object) => POST(new NextRequest('http://localhost/api/flow/activity', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `${FLOW_COOKIE}=${caseId}`, Origin: 'http://localhost' }, body: JSON.stringify(body) }));

test('proven pre-dispatch failure preserves useful error and permits a fresh approval, never replay', async () => {
  const { session, draft, execution, attempt } = await failed(new KsDemoError('authentication', 'Innloggingen kunne ikke fullføres.', undefined, true));
  assert.equal(attempt.status, 'failed');
  assert.match(attempt.error!, /Innloggingen/);
  let calls = 0;
  await assert.rejects(executeApprovedAction(session, draft.id, async () => { calls++; throw Error(); }, saveFlowCase));
  assert.equal(calls, 0);
  session.revision++; saveFlowCase(session);
  assert.equal(prepareAction(session, execution).status, 'prepared');
});

test('uncertain recovery requires explicit attestation, owns case and checks revision/status', async () => {
  const { session, execution, attempt } = await failed(new Error('private internal error'));
  assert.equal(attempt.status, 'uncertain');
  assert.ok(!attempt.error?.includes('private'));
  assert.throws(() => prepareAction(session, execution), /avklares/);
  chooseFlowAction(session, 'form', 'sfo-reduced-payment'); saveFlowCase(session);
  assert.throws(() => prepareAction(session, execution), /avklares/);
  const command = { action: 'confirm-not-submitted', id: attempt.id, caseId: session.id, revision: session.revision, confirmed: true, note: 'Kontrollert med ansvarlig: ingenting registrert.' };
  assert.equal((await send(session.id, { ...command, confirmed: false })).status, 400);
  assert.equal((await send(session.id, { ...command, note: '' })).status, 400);
  const other = createFlowCase();
  assert.equal((await send(other.id, command)).status, 409);
  assert.equal((await send(other.id, { ...command, caseId: other.id, revision: other.revision })).status, 404);
  assert.equal((await send(session.id, { ...command, revision: session.revision + 1 })).status, 409);
  assert.equal((await send(session.id, command)).status, 200);
  assert.equal(activityForCase(session.id).attempts[0].resolution?.method, 'user-confirmed-not-submitted');
  const current = loadFlowCase(session.id);
  assert.equal((await send(session.id, { ...command, revision: current.revision })).status, 409);
  assert.equal(prepareAction(current, execution).status, 'prepared');
});

test('receipt lookup never resubmits and only an unambiguous fresh receipt resolves uncertainty', async () => {
  const { session, attempt } = await failed(new KsDemoError('unavailable', 'KS utilgjengelig'));
  let receipts: KsDemoApplication[] = [];
  const client = { readApplications: async () => ({ value: receipts }) } as unknown as Parameters<typeof checkActionReceipt>[2];
  await assert.rejects(checkActionReceipt(session, attempt.id, client), /beviser ikke/);
  assert.equal(activityForCase(session.id).attempts[0].status, 'uncertain');
  const receipt: KsDemoApplication = { soknadId: 'soknad-recovered', personId: 'person-022', prosessId: 'sfo-moderasjon', status: 'SENDT_INN', opprettet: new Date().toISOString(), sporingsId: session.id, syntetisk: true };
  receipts = [{ ...receipt, opprettet: '2020-01-01T00:00:00Z' }];
  await assert.rejects(checkActionReceipt(session, attempt.id, client), /beviser ikke/);
  receipts = [receipt, { ...receipt, soknadId: 'second' }];
  await assert.rejects(checkActionReceipt(session, attempt.id, client), /Flere/);
  receipts = [receipt];
  await checkActionReceipt(session, attempt.id, client);
  const current = loadFlowCase(session.id);
  assert.equal(current.status, 'acted');
  assert.equal(current.outcomes[0].reference, receipt.soknadId);
  assert.equal(activityForCase(session.id).attempts[0].status, 'completed');
  await assert.rejects(checkActionReceipt(current, attempt.id, client));
  assert.equal(loadFlowCase(session.id).outcomes.length, 1);
});
