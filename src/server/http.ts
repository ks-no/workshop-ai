import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { CaseError, getCase } from './case-service';

export const COOKIE = 'sok-demo-session';
export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}
export function sessionFrom(request: NextRequest) { return getCase(request.cookies.get(COOKIE)?.value); }
export function sameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  // Next may normalize the internal request URL to localhost. The browser uses the Host it visited.
  const expectedOrigin = `${request.nextUrl.protocol}//${request.headers.get('host') || request.nextUrl.host}`;
  if (origin && origin !== expectedOrigin) throw new CaseError('Forespørselen kom fra en annen nettside.', 403);
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new CaseError('Forespørselen kom fra en annen nettside.', 403);
}
export async function readBody<T>(request: NextRequest, schema: z.ZodType<T>): Promise<T> {
  sameOrigin(request);
  if (!request.headers.get('content-type')?.includes('application/json')) throw new CaseError('Forespørselen må inneholde JSON.', 415);
  const body = await request.text();
  if (body.length > 8192) throw new CaseError('Forespørselen er for stor.', 413);
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { throw new CaseError('Forespørselen inneholder ugyldig JSON.'); }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new CaseError('Kontroller opplysningene og prøv igjen. Beløp må være hele kroner fra 0 til 100 000 000.');
  return result.data;
}
export function failure(error: unknown) {
  if (error instanceof CaseError) return json({ error: error.message }, error.status);
  return json({ error: 'Noe gikk galt. Prøv igjen. Opplysningene er ikke sendt noe sted.' }, 500);
}
