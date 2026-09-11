import type { NextRequest } from 'next/server';
import { CaseError } from '../../../server/case-service';
import { failure, json } from '../../../server/http';
import { assistantFrom } from '../../../server/assistant-http';
import { buildKlarsprakContrast } from '../../../server/klarsprak-service';

export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try {
    const session = assistantFrom(request);
    if (!session) throw new CaseError('Ingen aktiv samtale.', 404);
    if (request.nextUrl.searchParams.get('caseId') !== session.id || Number(request.nextUrl.searchParams.get('revision')) !== session.revision) {
      throw new CaseError('Samtalen er endret. Last inn siden på nytt.', 409);
    }
    const contrast = await buildKlarsprakContrast(session);
    if (!contrast) throw new CaseError('SFO-vurderingen er ikke klar for klarspråk ennå.', 404);
    return json(contrast);
  } catch (error) { return failure(error); }
}
