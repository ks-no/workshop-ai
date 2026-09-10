import type { NextRequest } from 'next/server';
import { CaseError, caseView } from '../../../server/case-service';
import { failure, json, sessionFrom } from '../../../server/http';

export async function GET(request: NextRequest) {
  try {
    const session = sessionFrom(request);
    if (!session.receipt) throw new CaseError('Bekreft demoen før du laster ned kvitteringen.', 409);
    const response = json({ demo: true, notice: 'Lokalt demodokument. Ikke sendt til kommunen. Ikke et vedtak.', ...caseView(session) });
    response.headers.set('Content-Disposition', `attachment; filename="sok-en-gang-${session.receipt.reference}.json"`);
    return response;
  } catch (error) { return failure(error); }
}
