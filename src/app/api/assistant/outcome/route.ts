import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { failure } from '../../../../server/http';
import { assistantFrom } from '../../../../server/assistant-http';
import { CaseError } from '../../../../server/case-service';
import { outcomeText } from '../../../../domain/assistant-actions';

export const runtime = 'nodejs';
/** Plain-text receipt for one executed end action. Requires the cookie case and its exact outcome ID. */
export async function GET(request: NextRequest) {
  try {
    const session = assistantFrom(request);
    const outcomeId = request.nextUrl.searchParams.get('outcomeId') || '';
    if (request.nextUrl.searchParams.get('caseId') !== session.id) throw new CaseError('Samtalen er endret. Last inn siden før du laster ned kvitteringen.', 409);
    const outcome = (session.outcomes ?? []).find(item => item.id === outcomeId);
    if (!outcome) throw new CaseError('Kvitteringen finnes ikke i denne samtalen.', 404);
    return new NextResponse(outcomeText(outcome, session.id), { status: 200, headers: {
      'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="sok-en-gang-${outcome.reference.replace(/[^A-Za-z0-9-]/g, '')}.txt"`,
    } });
  } catch (error) { return failure(error); }
}
