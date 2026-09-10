import { randomUUID } from 'node:crypto';
import { assess } from '../domain/rules';
import type { Answers, CaseSession, CaseView, Scenario } from '../domain/types';
import type { DataProviders } from '../providers/contracts';
import { mockProviders } from '../providers/mock-providers';

export class CaseError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const MAX_SESSIONS = 200;
const TTL = 2 * 60 * 60 * 1000;
const globalStore = globalThis as typeof globalThis & { sokSessions?: Map<string, CaseSession> };
const sessions = globalStore.sokSessions ??= new Map<string, CaseSession>();

export function audit(session: CaseSession, action: string, detail: string) {
  session.audit.push({ id: randomUUID(), at: new Date().toISOString(), action, detail });
  session.audit = session.audit.slice(-100);
}
export async function createCase(scenario: Scenario, allowed: boolean, providers: DataProviders = mockProviders): Promise<CaseSession> {
  if (!allowed) throw new CaseError('Du må velge å hente demoopplysningene før vi starter.');
  if (scenario === 'unavailable') throw new CaseError('Datakilden svarer ikke. Du kan prøve igjen eller velge den lokale demoen.', 503);
  for (const [id, entry] of sessions) if (entry.expiresAt < Date.now()) sessions.delete(id);
  if (sessions.size >= MAX_SESSIONS) throw new CaseError('Demoen har mange aktive økter. Prøv igjen senere.', 503);
  const retrievedAt = new Date().toISOString();
  const context = { scenario, retrievedAt, purpose: 'sfo-moderation' as const };
  const [family, sfo, income] = await Promise.all([
    providers.family.getFamily(context), providers.municipal.getSfo(context), providers.income.getIncome(context),
  ]);
  const session: CaseSession = {
    id: randomUUID(), createdAt: retrievedAt, expiresAt: Date.now() + TTL, scenario,
    data: { family, sfo, income }, answers: {}, assessment: null, receipt: null, audit: [],
  };
  audit(session, 'Henting valgt', 'Innbygger valgte å hente syntetiske familie-, SFO- og inntektsopplysninger for denne sjekken.');
  audit(session, 'Familie hentet', family.source.detail);
  audit(session, 'SFO-plass hentet', sfo.source.detail);
  audit(session, income.value.annualNok === null ? 'Inntekt mangler' : 'Inntekt hentet', income.source.detail);
  // Providers yield; another request may have filled the store in the meantime.
  if (sessions.size >= MAX_SESSIONS) throw new CaseError('Demoen har mange aktive økter. Prøv igjen senere.', 503);
  sessions.set(session.id, session);
  return session;
}
export function getCase(id: string | undefined): CaseSession {
  const session = id ? sessions.get(id) : undefined;
  if (!session || session.expiresAt < Date.now()) {
    if (id) sessions.delete(id);
    throw new CaseError('Demoøkten er utløpt. Start på nytt for å hente opplysningene igjen.', 401);
  }
  return session;
}
export function caseView(session: CaseSession): CaseView {
  return structuredClone({
    id: session.id, createdAt: session.createdAt, scenario: session.scenario,
    data: session.data, answers: session.answers, assessment: session.assessment,
    receipt: session.receipt, audit: session.audit,
  });
}
export function updateCase(session: CaseSession, answers: Answers): CaseSession {
  if (session.receipt) throw new CaseError('Denne demoen er allerede bekreftet. Start en ny demo for å endre opplysningene.', 409);
  // Replace the answer set so going back can remove an earlier correction.
  session.answers = structuredClone(answers);
  session.assessment = assess(session.data, session.answers);
  audit(session, 'Opplysninger kontrollert', answers.correction || answers.currentIncomeNok !== undefined
    ? 'Ny opplysning fra innbygger er lagret separat. Registergrunnlaget er uendret.' : 'Innbygger har kontrollert opplysningene.');
  audit(session, 'Regelvurdering', `${session.assessment.ruleVersion}: ${session.assessment.status}. Ingen språkmodell deltok i beregningen.`);
  return session;
}
export function confirmCase(session: CaseSession, confirmed: boolean): CaseSession {
  if (!confirmed) throw new CaseError('Bekreft opplysningene før saken går videre.');
  if (session.receipt) return session;
  // Never trust a result supplied by a browser or explanation model.
  const assessment = assess(session.data, session.answers);
  if (assessment.status === 'missing') throw new CaseError('Fyll inn den manglende opplysningen før du bekrefter.', 409);
  session.assessment = assessment;
  session.receipt = {
    reference: `DEMO-${session.id.slice(0, 8).toUpperCase()}`,
    createdAt: new Date().toISOString(), status: ['manual', 'out-of-scope'].includes(assessment.status) ? 'manual-review' : 'ready-for-review',
    synthetic: true, event: 'application.confirmed', ruleVersion: assessment.ruleVersion,
  };
  audit(session, 'Innbygger bekreftet', 'Opplysningene og den foreløpige vurderingen er bekreftet.');
  audit(session, 'Lokal prosesshendelse', 'application.confirmed. Lokal demokvittering opprettet; ingenting er sendt til kommunen.');
  return session;
}
export function deleteCase(id: string | undefined) { if (id) sessions.delete(id); }
