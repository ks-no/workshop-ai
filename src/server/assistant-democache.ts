import { createHash } from 'node:crypto';
import type { ServiceId } from '../domain/assistant-types';
import standardSak from './democache-standardsak.json';

export type DemocacheEntry = {
  personId: string; triggerMessage: string; language: string;
  serviceId: ServiceId; reason: string; summary: string; serviceSummary: string; answer: string;
};
const entries: DemocacheEntry[] = [standardSak as DemocacheEntry];

function normalize(message: string) {
  return message.trim().toLocaleLowerCase('nb-NO').replace(/\s+/gu, ' ');
}
function hashKey(message: string, personId: string) {
  return createHash('sha256').update(`${personId}:${normalize(message)}`).digest('hex');
}
const byHash = new Map(entries.map(entry => [hashKey(entry.triggerMessage, entry.personId), entry]));

/** Exact hash match only: the cache must never answer a case it wasn't given verbatim. */
export function lookupDemocache(message: string, personId: string): DemocacheEntry | null {
  return byHash.get(hashKey(message, personId)) ?? null;
}

const MIN_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_TIMEOUT_MS = 20_000;
/** How long the live model gets before the safety net takes over. Clamped like the other assistant-model.ts timeouts. */
export function democacheTimeoutMs() {
  const raw = Number(process.env.ASSISTANT_DEMOCACHE_TIMEOUT_MS);
  return Number.isFinite(raw) ? Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, raw)) : DEFAULT_TIMEOUT_MS;
}
