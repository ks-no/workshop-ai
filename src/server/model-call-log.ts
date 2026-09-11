import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ModelRole } from '../domain/assistant-types';

export type ModelCallLogEntry = {
  sporingsId: string; at: string; agent: string; role: ModelRole | undefined;
  model: string; durationMs: number | null; status: 'completed' | 'failed'; strippedFields: string[];
};

/**
 * `state/ai-trace.jsonl` in the KS sandbox only sees calls through ai-gateway, which this app never uses
 * (model calls go straight to Cloudflare). This is the same idea for our own model calls, keyed by the
 * same sporingsId as the KS calls, so forvaltningsinnsyn can show one timeline for both.
 */
export function logModelCall(entry: ModelCallLogEntry) {
  try {
    const directory = resolve(/* turbopackIgnore: true */ process.env.ASSISTANT_DATA_DIR || '.data');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    appendFileSync(join(directory, 'model-calls.jsonl'), JSON.stringify(entry) + '\n', { mode: 0o600 });
  } catch { /* Logging failure must not break the analysis it is logging. */ }
}

export function readModelCalls(sporingsId: string): ModelCallLogEntry[] {
  try {
    const directory = resolve(/* turbopackIgnore: true */ process.env.ASSISTANT_DATA_DIR || '.data');
    const lines = readFileSync(join(directory, 'model-calls.jsonl'), 'utf8').split('\n').filter(Boolean);
    return lines.map(line => JSON.parse(line) as ModelCallLogEntry).filter(entry => entry.sporingsId === sporingsId);
  } catch { return []; }
}
