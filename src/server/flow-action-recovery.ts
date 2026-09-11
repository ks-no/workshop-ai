import { randomUUID } from 'node:crypto';
import type { FlowCase, FlowOutcome } from '../domain/flow-types';
import { templateFor } from '../domain/flow-catalogue';
import { KsDemoError } from '../providers/ks-demo-client';
import { actionRecoveryContext, resolveActionAttempt } from './flow-action-store';
import { CaseError } from './case-service';
import { saveFlowCase } from './flow-store';
import { ksClient } from './ks-runtime';

export async function checkActionReceipt(session: FlowCase, attemptId: string, client = ksClient(session.id)) {
  const { attempt, draft, competing } = actionRecoveryContext(session.id, attemptId);
  const proposal = draft.proposal;
  if (proposal.type !== 'form' || proposal.submission !== 'ks-sandbox' || draft.execution.type !== 'form') throw new CaseError('Kontroller denne handlingen i den lokale oversikten før du avklarer den.');
  const process = templateFor(proposal.templateId)?.ksProcess;
  if (!process) throw new CaseError('Skjemaet mangler en kjent KS-prosess.');
  let applications;
  try { applications = (await client.readApplications(session.id, process.prosessId)).value; }
  catch (error) { throw new CaseError(error instanceof KsDemoError ? `${error.message} Kontroller at KS-tjenestene kjører (npm run start:ks).` : 'Kunne ikke kontrollere KS-kvitteringen. Utførelsen er fortsatt sperret.', 502); }
  // A case can have earlier submissions of the same form. Never attach their receipts.
  const matches = applications.filter(item => Date.parse(item.opprettet) >= Date.parse(attempt.createdAt) && !session.outcomes.some(outcome => outcome.reference === item.soknadId));
  if (matches.length !== 1) throw new CaseError(matches.length ? 'Flere kvitteringer passer. Kontroller søknadene med ansvarlig for tjenesten.' : 'Ingen sikker kvittering funnet. Dette beviser ikke at ingenting ble sendt. Kontroller med ansvarlig for tjenesten før du bekrefter at handlingen ikke ble registrert.', 409);
  const receipt = matches[0];
  if (competing.some(other => Date.parse(other.createdAt) <= Date.parse(receipt.opprettet))) throw new CaseError('Kvitteringen kan tilhøre en annen uavklart utførelse. Kontroller søknaden med ansvarlig for tjenesten.', 409);
  const fields = draft.execution.fields;
  const outcome: FlowOutcome = {
    id: randomUUID(), createdAt: receipt.opprettet, revision: session.revision + 1, kind: 'form', status: 'submitted', title: proposal.title,
    reference: receipt.soknadId, localOnly: false, recipient: proposal.recipient,
    detail: 'Kvitteringen er hentet fra KS-sandkassen. Søknaden ble ikke sendt på nytt.',
    payload: { fields: proposal.fields.map(field => ({ id: field.id, label: field.label, value: fields[field.id] ?? field.value })), ksSoknadId: receipt.soknadId, ksOppgaveId: receipt.oppgave?.oppgaveId ?? null, ksWarning: receipt.oppgave?.advarsel ?? null },
  };
  return resolveActionAttempt(session, attemptId, { at: new Date().toISOString(), method: 'verified-receipt', note: `Kvittering ${receipt.soknadId} kontrollert hos KS. Ingen ny innsending.` }, saveFlowCase, outcome);
}
