import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AssistantCase } from '../domain/assistant-types';
import { CaseError } from './case-service';
import { repairStoredGuidanceChecks } from '../domain/service-catalogue';

const state = globalThis as typeof globalThis & { assistantDb?: DatabaseSync; assistantLocks?: Set<string> };
const locks = state.assistantLocks ??= new Set<string>();
const TTL = 24 * 60 * 60 * 1000;
function db() {
  if (!state.assistantDb) {
    const directory = resolve(/* turbopackIgnore: true */ process.env.ASSISTANT_DATA_DIR || '.data');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    state.assistantDb = new DatabaseSync(join(directory, 'assistant.sqlite'));
    state.assistantDb.exec('PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY, expires INTEGER NOT NULL, body TEXT NOT NULL)');
  }
  state.assistantDb.prepare('DELETE FROM cases WHERE expires <= ?').run(Date.now());
  return state.assistantDb;
}
export function createAssistantCase(): AssistantCase {
  const database = db();
  const count = database.prepare('SELECT COUNT(*) AS count FROM cases').get() as { count: number };
  if (count.count >= 100) throw new CaseError('Demoen har mange lagrede økter. Slett en tidligere økt og prøv igjen.', 503);
  const now = new Date().toISOString();
  const session: AssistantCase = {
    id: randomUUID(), createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + TTL).toISOString(), revision: 1,
    language: 'nb', status: 'collecting', messages: [], facts: [], sources: [], intent: null, services: [], questions: [], unsupported: [],
    runs: [], events: [], summary: '', analyzedRevision: null, handoff: null, error: null, ksData: null, ksAccessDecision: null,
  };
  database.prepare('INSERT INTO cases (id, expires, body) VALUES (?, ?, ?)').run(session.id, Date.parse(session.expiresAt), JSON.stringify(session));
  return session;
}
export function loadAssistantCase(id?: string): AssistantCase {
  const row = id ? db().prepare('SELECT body FROM cases WHERE id = ?').get(id) as { body: string } | undefined : undefined;
  if (!row) throw new CaseError('Samtalen er slettet eller utløpt. Start en ny samtale.', 401);
  const session: AssistantCase = JSON.parse(row.body);
  session.language ??= 'nb';
  session.intent ??= null;
  session.ksData ??= null;
  session.ksAccessDecision ??= null;
  // Retired authored demo data must never re-enter a current analysis.
  delete (session as AssistantCase & { demoData?: unknown }).demoData;
  session.sources = session.sources.filter(source => !source.id.startsWith('demo-'));
  const repairedGuidance = repairStoredGuidanceChecks(session);
  if (session.status === 'analyzing' && !locks.has(session.id)) {
    session.status = 'error'; session.analyzedRevision = null;
    session.error = 'Analysen ble avbrutt av en omstart. Opplysningene er bevart. Prøv analysen på nytt.';
    session.runs.filter(run => run.status === 'running').forEach(run => { run.status = 'failed'; run.completedAt = new Date().toISOString(); });
    saveAssistantCase(session);
  }
  else if (repairedGuidance) saveAssistantCase(session);
  return session;
}
export function saveAssistantCase(session: AssistantCase) {
  session.updatedAt = new Date(Math.max(Date.now(), Date.parse(session.updatedAt) + 1)).toISOString();
  session.events = session.events.slice(-200); session.runs = session.runs.slice(-60); session.messages = session.messages.slice(-20);
  const result = db().prepare('UPDATE cases SET body = ? WHERE id = ?').run(JSON.stringify(session), session.id);
  if (!result.changes) throw new CaseError('Samtalen er slettet eller utløpt.', 401);
}
export function deleteAssistantCase(id?: string) {
  if (id && locks.has(id)) throw new CaseError('Vent til analysen er ferdig før du sletter samtalen.', 409);
  if (id) db().prepare('DELETE FROM cases WHERE id = ?').run(id);
}
export async function withAssistantLock<T>(id: string, revision: number, work: (session: AssistantCase) => Promise<T>): Promise<T> {
  if (locks.has(id)) throw new CaseError('En analyse pågår allerede. Vent til den er ferdig.', 409);
  const session = loadAssistantCase(id);
  if (session.revision !== revision) throw new CaseError('Samtalen er oppdatert i en annen fane. Last inn siste versjon.', 409);
  if (session.handoff) throw new CaseError('Denne planen er allerede bekreftet. Start en ny samtale for å endre den.', 409);
  locks.add(id);
  try { return await work(session); } finally { locks.delete(id); }
}
