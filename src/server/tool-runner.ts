import { randomUUID } from 'node:crypto';
import type { AssistantCase, ToolId } from '../domain/assistant-types';
import { TOOL_CATALOGUE, toolFetched } from '../domain/tool-catalogue';
import { connectKs, consentAndReadIncome, declineKsAccess } from './assistant-ks';
import { ksClient } from './ks-runtime';
import { CaseError } from './case-service';

/** Server-side executors per catalogue tool. Injectable so tests never call the KS sandbox. */
export type ToolExecutors = Partial<Record<ToolId, (session: AssistantCase) => Promise<void>>>;
export function defaultExecutors(client: ReturnType<typeof ksClient> = ksClient()): ToolExecutors {
  return {
    ks_connect: async session => { if (!session.ksData) await connectKs(session, client); },
    ks_income: async session => { if (!session.ksData?.incomeReadAt) await consentAndReadIncome(session, true, client); },
  };
}
function record(session: AssistantCase, type: 'human' | 'completed' | 'failed', detail: string) {
  session.events.push({ id: randomUUID(), runId: '', agent: 'Verktøykatalog', type, at: new Date().toISOString(), detail });
}

/**
 * One citizen choice resolves the consents the last analysis left pending. Only tools that are
 * pending for the current revision may run; a stale tab or an invented id gets a 409.
 */
export async function decideToolConsent(session: AssistantCase, toolIds: ToolId[], approved: boolean, executors: ToolExecutors = defaultExecutors()): Promise<{ executed: ToolId[] }> {
  const pending = (session.pendingConsents ?? []).filter(consent => toolIds.includes(consent.toolId) && consent.revision === session.revision);
  if (!pending.length) throw new CaseError('Det finnes ingen ventende samtykkeforespørsel for dette valget. Last inn siden på nytt.', 409);
  if (!approved) {
    declineKsAccess(session);
    session.pendingConsents = [];
    record(session, 'human', `Innbyggeren avslo: ${pending.map(consent => consent.title).join(', ')}. Ingen integrasjon ble kalt.`);
    return { executed: [] };
  }
  const executed: ToolId[] = [];
  for (const tool of TOOL_CATALOGUE.filter(item => pending.some(consent => consent.toolId === item.id))) {
    for (const dependency of tool.dependsOn) {
      if (!executed.includes(dependency) && !toolFetched(session, dependency)) throw new CaseError(`Verktøyet «${tool.title}» krever at «${TOOL_CATALOGUE.find(item => item.id === dependency)?.title}» kjøres først.`, 409);
    }
    const run = executors[tool.id];
    if (!run) throw new CaseError(`Verktøyet «${tool.title}» har ingen integrasjon i denne demoen.`, 501);
    try { await run(session); }
    catch (error) { record(session, 'failed', `${tool.title} (${tool.integration}) kunne ikke fullføres.`); throw error; }
    executed.push(tool.id);
    record(session, 'completed', `Kjørte «${tool.title}» via ${tool.integration} etter samtykke. Resultatet er lagret som kilde i saken.`);
  }
  session.pendingConsents = [];
  return { executed };
}
