import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AssistantCase, ModelPlan, ServiceId, SpecialistOutput, ToolId } from '../src/domain/assistant-types';
import type { ModelCall } from '../src/server/assistant-model';
import { addConfirmedAnswers, addMessage, analyzeCase } from '../src/server/assistant-service';
import { decideToolConsent, type ToolExecutors } from '../src/server/tool-runner';
import { connectKs, consentAndReadIncome } from '../src/server/assistant-ks';
import { TOOL_CATALOGUE, applicationDraftFor, consentParagraph, modelVisibleTools, pendingConsentsFor } from '../src/domain/tool-catalogue';

const previousModelEnv = new Map<string, string | undefined>();
beforeEach(() => {
  for (const key of ['LLM_MODEL', 'LLM_COORDINATOR_MODEL', 'LLM_SPECIALIST_MODEL']) { previousModelEnv.set(key, process.env[key]); delete process.env[key]; }
  process.env.LLM_MODEL = 'test-transport';
});
afterEach(() => { for (const [key, value] of previousModelEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } previousModelEnv.clear(); });

const now = '2026-09-10T08:00:00.000Z';
function session(): AssistantCase {
  return { id: 'b6fb9368-38ca-4ec9-94a8-967bde10ded6', createdAt: now, updatedAt: now, expiresAt: '2026-09-11T08:00:00.000Z', revision: 1, status: 'collecting', language: 'nb',
    messages: [], facts: [], sources: [], services: [], questions: [], unsupported: [], runs: [], events: [], summary: '', analyzedRevision: null, handoff: null, error: null, ksData: null, pendingConsents: [] };
}
function plan(services: ServiceId[], toolRequests?: ModelPlan['toolRequests'], intent: ModelPlan['intent'] = 'personalized'): ModelPlan {
  return { intent, summary: 'Det kan være du har krav på redusert SFO-betaling.', services: services.map(id => ({ id, reason: 'Mistet jobb og har barn' })), facts: [], questions: [], unsupported: [], toolRequests };
}
function model(response: ModelPlan, specialist: SpecialistOutput = { summary: 'Sjekklisten er klar.', findings: [], questions: [] }): ModelCall {
  return async (_system, context, schema) => schema.parse(context && typeof context === 'object' && 'service' in context ? specialist : response);
}
const discard = () => {};
/** The planner proposes the stated fact; screening may use proposals, the form only confirmed values. */
function withChildren(current: AssistantCase, response: ModelPlan): ModelPlan {
  return { ...response, facts: [{ key: 'has_children', value: 'true', sourceId: current.sources[0].id, quote: 'har barn' }] };
}
function snapshot<T>(value: T, resource: string) {
  return { value, source: { url: `http://127.0.0.1/${resource}`, retrievedAt: now, text: JSON.stringify(value), synthetic: true as const, resource } };
}
function fakeKs() {
  const consent = { samtykkeId: 'consent-1', personId: 'person-022' as const, formaal: 'Forberede vurdering av SFO-betaling', dataKilder: ['inntekt'], status: 'SAMTYKKET' as const, opprettet: now, utloper: '2099-01-01T00:00:00.000Z', sporingsId: 'trace', syntetisk: true as const };
  return {
    readHousehold: async () => snapshot({ husstandId: 'h1', type: 'Enslig forsørger', adresse: null, kommune: 'Oslo', kommunenummer: '0301', medlemmer: [{ personId: 'person-022', rolle: 'foresatt' }, { personId: 'person-023', rolle: 'barn' }], syntetisk: true as const }, 'household'),
    readSfo: async () => snapshot([{ personId: 'person-023', sfoId: 's1', sfonavn: 'Bolteløkka SFO', kommune: 'Oslo', trinn: 2, manedspris: 3400, syntetisk: true as const }], 'sfo'),
    readRates: async () => snapshot({ gjelderFra: '2026-08-01', kilde: 'KS', maksAndelAvInntekt: 0.06, maanederMedBetaling: 11, ordninger: [], syntetisk: true as const }, 'rates'),
    grantIncomeConsent: async () => snapshot(consent, 'consent'),
    readIncome: async () => snapshot({ inntektsaar: 2025, stadie: 'OPPGJOER' as const, beregningsbeloep: 152000, beregningstype: 'BARNEHAGE_SFO' as const, personer: [], visningsposter: [], inntekt: {}, fradrag: {}, feilmeldinger: [], syntetisk: true as const }, 'income'),
    readSfoAssessment: async () => snapshot({ godkjent: true, melding: 'Syntetisk resultat', grunnlag: { beregningsbeloep: 152000 } }, 'assessment'),
  } as unknown as NonNullable<Parameters<typeof consentAndReadIncome>[2]>;
}

test('catalogue exposes only requestable tools to the coordinator and never executors', () => {
  const visible = modelVisibleTools('coordinator', session());
  assert.deepEqual(visible.map(tool => tool.id), ['ks_connect', 'ks_income']);
  assert.ok(visible.every(tool => !('run' in tool) && tool.gate === 'consent' && tool.fetched === false));
  assert.ok(TOOL_CATALOGUE.every(tool => tool.kind !== 'compute' || tool.roles.length === 0), 'compute tools are never model-requestable');
});

test('a personalized SFO case asks for consent in the bot reply, whether or not the model remembered to request tools', async () => {
  for (const requests of [[{ tool: 'ks_connect' as ToolId, reason: 'Trenger SFO-plass' }, { tool: 'ks_income' as ToolId, reason: 'Trenger inntekt' }], undefined]) {
    const current = session();
    addMessage(current, 'Jeg mistet jobben og har barn');
    await analyzeCase(current, model(withChildren(current, plan(['family'], requests))), discard);
    assert.equal(current.status === 'error', false, current.error || '');
    assert.equal(current.services[0].formFlow?.stage, 'consent');
    assert.deepEqual(current.pendingConsents?.map(consent => consent.toolId), ['ks_connect', 'ks_income']);
    assert.equal(current.pendingConsents?.[0].requestedBy, requests ? 'model' : 'catalogue');
    const reply = current.messages.at(-1)!;
    assert.equal(reply.role, 'assistant');
    assert.match(reply.text, /redusert SFO-betaling/);
    assert.match(reply.text, /Vil du at jeg henter opplysninger for deg\?/);
    assert.match(reply.text, /Skatteetaten via KS Fiks/);
    assert.ok(current.events.some(event => event.type === 'tool-requested'));
    assert.equal(current.ksData, null, 'nothing is fetched before consent');
  }
});

test('tool requests outside the selected services or for information intent are ignored and logged', async () => {
  const housing = session();
  addMessage(housing, 'Jeg trenger hjelp med bostøtte');
  await analyzeCase(housing, model(plan(['housing'], [{ tool: 'ks_income', reason: 'x' }])), discard);
  assert.deepEqual(housing.pendingConsents, []);
  assert.ok(housing.events.some(event => event.type === 'blocked' && /ks_income/.test(event.detail)));
  assert.doesNotMatch(housing.messages.at(-1)!.text, /henter opplysninger/);

  const info = session();
  addMessage(info, 'Hva er reglene for redusert SFO?');
  await analyzeCase(info, model(plan(['family'], [{ tool: 'ks_connect', reason: 'x' }], 'information')), discard);
  assert.deepEqual(info.pendingConsents, []);
});

test('one consent click runs the integrations in dependency order and the draft application is filled on re-analysis', async () => {
  const current = session();
  addMessage(current, 'Jeg mistet jobben og har barn');
  await analyzeCase(current, model(withChildren(current, plan(['family']))), discard);
  const revision = current.revision;
  const client = fakeKs();
  const order: ToolId[] = [];
  const executors: ToolExecutors = {
    ks_connect: async target => { order.push('ks_connect'); await connectKs(target, client); },
    ks_income: async target => { order.push('ks_income'); await consentAndReadIncome(target, true, client, discard); },
  };
  const { executed } = await decideToolConsent(current, ['ks_income', 'ks_connect'], true, executors);
  assert.deepEqual(executed, ['ks_connect', 'ks_income']);
  assert.deepEqual(order, ['ks_connect', 'ks_income']);
  assert.deepEqual(current.pendingConsents, []);
  assert.ok(current.revision > revision, 'fetching new sources invalidates the analysis');
  assert.ok(current.events.some(event => event.agent === 'Verktøykatalog' && event.type === 'completed'));

  await analyzeCase(current, model(plan(['family'])), discard);
  const family = current.services.find(service => service.id === 'family')!;
  const draft = family.applicationDraft!;
  assert.equal(draft.title, 'Søknad om redusert foreldrebetaling i SFO (utkast)');
  const byKey = Object.fromEntries(draft.fields.map(field => [field.key, field]));
  assert.equal(byKey.sfo_place.value, 'Bolteløkka SFO, 2. trinn, 3400 kr/mnd');
  assert.equal(byKey.household_income_annual.status, 'filled');
  assert.equal(byKey.household_income_annual.sourceId, 'ks-income');
  assert.equal(byKey.income_basis.value, 'Hele husholdningens årsinntekt');
  assert.equal(byKey.job_lost.status, 'missing', 'unconfirmed facts never fill the form');
  assert.equal(byKey.submission.status, 'review');
  assert.equal(byKey.rule_result.value, 'Oppfyller vilkårene i sandkassen');
  assert.ok(draft.filled >= 6, `filled ${draft.filled}`);
  assert.deepEqual(current.pendingConsents, [], 'fetched tools are not offered again');
  assert.doesNotMatch(current.messages.at(-1)!.text, /henter opplysninger/);
  assert.equal(family.formFlow?.stage, 'collecting');
  assert.deepEqual(family.formFlow?.missing, ['job_lost']);
  assert.ok(current.questions.some(question => question.key === 'job_lost'), 'missing draft fields become follow-up questions');
  assert.match(current.messages.at(-1)!.text, /Søknadsutkastet for redusert SFO-betaling har \d+\/\d+ felt fylt/);
});

test('declining clears the pending consents and calls no integration; stale or invented ids are rejected', async () => {
  const current = session();
  addMessage(current, 'Jeg mistet jobben og har barn');
  await analyzeCase(current, model(withChildren(current, plan(['family']))), discard);
  let called = 0;
  const executors: ToolExecutors = { ks_connect: async () => { called++; }, ks_income: async () => { called++; } };
  await assert.rejects(decideToolConsent(current, ['read_guidance'], true, executors), /ingen ventende samtykkeforespørsel/);
  const { executed } = await decideToolConsent(current, ['ks_connect', 'ks_income'], false, executors);
  assert.deepEqual(executed, []);
  assert.equal(called, 0);
  assert.equal(current.ksAccessDecision?.status, 'declined');
  assert.deepEqual(current.pendingConsents, []);
  await assert.rejects(decideToolConsent(current, ['ks_connect'], true, executors), /ingen ventende/);
  assert.deepEqual(pendingConsentsFor({ ...current, intent: 'personalized' }, ['family'], ['ks_connect'], 3).consents, [], 'a declined case is not asked again');
});

test('consent text is Node-authored per language and the draft stays empty without data', () => {
  const consents = pendingConsentsFor({ ...session(), intent: 'personalized' }, ['family'], [], 1).consents;
  assert.match(consentParagraph(consents, 'en'), /^\*\*May I fetch information for you\?\*\* To prepare the application for reduced SFO payment I can fetch household/);
  assert.match(consentParagraph(consents, 'nb'), /Ingenting hentes før du velger ja/);
  assert.equal(consentParagraph([], 'nb'), '');
  const draft = applicationDraftFor('family', session())!;
  assert.equal(draft.filled, 0);
  assert.equal(applicationDraftFor('housing', session()), null);
});

test('eligibility loop: unknown asks first, consent follows, missing data is asked after the tools, then the draft is ready', async () => {
  const current = session();
  addMessage(current, 'Jeg mistet jobben');
  await analyzeCase(current, model(plan(['family'])), discard);
  let family = current.services.find(service => service.id === 'family')!;
  assert.equal(family.formFlow?.eligibility, 'unknown');
  assert.equal(family.formFlow?.stage, 'screening');
  assert.equal(current.pendingConsents?.length, 0, 'no consent is requested before eligibility is plausible');
  assert.equal(current.questions[0]?.key, 'uses_sfo');
  assert.match(current.messages.at(-1)!.text, /Kan du ha rett til redusert SFO-betaling\?/);
  assert.match(current.messages.at(-1)!.text, /Har du barn som bruker eller skal bruke SFO\?/);

  addConfirmedAnswers(current, 'Bruker SFO: Ja.', [{ key: 'uses_sfo', value: 'true', quote: 'Bruker SFO: Ja.' }]);
  await analyzeCase(current, model(plan(['family'])), discard);
  family = current.services.find(service => service.id === 'family')!;
  assert.equal(family.formFlow?.stage, 'consent');
  assert.deepEqual(current.pendingConsents?.map(consent => consent.toolId), ['ks_connect', 'ks_income']);
  assert.match(current.messages.at(-1)!.text, /Vil du at jeg henter opplysninger for deg\?/);

  const client = fakeKs();
  await decideToolConsent(current, ['ks_connect', 'ks_income'], true, {
    ks_connect: async target => { await connectKs(target, client); },
    ks_income: async target => { await consentAndReadIncome(target, true, client, discard); },
  });
  await analyzeCase(current, model(plan(['family'])), discard);
  family = current.services.find(service => service.id === 'family')!;
  assert.equal(family.formFlow?.stage, 'collecting');
  assert.deepEqual(family.formFlow?.missing, ['job_lost']);
  assert.ok(current.questions.some(question => question.key === 'job_lost'));
  assert.match(current.messages.at(-1)!.text, /Jeg mangler fortsatt: har mistet jobben/);

  addConfirmedAnswers(current, 'Har mistet jobben: Ja.', [{ key: 'job_lost', value: 'true', quote: 'Har mistet jobben: Ja.' }]);
  await analyzeCase(current, model(plan(['family'])), discard);
  family = current.services.find(service => service.id === 'family')!;
  assert.equal(family.formFlow?.stage, 'ready');
  assert.deepEqual(family.formFlow?.missing, []);
  assert.equal(family.applicationDraft?.fields.filter(field => field.status === 'missing').length, 0);
  assert.match(current.messages.at(-1)!.text, /Søknadsutkastet for redusert SFO-betaling er fylt ut/);
  assert.equal(current.pendingConsents?.length, 0);
});

test('a disqualifying screening answer stops the form without consent, and stated facts pull the form service in', async () => {
  const declined = session();
  addMessage(declined, 'Jeg mistet jobben');
  addConfirmedAnswers(declined, 'Bruker SFO: Nei.', [{ key: 'uses_sfo', value: 'false', quote: 'Bruker SFO: Nei.' }]);
  await analyzeCase(declined, model(plan(['family'])), discard);
  const family = declined.services.find(service => service.id === 'family')!;
  assert.equal(family.formFlow?.eligibility, 'unlikely');
  assert.equal(family.formFlow?.stage, 'not-applicable');
  assert.deepEqual(declined.pendingConsents, []);
  assert.match(declined.messages.at(-1)!.text, /ikke ut til å være aktuelt/);

  const routed = session();
  addMessage(routed, 'Jeg mistet jobben og har barn');
  await analyzeCase(routed, model(withChildren(routed, plan([]))), discard);
  assert.ok(routed.services.some(service => service.id === 'family'), 'a proposed has_children fact adds the family service for screening');
  assert.ok(routed.events.some(event => event.agent === 'Ruting' && /redusert SFO-betaling/.test(event.detail)));
  assert.equal(routed.services.find(service => service.id === 'family')?.formFlow?.stage, 'consent');
});

test('an information question never produces an application draft or a form stage', async () => {
  const info = session();
  addMessage(info, 'Hva er reglene for redusert SFO?');
  await analyzeCase(info, model(plan(['family'], undefined, 'information')), discard);
  const family = info.services.find(service => service.id === 'family')!;
  assert.equal(family.applicationDraft, null);
  assert.equal(family.formFlow, null);
  assert.doesNotMatch(info.messages.at(-1)!.text, /Søknadsutkast|henter opplysninger/);
});

test('declining consent moves the form to manual collection with its questions, without a model call', async () => {
  const current = session();
  addMessage(current, 'Jeg mistet jobben og har barn');
  await analyzeCase(current, model(withChildren(current, plan(['family']))), discard);
  assert.equal(current.services[0].formFlow?.stage, 'consent');
  const revision = current.revision;
  await decideToolConsent(current, ['ks_connect', 'ks_income'], false, { ks_connect: async () => assert.fail('no integration on decline') });
  assert.equal(current.revision, revision, 'a decline does not invalidate the analysis');
  assert.equal(current.services[0].formFlow?.stage, 'collecting');
  assert.ok(current.services[0].formFlow!.missing.includes('household_income_annual'));
  assert.ok(current.questions.some(question => question.key === 'household_income_annual'));
  assert.ok(current.questions.some(question => question.key === 'uses_sfo'));
});

test('an unrelated pending proposal does not keep the SFO form in collecting', async () => {
  const current = session();
  addMessage(current, 'Jeg mistet jobben og har barn i SFO. Husleien er 12000 kroner.');
  addConfirmedAnswers(current, 'Bruker SFO: Ja.\nHar mistet jobben: Ja.\nHusholdningens årsinntekt (kr): 300000 NOK.\nHva inntekten gjelder: Hele husholdningens årsinntekt.\nSamboer mangler i grunnlaget: Nei.', [
    { key: 'uses_sfo', value: 'true', quote: 'Bruker SFO: Ja.' }, { key: 'job_lost', value: 'true', quote: 'Har mistet jobben: Ja.' },
    { key: 'household_income_annual', value: '300000', quote: 'Husholdningens årsinntekt (kr): 300000 NOK.' },
    { key: 'income_basis', value: 'household_year', quote: 'Hva inntekten gjelder: Hele husholdningens årsinntekt.' },
    { key: 'cohabitant_missing', value: 'false', quote: 'Samboer mangler i grunnlaget: Nei.' },
  ]);
  const response = plan(['family', 'housing']);
  response.facts = [{ key: 'monthly_rent', value: '12000', sourceId: current.sources[0].id, quote: 'Husleien er 12000 kroner.' }];
  await analyzeCase(current, model(response), discard);
  assert.equal(current.facts.find(fact => fact.key === 'monthly_rent')?.status, 'proposed');
  await decideToolConsent(current, ['ks_connect', 'ks_income'], false, {});
  const family = current.services.find(service => service.id === 'family')!;
  assert.deepEqual(family.formFlow?.missing, []);
  assert.equal(family.formFlow?.stage, 'ready');
});
