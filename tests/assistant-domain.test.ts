import { test } from 'node:test';
import assert from 'node:assert/strict';
import { citationFor, confirmedValue, validateProposal } from '../src/domain/assistant-verification';
import { guidanceSources, prepareService, repairStoredGuidanceChecks, SERVICE_CATALOGUE } from '../src/domain/service-catalogue';
import { sfoAnswer } from '../src/domain/sfo-answer';
import type { AssistantCase, EvidenceSource, FactKey, MemoryFact, ProposedFact } from '../src/domain/assistant-types';

function source(text: string): EvidenceSource {
  return { id: 'citizen-message', kind: 'conversation', title: 'Innbyggerens melding', text, url: null, retrievedAt: '2026-09-03T12:00:00.000Z', purpose: 'Opplysning gitt av innbygger', period: 'Oppgitt nå' };
}
function session(): AssistantCase {
  return { id: 'case', createdAt: '', updatedAt: '', expiresAt: '', revision: 1, status: 'collecting', messages: [], facts: [], sources: guidanceSources(), services: [], questions: [], unsupported: [], runs: [], events: [], summary: '', critique: [], analyzedRevision: null, handoff: null, error: null, ksData: null };
}
function fact(key: FactKey, value: string, status: MemoryFact['status'] = 'confirmed'): MemoryFact {
  return { id: `${key}-${value}`, key, value, label: key, status, citation: { sourceId: 'citizen-message', quote: value, lineStart: 1, lineEnd: 1, page: null }, createdAt: '', confirmedAt: status === 'confirmed' ? '2026-09-03T12:00:00.000Z' : null };
}
function proposal(key: FactKey, value: string, quote: string): ProposedFact {
  return { key, value, sourceId: 'citizen-message', quote };
}

test('citations use exact stored text and page-local line ranges', () => {
  const evidence = source('Heading\nFirst line\nSecond line\nOther page');
  evidence.kind = 'document';
  evidence.pages = [{ page: 1, text: 'Heading\nFirst line\nSecond line' }, { page: 2, text: 'Other page' }];
  assert.deepEqual(citationFor(evidence, 'First line\nSecond line'), { sourceId: evidence.id, quote: 'First line\nSecond line', lineStart: 2, lineEnd: 3, page: 1 });
  assert.equal(citationFor(evidence, 'Other page')?.page, 2);
  assert.equal(citationFor(evidence, 'First Line'), null);
  assert.equal(citationFor(evidence, 'Second line\nOther page'), null);
  assert.equal(citationFor(evidence, ''), null);
});

test('numeric proposals must cite the exact scalar without arithmetic or substring matches', () => {
  for (const quote of ['Årsinntekten er 320000.', 'Inntekt: 320 000 kr', 'Inntekt: 320\u00a0000 kr']) {
    assert.equal(validateProposal(proposal('household_income_annual', '320000', quote), [source(quote)])?.value, '320000');
  }
  for (const quote of ['Inntekt 1320000 kr', 'Månedsinntekt 26666 kr', 'Inntekt -320000 kr', 'Inntekt 320000,50 kr', 'Nummer x320000y']) {
    assert.equal(validateProposal(proposal('household_income_annual', '320000', quote), [source(quote)]), null);
  }
  for (const value of ['NaN', 'Infinity', '1.5', '-1', '100000001', '3e5']) {
    assert.equal(validateProposal(proposal('household_income_annual', value, value), [source(value)]), null);
  }
  assert.equal(validateProposal(proposal('household_income_annual', '0', 'Inntekt 0 kr'), [source('Inntekt 0 kr')])?.value, '0');
  assert.equal(validateProposal(proposal('household_size', '0', '0 personer'), [source('0 personer')]), null);
});

test('unknown, ambiguous and guidance sources cannot become personal fact proposals', () => {
  const quote = 'Vi har 3 barn.';
  const proposed = proposal('household_size', '3', quote);
  assert.equal(validateProposal(proposed, []), null);
  assert.equal(validateProposal(proposed, [source(quote), source(quote)]), null);
  assert.equal(validateProposal(proposed, [{ ...source(quote), kind: 'guidance' }]), null);
  assert.equal(validateProposal({ ...proposed, quote: 'Vi har 4 barn.' }, [source(quote)]), null);
});

test('booleans remain proposals and dates or place names must have concrete textual evidence', () => {
  const quote = 'Jeg tror ikke jeg skal flytte.';
  const current = session();
  const result = validateProposal(proposal('moving', 'true', quote), [source(quote)]);
  assert.ok(result, 'Semantic interpretation is offered for human review, not certified as fact');
  assert.equal(current.facts.length, 0);
  assert.equal(validateProposal(proposal('moving', 'yes', quote), [source(quote)]), null);
  assert.equal(validateProposal(proposal('move_date', '2026-10-01', 'Flytter 1.10.2026'), [source('Flytter 1.10.2026')])?.value, '2026-10-01');
  assert.equal(validateProposal(proposal('move_date', '2026-02-30', '2026-02-30'), [source('2026-02-30')]), null);
  assert.equal(validateProposal(proposal('move_date', '2026-10-01', 'Flytter neste måned'), [source('Flytter neste måned')]), null);
  assert.equal(validateProposal(proposal('new_municipality', 'Bergen', 'Flytter til Oslo'), [source('Flytter til Oslo')]), null);
});

test('confirmed values exclude proposed/rejected facts and fail closed for conflicts', () => {
  const current = session();
  current.facts = [fact('monthly_rent', '12000', 'proposed'), fact('monthly_rent', '10000', 'rejected')];
  assert.equal(confirmedValue(current, 'monthly_rent'), undefined);
  current.facts.push(fact('monthly_rent', '9000'));
  assert.equal(confirmedValue(current, 'monthly_rent'), '9000');
  current.facts.push(fact('monthly_rent', '15000', 'conflict'));
  assert.equal(confirmedValue(current, 'monthly_rent'), undefined);
  current.facts = [fact('monthly_rent', '9000'), fact('monthly_rent', '8000')];
  assert.equal(confirmedValue(current, 'monthly_rent'), undefined);
});

test('family uses only stored KS snapshots and never recalculates a changed conversational income', () => {
  const current = session();
  current.ksData = { personId: 'person-022', connectedAt: current.createdAt, incomeReadAt: current.createdAt, consent: null };
  current.sources.push({ ...source('[{"trinn":2,"manedspris":2980,"syntetisk":true}]'), id: 'ks-sfo', kind: 'register' });
  current.sources.push({ ...source('{"beregningsbeloep":320000,"syntetisk":true}'), id: 'ks-income', kind: 'register' });
  current.sources.push({ ...source('{"godkjent":true,"melding":"Syntetisk resultat"}'), id: 'ks-assessment', kind: 'register' });
  const before = structuredClone(current);
  const initial = prepareService('family', current, 'Endret inntekt');
  assert.equal(initial.assessment, null);
  assert.ok(initial.sourceIds.includes('ks-assessment'));
  assert.match(initial.summary, /KS-sandkassen/);
  current.sources.push(source('Ny forventet årsinntekt er 120000.'));
  current.facts.push(fact('household_income_annual', '120000'));
  const changed = prepareService('family', current, '');
  assert.equal(changed.assessment, null);
  assert.ok(changed.checks.some(check => check.id === 'sfo-snapshot' && check.status === 'human'));
  assert.deepEqual(current.sources.slice(0, before.sources.length), before.sources);
});

test('stored KS result is shown directly with conflicting citizen information and keeps valid guidance', () => {
  const current = session();
  current.sources.push({ ...source(JSON.stringify({ godkjent: true, melding: 'Syntetisk KS-resultat.', grunnlag: { ordningNavn: 'Redusert betaling i SFO, 2.–3. trinn', beregningsbeloep: 152000, inntektsgrense: 154917, gjelderFra: '2026-08-01' } }, null, 2)), id: 'ks-assessment', kind: 'register' });
  current.facts = [fact('uses_sfo', 'true'), fact('household_income_annual', '1000000'), fact('income_basis', 'household_year'), fact('cohabitant_missing', 'true')];
  const answer = sfoAnswer(current)!;
  assert.equal(answer.eligible, true);
  assert.equal(answer.basisIncomeNok, 152000);
  assert.equal(answer.thresholdNok, 154917);
  assert.equal(answer.reportedIncomeNok, 1000000);
  assert.equal(answer.missingPartner, true);
  assert.equal(answer.basisConflict, true);
  assert.equal(answer.citation.sourceId, 'ks-assessment');
  const service = prepareService('family', current, 'SFO-spørsmål');
  assert.equal(service.checks.some(check => check.id === 'guidance-missing'), false);
  assert.equal(service.status, 'needs-review');
  service.checks.push({ id: 'guidance-missing', label: 'Veiledningskilde mangler', status: 'missing', detail: 'Gammel feilmarkering', factKeys: [] });
  service.status = 'needs-information'; current.services = [service];
  assert.equal(repairStoredGuidanceChecks(current), true);
  assert.equal(service.checks.some(check => check.id === 'guidance-missing'), false);
  assert.equal(service.status, 'needs-review');
});

test('three preparation workflows have checklists and actual stored guidance citations without submitting anything', () => {
  const current = session();
  current.facts = [fact('uses_sfo', 'false'), fact('monthly_rent', '12000'), fact('household_size', '3'), fact('household_income_annual', '320000'), fact('income_basis', 'household_year'), fact('move_date', '2026-10-01'), fact('new_municipality', 'Bergen')];
  const before = structuredClone(current);
  for (const entry of SERVICE_CATALOGUE) {
    const result = prepareService(entry.id, current, 'Innbyggerens behov');
    assert.ok(result.checks.length);
    assert.equal(result.status, 'needs-review');
    assert.ok(result.findings.length);
    for (const finding of result.findings) {
      const evidence = current.sources.find(item => item.id === finding.citation.sourceId)!;
      assert.ok(evidence.text.includes(finding.citation.quote));
      assert.ok(evidence.url?.startsWith('https://'));
    }
    if (entry.id !== 'family') assert.equal(result.assessment, null);
  }
  assert.deepEqual(current, before);
  const housing = prepareService('housing', current, '');
  assert.match(housing.checks.find(check => check.id === 'housing-period')!.detail, /deler ikke årsinntekt på tolv/);
});

test('missing sources and unconfirmed facts remain visible and cannot produce ready service results', () => {
  const current = session();
  current.sources = [];
  current.facts = [fact('move_date', '2026-10-01', 'proposed'), fact('new_municipality', 'Bergen', 'proposed')];
  const result = prepareService('moving', current, '');
  assert.equal(result.status, 'needs-information');
  assert.equal(result.findings.length, 0);
  assert.equal(result.sourceIds.length, 0);
  assert.equal(result.questions.length, 2);
  assert.ok(result.checks.some(check => check.id === 'guidance-missing'));
});

test('service provenance includes only KS snapshots actually stored', () => {
  const current = session();
  current.sources.push({ ...source('{"syntetisk":true}'), id: 'ks-sfo', kind: 'register' });
  const initial = prepareService('family', current, '');
  assert.ok(initial.sourceIds.includes('ks-sfo'));
  assert.ok(!initial.sourceIds.includes('ks-income'));
  assert.ok(!initial.sourceIds.includes('ks-assessment'));
});
