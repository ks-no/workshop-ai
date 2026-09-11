import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedActionKinds, buildFormDraft, contactFor, emailEvidence, fallbackEmailDraft, missingFormFields, normalizeRecommendation, outcomeText, resolveNextActions, ruleRecommendation, selfServiceFor } from '../src/domain/assistant-actions';
import { narrativeWithinEvidence } from '../src/domain/assistant-verification';
import { guidanceSources, prepareService } from '../src/domain/service-catalogue';
import type { AssistantCase, EvidenceSource, FactKey, MemoryFact, Outcome } from '../src/domain/assistant-types';

const now = '2026-09-10T10:00:00.000Z';
function session(): AssistantCase {
  const message: EvidenceSource = { id: 'citizen-message', kind: 'conversation', title: 'Din beskrivelse 1', text: 'Jeg har mistet jobben og skal flytte til Bergen 2026-10-01. Husholdningen tjener 320000 kroner i året.', url: null, retrievedAt: now, purpose: 'Forstå behov', period: 'Nå' };
  return { id: 'case', createdAt: now, updatedAt: now, expiresAt: now, revision: 3, analyzedRevision: 3, status: 'ready', intent: 'personalized', language: 'nb',
    messages: [{ id: 'm1', role: 'user', text: message.text, at: now, sourceId: message.id }, { id: 'm2', role: 'assistant', text: 'KI-tolkning', at: now, sourceId: null }],
    facts: [], sources: [...guidanceSources(), message], services: [], questions: [], unsupported: [], runs: [], events: [], summary: '', handoff: null, critique: [], error: null, ksData: null, drafts: { email: null, form: null }, outcomes: [] };
}
function fact(key: FactKey, value: string, sourceId = 'citizen-message', status: MemoryFact['status'] = 'confirmed'): MemoryFact {
  return { id: `${key}-${value}`, key, value, label: key, status, citation: { sourceId, quote: value, lineStart: 1, lineEnd: 1, page: null }, createdAt: now, confirmedAt: now };
}

test('every service always routes to a contact, and clarification is offered only while information is missing', () => {
  const current = session();
  current.services = [prepareService('moving', current, 'Innbyggeren skal flytte')];
  const kinds = allowedActionKinds(current, current.services[0]);
  assert.ok(kinds.includes('contact'));
  assert.ok(kinds.includes('clarify'));
  assert.equal(ruleRecommendation(current, current.services[0]).kind, 'clarify');
  const actions = resolveNextActions(current);
  const form = actions.find(action => action.kind === 'form')!;
  assert.equal(form.available, false);
  assert.match(form.blockers.join(' '), /Mangler: Flyttedato, Ny kommune\./);
  assert.equal(actions.find(action => action.kind === 'contact')?.contact?.id, contactFor('moving').id);
  assert.equal(actions.find(action => action.kind === 'self-service')?.contact?.id, selfServiceFor('moving')?.id);
  assert.equal(actions.find(action => action.kind === 'email')?.available, true, 'A caseworker can be e-mailed even when the citizen lacks some information.');
  assert.equal(actions[0].recommended, true, 'The recommended action is listed first.');

  current.facts = [fact('move_date', '2026-10-01'), fact('new_municipality', 'Bergen')];
  current.services = [prepareService('moving', current, 'Innbyggeren skal flytte')];
  const complete = resolveNextActions(current);
  assert.equal(complete.some(action => action.kind === 'clarify'), false);
  assert.equal(complete.find(action => action.kind === 'form')?.available, true);
  assert.equal(ruleRecommendation(current, current.services[0]).kind, 'self-service', 'A state service is completed by the citizen in the official self-service.');
});

test('a complete family case recommends the KS form, which is filled only from confirmed facts with their provenance', () => {
  const current = session();
  current.sources.push({ id: 'ks-sfo', kind: 'register', title: 'KS API · SFO-plasser', text: '[{"sfonavn":"Test AKS"}]', url: 'http://127.0.0.1/sfo', retrievedAt: now, purpose: 'SFO', period: 'Nå' });
  current.facts = [fact('uses_sfo', 'true', 'ks-sfo'), fact('household_income_annual', '320000'), fact('income_basis', 'household_year')];
  current.services = [prepareService('family', current, 'Innbyggeren spør om SFO-betaling')];
  assert.equal(current.services[0].status, 'needs-review');
  assert.equal(ruleRecommendation(current, current.services[0]).kind, 'form');
  const draft = buildFormDraft(current, 'family', now, 'draft-1')!;
  assert.equal(draft.submission, 'ks-sandbox');
  assert.equal(draft.recipient.id, 'sfo-office');
  assert.deepEqual(missingFormFields(draft), []);
  const byId = Object.fromEntries(draft.fields.map(field => [field.id, field]));
  assert.equal(byId.uses_sfo.origin, 'register');
  assert.equal(byId.uses_sfo.editable, false);
  assert.equal(byId.household_income_annual.value, '320000');
  assert.equal(byId.household_income_annual.origin, 'confirmed');
  assert.equal(byId.cohabitant_missing.origin, 'empty');
  assert.equal(byId.situation.origin, 'citizen');
  assert.match(byId.situation.value, /mistet jobben/);
  assert.equal(byId.situation.editable, true);
  assert.equal(byId.message.value, '');
  const action = resolveNextActions(current).find(item => item.kind === 'form')!;
  assert.equal(action.available, true);
  assert.equal(action.recommended, true);
  assert.match(action.detail, /KS-sandkassen/);
});

test('stale analysis or unresolved proposals block e-mail, form and summary but never the contact route', () => {
  const current = session();
  current.facts = [fact('move_date', '2026-10-01'), fact('new_municipality', 'Bergen'), fact('monthly_rent', '12000', 'citizen-message', 'proposed')];
  current.services = [prepareService('moving', current, 'Flytting')];
  current.analyzedRevision = current.revision - 1;
  const actions = resolveNextActions(current);
  for (const kind of ['email', 'form', 'summary'] as const) {
    const action = actions.find(item => item.kind === kind)!;
    assert.equal(action.available, false, kind);
    assert.ok(action.blockers.some(blocker => /oppdateres/.test(blocker)), kind);
    assert.ok(action.blockers.some(blocker => /1 foreslåtte opplysninger/.test(blocker)), kind);
  }
  assert.equal(actions.find(item => item.kind === 'contact')?.available, true);
  current.handoff = { id: 'PLAN-1', createdAt: now, revision: current.revision, serviceIds: ['moving'], localOnly: true, status: 'prepared-for-human-review', credential: null };
  const locked = resolveNextActions(current);
  assert.equal(locked.find(item => item.kind === 'summary')?.done, true);
  assert.match(locked.find(item => item.kind === 'email')!.blockers[0], /låst/);
});

test('agent recommendations are kept only when the service can offer them, otherwise the rule decides', () => {
  const current = session();
  current.services = [prepareService('moving', current, 'Flytting')];
  const service = current.services[0];
  const invalid = normalizeRecommendation(current, service, { kind: 'summary', reason: 'Last ned nå.' }, true);
  assert.equal(invalid.by, 'rule');
  assert.equal(invalid.kind, 'clarify');
  const accepted = normalizeRecommendation(current, service, { kind: 'contact', reason: 'Ta kontakt med kommunen for å avklare flyttedatoen.' }, true);
  assert.deepEqual(accepted, { kind: 'contact', reason: 'Ta kontakt med kommunen for å avklare flyttedatoen.', by: 'agent' });
  const unsafeReason = normalizeRecommendation(current, service, { kind: 'contact', reason: 'Du får 50000 kroner.' }, false);
  assert.equal(unsafeReason.by, 'agent');
  assert.equal(unsafeReason.kind, 'contact');
  assert.ok(!unsafeReason.reason.includes('50000'));
  assert.equal(normalizeRecommendation(current, service, undefined, false).by, 'rule');
});

test('general information questions end in a contact or official service, never in a personal submission', () => {
  const current = session();
  current.intent = 'information';
  current.services = [prepareService('housing', current, 'Generelt spørsmål')];
  assert.deepEqual(allowedActionKinds(current, current.services[0]), ['contact', 'self-service']);
  const actions = resolveNextActions(current);
  assert.equal(actions.some(action => ['email', 'form', 'clarify', 'summary'].includes(action.kind)), false);
  assert.equal(ruleRecommendation(current, current.services[0]).kind, 'contact');
  assert.equal(actions.find(action => action.kind === 'self-service')?.url, 'https://www.husbanken.no/person/bostotte/');
});

test('the fallback e-mail uses only confirmed values and passes the same evidence check as model text', () => {
  const current = session();
  current.facts = [fact('move_date', '2026-10-01'), fact('new_municipality', 'Bergen')];
  current.services = [prepareService('moving', current, 'Flytting')];
  const draft = fallbackEmailDraft(current, 'moving', contactFor('moving'));
  assert.match(draft.subject, /Flytting/);
  assert.match(draft.body, /Flyttedato: 2026-10-01/);
  assert.match(draft.body, /Ny kommune: Bergen/);
  assert.match(draft.body, /mistet jobben/, 'The citizen’s own words are quoted, not AI interpretation.');
  assert.match(draft.body, /ingen søknad er sendt ennå/i);
  assert.equal(narrativeWithinEvidence(draft.body, emailEvidence(current, 'moving'), 'nb'), true);
  current.language = 'en';
  const english = fallbackEmailDraft(current, 'moving', contactFor('moving'));
  assert.match(english.body, /Kind regards/);
  assert.equal(narrativeWithinEvidence(english.body, emailEvidence(current, 'moving'), 'en'), true);
  assert.equal(narrativeWithinEvidence('Søknaden din er sendt og du får 9999 kroner.', emailEvidence(current, 'moving'), 'nb'), false);
});

test('executed outcomes mark their action as done and render a plain-text receipt without private extras', () => {
  const current = session();
  current.facts = [fact('move_date', '2026-10-01'), fact('new_municipality', 'Bergen')];
  current.services = [prepareService('moving', current, 'Flytting')];
  const outcome: Outcome = { id: 'o1', kind: 'form', serviceId: 'moving', createdAt: now, revision: 3, reference: 'SKJEMA-ABCD1234', status: 'prepared-locally', recipient: selfServiceFor('moving')!, title: 'Forberedt flyttemelding (til Skatteetaten)', detail: 'Klargjort lokalt.', localOnly: true,
    payload: { fields: [{ id: 'move_date', label: 'Flyttedato', value: '2026-10-01' }, { id: 'new_address', label: 'Ny adresse', value: '' }] } };
  current.outcomes = [outcome];
  assert.equal(resolveNextActions(current).find(action => action.kind === 'form')?.done, true);
  const text = outcomeText(outcome, current.id);
  assert.match(text, /Referanse: SKJEMA-ABCD1234/);
  assert.match(text, /Flyttedato: 2026-10-01/);
  assert.match(text, /Ny adresse: \(ikke utfylt\)/);
  assert.match(text, /Ingen søknad er sendt til en offentlig tjeneste/);
  const ks: Outcome = { ...outcome, id: 'o2', kind: 'form', serviceId: 'family', reference: 'soknad-1', status: 'submitted-to-ks-sandbox', localOnly: false, payload: { fields: [], ksSoknadId: 'soknad-1', ksOppgaveId: 'oppgave-1', ksWarning: null } };
  assert.match(outcomeText(ks, current.id), /oppgave-ID: oppgave-1/);
  assert.match(outcomeText(ks, current.id), /workshop-sandkasse/);
});
