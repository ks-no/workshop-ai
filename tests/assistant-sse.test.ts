import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { NextRequest } from 'next/server';
import { POST } from '../src/app/api/assistant/route';
import { ASSISTANT_COOKIE } from '../src/server/assistant-http';
import { createAssistantCase, deleteAssistantCase, saveAssistantCase } from '../src/server/assistant-store';
import { addMessage, analyzeCase } from '../src/server/assistant-service';
import type { AssistantCase, CritiqueRound, ModelPlan, ServiceId } from '../src/domain/assistant-types';
import type { ModelCall } from '../src/server/assistant-model';

const directory = mkdtempSync(join(tmpdir(), 'assistant-sse-tests-'));
const priorDataDirectory = process.env.ASSISTANT_DATA_DIR;
process.env.ASSISTANT_DATA_DIR = directory;
const createdIds = new Set<string>();
const origin = 'http://127.0.0.1:3211';

afterEach(() => { for (const id of createdIds) deleteAssistantCase(id); createdIds.clear(); });
after(() => {
  const state = globalThis as typeof globalThis & { assistantDb?: DatabaseSync };
  state.assistantDb?.close(); delete state.assistantDb;
  if (priorDataDirectory === undefined) delete process.env.ASSISTANT_DATA_DIR;
  else process.env.ASSISTANT_DATA_DIR = priorDataDirectory;
  rmSync(directory, { recursive: true, force: true });
});

function newCase(): AssistantCase {
  const current = createAssistantCase();
  createdIds.add(current.id);
  return current;
}
function jsonRequest(body: unknown, cookieCase: AssistantCase) {
  return new NextRequest(`${origin}/api/assistant`, { method: 'POST', headers: {
    'Content-Type': 'application/json', Origin: origin, Host: new URL(origin).host, Cookie: `${ASSISTANT_COOKIE}=${cookieCase.id}`,
  }, body: JSON.stringify(body) });
}
function streamRequest(body: unknown, cookieCase: AssistantCase) {
  return new NextRequest(`${origin}/api/assistant`, { method: 'POST', headers: {
    'Content-Type': 'application/json', Accept: 'text/event-stream', Origin: origin, Host: new URL(origin).host, Cookie: `${ASSISTANT_COOKIE}=${cookieCase.id}`,
  }, body: JSON.stringify(body) });
}
async function readFrames(response: Response) {
  const text = await response.text();
  return text.split('\n\n').filter(Boolean).map(frame => {
    const [eventLine, dataLine] = frame.split('\n');
    return { event: eventLine.slice('event: '.length), data: JSON.parse(dataLine.slice('data: '.length)) };
  });
}

test('a request without Accept: text/event-stream keeps the existing JSON contract', async () => {
  const current = newCase();
  const response = await POST(jsonRequest({ action: 'analyze', caseId: current.id, revision: current.revision }, current));
  assert.match(response.headers.get('content-type') || '', /application\/json/);
  const body = await response.json();
  assert.match(body.error, /Beskriv hva du trenger/);
});

test('Accept: text/event-stream turns a rejected action into a single error frame, not a dead connection', async () => {
  const current = newCase();
  const response = await POST(streamRequest({ action: 'analyze', caseId: current.id, revision: current.revision }, current));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/event-stream/);
  const frames = await readFrames(response);
  assert.deepEqual(frames.map(frame => frame.event), ['error']);
  assert.match(frames[0].data.message, /Beskriv hva du trenger/);
});

test('a streamed action that needs no reanalysis sends only the terminal ferdig frame with the full session', async () => {
  const current = newCase();
  const citation = { sourceId: 'source-x', quote: 'x', lineStart: 1, lineEnd: 1, page: null };
  const now = new Date().toISOString();
  const first = randomUUID();
  current.facts.push(
    { id: first, key: 'has_children', value: 'true', label: 'Har barn', status: 'proposed', citation, createdAt: now, confirmedAt: null },
    { id: randomUUID(), key: 'moving', value: 'true', label: 'Flytting', status: 'proposed', citation, createdAt: now, confirmedAt: null },
  );
  saveAssistantCase(current);
  const response = await POST(streamRequest({ action: 'fact', factId: first, decision: 'confirm', caseId: current.id, revision: current.revision }, current));
  assert.equal(response.status, 200);
  const frames = await readFrames(response);
  assert.deepEqual(frames.map(frame => frame.event), ['ferdig']);
  assert.equal(frames[0].data.session.facts.find((fact: { id: string }) => fact.id === first).status, 'confirmed');
  assert.ok(frames[0].data.model);
});

function session(): AssistantCase {
  const now = new Date().toISOString();
  return { id: 'sse-test', createdAt: now, updatedAt: now, expiresAt: now, revision: 1, status: 'collecting', messages: [], facts: [], sources: [], services: [], questions: [], unsupported: [], runs: [], events: [], summary: '', critique: [], analyzedRevision: null, handoff: null, error: null, ksData: null };
}
function plan(services: ServiceId[] = ['moving']): ModelPlan {
  return { summary: 'Forbered opplysningene for menneskelig vurdering.', services: services.map(id => ({ id, reason: 'Innbyggerens beskrivelse' })), facts: [], questions: [], unsupported: [] };
}
type TailContext = { draft: string };
type CriticOutput = { verdict: 'PASS' | 'REVISE'; gaps: { point: string; quote: string }[]; notes: string };
function model(response: ModelPlan, critic?: () => CriticOutput | Promise<CriticOutput>): ModelCall {
  return async (_system, context, schema, role) => {
    if (context && typeof context === 'object' && 'draft' in context) {
      const tailContext = context as TailContext;
      if (role === 'critic') return schema.parse(await (critic?.() ?? { verdict: 'PASS', gaps: [], notes: '' }));
      return schema.parse({ answer: tailContext.draft });
    }
    return schema.parse(context && typeof context === 'object' && 'service' in context
      ? { summary: 'Sjekklisten er klar til kontroll.', findings: [], questions: [] } : response);
  };
}
const discardPersistence = () => {};

test('a PASS run emits triage, draft, critic and polish as step events in order', async () => {
  const current = session();
  addMessage(current, 'Jeg trenger hjelp til å forberede flytting.');
  const steps: string[] = [];
  await analyzeCase(current, model(plan()), discardPersistence, { onStep: step => steps.push(step) });
  assert.deepEqual(steps, ['triage', 'draft', 'critic', 'polish']);
});

test('a REVISE round is a visible revise step, not a hidden retry, and each critic round sends its own critic-detail', async () => {
  const current = session();
  addMessage(current, 'Jeg trenger hjelp til å forberede flytting.');
  const steps: string[] = [];
  const critiques: CritiqueRound[] = [];
  const alwaysRevise = model(plan(), () => ({ verdict: 'REVISE', gaps: [{ point: 'Mangler kilde for datoen.', quote: 'flytting' }], notes: 'Trenger mer presisjon.' }));
  await analyzeCase(current, alwaysRevise, discardPersistence, { onStep: step => steps.push(step), onCritique: round => critiques.push(round) });
  assert.deepEqual(steps, ['triage', 'draft', 'critic', 'revise', 'critic', 'polish']);
  assert.equal(critiques.length, 2);
  assert.ok(critiques.every(round => round.verdict === 'REVISE'));
});

test('the critic-detail event carries the full critique text, not a truncated preview', async () => {
  const current = session();
  addMessage(current, 'Jeg trenger hjelp til å forberede flytting.');
  const longNotes = 'Dette er en lang og detaljert tilbakemelding fra kritikeren. '.repeat(20).slice(0, 1200);
  const gaps = [
    { point: 'Mangler kilde for flyttedatoen.', quote: 'flyttet 1. oktober' },
    { point: 'Beløpet er ikke dokumentert.', quote: '45000 kroner' },
  ];
  const critiques: CritiqueRound[] = [];
  await analyzeCase(current, model(plan(), () => ({ verdict: 'PASS', gaps, notes: longNotes })), discardPersistence, { onCritique: round => critiques.push(round) });
  assert.equal(critiques.length, 1);
  assert.equal(critiques[0].notes.length, 1200);
  assert.equal(critiques[0].notes, longNotes);
  assert.deepEqual(critiques[0].gaps, gaps);
});

test('an aborted signal terminates the run instead of completing the analysis', async () => {
  const current = session();
  addMessage(current, 'Jeg trenger hjelp til å forberede flytting.');
  const controller = new AbortController();
  await analyzeCase(current, model(plan()), discardPersistence, {
    signal: controller.signal,
    onStep: step => { if (step === 'triage') controller.abort(); },
  });
  assert.equal(current.status, 'error');
  assert.match(current.error ?? '', /avbrutt/);
});
