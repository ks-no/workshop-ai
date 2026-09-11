import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { CaseError } from './case-service';
import { aiProvider, configuredModelName } from './assistant-model';
import { modelRoles, type AiProvider, type ModelRole } from '../domain/assistant-types';

// Only the leverandører with a curated model list can be switched in drift; a generic
// LiteLLM endpoint is configured in .env.local and has no shortlist to offer.
export const PROVIDER_IDS = ['cloudflare', 'telenor'] as const satisfies readonly AiProvider[];
export type ProviderId = typeof PROVIDER_IDS[number];
export type Selection = { provider: AiProvider; model: string };

// Curated shortlist per leverandør; en ukjent modell avvises i stedet for å nå Python.
const MODEL_CATALOGUE: Record<ProviderId, readonly string[]> = {
  cloudflare: ['@cf/qwen/qwen3.8-27b', '@cf/google/gemma-4-26b-a4b-it'],
  telenor: ['Qwen3-Coder-Next', 'Qwen3-Coder-Next-FP8', 'GLM-5.2', 'GLM-5.2-FP8'],
};
function switchable(provider: AiProvider): provider is ProviderId {
  return (PROVIDER_IDS as readonly AiProvider[]).includes(provider);
}
function normalizedModel(provider: AiProvider, model: string) {
  return provider === 'cloudflare' ? model.replace(/^workers-ai\//, '') : model;
}
export function isKnownModel(provider: AiProvider, model: string) {
  return switchable(provider) ? MODEL_CATALOGUE[provider].includes(normalizedModel(provider, model)) : !!model;
}
export function providerCatalogue() {
  return PROVIDER_IDS.map(provider => ({ provider, models: MODEL_CATALOGUE[provider] }));
}

function defaultSelection(role: ModelRole): Selection {
  return { provider: aiProvider(), model: configuredModelName(role) };
}

type Override = Partial<Record<ModelRole, Selection>>;
const selectionSchema = z.object({ provider: z.enum(PROVIDER_IDS), model: z.string().min(1).max(200) }).strict();
const overrideSchema = z.object({
  triage: selectionSchema.optional(), draft: selectionSchema.optional(),
  critic: selectionSchema.optional(), polish: selectionSchema.optional(),
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
export function setActiveSelection(role: ModelRole, provider: AiProvider, model: string): Selection {
  if (!switchable(provider) || !isKnownModel(provider, model)) throw new CaseError('Ukjent modell for valgt leverandør.', 400);
  const override = readOverride();
  override[role] = { provider, model };
  writeOverride(override);
  return override[role]!;
}
const candidateSchema = z.object({ role: z.enum(modelRoles), provider: z.enum(PROVIDER_IDS), model: z.string().min(1).max(200) }).strict();
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
function secureBase(value: string, allowLoopback: boolean) {
  try {
    const url = new URL(value.trim());
    if (url.username || url.password) return false;
    return url.protocol === 'https:' || (allowLoopback && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  } catch { return false; }
}
// Same allowlist as Python's TELENOR_HOSTNAME_PATTERN: only Telenor's own AWS API Gateway or telenor.no/com hosts.
const TELENOR_HOST = /^[a-z0-9][a-z0-9.-]*\.(?:execute-api\.[a-z0-9-]+\.amazonaws\.com|telenor\.(?:no|com))$/i;
export function providerConfigured(provider: AiProvider) {
  if (provider === 'cloudflare') return cloudflareConfigured();
  if (provider === 'litellm') return !!process.env.LLM_API_KEY && secureBase(process.env.LLM_BASE_URL || '', true);
  if (!secureBase(process.env.TELENOR_AI_FACTORY_BASE_URL || '', false)) return false;
  const host = (() => { try { return new URL((process.env.TELENOR_AI_FACTORY_BASE_URL || '').trim()).hostname; } catch { return ''; } })();
  return !!process.env.TELENOR_AI_FACTORY_API_KEY && TELENOR_HOST.test(host);
}
export function requireConfigured(provider: AiProvider) {
  if (providerConfigured(provider)) return;
  if (provider === 'cloudflare') throw new Error('Legg inn CF_ACCOUNT_ID og CF_AI_GATEWAY_TOKEN i serverens .env.local og start appen på nytt.');
  if (provider === 'litellm') throw new Error('Legg inn LLM_BASE_URL, LLM_API_KEY og LLM_MODEL i serverens .env.local og start appen på nytt.');
  throw new Error('Legg inn TELENOR_AI_FACTORY_BASE_URL og TELENOR_AI_FACTORY_API_KEY i serverens .env.local og start appen på nytt.');
}
/** Kjøres før pipelinen starter: en ukjent modell eller manglende nøkkel skal aldri feile halvveis i en agentkjøring. */
export function assertReady(role: ModelRole) {
  const { provider, model } = activeSelection(role);
  if (!isKnownModel(provider, model)) throw new CaseError(`Ukjent modell er valgt for rollen ${role}. Bytt modell i administrasjonspanelet.`, 400);
  requireConfigured(provider);
}
