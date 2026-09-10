import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { CaseError } from '../../../server/case-service';
import { failure, json, readBody } from '../../../server/http';
import { createFlowCase, deleteFlowCase, loadFlowCase, saveFlowCase, withFlowLock, FLOW_TTL_SECONDS } from '../../../server/flow-store';
import { FLOW_COOKIE, flowFrom, flowResponse } from '../../../server/flow-http';
import { addInput, answerQuestions, approveReview, bumpRevision, continueFlow, executeAction, planNextStep, retryFlow, skipProposal, chooseFlowAction, reviewFlowFacts, validateExecution } from '../../../server/flow-service';
import { flowFetchables, flowActionTypes } from '../../../domain/flow-types';

import { activityForCase, prepareAction, executeApprovedAction, invalidateDrafts } from '../../../server/flow-action-store';

export const runtime = 'nodejs';
const revision = z.number().int().positive();
const caseId = z.string().uuid();
const key = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
const execution = z.discriminatedUnion('type', [
  z.object({ type: z.literal('email'), to: z.string().trim().min(3).max(200), subject: z.string().trim().min(1).max(160), body: z.string().trim().min(1).max(4000) }).strict(),
  z.object({ type: z.literal('form'), fields: z.record(z.string().max(80), z.string().max(1000)).refine(value => Object.keys(value).length <= 16) }).strict(),
  z.object({ type: z.literal('reminder'), title: z.string().trim().min(1).max(120), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/).nullable().default(null), note: z.string().max(400).default('') }).strict(),
  z.object({ type: z.literal('contact'), summary: z.string().trim().min(1).max(4000).optional() }).strict(),
]);
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }).strict(),
  z.object({ action: z.literal('input'), text: z.string().trim().min(1).max(4000), revision, caseId }).strict(),
  z.object({ action: z.literal('answers'), answers: z.array(z.object({ key, value: z.string().max(400) }).strict()).max(8), note: z.string().max(2000).default(''), revision, caseId }).strict(),
  z.object({ action: z.literal('approve'), facts: z.array(z.object({ id: z.string().uuid(), value: z.string().max(400) }).strict()).max(40), remove: z.array(z.string().uuid()).max(40).default([]), fetch: z.array(z.enum(flowFetchables)).max(3).default([]), note: z.string().max(2000).default(''), revision, caseId }).strict(),
  z.object({ action: z.literal('prepare'), execution, revision, caseId }).strict(),
  z.object({ action: z.literal('execute'), draftId: z.string().uuid(), revision, caseId }).strict(),
  z.object({ action: z.literal('choose'), type: z.enum(flowActionTypes), revision, caseId }).strict(),
  z.object({ action: z.literal('review-facts'), revision, caseId }).strict(),
  z.object({ action: z.literal('skip'), revision, caseId }).strict(),
  z.object({ action: z.literal('continue'), revision, caseId }).strict(),
  z.object({ action: z.literal('retry'), revision, caseId }).strict(),
]);

export async function GET(request: NextRequest) {
  try { return await flowResponse(flowFrom(request)); }
  catch (error) { if (error instanceof CaseError && error.status === 401) return flowResponse(null); return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    const command = await readBody(request, schema);
    if (command.action === 'start') {
      try { return await flowResponse(flowFrom(request)); }
      catch (error) { if (!(error instanceof CaseError && error.status === 401)) throw error; }
      const session = createFlowCase();
      const response = await flowResponse(session, 201);
      response.cookies.set(FLOW_COOKIE, session.id, { httpOnly: true, sameSite: 'strict', secure: request.nextUrl.protocol === 'https:', path: '/', maxAge: FLOW_TTL_SECONDS });
      return response;
    }
    const current = flowFrom(request);
    if (command.caseId !== current.id) throw new CaseError('En annen sak er åpnet i en annen fane. Last inn siden på nytt.', 409);
    // A lost response can be replayed without another dispatch, even after revision advances.
    if (command.action === 'execute') {
      const receipt = activityForCase(current.id).attempts.find(attempt => attempt.draftId === command.draftId && attempt.status === 'completed');
      if (receipt) return flowResponse(current);
    }
    await withFlowLock(current.id, command.revision, async session => {
      if (command.action === 'execute') {
        await executeApprovedAction(session, command.draftId, async approved => {
          bumpRevision(session);
          return executeAction(session, approved);
        }, saveFlowCase);
        return;
      }
      if (command.action === 'prepare') {
        const approved = validateExecution(session, command.execution);
        bumpRevision(session);
        prepareAction(session, approved, saveFlowCase);
        return;
      }
      bumpRevision(session);
      invalidateDrafts(session.id);
      try {
        let lastEvent: string;
        if (command.action === 'input') lastEvent = addInput(session, command.text);
        else if (command.action === 'answers') lastEvent = answerQuestions(session, command.answers, command.note);
        else if (command.action === 'approve') lastEvent = await approveReview(session, command);
        else if (command.action === 'choose') { chooseFlowAction(session, command.type); saveFlowCase(session); return; }
        else if (command.action === 'review-facts') { reviewFlowFacts(session); saveFlowCase(session); return; }
        else if (command.action === 'skip') lastEvent = skipProposal(session);
        else if (command.action === 'continue') lastEvent = continueFlow(session);
        else lastEvent = retryFlow(session);
        await planNextStep(session, lastEvent);
        saveFlowCase(session);
      } catch (error) {
        if (session.status === 'thinking') {
          session.status = 'error'; session.step = null;
          session.error = error instanceof Error ? error.message : 'Planleggingen kunne ikke fullføres.';
          saveFlowCase(session);
        }
        throw error;
      }
    });
    return flowResponse(loadFlowCase(current.id));
  } catch (error) { return failure(error); }
}
export async function DELETE(request: NextRequest) {
  try {
    const command = await readBody(request, z.object({ caseId, revision }).strict());
    const current = flowFrom(request);
    if (command.caseId !== current.id || command.revision !== current.revision) throw new CaseError('Saken er endret. Last inn siden før du sletter.', 409);
    deleteFlowCase(current.id);
    const response = json({ deleted: true }); response.cookies.delete(FLOW_COOKIE); return response;
  } catch (error) { return failure(error); }
}
