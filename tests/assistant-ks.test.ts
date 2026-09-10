import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consentAndReadIncome, declineKsAccess } from '../src/server/assistant-ks';
import type { AssistantCase, EvidenceSource, MemoryFact } from '../src/domain/assistant-types';

const now = '2026-09-04T08:00:00.000Z';
function session(): AssistantCase {
  return { id: 'b6fb9368-38ca-4ec9-94a8-967bde10ded6', createdAt: now, updatedAt: now, expiresAt: '2026-09-05T08:00:00.000Z', revision: 1,
    status: 'collecting', language: 'nb', messages: [], facts: [], sources: [], services: [], questions: [], unsupported: [], runs: [], events: [],
    summary: '', analyzedRevision: null, handoff: null, error: null, ksData: { personId: 'person-022', connectedAt: now, incomeReadAt: null, consent: null } };
}
function snapshot<T>(value: T, resource: string) {
  return { value, source: { url: `http://127.0.0.1/${resource}`, retrievedAt: now, text: JSON.stringify(value), synthetic: true as const, resource } };
}
function client() {
  const consent = { samtykkeId: 'consent-1', personId: 'person-022' as const, formaal: 'Forberede vurdering av SFO-betaling', dataKilder: ['inntekt'],
    status: 'SAMTYKKET' as const, opprettet: now, utloper: '2099-09-04T08:00:00.000Z', sporingsId: 'b6fb9368-38ca-4ec9-94a8-967bde10ded6', syntetisk: true as const };
  const income = { inntektsaar: 2025, stadie: 'OPPGJOER' as const, beregningsbeloep: 152000, beregningstype: 'BARNEHAGE_SFO' as const,
    personer: [], visningsposter: [], inntekt: {}, fradrag: {}, feilmeldinger: [], syntetisk: true as const };
  return {
    grantIncomeConsent: async () => snapshot(consent, 'consent'),
    readIncome: async () => snapshot(income, 'income'),
    readSfoAssessment: async () => snapshot({ godkjent: true, melding: 'Syntetisk resultat', grunnlag: { beregningsbeloep: 152000 } }, 'assessment'),
  } as unknown as NonNullable<Parameters<typeof consentAndReadIncome>[2]>;
}
function citizenIncome(source: EvidenceSource): MemoryFact {
  return { id: 'citizen-income', key: 'household_income_annual', value: '900000', label: 'Husholdningens årsinntekt (kr)', status: 'confirmed',
    citation: { sourceId: source.id, quote: source.text, lineStart: 1, lineEnd: 1, page: null }, createdAt: now, confirmedAt: now };
}

test('KS income fills the SFO income basis directly with register provenance', async () => {
  const current = session();
  await consentAndReadIncome(current, true, client(), () => undefined);
  assert.equal(current.ksData?.incomeReadAt, now);
  assert.equal(current.facts.find(item => item.key === 'household_income_annual')?.value, '152000');
  assert.equal(current.facts.find(item => item.key === 'household_income_annual')?.status, 'confirmed');
  assert.equal(current.facts.find(item => item.key === 'household_income_annual')?.citation.sourceId, 'ks-income');
  assert.equal(current.facts.find(item => item.key === 'income_basis')?.value, 'household_year');
  assert.match(current.events.map(item => item.detail).join('\n'), /fylt inn fra KS-kilden/);
});

test('KS income never overwrites an income the citizen already entered', async () => {
  const current = session();
  const source: EvidenceSource = { id: 'citizen-source', kind: 'conversation', title: 'Svar', text: '900000', url: null, retrievedAt: now, purpose: 'Svar', period: 'Nå' };
  current.sources.push(source);
  current.facts.push(citizenIncome(source));
  await consentAndReadIncome(current, true, client(), () => undefined);
  assert.equal(current.facts.filter(item => item.key === 'household_income_annual').length, 1);
  assert.equal(current.facts.find(item => item.key === 'household_income_annual')?.value, '900000');
  assert.ok(current.sources.some(item => item.id === 'ks-income'));
});

test('declining KS access records the human choice without retrieving personal data', () => {
  const current = session();
  current.ksData = null;
  declineKsAccess(current);
  assert.equal(current.ksAccessDecision?.status, 'declined');
  assert.equal(current.ksData, null);
  assert.match(current.events.at(-1)?.detail || '', /fortsette uten/);
});
