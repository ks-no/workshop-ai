import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { GET, POST } from '../src/app/api/assistant/admin/route';
import { activeSelection } from '../src/server/assistant-providers';

const directory = mkdtempSync(join(tmpdir(), 'assistant-admin-tests-'));
const localOrigin = 'http://127.0.0.1:3210';
const fixtureConfig = {
  CF_ACCOUNT_ID: '0123456789abcdef0123456789abcdef', CF_AI_GATEWAY_TOKEN: 'test-only-not-a-real-cloudflare-token', CF_AI_GATEWAY_ID: 'admin-tests',
  TELENOR_AI_FACTORY_BASE_URL: 'https://test123.execute-api.eu-north-1.amazonaws.com/prod', TELENOR_AI_FACTORY_API_KEY: 'test-only-not-a-real-telenor-key',
  ASSISTANT_DATA_DIR: directory, ASSISTANT_ADMIN_ENABLED: 'true',
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

function getRequest(origin = localOrigin) {
  return new NextRequest(`${origin}/api/assistant/admin`, { headers: { Host: new URL(origin).host } });
}
function postRequest(body: unknown, origin = localOrigin, headers: Record<string, string> = {}) {
  return new NextRequest(`${origin}/api/assistant/admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, Host: new URL(origin).host, ...headers },
    body: JSON.stringify(body),
  });
}

test('admin endpoint is off by default even for a localhost caller', async () => {
  delete process.env.ASSISTANT_ADMIN_ENABLED;
  const getResponse = await GET(getRequest());
  assert.equal(getResponse.status, 404);
  assert.match((await getResponse.json()).error, /[æøå]/);
  const postResponse = await POST(postRequest({ role: 'triage', provider: 'cloudflare', model: '@cf/qwen/qwen3.8-27b' }));
  assert.equal(postResponse.status, 404);
});

test('admin endpoint rejects a non-localhost caller even when enabled', async () => {
  const response = await GET(getRequest('http://example.com'));
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /localhost/);
});

test('GET returns the leverandørkatalog and role status without leaking configured secrets', async () => {
  const response = await GET(getRequest());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.catalogue.map((entry: { provider: string }) => entry.provider), ['cloudflare', 'telenor']);
  assert.equal(body.model.roles.triage.keyConfigured, true);
  assert.equal(body.model.roles.draft.keyConfigured, true);
  const serialized = JSON.stringify(body);
  for (const secret of [fixtureConfig.CF_AI_GATEWAY_TOKEN, fixtureConfig.TELENOR_AI_FACTORY_API_KEY, fixtureConfig.TELENOR_AI_FACTORY_BASE_URL]) {
    assert.ok(!serialized.includes(secret), `response must never include ${secret}`);
  }
});

test('POST switches the active provider and model for a role without a restart, reflected on the next GET', async () => {
  const postResponse = await POST(postRequest({ role: 'draft', provider: 'telenor', model: 'GLM-5.2' }));
  assert.equal(postResponse.status, 200);
  const posted = await postResponse.json();
  assert.deepEqual(posted.model.roles.draft, { provider: 'telenor', model: 'GLM-5.2', keyConfigured: true });
  assert.deepEqual(activeSelection('draft'), { provider: 'telenor', model: 'GLM-5.2' });
  const getResponse = await GET(getRequest());
  assert.deepEqual((await getResponse.json()).model.roles.draft.model, 'GLM-5.2');
});

test('POST rejects a cross-site request even when the admin function is enabled', async () => {
  const response = await POST(postRequest({ role: 'triage', provider: 'cloudflare', model: '@cf/qwen/qwen3.8-27b' }, localOrigin, { Origin: 'http://evil.example' }));
  assert.equal(response.status, 403);
  assert.equal(activeSelection('triage').provider, 'cloudflare');
});

test('POST fails closed on an unknown provider or model with 400 and a Norwegian message, and never activates it', async () => {
  const response = await POST(postRequest({ role: 'triage', provider: 'telenor', model: 'not-a-real-model' }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /[æøå]/);
  assert.equal(activeSelection('triage').provider, 'cloudflare');
});

test('POST requires a JSON content type', async () => {
  const response = await POST(postRequest({ role: 'triage', provider: 'cloudflare', model: '@cf/qwen/qwen3.8-27b' }, localOrigin, { 'Content-Type': 'text/plain' }));
  assert.equal(response.status, 415);
});
