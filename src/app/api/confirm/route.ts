import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { caseView, confirmCase } from '../../../server/case-service';
import { failure, json, readBody, sessionFrom } from '../../../server/http';

export async function POST(request: NextRequest) {
  try {
    const { confirmed } = await readBody(request, z.object({ confirmed: z.literal(true) }).strict());
    return json(caseView(confirmCase(sessionFrom(request), confirmed)));
  } catch (error) { return failure(error); }
}
