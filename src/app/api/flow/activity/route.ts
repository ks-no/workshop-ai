import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { flowFrom, flowResponse } from '../../../../server/flow-http';
import { cancelReminder, editReminder, readNotification, setChecklistMark, resolveActionAttempt } from '../../../../server/flow-action-store';
import { checkActionReceipt } from '../../../../server/flow-action-recovery';
import { withFlowLock, saveFlowCase, loadFlowCase } from '../../../../server/flow-store';
import { CaseError } from '../../../../server/case-service';
import { failure, readBody } from '../../../../server/http';

export const runtime = 'nodejs';
const id = z.string().uuid();
const version = z.number().int().positive();
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('check-receipt'), caseId: id, revision: z.number().int().nonnegative(), id }).strict(),
  z.object({ action: z.literal('confirm-not-submitted'), caseId: id, revision: z.number().int().nonnegative(), id, confirmed: z.literal(true), note: z.string().trim().min(10).max(400) }).strict(),
  z.object({ action: z.literal('checklist'), caseId: id, key: z.string().max(100), checked: z.boolean(), version: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.literal('edit-reminder'), id, version, title: z.string().trim().min(1).max(120), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(), note: z.string().max(400) }).strict(),
  z.object({ action: z.literal('cancel-reminder'), id, version }).strict(),
  z.object({ action: z.literal('read-notification'), id }).strict(),
]);
export async function POST(request: NextRequest) {
  try {
    const command = await readBody(request, schema);
    const session = flowFrom(request);
    if (command.action === 'check-receipt' || command.action === 'confirm-not-submitted') {
      if (command.caseId !== session.id) throw new CaseError('Utførelsen tilhører en annen sak.', 409);
      await withFlowLock(session.id, command.revision, async current => {
        if (command.action === 'check-receipt') await checkActionReceipt(current, command.id);
        else resolveActionAttempt(current, command.id, { at: new Date().toISOString(), method: 'user-confirmed-not-submitted', note: `Du bekreftet at handlingen ikke ble registrert: ${command.note}` }, saveFlowCase);
      });
      return flowResponse(loadFlowCase(session.id));
    }
    if (command.action === 'checklist') {
      if (command.caseId !== session.id) throw new CaseError('Sjekklisten tilhører en annen sak.', 409);
      setChecklistMark(session.id, command.key, command.checked, command.version);
    }
    else if (command.action === 'edit-reminder') editReminder(session.id, command.id, command.version, { title: command.title, date: command.date, time: command.time, note: command.note });
    else if (command.action === 'cancel-reminder') cancelReminder(session.id, command.id, command.version);
    else readNotification(session.id, command.id);
    return flowResponse(session);
  } catch (error) { return failure(error); }
}
