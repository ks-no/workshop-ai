import type { NextRequest } from 'next/server';
import { failure, json } from '../../../../server/http';
import { assistantFrom } from '../../../../server/assistant-http';
import { ksClient } from '../../../../server/ks-runtime';
import { buildInnsynTimeline } from '../../../../server/innsyn-service';

export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try {
    const session = assistantFrom(request);
    const revisjon = session.ksData ? await ksClient(session.id).readRevisjonslogg(session.id).then(result => result.value).catch(() => []) : [];
    return json({ sporingsId: session.id, events: buildInnsynTimeline(session, revisjon) });
  } catch (error) { return failure(error); }
}
