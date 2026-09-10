import type { NextRequest } from 'next/server';
import { failure, sameOrigin } from '../../../../server/http';
import { CaseError } from '../../../../server/case-service';
import { assistantFrom, assistantResponse, boundedMultipart } from '../../../../server/assistant-http';
import { addDocument, analyzeCase } from '../../../../server/assistant-service';
import { extractDocument } from '../../../../server/assistant-documents';
import { loadAssistantCase, withAssistantLock } from '../../../../server/assistant-store';

export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const session = assistantFrom(request);
    const form = await boundedMultipart(request);
    if ([...form.keys()].some(key => !['file', 'revision', 'caseId'].includes(key)) || form.getAll('file').length !== 1 || form.getAll('revision').length !== 1 || form.getAll('caseId').length !== 1) throw new CaseError('Ugyldig dokumentopplasting.');
    if (form.get('caseId') !== session.id) throw new CaseError('En annen samtale er åpnet. Last inn siden på nytt.', 409);
    const file = form.get('file'); const revision = Number(form.get('revision'));
    if (!(file instanceof File) || !Number.isSafeInteger(revision) || revision <= 0) throw new CaseError('Velg et dokument og en gyldig samtale.');
    await withAssistantLock(session.id, revision, async current => {
      const source = await extractDocument(file.name, new Uint8Array(await file.arrayBuffer()));
      addDocument(current, source); await analyzeCase(current);
    });
    return assistantResponse(loadAssistantCase(session.id));
  } catch (error) { return failure(error); }
}
