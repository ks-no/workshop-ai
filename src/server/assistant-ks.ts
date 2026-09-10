import { randomUUID } from 'node:crypto';
import type { AssistantCase, EvidenceSource, FactKey } from '../domain/assistant-types';
import { citationFor, FACT_LABELS } from '../domain/assistant-verification';
import { KsDemoError, KS_DEMO_INCOME_PURPOSE, type KsDemoSnapshot } from '../providers/ks-demo-client';
import { ksClient, ksPersonId } from './ks-runtime';
import { CaseError } from './case-service';
import { invalidateAnalysis } from './assistant-service';
import { saveAssistantCase } from './assistant-store';

type Client = ReturnType<typeof ksClient>;
function source(id: string, title: string, snapshot: KsDemoSnapshot<unknown>, fields: unknown, purpose: string): EvidenceSource {
  return { id, kind: 'register', title: `KS API · ${title} (syntetiske testopplysninger)`,
    text: JSON.stringify(fields, null, 2), url: snapshot.source.url, retrievedAt: snapshot.source.retrievedAt,
    purpose, period: 'Øyeblikksbilde fra KS workshop. Et utvalg av API-feltene; identifikatorer er utelatt.' };
}
function record(session: AssistantCase, detail: string) {
  session.events.push({ id: randomUUID(), runId: '', agent: 'KS API', type: 'source-read', at: new Date().toISOString(), detail });
}
function addRegisterFact(session: AssistantCase, source: EvidenceSource, key: FactKey, value: string, quote: string) {
  const active = session.facts.filter(item => item.key === key && !['rejected', 'superseded'].includes(item.status));
  if (active.length) return;
  const citation = citationFor(source, quote);
  if (!citation) throw new CaseError('KS-kilden kunne ikke knyttes til den hentede opplysningen.', 502);
  session.facts.push({ id: randomUUID(), key, value, label: FACT_LABELS[key], status: 'confirmed', citation,
    createdAt: source.retrievedAt, confirmedAt: source.retrievedAt });
  record(session, `${FACT_LABELS[key]} ble fylt inn fra KS-kilden. Innbyggeren kan rette verdien uten en ekstra bekreftelse.`);
}
function report(error: unknown): never {
  if (error instanceof CaseError) throw error;
  if (error instanceof KsDemoError) throw new CaseError(error.message, error.code.startsWith('consent') ? 409 : 502);
  throw new CaseError('KS-tjenesten kunne ikke fullføre forespørselen. Kontroller tilkoblingen og prøv igjen.', 502);
}
export async function connectKs(session: AssistantCase, client: Client = ksClient()) {
  if (session.ksData) throw new CaseError('KS-opplysningene er allerede hentet i denne samtalen.', 409);
  try {
    const [household, sfo, rates] = await Promise.all([client.readHousehold(), client.readSfo(), client.readRates()]);
    const snapshots = [
      source('ks-household', 'Husstand', household, { type: household.value.type, kommune: household.value.kommune,
        kommunenummer: household.value.kommunenummer, medlemmer: household.value.medlemmer.map(({ rolle }) => ({ rolle })), syntetisk: true }, 'Forberede oversikt over husstanden.'),
      source('ks-sfo', 'SFO-plasser', sfo, sfo.value.map(({ sfonavn, kommune, trinn, manedspris, syntetisk }) => ({ sfonavn, kommune, trinn, manedspris, syntetisk })), 'Forberede vurdering av SFO-betaling.'),
      source('ks-rates', 'SFO-satser', rates, { gjelderFra: rates.value.gjelderFra, kilde: rates.value.kilde, merknad: rates.value.merknad,
        maksAndelAvInntekt: rates.value.maksAndelAvInntekt, maanederMedBetaling: rates.value.maanederMedBetaling,
        inntektsbegrep: rates.value.inntektsbegrep, ordninger: rates.value.ordninger.filter(item => item.tjeneste === 'sfo') }, 'Forstå reglene i KS-sandkassen.'),
    ];
    invalidateAnalysis(session);
    session.ksData = { personId: ksPersonId(), connectedAt: household.source.retrievedAt, incomeReadAt: null, consent: null };
    session.sources.push(...snapshots);
    if (sfo.value.length) addRegisterFact(session, snapshots[1], 'uses_sfo', 'true', `"sfonavn": ${JSON.stringify(sfo.value[0].sfonavn)}`);
    record(session, 'Hentet husstand, SFO-plasser og satser fra KS workshop API. Inntekt er ikke hentet.');
  } catch (error) { report(error); }
}
/** Keep response values and exact excerpts, but remove register identities before storage/model context. */
function withoutIdentities(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutIdentities);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !/personId|husstandId|foedselsnummer|fodselsnummer|^pid$|^navn$|^adresse$/i.test(key)).map(([key, item]) => [key, withoutIdentities(item)]));
  return value;
}
export async function consentAndReadIncome(session: AssistantCase, approved: boolean, client: Client = ksClient(), persist = saveAssistantCase) {
  if (!approved || !session.ksData || session.ksData.personId !== ksPersonId()) throw new CaseError('Hent KS-opplysningene og velg samtykke før inntekt kan leses.', 409);
  try {
    const granted = await client.grantIncomeConsent({ approved: true, caseId: session.id });
    invalidateAnalysis(session);
    session.ksData.consent = granted.value;
    session.ksData.incomeReadAt = null;
    session.sources = session.sources.filter(item => !['ks-income', 'ks-assessment'].includes(item.id));
    session.events.push({ id: randomUUID(), runId: '', agent: 'Innbygger', type: 'human', at: granted.source.retrievedAt,
      detail: `Samtykke registrert hos KS Fiks: ${KS_DEMO_INCOME_PURPOSE}.` });
    persist(session); // A granted upstream consent remains visible if a later read fails.
    const income = await client.readIncome(granted.value);
    const assessment = await client.readSfoAssessment(granted.value);
    const incomeSource = source('ks-income', 'Inntektsgrunnlag for SFO', income, {
      inntektsaar: income.value.inntektsaar, stadie: income.value.stadie, beregningsbeloep: income.value.beregningsbeloep,
      beregningstype: income.value.beregningstype, feilmeldinger: income.value.feilmeldinger, syntetisk: income.value.syntetisk,
    }, KS_DEMO_INCOME_PURPOSE);
    session.sources.push(incomeSource);
    session.sources.push(source('ks-assessment', 'Regelvurdering for SFO', assessment, withoutIdentities(assessment.value), KS_DEMO_INCOME_PURPOSE));
    addRegisterFact(session, incomeSource, 'household_income_annual', String(income.value.beregningsbeloep), `"beregningsbeloep": ${income.value.beregningsbeloep}`);
    addRegisterFact(session, incomeSource, 'income_basis', 'household_year', `"beregningstype": "${income.value.beregningstype}"`);
    session.ksData.incomeReadAt = income.source.retrievedAt;
    session.ksAccessDecision = { status: 'approved', decidedAt: income.source.retrievedAt };
    record(session, 'Leste inntektsgrunnlag og deterministisk SFO-vurdering fra KS etter kontrollert samtykke. Resultatet gjelder registerøyeblikksbildet.');
  } catch (error) { report(error); }
}
export function declineKsAccess(session: AssistantCase) {
  if (session.ksData?.incomeReadAt) throw new CaseError('KS-opplysningene er allerede hentet i denne samtalen.', 409);
  const decidedAt = new Date().toISOString();
  session.ksAccessDecision = { status: 'declined', decidedAt };
  session.events.push({ id: randomUUID(), runId: '', agent: 'Innbygger', type: 'human', at: decidedAt,
    detail: 'Innbyggeren valgte å fortsette uten å hente personopplysninger fra KS. Manuelle spørsmål er fortsatt tilgjengelige.' });
}
