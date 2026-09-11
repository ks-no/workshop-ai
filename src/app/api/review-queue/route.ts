import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { CaseError } from '../../../server/case-service';
import { failure, json, readBody } from '../../../server/http';
import { listReviews, updateReview } from '../../../server/flow-action-store';
export const runtime = 'nodejs';
function authenticate(request: NextRequest) {
  const token = process.env.FLOW_REVIEW_TOKEN;
  if (!token) throw new CaseError('Den lokale operatørkøen er ikke konfigurert.', 503);
  const received = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  if (received.length !== expected.length || !timingSafeEqual(received, expected))
    throw new CaseError('Operatørtilgang kreves.', 401);
}
export async function GET(request: NextRequest) {
  try {
    authenticate(request);
    return json({ reviews: listReviews() });
  } catch (error) {
    return failure(error);
  }
}
const schema = z
  .object({
    caseId: z.string().uuid(),
    id: z.string().uuid(),
    version: z.number().int().positive(),
    status: z.enum(['queued', 'in-progress', 'resolved']),
    reply: z.string().trim().max(4000).nullable(),
  })
  .strict();
export async function POST(request: NextRequest) {
  try {
    authenticate(request);
    const command = await readBody(request, schema);
    return json({
      review: updateReview(command.caseId, command.id, command.version, command.status, command.reply),
    });
  } catch (error) {
    return failure(error);
  }
}
