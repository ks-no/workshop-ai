import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AssistantCase, ModelPlan, ServiceId } from '../src/domain/assistant-types';
import type { ModelCall } from '../src/server/assistant-model';
import { addMessage, analyzeCase } from '../src/server/assistant-service';
import { democacheTimeoutMs, lookupDemocache } from '../src/server/assistant-democache';
import standardSak from '../src/server/democache-standardsak.json';

const previousEnv = new Map<string, string | undefined>();
beforeEach(() => {
  for (const key of ['LLM_MODEL', 'KS_PERSON_ID', 'ASSISTANT_DEMOCACHE_TIMEOUT_MS', 'ASSISTANT_MAX_REVISIONS']) {
    previousEnv.set(key, process.env[key]);
    delete process.env[key];
  }
  process.env.LLM_MODEL = 'test-transport';
});
afterEach(() => {
  for (const [key, value] of previousEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  previousEnv.clear();
});

function session(): AssistantCase {
  const now = new Date().toISOString();
  return { id: 'democache-test', createdAt: now, updatedAt: now, expiresAt: now, revision: 1, status: 'collecting', messages: [], facts: [], sources: [], services: [], questions: [], unsupported: [], runs: [], events: [], summary: '', critique: [], analyzedRevision: null, handoff: null, error: null, ksData: null };
}
function plan(services: ServiceId[] = ['moving']): ModelPlan {
  return { summary: 'Forbered opplysningene for menneskelig vurdering.', services: services.map(id => ({ id, reason: 'Innbyggerens beskrivelse' })), facts: [], questions: [], unsupported: [] };
}
type TailContext = { draft: string };
function model(response: ModelPlan, delayMs = 0): ModelCall {
  return async (_system, context, schema, role) => {
    if (delayMs) await new Promise(resolveDelay => setTimeout(resolveDelay, delayMs));
    if (context && typeof context === 'object' && 'draft' in context) {
      const tailContext = context as TailContext;
      if (role === 'critic') return schema.parse({ verdict: 'PASS', gaps: [], notes: '' });
      return schema.parse({ answer: tailContext.draft });
    }
    return schema.parse(context && typeof context === 'object' && 'service' in context
      ? { summary: 'Sjekklisten er klar til kontroll.', findings: [], questions: [] } : response);
  };
}
const discardPersistence = () => {};

test('democacheTimeoutMs faller tilbake til standardverdien og klemmes til et fornuftig intervall', () => {
  assert.equal(democacheTimeoutMs(), 20_000);
  process.env.ASSISTANT_DEMOCACHE_TIMEOUT_MS = '1';
  assert.equal(democacheTimeoutMs(), 5_000);
  process.env.ASSISTANT_DEMOCACHE_TIMEOUT_MS = '999999999';
  assert.equal(democacheTimeoutMs(), 120_000);
  process.env.ASSISTANT_DEMOCACHE_TIMEOUT_MS = 'ikke et tall';
  assert.equal(democacheTimeoutMs(), 20_000);
});

test('oppslaget treffer kun på eksakt hash av normalisert henvendelse pluss personId', () => {
  assert.ok(lookupDemocache(standardSak.triggerMessage, standardSak.personId));
  assert.equal(lookupDemocache(standardSak.triggerMessage, 'person-999'), null);
  assert.equal(lookupDemocache('En helt annen henvendelse om SFO.', standardSak.personId), null);
  // Normalisering (mellomrom og store/små bokstaver) skal ikke ødelegge et reelt treff.
  assert.ok(lookupDemocache(`  ${standardSak.triggerMessage.toUpperCase()}  `, standardSak.personId));
});

test('henvendelser uten cache-treff går til levende modell, aldri til et omtrentlig treff', async () => {
  const current = session();
  addMessage(current, 'Jeg trenger hjelp med SFO, men dette er ikke standardsaken.');
  await analyzeCase(current, model(plan(['family'])), discardPersistence);
  assert.equal(current.status, 'ready');
  assert.equal(current.messages.at(-1)?.precomputed, undefined);
});

test('den manuelle hurtigtasten tvinger fram det forhåndsberegnede svaret på under 500 ms', async () => {
  const current = session();
  addMessage(current, standardSak.triggerMessage);
  const startedAt = Date.now();
  await analyzeCase(current, model(plan()), discardPersistence, { forceDemoCache: true });
  const elapsedMs = Date.now() - startedAt;
  assert.ok(elapsedMs < 500, `forventet svar på under 500 ms, brukte ${elapsedMs} ms`);
  assert.equal(current.status, 'ready');
  const answer = current.messages.at(-1);
  assert.equal(answer?.precomputed, true);
  assert.equal(answer?.text, standardSak.answer);
  assert.equal(current.services[0]?.id, standardSak.serviceId);
});

test('hurtigtasten har ingen effekt uten cache-treff, saken går uansett til levende modell', async () => {
  const current = session();
  addMessage(current, 'En melding som ikke er standardsaken.');
  await analyzeCase(current, model(plan(['moving'])), discardPersistence, { forceDemoCache: true });
  assert.equal(current.messages.at(-1)?.precomputed, undefined);
  assert.equal(current.services[0]?.id, 'moving');
});

test('regresjon: automatisk fallback utløses når modellkallet mot Cloudflare passerer terskelen (simulert timeout)', async () => {
  process.env.ASSISTANT_DEMOCACHE_TIMEOUT_MS = '5000';
  const current = session();
  addMessage(current, standardSak.triggerMessage);
  // Modellen svarer aldri innen terskelen; sikkerhetsnettet må da overta i stedet for å bli hengende.
  await analyzeCase(current, model(plan(), democacheTimeoutMs() + 1500), discardPersistence);
  assert.equal(current.status, 'ready');
  const answer = current.messages.at(-1);
  assert.equal(answer?.precomputed, true);
  assert.equal(answer?.text, standardSak.answer);
  assert.ok(current.events.some(item => item.agent === 'Sikkerhetsnett' && /tidsgrensen/.test(item.detail)));
});

test('automatisk fallback utløses også når spesialisten feiler mot modellen, ikke bare ved timeout', async () => {
  const current = session();
  addMessage(current, standardSak.triggerMessage);
  const failingModel: ModelCall = async (_system, context, schema, role) => {
    if (context && typeof context === 'object' && 'service' in context) throw new Error('Cloudflare AI Gateway svarte med en feil.');
    if (context && typeof context === 'object' && 'draft' in context) {
      const tailContext = context as TailContext;
      if (role === 'critic') return schema.parse({ verdict: 'PASS', gaps: [], notes: '' });
      return schema.parse({ answer: tailContext.draft });
    }
    return schema.parse(plan([standardSak.serviceId as ServiceId]));
  };
  await analyzeCase(current, failingModel, discardPersistence);
  assert.equal(current.status, 'ready');
  const answer = current.messages.at(-1);
  assert.equal(answer?.precomputed, true);
  assert.equal(answer?.text, standardSak.answer);
  assert.ok(current.events.some(item => item.agent === 'Sikkerhetsnett' && /feilet/.test(item.detail)));
});

test('en signal-avbrutt forespørsel uten tidsavbrudd eller modellfeil skal ikke maskeres som et cache-svar', async () => {
  const current = session();
  addMessage(current, standardSak.triggerMessage);
  const controller = new AbortController();
  await analyzeCase(current, model(plan()), discardPersistence, {
    signal: controller.signal,
    onStep: step => { if (step === 'triage') controller.abort(); },
  });
  assert.equal(current.status, 'error');
  assert.equal(current.messages.at(-1)?.precomputed, undefined);
});
