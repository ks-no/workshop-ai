import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import type { FlowCase, FlowStep } from '../src/domain/flow-types.ts';
import { callModel, modelStatus } from '../src/server/assistant-model.ts';
import { FLOW_PLANNER_PROMPT, flowModelName, flowStepSchema } from '../src/server/flow-model.ts';
import { addInput, answerQuestions, approveReview, buildFlowContext, bumpRevision, planNextStep, skipProposal } from '../src/server/flow-service.ts';

// Explicit opt-in command: real, possibly billable inference through the Python runtime; synthetic text only.
// Usage: npm run test:ai:flow   (reads LLM_BASE_URL, LLM_API_KEY and LLM_MODEL from .env.local: the AI Factory proxy or a loopback server)
const SITUATION = process.env.FLOW_EVAL_SITUATION || 'Jeg mistet jobben forrige måned og har et barn i 2. trinn på SFO. Husholdningen har en samlet årsinntekt på 152 000 kr nå, og jeg lurer på om jeg kan få billigere SFO.';
const ROUNDS = Math.min(6, Math.max(1, Number(process.env.FLOW_EVAL_ROUNDS) || 3));
const keep = () => {};
function fresh(): FlowCase {
  const now = new Date().toISOString();
  return { id: randomUUID(), createdAt: now, updatedAt: now, expiresAt: now, revision: 1, status: 'collecting', situation: '', sources: [], facts: [], skipped: [], step: null, history: [], outcomes: [], events: [], error: null, notice: null, stepCount: 0,
    ks: { personId: null, fetched: [], declined: [], fetchedAt: null, consent: null } };
}
function summary(step: FlowStep) {
  return { kind: step.kind, by: step.by, model: step.model, durationMs: step.durationMs, title: step.title, message: step.message, rationale: step.rationale,
    questions: step.questions.map(question => `${question.key} (${question.kind})`), fetch: step.fetch, proposal: step.proposal ? { type: step.proposal.type, ...(step.proposal.type === 'form' ? { templateId: step.proposal.templateId, fields: step.proposal.fields.map(field => `${field.id}=${field.value || '∅'} [${field.origin}]`) } : {}), ...(step.proposal.type === 'email' ? { aiDrafted: step.proposal.aiDrafted, subject: step.proposal.subject } : {}) } : null };
}
const report: Record<string, unknown> = { at: new Date().toISOString(), model: flowModelName(), provider: 'litellm', syntheticOnly: true, situation: SITUATION, rounds: [] as unknown[] };
const rounds = report.rounds as unknown[];
const session = fresh();
console.log('model status:', await modelStatus());
bumpRevision(session);
let lastEvent = addInput(session, SITUATION);

const baseUrl = (process.env.LLM_BASE_URL || '').trim().replace(/\/+$/, '');
if (baseUrl && process.env.LLM_API_KEY && process.env.FLOW_EVAL_DIRECT !== '0') {
  // Token usage and latency of the exact first request, straight against the configured endpoint, to size prompts sensibly.
  const system = `${FLOW_PLANNER_PROMPT}\nReturn exactly one JSON object matching: ${JSON.stringify(z.toJSONSchema(flowStepSchema))}`;
  const user = JSON.stringify(buildFlowContext(session, lastEvent, null));
  const started = Date.now();
  const response = await fetch(`${baseUrl}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.LLM_API_KEY}` }, body: JSON.stringify({
    model: flowModelName(), temperature: 0, max_completion_tokens: 2400, response_format: { type: 'json_object' }, stream: false,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  }) });
  const body = await response.json();
  const content: string = body.choices?.[0]?.message?.content ?? '';
  let valid = false;
  try { valid = flowStepSchema.safeParse(JSON.parse(content)).success; } catch { valid = false; }
  const direct = { elapsedMs: Date.now() - started, status: response.status, usage: body.usage, finishReason: body.choices?.[0]?.finish_reason, outputChars: content.length, schemaValid: valid, systemChars: system.length, userChars: user.length };
  report.directRequest = direct;
  console.log('direct Ollama request:', direct);
  console.log(content.slice(0, 1200));
}

for (let round = 1; round <= ROUNDS; round++) {
  const started = Date.now();
  await planNextStep(session, lastEvent, callModel, keep);
  const step = session.step!;
  const entry = { round, lastEvent, elapsedMs: Date.now() - started, step: summary(step), facts: session.facts.map(fact => `${fact.key}=${fact.value} [${fact.origin}/${fact.status}]`), events: session.events.slice(-5).map(event => `${event.type}: ${event.detail}`) };
  rounds.push(entry);
  console.log(`\n=== round ${round} (${entry.elapsedMs} ms) ===\n${JSON.stringify(entry.step, null, 1)}\nfacts: ${entry.facts.join(' | ')}\nevents: ${entry.events.join('\n        ')}`);
  bumpRevision(session);
  if (step.kind === 'ask') {
    lastEvent = answerQuestions(session, step.questions.map(question => ({ key: question.key, value: question.kind === 'number' ? '152000' : question.kind === 'date' ? '2026-10-01' : question.kind === 'boolean' ? 'Ja' : question.kind === 'select' ? question.options[0] ?? 'Vet ikke' : 'Borgund SFO, 2. trinn' })), '');
  } else if (step.kind === 'review') {
    lastEvent = await approveReview(session, { facts: session.facts.filter(fact => fact.status === 'proposed' || fact.status === 'confirmed').map(fact => ({ id: fact.id, value: fact.value })), remove: [], fetch: [], note: '' });
  } else if (step.kind === 'action') {
    lastEvent = skipProposal(session);
  } else break;
}
mkdirSync('plans/260903-1502-agentic-citizen-service/reports', { recursive: true });
writeFileSync('plans/260903-1502-agentic-citizen-service/reports/flow-live-evaluation.json', JSON.stringify(report, null, 2));
const modelRounds = rounds.filter(item => (item as { step: { by: string } }).step.by === 'model').length;
console.log(`\n${modelRounds} of ${rounds.length} rounds came from the model. Report: plans/260903-1502-agentic-citizen-service/reports/flow-live-evaluation.json`);
if (!modelRounds) process.exitCode = 1;
