import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInnsynTimeline } from '../src/server/innsyn-service';
import type { AssistantCase, EvidenceSource } from '../src/domain/assistant-types';
import type { KsDemoRevisjonshendelse } from '../src/providers/ks-demo-client';

const now = '2026-09-04T08:00:00.000Z';
const later = '2026-09-04T08:05:00.000Z';

function source(overrides: Partial<EvidenceSource> & Pick<EvidenceSource, 'id' | 'text'>): EvidenceSource {
  return { kind: 'register', title: 'KS API · Test', url: 'http://127.0.0.1/test', retrievedAt: now, purpose: 'Test', period: 'Nå', scope: 'idporten', ...overrides };
}

function session(): AssistantCase {
  const rates = source({ id: 'ks-rates', text: JSON.stringify({ maksAndelAvInntekt: 0.06, maanederMedBetaling: 11, gjelderFra: '2026-01-01' }) });
  const income = source({ id: 'ks-income', text: JSON.stringify({ beregningsbeloep: 500000, inntektsaar: 2025 }), retrievedAt: later });
  const assessment = source({ id: 'ks-assessment', text: JSON.stringify({ godkjent: true, melding: 'Syntetisk resultat' }), strippedFields: ['personId'] });
  return {
    id: 'b6fb9368-38ca-4ec9-94a8-967bde10ded6', createdAt: now, updatedAt: now, expiresAt: later, revision: 1,
    status: 'collecting', language: 'nb', messages: [], facts: [], services: [], questions: [], unsupported: [],
    sources: [rates, income, assessment], runs: [],
    events: [{ id: 'human-1', runId: '', agent: 'Innbygger', type: 'human', at: now, detail: 'Samtykke registrert hos KS Fiks: test.' }],
    summary: '', analyzedRevision: null, handoff: null, error: null, critique: [],
    ksData: { personId: 'person-022', connectedAt: now, incomeReadAt: later, consent: null },
  };
}

test('the same sporingsId ties samtykke, oppslag and regelberegning into one sorted timeline', () => {
  const current = session();
  const revisjon: KsDemoRevisjonshendelse[] = [{
    hendelseId: 'r-1', tidspunkt: later, syntetisk: true, sporingsId: current.id, handling: 'les', ressurs: 'inntekt',
    aktor: { type: 'innbygger', id: '12818800078', acr: 'idporten-loa-high' },
  }];
  const events = buildInnsynTimeline(current, revisjon);

  assert.equal(events.map(item => item.at).join(','), [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).map(item => item.at).join(','));
  assert.ok(events.some(item => item.kind === 'samtykke'));
  const regel = events.find(item => item.kind === 'regelberegning');
  assert.ok(regel);
  assert.equal(regel?.utfall, 'Innvilget');
  assert.match(regel?.terskel ?? '', /6 %/);
  assert.equal(regel?.inndata?.aarsinntekt, 500000);

  const sandboxEvent = events.find(item => item.id === 'r-1');
  assert.ok(sandboxEvent);
  assert.ok(!sandboxEvent?.detail.includes('12818800078'), 'the raw fødselsnummer from aktor.id must never reach the innsyn tab');
});

test('an unreadable rates snapshot costs the rule step, not the rest of the timeline', () => {
  const current = session();
  current.sources = current.sources.map(item => item.id === 'ks-rates' ? { ...item, text: 'ikke json' } : item);
  const events = buildInnsynTimeline(current, []);
  assert.equal(events.some(item => item.kind === 'regelberegning'), false);
  assert.ok(events.some(item => item.kind === 'samtykke'));
  assert.ok(events.some(item => item.kind === 'oppslag'));
});

test('every entry the app itself produced carries the fields the innsyn tab needs', () => {
  const events = buildInnsynTimeline(session(), []);
  const oppslag = events.find(item => item.kind === 'oppslag' && item.id === 'ks-assessment');
  assert.ok(oppslag);
  assert.equal(oppslag?.syntetisk, true);
  assert.equal(oppslag?.scope, 'idporten');
});
