import type { NextRequest } from 'next/server';
import { failure, sameOrigin } from '../../../../server/http';
import { CaseError } from '../../../../server/case-service';
import { boundedMultipart } from '../../../../server/assistant-http';
import { extractDocument } from '../../../../server/assistant-documents';
import { flowFrom, flowResponse } from '../../../../server/flow-http';
import { loadFlowCase, saveFlowCase, withFlowLock } from '../../../../server/flow-store';
import { addFlowDocument, bumpRevision, planNextStep } from '../../../../server/flow-service';

export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const session = flowFrom(request);
    const form = await boundedMultipart(request);
    if ([...form.keys()].some(key => !['file', 'revision', 'caseId'].includes(key)) || form.getAll('file').length !== 1 || form.getAll('revision').length !== 1 || form.getAll('caseId').length !== 1) throw new CaseError('Ugyldig dokumentopplasting.');
    if (form.get('caseId') !== session.id) throw new CaseError('En annen sak er åpnet. Last inn siden på nytt.', 409);
    const file = form.get('file'); const revision = Number(form.get('revision'));
    if (!(file instanceof File) || !Number.isSafeInteger(revision) || revision <= 0) throw new CaseError('Velg et dokument og en gyldig sak.');
    await withFlowLock(session.id, revision, async current => {
      const source = await extractDocument(file.name, new Uint8Array(await file.arrayBuffer()));
      bumpRevision(current);
      addFlowDocument(current, source);
      // Before the first description the document just waits; afterwards the planner reads it right away.
      if (current.situation) await planNextStep(current, 'document-added');
      saveFlowCase(current);
    });
    return flowResponse(loadFlowCase(session.id));
  } catch (error) { return failure(error); }
}
