import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createAssistantCase, deleteAssistantCase, loadAssistantCase, saveAssistantCase, withAssistantLock } from '../src/server/assistant-store';

const directory = mkdtempSync(join(tmpdir(), 'assistant-store-tests-'));
const previousDirectory = process.env.ASSISTANT_DATA_DIR;
process.env.ASSISTANT_DATA_DIR = directory;
after(() => {
  const state = globalThis as typeof globalThis & { assistantDb?: DatabaseSync };
  state.assistantDb?.close();
  delete state.assistantDb;
  if (previousDirectory === undefined) delete process.env.ASSISTANT_DATA_DIR;
  else process.env.ASSISTANT_DATA_DIR = previousDirectory;
  rmSync(directory, { recursive: true, force: true });
});

test('cases persist independently and deletion removes embedded sources and rejects later saves', () => {
  const first = createAssistantCase();
  const second = createAssistantCase();
  first.sources.push({ id: 'test-document', kind: 'document', title: 'Synthetic fixture', text: 'Unique test-only document content.', url: null, retrievedAt: first.createdAt, purpose: 'Persistence test', period: '2026' });
  saveAssistantCase(first);
  assert.deepEqual(loadAssistantCase(first.id).sources, first.sources);
  assert.deepEqual(loadAssistantCase(second.id).sources, []);
  deleteAssistantCase(first.id);
  assert.throws(() => loadAssistantCase(first.id), /slettet eller utløpt/);
  assert.throws(() => saveAssistantCase(first), /slettet eller utløpt/);
  assert.equal(loadAssistantCase(second.id).id, second.id);
  const inspect = new DatabaseSync(join(directory, 'assistant.sqlite'));
  try {
    assert.equal(inspect.prepare('SELECT COUNT(*) AS count FROM cases WHERE body LIKE ?').get('%Unique test-only document content.%')?.count, 0);
  } finally { inspect.close(); deleteAssistantCase(second.id); }
});

test('stale revisions and completed handoffs reject mutation before its callback runs', async () => {
  const current = createAssistantCase();
  let ran = false;
  try {
    await assert.rejects(withAssistantLock(current.id, current.revision - 1, async () => { ran = true; }), /annen fane/);
    assert.equal(ran, false);
    current.handoff = { id: 'test-handoff', createdAt: current.createdAt, revision: current.revision, serviceIds: ['moving'], localOnly: true, status: 'prepared-for-human-review', credential: null };
    current.status = 'handed-off';
    saveAssistantCase(current);
    await assert.rejects(withAssistantLock(current.id, current.revision, async () => { ran = true; }), /allerede bekreftet/);
    assert.equal(ran, false);
  } finally { deleteAssistantCase(current.id); }
});

test('an active case lock blocks competing mutation and deletion but allows progress reads', async () => {
  const current = createAssistantCase();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const active = withAssistantLock(current.id, current.revision, async working => {
    working.status = 'analyzing';
    saveAssistantCase(working);
    await gate;
    working.status = 'collecting';
    saveAssistantCase(working);
  });
  try {
    await assert.rejects(withAssistantLock(current.id, current.revision, async () => assert.fail('Competing mutation ran')), /pågår allerede/);
    assert.throws(() => deleteAssistantCase(current.id), /Vent til analysen/);
    assert.equal(loadAssistantCase(current.id).status, 'analyzing');
  } finally { release(); await active; }
  assert.equal(loadAssistantCase(current.id).status, 'collecting');
  deleteAssistantCase(current.id);
});

test('a failed mutation releases its lock so a later operation can proceed', async () => {
  const current = createAssistantCase();
  try {
    await assert.rejects(withAssistantLock(current.id, current.revision, async () => { throw new Error('Expected test failure'); }), /Expected test failure/);
    const result = await withAssistantLock(current.id, current.revision, async () => 'lock released');
    assert.equal(result, 'lock released');
  } finally { deleteAssistantCase(current.id); }
});

test('a fresh process recovers persisted interrupted analysis without losing evidence', () => {
  const current = createAssistantCase();
  current.status = 'analyzing';
  current.analyzedRevision = current.revision;
  current.summary = 'Case content survives a restart.';
  current.runs = [{ id: 'interrupted-run', agent: 'Coordinator', stage: 'triage', revision: current.revision, status: 'running', startedAt: current.createdAt, completedAt: null, model: 'test-transport', durationMs: null }];
  current.sources.push({ id: 'saved-message', kind: 'conversation', title: 'Synthetic text', text: 'I need help preparing a move.', url: null, retrievedAt: current.createdAt, purpose: 'Restart test', period: '2026' });
  saveAssistantCase(current);
  try {
    const moduleUrl = new URL('../src/server/assistant-store.ts', import.meta.url).href;
    const script = `import { loadAssistantCase } from ${JSON.stringify(moduleUrl)}; process.stdout.write(JSON.stringify(loadAssistantCase(${JSON.stringify(current.id)})));`;
    const recovered = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, ASSISTANT_DATA_DIR: directory }, timeout: 20000 }));
    assert.equal(recovered.status, 'error');
    assert.match(recovered.error, /omstart/);
    assert.equal(recovered.analyzedRevision, null);
    assert.equal(recovered.runs[0].status, 'failed');
    assert.ok(recovered.runs[0].completedAt);
    assert.deepEqual(recovered.sources, current.sources);
    assert.equal(loadAssistantCase(current.id).runs[0].status, 'failed');
  } finally { deleteAssistantCase(current.id); }
});

test('expired records cannot be loaded or resurrected by an old case object', () => {
  const current = createAssistantCase();
  const inspect = new DatabaseSync(join(directory, 'assistant.sqlite'));
  try { inspect.prepare('UPDATE cases SET expires = ? WHERE id = ?').run(Date.now() - 1, current.id); }
  finally { inspect.close(); }
  assert.throws(() => loadAssistantCase(current.id), /slettet eller utløpt/);
  assert.throws(() => saveAssistantCase(current), /slettet eller utløpt/);
});

test('new cases default to Norwegian and selected case and message languages survive reload', () => {
  const current = createAssistantCase();
  try {
    assert.equal(current.language, 'nb');
    assert.equal(loadAssistantCase(current.id).language, 'nb');
    current.language = 'vi';
    current.messages.push({ id: 'translated-answer', role: 'assistant', language: 'vi', text: 'Tôi có thể giúp bạn chuẩn bị hồ sơ.', at: current.createdAt, sourceId: null });
    saveAssistantCase(current);
    const loaded = loadAssistantCase(current.id);
    assert.equal(loaded.language, 'vi');
    assert.equal(loaded.messages[0].language, 'vi');
    assert.equal(loaded.messages[0].text, current.messages[0].text);
  } finally { deleteAssistantCase(current.id); }
});

test('legacy stored cases without language load with the Norwegian default', () => {
  const current = createAssistantCase();
  try {
    delete current.language;
    saveAssistantCase(current);
    const loaded = loadAssistantCase(current.id);
    assert.equal(loaded.language, 'nb');
    assert.equal(loaded.id, current.id);
    assert.equal(loaded.revision, current.revision);
  } finally { deleteAssistantCase(current.id); }
});
