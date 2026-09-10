import { randomUUID } from 'node:crypto';
import type { FlowCase } from '../domain/flow-types';
import { assistantDatabase } from './assistant-store';
import { CaseError } from './case-service';
import { deleteFlowArtifacts, processExpiredArtifacts } from './flow-action-store';

/** The step flow keeps its own table in the shared local SQLite file: same lifetime rules, same single-process lock. */
const state = globalThis as typeof globalThis & { flowLocks?: Set<string> };
const locks = state.flowLocks ??= new Set<string>();
export const FLOW_TTL_SECONDS = 90 * 24 * 60 * 60;
const TTL = FLOW_TTL_SECONDS * 1000;
function db() {
  const database = assistantDatabase();
  database.exec('CREATE TABLE IF NOT EXISTS flows (id TEXT PRIMARY KEY, expires INTEGER NOT NULL, body TEXT NOT NULL)');
  database.exec('CREATE TABLE IF NOT EXISTS flow_mutations (case_id TEXT PRIMARY KEY, token TEXT NOT NULL, pid INTEGER NOT NULL, expires INTEGER NOT NULL)');
  database.prepare('DELETE FROM flows WHERE expires <= ?').run(Date.now());
  processExpiredArtifacts();
  return database;
}
function mutationActive(id: string) {
  const database = db();
  const row = database.prepare('SELECT token, pid, expires FROM flow_mutations WHERE case_id=?').get(id) as { token: string; pid: number; expires: number } | undefined;
  if (!row) return false;
  let alive = row.expires > Date.now();
  if (alive) { try { process.kill(row.pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false; } }
  if (!alive) database.prepare('DELETE FROM flow_mutations WHERE case_id=? AND token=?').run(id, row.token);
  return alive;
}
export function createFlowCase(): FlowCase {
  const database = db();
  const count = database.prepare('SELECT COUNT(*) AS count FROM flows').get() as { count: number };
  if (count.count >= 100) throw new CaseError('Demoen har mange lagrede saker. Slett en tidligere sak og prøv igjen.', 503);
  const now = new Date().toISOString();
  const session: FlowCase = {
    id: randomUUID(), createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + TTL).toISOString(), revision: 1,
    status: 'collecting', situation: '', sources: [], facts: [], skipped: [], step: null, history: [], outcomes: [], events: [],
    error: null, notice: null, stepCount: 0, ks: { personId: null, fetched: [], declined: [], fetchedAt: null, consent: null },
  };
  database.prepare('INSERT INTO flows (id, expires, body) VALUES (?, ?, ?)').run(session.id, Date.parse(session.expiresAt), JSON.stringify(session));
  return session;
}
export function loadFlowCase(id?: string): FlowCase {
  const row = id ? db().prepare('SELECT body FROM flows WHERE id = ?').get(id) as { body: string } | undefined : undefined;
  if (!row) throw new CaseError('Saken er slettet eller utløpt. Start på nytt.', 401);
  const session: FlowCase = JSON.parse(row.body);
  if (session.status === 'thinking' && !locks.has(session.id) && !mutationActive(session.id)) {
    // A restart interrupted the planner. The stored sources and facts survive; the citizen retries.
    session.status = 'error'; session.step = null;
    session.error = 'Planleggingen ble avbrutt av en omstart. Opplysningene er bevart; prøv igjen.';
    saveFlowCase(session);
  }
  return session;
}
export function saveFlowCase(session: FlowCase) {
  session.updatedAt = new Date(Math.max(Date.now(), Date.parse(session.updatedAt) + 1)).toISOString();
  session.events = session.events.slice(-150); session.history = session.history.slice(-30);
  const result = db().prepare('UPDATE flows SET body = ? WHERE id = ?').run(JSON.stringify(session), session.id);
  if (!result.changes) throw new CaseError('Saken er slettet eller utløpt.', 401);
}
export function deleteFlowCase(id?: string) {
  if (id && (locks.has(id) || mutationActive(id))) throw new CaseError('Vent til planleggingen er ferdig før du sletter saken.', 409);
  if (id) { deleteFlowArtifacts(id); db().prepare('DELETE FROM flows WHERE id = ?').run(id); }
}
export async function withFlowLock<T>(id: string, revision: number, work: (session: FlowCase) => Promise<T>): Promise<T> {
  if (locks.has(id) || mutationActive(id)) throw new CaseError('Assistenten arbeider allerede med saken. Vent til den er ferdig.', 409);
  const database = db();
  const token = randomUUID();
  // A bounded lease protects writes across app workers as well as browser tabs.
  const claimed = database.prepare('INSERT OR IGNORE INTO flow_mutations(case_id,token,pid,expires) VALUES(?,?,?,?)').run(id, token, process.pid, Date.now() + 10 * 60 * 1000);
  if (!claimed.changes) throw new CaseError('Saken behandles allerede.', 409);
  locks.add(id);
  try {
    const session = loadFlowCase(id);
    if (session.revision !== revision) throw new CaseError('Saken er oppdatert i en annen fane. Last inn siste versjon.', 409);
    return await work(session);
  } finally {
    locks.delete(id);
    database.prepare('DELETE FROM flow_mutations WHERE case_id=? AND token=?').run(id, token);
  }
}
