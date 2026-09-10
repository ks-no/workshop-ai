import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activeSelection, assertReady, providerCatalogue, providerConfigured, setActiveSelection, validateCandidate } from '../src/server/assistant-providers';
import { CaseError } from '../src/server/case-service';

const directory = mkdtempSync(join(tmpdir(), 'assistant-providers-tests-'));
const fixtureConfig = {
  CF_ACCOUNT_ID: '0123456789abcdef0123456789abcdef', CF_AI_GATEWAY_TOKEN: 'test-only-not-a-real-cloudflare-token', CF_AI_GATEWAY_ID: 'provider-tests',
  TELENOR_AI_FACTORY_BASE_URL: 'https://ai-factory.telenor.test', TELENOR_AI_FACTORY_API_KEY: 'test-only-not-a-real-telenor-key',
  ASSISTANT_DATA_DIR: directory,
};
const previousEnv = new Map<string, string | undefined>();
beforeEach(() => {
  for (const [key, value] of Object.entries(fixtureConfig)) { previousEnv.set(key, process.env[key]); process.env[key] = value; }
});
afterEach(() => {
  for (const [key, value] of previousEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  previousEnv.clear();
  rmSync(join(directory, 'state'), { recursive: true, force: true });
});

test('catalogue lists both leverandører with their curated modeller', () => {
  const catalogue = providerCatalogue();
  assert.deepEqual(catalogue.map(entry => entry.provider), ['cloudflare', 'telenor-ai-factory']);
  assert.ok(catalogue.find(entry => entry.provider === 'telenor-ai-factory')!.models.includes('Qwen3-Coder-Next'));
});

test('active selection falls back to the legacy Cloudflare env chain with no override stored', () => {
  process.env.LLM_MODEL = 'workers-ai/@cf/google/gemma-4-26b-a4b-it';
  delete process.env.LLM_COORDINATOR_MODEL; delete process.env.LLM_SPECIALIST_MODEL;
  assert.deepEqual(activeSelection('coordinator'), { provider: 'cloudflare', model: 'workers-ai/@cf/google/gemma-4-26b-a4b-it' });
});

test('a switch persists under ASSISTANT_DATA_DIR and takes effect on the next call without a restart', () => {
  const selection = setActiveSelection('specialist', 'telenor-ai-factory', 'GLM-5.2');
  assert.deepEqual(selection, { provider: 'telenor-ai-factory', model: 'GLM-5.2' });
  assert.deepEqual(activeSelection('specialist'), selection);
  assert.deepEqual(activeSelection('coordinator').provider, 'cloudflare', 'the other role keeps its own selection');
  const stored = JSON.parse(readFileSync(join(directory, 'state', 'ai-provider-override.json'), 'utf8'));
  assert.deepEqual(stored.specialist, selection);
});

test('an unknown leverandør or modell is rejected with 400 and a Norwegian message, and never becomes active', () => {
  for (const candidate of [
    { role: 'coordinator', provider: 'openai', model: 'gpt-4o' },
    { role: 'coordinator', provider: 'telenor-ai-factory', model: 'not-a-real-model' },
    { role: 'sideloaded', provider: 'cloudflare', model: '@cf/qwen/qwen3.8-27b' },
  ]) {
    assert.throws(() => validateCandidate(candidate), (error: unknown) => {
      assert.ok(error instanceof CaseError);
      assert.equal(error.status, 400);
      assert.match(error.message, /[æøå]/);
      return true;
    });
  }
  assert.throws(() => setActiveSelection('coordinator', 'telenor-ai-factory', 'not-a-real-model'));
  assert.equal(activeSelection('coordinator').provider, 'cloudflare');
});

test('a corrupted override file is ignored rather than trusted', () => {
  mkdirSync(join(directory, 'state'), { recursive: true });
  writeFileSync(join(directory, 'state', 'ai-provider-override.json'), '{ not valid json');
  assert.equal(activeSelection('coordinator').provider, 'cloudflare');
});

test('provider readiness reflects only presence, never leaks the configured values', () => {
  assert.equal(providerConfigured('cloudflare'), true);
  assert.equal(providerConfigured('telenor-ai-factory'), true);
  delete process.env.TELENOR_AI_FACTORY_API_KEY;
  assert.equal(providerConfigured('telenor-ai-factory'), false);
  process.env.TELENOR_AI_FACTORY_API_KEY = fixtureConfig.TELENOR_AI_FACTORY_API_KEY;
  process.env.TELENOR_AI_FACTORY_BASE_URL = 'http://ai-factory.telenor.test';
  assert.equal(providerConfigured('telenor-ai-factory'), false, 'must require https, never an arbitrary or plaintext base URL');
});

test('assertReady fails closed on a missing key or an unknown active model, before any pipeline runs', () => {
  delete process.env.CF_AI_GATEWAY_TOKEN;
  assert.throws(() => assertReady('coordinator'));
  process.env.CF_AI_GATEWAY_TOKEN = fixtureConfig.CF_AI_GATEWAY_TOKEN;
  assertReady('coordinator');
  setActiveSelection('specialist', 'telenor-ai-factory', 'Qwen3-Coder-Next');
  assertReady('specialist');
  delete process.env.TELENOR_AI_FACTORY_API_KEY;
  assert.throws(() => assertReady('specialist'), /Telenor|\.env\.local/);
});
