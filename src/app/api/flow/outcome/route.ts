import { NextResponse, type NextRequest } from 'next/server';
import { CaseError } from '../../../../server/case-service';
import { failure } from '../../../../server/http';
import { flowFrom } from '../../../../server/flow-http';
import { flowOutcomeText } from '../../../../domain/flow-catalogue';

export const runtime = 'nodejs';
/** Plain-text receipt for one executed action of the cookie case. */
export async function GET(request: NextRequest) {
  try {
    const session = flowFrom(request);
    const caseId = request.nextUrl.searchParams.get('caseId');
    const outcomeId = request.nextUrl.searchParams.get('outcomeId');
    if (caseId !== session.id) throw new CaseError('Kvitteringen tilhører en annen sak.', 409);
    const outcome = session.outcomes.find(item => item.id === outcomeId);
    if (!outcome) throw new CaseError('Kvitteringen finnes ikke.', 404);
    return new NextResponse(flowOutcomeText(outcome, session.id), { headers: {
      'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="sok-en-gang-${outcome.reference.toLowerCase()}.txt"`,
    } });
  } catch (error) { return failure(error); }
}
