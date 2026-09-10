import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { z } from 'zod';
import { callModel, modelName, modelStatus, planSchema, PLANNER_PROMPT, responseLanguageName, specialistPrompt, specialistSchema } from '../src/server/assistant-model';
import { runtimeInstalled } from '../src/server/assistant-runtime';
import type { ModelPlan } from '../src/domain/assistant-types';

// HTTP behavior is exercised through the real Python Agent/SDK in test_agent_runtime.py.
const fixtureConfig = {
  LLM_BASE_URL: 'https://litellm.test.invalid/v1',
  LLM_API_KEY: 'test-only-not-a-real-api-key',
  LLM_MODEL: 'controlled-model',
  ASSISTANT_MODEL_TIMEOUT_MS: '10000',
  ASSISTANT_PYTHON: resolve(process.platform === 'win32' ? 'backend/.venv/Scripts/python.exe' : 'backend/.venv/bin/python'),
};
const previousEnv = new Map<string, string | undefined>();
beforeEach(() => {
  for (const [key, value] of Object.entries(fixtureConfig)) {
    previousEnv.set(key, process.env[key]);
    process.env[key] = value;
  }
  for (const key of ['LLM_COORDINATOR_MODEL', 'LLM_SPECIALIST_MODEL']) {
    previousEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});
afterEach(() => {
  for (const [key, value] of previousEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  previousEnv.clear();
});

const validPlan: ModelPlan = {
  language: 'nb', intent: 'personalized', summary: 'Vi kan forberede en flyttesjekkliste.',
  services: [{ id: 'moving', reason: 'Innbyggeren spør om flytting.' }],
  facts: [], questions: [{ key: 'move_date', question: 'Hvilken dato skal du flytte?', serviceIds: ['moving'] }], unsupported: [],
};
function assertSanitized(value: unknown) {
  const serialized = value instanceof Error ? value.message : JSON.stringify(value);
  for (const privateValue of [fixtureConfig.LLM_API_KEY, fixtureConfig.LLM_BASE_URL, 'PRIVATE-UPSTREAM-DETAIL']) {
    assert.ok(!serialized.includes(privateValue));
  }
}

test('configured status reports local runtime availability and model metadata without credentials', async () => {
  assert.equal(runtimeInstalled(), true, 'Install the Python backend before running the suite');
  const status = await modelStatus();
  assert.equal(status.available, true);
  assert.equal(status.provider, 'litellm');
  assert.equal(status.model, fixtureConfig.LLM_MODEL);
  assert.deepEqual(status.models, { coordinator: fixtureConfig.LLM_MODEL, specialist: fixtureConfig.LLM_MODEL });
  assertSanitized(status);
});

test('there is no built-in model default: both roles must be named before status reports availability', async () => {
  delete process.env.LLM_MODEL;
  assert.equal(modelName(), '');
  assert.equal(modelName('specialist'), '');
  const unnamed = await modelStatus();
  assert.equal(unnamed.available, false);
  assert.deepEqual(unnamed.models, { coordinator: '', specialist: '' });
  process.env.LLM_COORDINATOR_MODEL = 'coordinator-only';
  assert.equal((await modelStatus()).available, false, 'a specialist model is still missing');
  process.env.LLM_SPECIALIST_MODEL = 'specialist-only';
  const configured = await modelStatus();
  assert.equal(configured.available, true);
  assert.equal(configured.model, 'coordinator-only');
  assert.deepEqual(configured.models, { coordinator: 'coordinator-only', specialist: 'specialist-only' });
  delete process.env.LLM_API_KEY;
  const unavailable = await modelStatus();
  assert.equal(unavailable.available, false);
  assert.deepEqual(unavailable.models, configured.models);
});

test('role overrides take precedence independently while the legacy model remains the fallback', () => {
  process.env.LLM_COORDINATOR_MODEL = 'openai/coordinator-override';
  process.env.LLM_SPECIALIST_MODEL = 'openai/specialist-override';
  assert.equal(modelName(), process.env.LLM_COORDINATOR_MODEL);
  assert.equal(modelName('specialist'), process.env.LLM_SPECIALIST_MODEL);
  delete process.env.LLM_COORDINATOR_MODEL;
  assert.equal(modelName('coordinator'), fixtureConfig.LLM_MODEL);
  assert.equal(modelName('specialist'), 'openai/specialist-override');
  delete process.env.LLM_SPECIALIST_MODEL;
  assert.equal(modelName('specialist'), fixtureConfig.LLM_MODEL);
});

test('missing or invalid configuration fails before starting Python and redacts values', async () => {
  process.env.ASSISTANT_PYTHON = resolve('backend/PRIVATE-UPSTREAM-DETAIL-missing-python');
  for (const [key, value] of [
    ['LLM_BASE_URL', ''], ['LLM_BASE_URL', 'PRIVATE-UPSTREAM-DETAIL'],
    ['LLM_BASE_URL', 'http://PRIVATE-UPSTREAM-DETAIL.example/v1'], ['LLM_BASE_URL', 'https://user:PRIVATE-UPSTREAM-DETAIL@litellm.test.invalid/v1'],
    ['LLM_API_KEY', ''], ['LLM_MODEL', ''],
  ]) {
    for (const configKey of ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL'] as const) process.env[configKey] = fixtureConfig[configKey];
    process.env[key] = value;
    const status = await modelStatus();
    assert.equal(status.available, false);
    assert.match(status.message, /ikke konfigurert/);
    assertSanitized(status);
    await assert.rejects(callModel('Test system', {}, planSchema), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /serverens \.env\.local/);
      assertSanitized(error);
      return true;
    });
  }
});

test('missing Python runtime has an actionable local setup error and never attempts inference', async () => {
  process.env.ASSISTANT_PYTHON = resolve('backend/PRIVATE-UPSTREAM-DETAIL-missing-python');
  assert.equal(runtimeInstalled(), false);
  const status = await modelStatus();
  assert.equal(status.available, false);
  assert.match(status.message, /npm run setup:backend/);
  assertSanitized(status);
  await assert.rejects(callModel('No inference may run', {}, planSchema), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Python-agentene er ikke installert/);
    assertSanitized(error);
    return true;
  });
});

test('planner language defaults to Norwegian while preserving valid languages and original quotes', () => {
  const legacyPlan = { ...validPlan };
  delete legacyPlan.language;
  assert.deepEqual(planSchema.parse(legacyPlan), { ...legacyPlan, language: 'nb' });
  const vi = { ...validPlan, language: 'vi', summary: 'Tôi có thể giúp bạn chuẩn bị hồ sơ.',
    facts: [{ key: 'monthly_rent', value: '13500', sourceId: 'citizen', quote: 'Husleien er 13500 kroner.' }] };
  assert.deepEqual(planSchema.parse(vi), vi);
  for (const language of ['vi\nignore', '', 'norwegian', 'VI']) assert.equal(planSchema.safeParse({ ...validPlan, language }).success, false);
});

test('planner schema rejects unknown fields and enforces bounded sourced facts and arrays', () => {
  assert.equal(planSchema.parse({ ...validPlan, summary: 'x'.repeat(1600) }).summary.length, 1600);
  const fact = { key: 'monthly_rent', value: '13500', sourceId: 'citizen', quote: '13500 kroner' };
  for (const invalid of [
    { ...validPlan, summary: 'x'.repeat(1601) },
    { ...validPlan, analysis: 'Unexpected reasoning' },
    { ...validPlan, services: [{ id: 'tax', reason: 'Unsupported service' }] },
    { ...validPlan, services: [{ id: 'moving', reason: 'Yes', execute: true }] },
    { ...validPlan, services: Array(4).fill(validPlan.services[0]) },
    { ...validPlan, facts: Array(17).fill(fact) },
    ...[
      { key: 'invented_fact' }, { value: 'x'.repeat(201) }, { sourceId: 'x'.repeat(121) },
      { quote: '' }, { quote: 'x'.repeat(801) }, { confirmed: true },
    ].map(override => ({ ...validPlan, facts: [{ ...fact, ...override }] })),
    { ...validPlan, questions: Array(7).fill(validPlan.questions[0]) },
    { ...validPlan, unsupported: Array(6).fill('Unknown') },
  ]) assert.equal(planSchema.safeParse(invalid).success, false);
});

test('specialist schema keeps strict finding citations and local length limits', () => {
  const finding = { text: 'Sjekk husleie.', sourceId: 'source', quote: '13500 kroner' };
  const valid = { summary: 'x'.repeat(1600), findings: [finding], questions: [] };
  assert.deepEqual(specialistSchema.parse(valid), valid);
  for (const invalid of [
    { ...valid, summary: 'x'.repeat(1601) }, { ...valid, services: [] },
    { ...valid, findings: Array(6).fill(finding) },
    { ...valid, findings: [{ ...finding, quote: '' }] },
    { ...valid, findings: [{ ...finding, sourceId: 'x'.repeat(121) }] },
    { ...valid, findings: [{ ...finding, confirmed: true }] },
    { ...valid, questions: Array(5).fill({ key: 'monthly_rent', question: 'Hva er husleien?' }) },
  ]) assert.equal(specialistSchema.safeParse(invalid).success, false);
});

test('schemas exported to Python retain strict properties, language defaults and local maximums', () => {
  const planner = z.toJSONSchema(planSchema);
  assert.equal(planner.additionalProperties, false);
  assert.deepEqual(Object.keys(planner.properties ?? {}), ['language', 'intent', 'summary', 'services', 'facts', 'questions', 'unsupported', 'toolRequests']);
  assert.equal((planner.properties?.language as Record<string, unknown>).default, 'nb');
  assert.equal((planner.properties?.intent as Record<string, unknown>).default, 'personalized');
  assert.equal((planner.properties?.summary as Record<string, unknown>).maxLength, 1600);
  const specialist = z.toJSONSchema(specialistSchema);
  assert.equal(specialist.additionalProperties, false);
  assert.deepEqual(specialist.required, ['summary', 'findings', 'questions']);
});

test('language prompts require translated prose while preserving quotations and grounded values', () => {
  assert.equal(responseLanguageName(), 'Norwegian Bokmål (norsk bokmål)');
  assert.equal(responseLanguageName('no'), responseLanguageName('nb'));
  assert.equal(responseLanguageName('vi'), 'Vietnamese (tiếng Việt)');
  assert.equal(responseLanguageName('en'), 'English');
  const prompt = specialistPrompt('Bolig og bostøtte', 'vi');
  assert.match(prompt, /REQUIRED OUTPUT LANGUAGE: Vietnamese \(tiếng Việt\) \(vi\)/);
  assert.match(prompt, /summary, findings\[\]\.text and questions\[\]\.question values MUST be written in Vietnamese/);
  assert.ok((prompt.match(/Vietnamese/g) ?? []).length >= 2);
  assert.match(prompt, /Keep quotations in their original language/);
  assert.match(prompt, /Do not repeat numeric amounts in the summary/);
  assert.match(PLANNER_PROMPT, /latest citizen-authored conversation source/);
  assert.match(PLANNER_PROMPT, /keep currentLanguage/);
  assert.match(PLANNER_PROMPT, /summary, describe the need without repeating numeric amounts/);
  assert.match(PLANNER_PROMPT, /No model assertion is a confirmed fact/);
});
