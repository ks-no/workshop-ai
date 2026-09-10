import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { explain } from '../../../server/explanation-service';
import { failure, json, readBody, sessionFrom } from '../../../server/http';

export async function POST(request: NextRequest) {
  try {
    const input = await readBody(request, z.object({
      question: z.string().trim().min(1).max(300),
      topic: z.enum(['why', 'data', 'income-change', 'source', 'next', 'privacy', 'unknown']).optional(),
    }).strict());
    return json(await explain(sessionFrom(request), input.question, input.topic));
  } catch (error) { return failure(error); }
}
