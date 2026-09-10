import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { CaseError } from './case-service';
import type { ModelRole } from './assistant-model';
import type { ProviderId } from '../domain/assistant-types';

export const PROVIDER_IDS = ['cloudflare', 'telenor-ai-factory'] as const satisfies readonly ProviderId[];
export type Selection = { provider: ProviderId; model: string };

// Curated shortlist per leverandør; en ukjent modell avvises i stedet for å nå Python.
const MODEL_CATALOGUE: Record<ProviderId, readonly string[]> = {
  cloudflare: ['@cf/qwen/qwen3.8-27b', '@cf/google/gemma-4-26b-a4b-it'],
  'telenor-ai-factory': ['Qwen3-Coder-Next', 'GLM-5.2'],
};
function normalizedModel(provider: ProviderId, model: string) {
  return provider === 'cloudflare' ? model.replace(/^workers-ai\//, '') : model;
}
export function isKnownModel(provider: ProviderId, model: string) {
  return MODEL_CATALOGUE[provider].includes(normalizedModel(provider, model));
}
export function providerCatalogue() {
  return PROVIDER_IDS.map(provider => ({ provider, models: MODEL_CATALOGUE[provider] }));
}

function legacyCloudflareModel(role: ModelRole) {
  return (role === 'coordinator' ? process.env.LLM_COORDINATOR_MODEL : process.env.LLM_SPECIALIST_MODEL)
    || process.env.LLM_MODEL || (role === 'coordinator' ? '@cf/qwen/qwen3.8-27b' : '@cf/google/gemma-4-26b-a4b-it');
}
function defaultSelection(role: ModelRole): Selection {
  return { provider: 'cloudflare', model: legacyCloudflareModel(role) };
}

type Override = Partial<Record<ModelRole, Selection>>;
const overrideSchema = z.object({
  coordinator: z.object({ provider: z.enum(PROVIDER_IDS), model: z.string().min(1).max(200) }).strict().optional(),
  specialist: z.object({ provider: z.enum(PROVIDER_IDS), model: z.string().min(1).max(200) }).strict().optional(),
}).strict();

function overridePath() {
  const directory = resolve(/* turbopackIgnore: true */ join(process.env.ASSISTANT_DATA_DIR || '.data', 'state'));
  return { directory, file: join(directory, 'ai-provider-override.json') };
}
function readOverride(): Override {
  try {
    const parsed = overrideSchema.safeParse(JSON.parse(readFileSync(overridePath().file, 'utf8')));
    return parsed.success ? parsed.data : {};
  } catch { return {}; }
}
function writeOverride(override: Override) {
  const { directory, file } = overridePath();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(override), { mode: 0o600 });
}

export function activeSelection(role: ModelRole): Selection {
  const stored = readOverride()[role];
  if (stored && isKnownModel(stored.provider, stored.model)) return stored;
  return defaultSelection(role);
}
export function setActiveSelection(role: ModelRole, provider: ProviderId, model: string): Selection {
  if (!isKnownModel(provider, model)) throw new CaseError('Ukjent modell for valgt leverandør.', 400);
  const override = readOverride();
  override[role] = { provider, model };
  writeOverride(override);
  return override[role]!;
}
const candidateSchema = z.object({ role: z.enum(['coordinator', 'specialist']), provider: z.enum(PROVIDER_IDS), model: z.string().min(1).max(200) }).strict();
export function validateCandidate(value: unknown): { role: ModelRole; provider: ProviderId; model: string } {
  const parsed = candidateSchema.safeParse(value);
  if (!parsed.success) throw new CaseError('Ugyldig rolle, leverandør eller modell.', 400);
  if (!isKnownModel(parsed.data.provider, parsed.data.model)) throw new CaseError('Ukjent modell for valgt leverandør.', 400);
  return parsed.data;
}

function cloudflareConfigured() {
  const account = process.env.CF_ACCOUNT_ID || '';
  const token = process.env.CF_AI_GATEWAY_TOKEN || '';
  const gateway = process.env.CF_AI_GATEWAY_ID || 'default';
  return /^[a-f0-9]{32}$/i.test(account) && !!token && /^[a-zA-Z0-9_-]{1,64}$/.test(gateway);
}
function telenorConfigured() {
  const key = process.env.TELENOR_AI_FACTORY_API_KEY || '';
  if (!key) return false;
  try {
    const url = new URL(process.env.TELENOR_AI_FACTORY_BASE_URL || '');
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}
export function providerConfigured(provider: ProviderId) {
  return provider === 'cloudflare' ? cloudflareConfigured() : telenorConfigured();
}
export function requireConfigured(provider: ProviderId) {
  if (providerConfigured(provider)) return;
  if (provider === 'cloudflare') throw new Error('Legg inn CF_ACCOUNT_ID og CF_AI_GATEWAY_TOKEN i serverens .env.local og start appen på nytt.');
  throw new Error('Legg inn TELENOR_AI_FACTORY_BASE_URL og TELENOR_AI_FACTORY_API_KEY i serverens .env.local og start appen på nytt.');
}
/** Kjøres før pipelinen starter: en ukjent modell eller manglende nøkkel skal aldri feile halvveis i en agentkjøring. */
export function assertReady(role: ModelRole) {
  const { provider, model } = activeSelection(role);
  if (!isKnownModel(provider, model)) throw new CaseError(`Ukjent modell er valgt for rollen ${role}. Bytt modell i administrasjonspanelet.`, 400);
  requireConfigured(provider);
}
