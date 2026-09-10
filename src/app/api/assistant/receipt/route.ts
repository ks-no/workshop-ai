import type { NextRequest } from 'next/server';
import { failure, json } from '../../../../server/http';
import { assistantFrom } from '../../../../server/assistant-http';
import { handoffDocument } from '../../../../server/assistant-service';
import { CaseError } from '../../../../server/case-service';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try {
    const session = assistantFrom(request);
    if (request.nextUrl.searchParams.get('caseId') !== session.id || Number(request.nextUrl.searchParams.get('revision')) !== session.revision) {
      throw new CaseError('Samtalen er endret. Last inn siden før du laster ned saksgrunnlaget.', 409);
    }
    const response = json(handoffDocument(session));
    response.headers.set('Content-Disposition', `attachment; filename="sok-en-gang-${session.handoff!.id}.json"`);
    return response;
  } catch (error) { return failure(error); }
}
