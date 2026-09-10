import type { NextRequest } from 'next/server';
import { modelStatus } from './assistant-model';
import { json } from './http';
import { loadAssistantCase } from './assistant-store';
import type { AssistantCase } from '../domain/assistant-types';
import { CaseError } from './case-service';

export const ASSISTANT_COOKIE = 'sok-assistant-session';
export function assistantFrom(request: NextRequest) { return loadAssistantCase(request.cookies.get(ASSISTANT_COOKIE)?.value); }
export async function assistantResponse(session: AssistantCase | null, status = 200) {
  return json({ session, model: await modelStatus() }, status);
}
export async function boundedMultipart(request: NextRequest) {
  const reader = request.body?.getReader();
  if (!reader) throw new CaseError('Dokument mangler.');
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.length;
    if (length > 1_600_000) { await reader.cancel(); throw new CaseError('Dokumentet er for stort.', 413); }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return await new Response(bytes, { headers: { 'Content-Type': request.headers.get('content-type') || '' } }).formData(); }
  catch { throw new CaseError('Dokumentopplastingen kunne ikke leses.'); }
}
