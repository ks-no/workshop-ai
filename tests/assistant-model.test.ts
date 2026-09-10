import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { z } from 'zod';
import { aiProvider, callModel, maxRevisions, modelName, modelStatus, planSchema, responseLanguageName, specialistPrompt, specialistSchema, TRIAGE_PROMPT } from '../src/server/assistant-model';
import { runtimeInstalled } from '../src/server/assistant-runtime';
import type { ModelPlan } from '../src/domain/assistant-types';

// HTTP behavior is exercised through the real Python Agent/SDK in test_agent_runtime.py.
const fixtureConfig = {
  CF_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  CF_AI_GATEWAY_TOKEN: 'test-only-not-a-real-cloudflare-token',
  CF_AI_GATEWAY_ID: 'adapter-tests',
  LLM_MODEL: 'workers-ai/@cf/google/gemma-4-26b-a4b-it',
  ASSISTANT_MODEL_TIMEOUT_MS: '10000',
  ASSISTANT_PYTHON: resolve(process.platform === 'win32' ? 'backend/.venv/Scripts/python.exe' : 'backend/.venv/bin/python'),
};
const telenorFixture = {
  TELENOR_AI_FACTORY_BASE_URL: 'https://abc123.execute-api.eu-north-1.amazonaws.com/prod',
  TELENOR_AI_FACTORY_API_KEY: 'test-only-not-a-real-telenor-key',
};
// Every key a test in this file might set gets a clean slate here and an automatic restore in
// afterEach, so a test only has to set what it needs and never has to remember to unset it.
const volatileKeys = ['LLM_TRIAGE_MODEL', 'LLM_DRAFT_MODEL', 'LLM_CRITIC_MODEL', 'LLM_POLISH_MODEL',
  'LLM_COORDINATOR_MODEL', 'LLM_SPECIALIST_MODEL', 'AI_PROVIDER',
  'TELENOR_AI_FACTORY_BASE_URL', 'TELENOR_AI_FACTORY_API_KEY', 'ASSISTANT_MAX_REVISIONS'];
const previousEnv = new Map<string, string | undefined>();
beforeEach(() => {
  for (const [key, value] of Object.entries(fixtureConfig)) {
    previousEnv.set(key, process.env[key]);
    process.env[key] = value;
  }
  for (const key of volatileKeys) {
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
  for (const privateValue of [fixtureConfig.CF_AI_GATEWAY_TOKEN, fixtureConfig.CF_ACCOUNT_ID, fixtureConfig.CF_AI_GATEWAY_ID,
    telenorFixture.TELENOR_AI_FACTORY_API_KEY, telenorFixture.TELENOR_AI_FACTORY_BASE_URL, 'PRIVATE-UPSTREAM-DETAIL']) {
    assert.ok(!serialized.includes(privateValue));
  }
}

test('configured status reports local runtime availability and model metadata without credentials', async () => {
  assert.equal(runtimeInstalled(), true, 'Install the Python backend before running the suite');
  const status = await modelStatus();
  assert.equal(status.available, true);
  assert.equal(status.provider, 'cloudflare');
  assert.equal(status.model, fixtureConfig.LLM_MODEL);
  assert.deepEqual(status.models, { triage: fixtureConfig.LLM_MODEL, draft: fixtureConfig.LLM_MODEL, critic: fixtureConfig.LLM_MODEL, polish: fixtureConfig.LLM_MODEL });
  assertSanitized(status);
});

test('role defaults use Qwen for triage/critic/polish and Gemma for draft, and appear in status', async () => {
  delete process.env.LLM_MODEL;
  const expected = { triage: '@cf/qwen/qwen3.8-27b', draft: '@cf/google/gemma-4-26b-a4b-it', critic: '@cf/qwen/qwen3.8-27b', polish: '@cf/qwen/qwen3.8-27b' };
  assert.equal(modelName(), expected.triage);
  assert.equal(modelName('triage'), expected.triage);
  assert.equal(modelName('draft'), expected.draft);
  assert.equal(modelName('critic'), expected.critic);
  assert.equal(modelName('polish'), expected.polish);
  const configured = await modelStatus();
  assert.equal(configured.model, expected.triage);
  assert.deepEqual(configured.models, expected);
  delete process.env.CF_AI_GATEWAY_TOKEN;
  const unavailable = await modelStatus();
  assert.equal(unavailable.available, false);
  assert.deepEqual(unavailable.models, expected);
});

test('per-role env overrides take precedence independently for all four roles', () => {
  process.env.LLM_TRIAGE_MODEL = 'workers-ai/@cf/test/triage-override';
  process.env.LLM_DRAFT_MODEL = 'workers-ai/@cf/test/draft-override';
  process.env.LLM_CRITIC_MODEL = 'workers-ai/@cf/test/critic-override';
  process.env.LLM_POLISH_MODEL = 'workers-ai/@cf/test/polish-override';
  assert.equal(modelName('triage'), process.env.LLM_TRIAGE_MODEL);
  assert.equal(modelName('draft'), process.env.LLM_DRAFT_MODEL);
  assert.equal(modelName('critic'), process.env.LLM_CRITIC_MODEL);
  assert.equal(modelName('polish'), process.env.LLM_POLISH_MODEL);
});

test('the legacy coordinator/specialist env vars still work as the fallback under the new roles', () => {
  process.env.LLM_COORDINATOR_MODEL = 'workers-ai/@cf/test/coordinator-legacy';
  process.env.LLM_SPECIALIST_MODEL = 'workers-ai/@cf/test/specialist-legacy';
  assert.equal(modelName('triage'), process.env.LLM_COORDINATOR_MODEL);
  assert.equal(modelName('critic'), process.env.LLM_COORDINATOR_MODEL);
  assert.equal(modelName('polish'), process.env.LLM_COORDINATOR_MODEL);
  assert.equal(modelName('draft'), process.env.LLM_SPECIALIST_MODEL);
  // A per-role override still wins over the legacy fallback.
  process.env.LLM_TRIAGE_MODEL = 'workers-ai/@cf/test/triage-override';
  assert.equal(modelName('triage'), process.env.LLM_TRIAGE_MODEL);
});

test('LLM_MODEL is the last fallback before the provider default, below both legacy and per-role vars', () => {
  assert.equal(modelName('triage'), fixtureConfig.LLM_MODEL);
  assert.equal(modelName('draft'), fixtureConfig.LLM_MODEL);
  process.env.LLM_COORDINATOR_MODEL = 'workers-ai/@cf/test/coordinator-legacy';
  assert.equal(modelName('triage'), process.env.LLM_COORDINATOR_MODEL);
  delete process.env.LLM_COORDINATOR_MODEL;
  assert.equal(modelName('triage'), fixtureConfig.LLM_MODEL);
  delete process.env.LLM_MODEL;
  assert.equal(modelName('triage'), '@cf/qwen/qwen3.8-27b');
  assert.equal(modelName('draft'), '@cf/google/gemma-4-26b-a4b-it');
});

test('aiProvider defaults to cloudflare, accepts telenor case-insensitively and with surrounding whitespace, and treats anything else as cloudflare', () => {
  assert.equal(aiProvider(), 'cloudflare');
  for (const value of ['telenor', 'TELENOR', 'Telenor', ' telenor ', '\ttelenor\n']) {
    process.env.AI_PROVIDER = value;
    assert.equal(aiProvider(), 'telenor', `expected ${JSON.stringify(value)} to select telenor`);
  }
  for (const value of ['cloudflare', 'openai', 'unknown-provider', '']) {
    process.env.AI_PROVIDER = value;
    assert.equal(aiProvider(), 'cloudflare', `expected ${JSON.stringify(value)} to fall back to cloudflare`);
  }
});

test('Telenor defaults appear in modelStatus when AI_PROVIDER=telenor', async () => {
  delete process.env.LLM_MODEL;
  process.env.AI_PROVIDER = 'telenor';
  const expected = { triage: 'Qwen3-Coder-Next-FP8', draft: 'GLM-5.2-FP8', critic: 'Qwen3-Coder-Next-FP8', polish: 'Qwen3-Coder-Next-FP8' };
  const status = await modelStatus();
  assert.equal(status.provider, 'telenor');
  assert.equal(status.model, expected.triage);
  assert.deepEqual(status.models, expected);
  assertSanitized(status);
});

test('maxRevisions defaults to 2, clamps to 1..5, falls back on non-numeric input and truncates a float', () => {
  delete process.env.ASSISTANT_MAX_REVISIONS;
  assert.equal(maxRevisions(), 2);
  for (const [input, expected] of [['1', 1], ['5', 5], ['0', 1], ['-3', 1], ['9', 5], ['not-a-number', 2], ['2.7', 2]] as const) {
    process.env.ASSISTANT_MAX_REVISIONS = input;
    assert.equal(maxRevisions(), expected, `expected ASSISTANT_MAX_REVISIONS=${input} to resolve to ${expected}`);
  }
});

test('Telenor configuration is fail-closed: only an https execute-api/telenor host with a non-empty key is available', async () => {
  process.env.AI_PROVIDER = 'telenor';
  process.env.TELENOR_AI_FACTORY_BASE_URL = telenorFixture.TELENOR_AI_FACTORY_BASE_URL;
  process.env.TELENOR_AI_FACTORY_API_KEY = telenorFixture.TELENOR_AI_FACTORY_API_KEY;
  const valid = await modelStatus();
  assert.equal(valid.available, true);
  assert.equal(valid.provider, 'telenor');
  assertSanitized(valid);

  for (const [key, value] of [
    ['TELENOR_AI_FACTORY_BASE_URL', ''],
    ['TELENOR_AI_FACTORY_BASE_URL', telenorFixture.TELENOR_AI_FACTORY_BASE_URL.replace('https://', 'http://')],
    ['TELENOR_AI_FACTORY_BASE_URL', 'https://evil.example.com/prod'],
    ['TELENOR_AI_FACTORY_BASE_URL', `${telenorFixture.TELENOR_AI_FACTORY_BASE_URL}?token=x`],
    ['TELENOR_AI_FACTORY_API_KEY', ''],
  ] as const) {
    process.env.TELENOR_AI_FACTORY_BASE_URL = telenorFixture.TELENOR_AI_FACTORY_BASE_URL;
    process.env.TELENOR_AI_FACTORY_API_KEY = telenorFixture.TELENOR_AI_FACTORY_API_KEY;
    process.env[key] = value;
    const status = await modelStatus();
    assert.equal(status.available, false, `expected ${key}=${JSON.stringify(value)} to be rejected`);
    assertSanitized(status);
  }
});

test('missing or invalid configuration fails before starting Python and redacts values', async () => {
  process.env.ASSISTANT_PYTHON = resolve('backend/PRIVATE-UPSTREAM-DETAIL-missing-python');
  for (const [key, value] of [
    ['CF_ACCOUNT_ID', ''], ['CF_ACCOUNT_ID', 'PRIVATE-UPSTREAM-DETAIL/invalid-account'],
    ['CF_AI_GATEWAY_TOKEN', ''], ['CF_AI_GATEWAY_ID', '../PRIVATE-UPSTREAM-DETAIL'],
  ]) {
    for (const configKey of ['CF_ACCOUNT_ID', 'CF_AI_GATEWAY_TOKEN', 'CF_AI_GATEWAY_ID'] as const) process.env[configKey] = fixtureConfig[configKey];
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
  assert.deepEqual(Object.keys(planner.properties ?? {}), ['language', 'intent', 'summary', 'services', 'facts', 'questions', 'unsupported']);
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
  assert.match(TRIAGE_PROMPT, /latest citizen-authored conversation source/);
  assert.match(TRIAGE_PROMPT, /keep currentLanguage/);
  assert.match(TRIAGE_PROMPT, /summary, describe the need without repeating numeric amounts/);
  assert.match(TRIAGE_PROMPT, /No model assertion is a confirmed fact/);
});
