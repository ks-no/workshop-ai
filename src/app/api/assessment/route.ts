import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { caseView, updateCase } from '../../../server/case-service';
import { failure, json, readBody, sessionFrom } from '../../../server/http';

const schema = z.object({
  cohabitant: z.enum(['no', 'yes']).optional(),
  currentIncomeNok: z.number().int().min(0).max(100_000_000).optional(),
  correction: z.enum(['income', 'other']).optional(),
  note: z.string().trim().max(500).optional(),
  informationConfirmed: z.boolean(),
}).strict().refine(value => value.correction !== 'income' || value.currentIncomeNok !== undefined)
  .refine(value => value.correction !== 'other' || (value.note?.length ?? 0) >= 5);

export async function POST(request: NextRequest) {
  try {
    const input = await readBody(request, schema);
    return json(caseView(updateCase(sessionFrom(request), input)));
  } catch (error) { return failure(error); }
}
