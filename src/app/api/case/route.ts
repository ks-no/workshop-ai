import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { caseView, createCase, deleteCase } from '../../../server/case-service';
import { COOKIE, failure, json, readBody, sameOrigin, sessionFrom } from '../../../server/http';

export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  try {
    const input = await readBody(request, z.object({
      scenario: z.enum(['standard', 'missing-income', 'high-income', 'unavailable']), allowed: z.literal(true),
    }).strict());
    const session = await createCase(input.scenario, input.allowed);
    deleteCase(request.cookies.get(COOKIE)?.value);
    const response = json(caseView(session), 201);
    response.cookies.set(COOKIE, session.id, {
      httpOnly: true, sameSite: 'strict', secure: request.nextUrl.protocol === 'https:', path: '/', maxAge: 7200,
    });
    return response;
  } catch (error) { return failure(error); }
}
export async function GET(request: NextRequest) {
  try { return json(caseView(sessionFrom(request))); } catch (error) { return failure(error); }
}
export async function DELETE(request: NextRequest) {
  try {
    sameOrigin(request);
    deleteCase(request.cookies.get(COOKIE)?.value);
    const response = json({ deleted: true });
    response.cookies.delete(COOKIE);
    return response;
  } catch (error) { return failure(error); }
}
