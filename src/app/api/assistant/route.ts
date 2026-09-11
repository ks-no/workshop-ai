import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { CaseError } from '../../../server/case-service';
import { failure, json, readBody } from '../../../server/http';
import { createAssistantCase, deleteAssistantCase, loadAssistantCase, saveAssistantCase, withAssistantLock } from '../../../server/assistant-store';
import { ASSISTANT_COOKIE, assistantFrom, assistantResponse } from '../../../server/assistant-http';
import { addConfirmedAnswers, addMessage, analyzeCase, decideFactAndContinue, discardDraft, draftEmail, fillForm, prepareHandoff, sendEmail, submitForm, type AnalyzeHooks } from '../../../server/assistant-service';
import { modelStatus } from '../../../server/assistant-model';
import { factKeys, serviceIds, toolIds, type AssistantCase, type AssistantCommand } from '../../../domain/assistant-types';
import { decideToolConsent } from '../../../server/tool-runner';

import { connectKs, consentAndReadIncome, declineKsAccess } from '../../../server/assistant-ks';

export const runtime = 'nodejs';
const revision = z.number().int().positive();
const caseId = z.string().uuid();
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }).strict(),
  z.object({ action: z.literal('message'), message: z.string().trim().min(1).max(4000), revision, caseId }).strict(),
  z.object({ action: z.literal('answers'), message: z.string().trim().min(1).max(4000), answers: z.array(z.object({ key: z.enum(factKeys), value: z.string().trim().min(1).max(200), quote: z.string().trim().min(1).max(1000) }).strict()).min(1).max(8), revision, caseId }).strict(),
  z.object({ action: z.literal('analyze'), revision, caseId }).strict(),
  z.object({ action: z.literal('fact'), factId: z.string().uuid(), decision: z.enum(['confirm', 'reject']), revision, caseId }).strict(),
  z.object({ action: z.literal('connect-ks'), revision, caseId }).strict(),
  z.object({ action: z.literal('income-consent'), approved: z.literal(true), revision, caseId }).strict(),
  z.object({ action: z.literal('ks-access'), approved: z.boolean(), revision, caseId }).strict(),
  z.object({ action: z.literal('tool-consent'), toolIds: z.array(z.enum(toolIds)).min(1).max(4), approved: z.boolean(), revision, caseId }).strict(),
  z.object({ action: z.literal('handoff'), confirmed: z.literal(true), revision, caseId }).strict(),
  z.object({ action: z.literal('draft-email'), serviceId: z.enum(serviceIds), revision, caseId }).strict(),
  z.object({ action: z.literal('send-email'), serviceId: z.enum(serviceIds), to: z.string().trim().min(3).max(200), subject: z.string().trim().min(1).max(160), body: z.string().trim().min(1).max(4000), revision, caseId }).strict(),
  z.object({ action: z.literal('fill-form'), serviceId: z.enum(serviceIds), revision, caseId }).strict(),
  z.object({ action: z.literal('submit-form'), serviceId: z.enum(serviceIds), fields: z.record(z.string().max(80), z.string().max(1000)).refine(value => Object.keys(value).length <= 12), revision, caseId }).strict(),
  z.object({ action: z.literal('discard-draft'), kind: z.enum(['email', 'form']), revision, caseId }).strict(),
]);
/** Actions that can run the pipeline, and so are worth streaming step-by-step when the client asks for it. */
const streamableActions = new Set(['message', 'answers', 'analyze', 'fact', 'connect-ks', 'income-consent', 'ks-access', 'tool-consent']);
function wantsStream(request: NextRequest) {
  return (request.headers.get('accept') || '').includes('text/event-stream');
}
function sseFrame(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
type NonStartCommand = Exclude<AssistantCommand, { action: 'start' }>;
async function runAction(command: NonStartCommand, session: AssistantCase, hooks: AnalyzeHooks) {
  if (command.action === 'message') { addMessage(session, command.message); await analyzeCase(session, undefined, undefined, hooks); }
  else if (command.action === 'answers') { addConfirmedAnswers(session, command.message, command.answers); await analyzeCase(session, undefined, undefined, hooks); }
  else if (command.action === 'analyze') { if (!session.messages.length) throw new CaseError('Beskriv hva du trenger hjelp med først.'); await analyzeCase(session, undefined, undefined, hooks); }
  else if (command.action === 'fact') await decideFactAndContinue(session, command.factId, command.decision, undefined, undefined, hooks);
  else if (command.action === 'connect-ks') { await connectKs(session); if (session.messages.length) await analyzeCase(session, undefined, undefined, hooks); }
  else if (command.action === 'income-consent') { await consentAndReadIncome(session, command.approved); if (session.messages.length) await analyzeCase(session, undefined, undefined, hooks); }
  else if (command.action === 'ks-access') {
    if (!command.approved) declineKsAccess(session);
    else {
      if (!session.ksData) await connectKs(session);
      await consentAndReadIncome(session, true);
      if (session.messages.length) await analyzeCase(session, undefined, undefined, hooks);
    }
  }
  else if (command.action === 'tool-consent') {
    const { executed } = await decideToolConsent(session, command.toolIds, command.approved);
    if (executed.length && session.messages.length) await analyzeCase(session, undefined, undefined, hooks);
  }
  else if (command.action === 'handoff') prepareHandoff(session, command.confirmed);
  else if (command.action === 'draft-email') await draftEmail(session, command.serviceId);
  else if (command.action === 'send-email') sendEmail(session, command.serviceId, { to: command.to, subject: command.subject, body: command.body });
  else if (command.action === 'fill-form') fillForm(session, command.serviceId);
  else if (command.action === 'submit-form') await submitForm(session, command.serviceId, command.fields);
  else if (command.action === 'discard-draft') discardDraft(session, command.kind);
  saveAssistantCase(session);
}
/** One event per pipeline step, the full critique on its own event, and a terminal ferdig frame with the usual JSON payload. */
function streamAnalysis(request: NextRequest, command: NonStartCommand, current: AssistantCase) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(sseFrame(event, data)));
      try {
        await withAssistantLock(current.id, command.revision, session => runAction(command, session, {
          signal: request.signal,
          onStep: step => send(step, {}),
          onCritique: round => send('critic-detail', round),
        }));
        send('ferdig', { session: loadAssistantCase(current.id), model: await modelStatus() });
      } catch (error) {
        send('error', { message: error instanceof CaseError ? error.message : 'Noe gikk galt. Prøv igjen. Opplysningene er ikke sendt noe sted.' });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
}
export async function GET(request: NextRequest) {
  try { return await assistantResponse(assistantFrom(request)); }
  catch (error) { if (error instanceof CaseError && error.status === 401) return assistantResponse(null); return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    const command = await readBody(request, schema);
    if (command.action === 'start') {
      try { return await assistantResponse(assistantFrom(request)); }
      catch (error) { if (!(error instanceof CaseError && error.status === 401)) throw error; }
      const session = createAssistantCase();
      const response = await assistantResponse(session, 201);
      response.cookies.set(ASSISTANT_COOKIE, session.id, { httpOnly: true, sameSite: 'strict', secure: request.nextUrl.protocol === 'https:', path: '/', maxAge: 86400 });
      return response;
    }
    const current = assistantFrom(request);
    if (command.caseId !== current.id) throw new CaseError('En annen samtale er åpnet i en annen fane. Last inn siden på nytt.', 409);
    if (command.action === 'handoff' && current.handoff && command.revision === current.revision) return assistantResponse(current);
    if (streamableActions.has(command.action) && wantsStream(request)) return streamAnalysis(request, command, current);
    await withAssistantLock(current.id, command.revision, session => runAction(command, session, {}));
    return assistantResponse(loadAssistantCase(current.id));
  } catch (error) { return failure(error); }
}
export async function DELETE(request: NextRequest) {
  try {
    const command = await readBody(request, z.object({ caseId, revision }).strict());
    const current = assistantFrom(request);
    if (command.caseId !== current.id || command.revision !== current.revision) throw new CaseError('Samtalen er endret. Last inn siden før du sletter.', 409);
    deleteAssistantCase(current.id);
    const response = json({ deleted: true }); response.cookies.delete(ASSISTANT_COOKIE); return response;
  } catch (error) { return failure(error); }
}
