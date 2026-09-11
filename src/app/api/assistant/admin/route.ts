import type { NextRequest } from 'next/server';
import { CaseError } from '../../../../server/case-service';
import { failure, json, sameOrigin } from '../../../../server/http';
import { modelStatus } from '../../../../server/assistant-model';
import { providerCatalogue, setActiveSelection, validateCandidate } from '../../../../server/assistant-providers';

export const runtime = 'nodejs';
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

/** Demoverktøy: av som standard, og kun nåbart fra localhost selv når det er slått på. */
function assertAdminAccess(request: NextRequest) {
  if (process.env.ASSISTANT_ADMIN_ENABLED !== 'true') throw new CaseError('Administrasjonsendepunktet er slått av.', 404);
  if (!LOCAL_HOSTS.includes(request.nextUrl.hostname)) throw new CaseError('Administrasjonsendepunktet er bare tilgjengelig fra localhost.', 403);
}

export async function GET(request: NextRequest) {
  try {
    assertAdminAccess(request);
    return json({ model: await modelStatus(), catalogue: providerCatalogue() });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    assertAdminAccess(request);
    sameOrigin(request);
    if (!request.headers.get('content-type')?.includes('application/json')) throw new CaseError('Forespørselen må inneholde JSON.', 415);
    const body = await request.text();
    if (body.length > 2048) throw new CaseError('Forespørselen er for stor.', 413);
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { throw new CaseError('Forespørselen inneholder ugyldig JSON.'); }
    const candidate = validateCandidate(parsed);
    setActiveSelection(candidate.role, candidate.provider, candidate.model);
    return json({ model: await modelStatus() });
  } catch (error) { return failure(error); }
}
