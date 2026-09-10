import { randomUUID } from 'node:crypto';
import { componentForStep, FLOW_COMPONENTS } from '../domain/flow-components';
import { createReminder, createReview, recordMockEmail } from './flow-action-store';
import type { EvidenceSource } from '../domain/assistant-types';
import { CONTACT_POINTS } from '../domain/assistant-actions';
import { narrativeWithinEvidence } from '../domain/assistant-verification';
import { ACTION_LABELS, activeFacts, buildFlowForm, fallbackFlowEmail, FLOW_FORMS, FLOW_SOURCES, flowContact, narrativeOk, normalizeReminder, rulePlan, SANDBOX_NOTE, STEP_LABELS, templateFor, validDateString } from '../domain/flow-catalogue';
import { flowFetchables, type FlowCase, type FlowExecution, type FlowFact, type FlowFetchable, type FlowHistoryEntry, type FlowOutcome, type FlowProposal, type FlowQuestion, type FlowSource, type FlowStep } from '../domain/flow-types';
import { KsDemoError, KS_DEMO_INCOME_PURPOSE } from '../providers/ks-demo-client';
import { withoutIdentities } from './assistant-ks';
import { type ModelCall } from './assistant-model';
import { CaseError } from './case-service';
import { callFlowModel, FLOW_PLANNER_PROMPT, flowModelName, flowStepSchema, type FlowPlannerOutput } from './flow-model';
import { saveFlowCase } from './flow-store';
import { ksClient, ksPersonId } from './ks-runtime';

/**
 * The step pipeline. Every citizen command changes the case, then the planner proposes the
 * next step. The model may only propose; Node checks quotes, numbers, catalogue ids and
 * dates before a step is shown, and falls back to fixed rules when the model is unavailable.
 */
type Persist = (session: FlowCase) => void;
type KsClient = ReturnType<typeof ksClient>;
type PlannedStep = Omit<FlowStep, 'id' | 'createdAt' | 'revision' | 'durationMs' | 'model' | 'by'>;
const MODEL_SECURITY = { integrity: 'untrusted', confidentiality: 'private', allowedCapabilities: ['analyze'] } as const;
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
const NEUTRAL_MESSAGE = 'Kontroller opplysningene og kildene før du går videre. Demoen forbereder en sak; kommunen gjør vedtak.';
const NEUTRAL_RATIONALE = 'Begrunnelsen fra modellen inneholdt tall eller påstander uten kildegrunnlag og ble utelatt.';
const BOOLEAN_LABELS: Record<string, string> = { true: 'Ja', false: 'Nei', ja: 'Ja', nei: 'Nei', yes: 'Ja', no: 'Nei' };
const HOUSEHOLD_TYPES: Record<string, string> = { ENSLIG_FORSORGER: 'enslig forsørger', FAMILIE: 'familie', PAR: 'par', ENSLIG: 'enslig' };

const now = () => new Date().toISOString();
export function event(session: FlowCase, agent: string, type: FlowCase['events'][number]['type'], detail: string) {
  session.events.push({ id: randomUUID(), at: now(), agent, type, detail });
  if (session.events.length > 150) session.events = session.events.slice(-150);
}
function addSource(session: FlowCase, kind: FlowSource['kind'], title: string, text: string, pages?: FlowSource['pages']): FlowSource {
  if (session.sources.length >= 60) throw new CaseError('Saken har nådd kildegrensen. Start en ny sak.', 413);
  const source: FlowSource = { id: `${kind}-${randomUUID()}`, kind, title, text, at: now(), ...(pages ? { pages } : {}) };
  session.sources.push(source);
  return source;
}
function addFact(session: FlowCase, input: Omit<FlowFact, 'id' | 'createdAt'>): FlowFact {
  if (session.facts.length >= 120) throw new CaseError('Grensen for lagrede opplysninger er nådd.', 413);
  if (input.status === 'confirmed') session.facts.filter(fact => fact.key === input.key && fact.status === 'confirmed').forEach(fact => { fact.status = 'superseded'; });
  const fact: FlowFact = { id: randomUUID(), createdAt: now(), ...input };
  session.facts.push(fact);
  return fact;
}
const sameValue = (a: string, b: string) => a.trim().toLocaleLowerCase('nb-NO').replace(/\s+/g, ' ') === b.trim().toLocaleLowerCase('nb-NO').replace(/\s+/g, ' ');
const noteTitle = (session: FlowCase) => `Melding ${session.sources.filter(source => source.kind === 'note').length + 1}`;

/** Every citizen command starts a new revision, so a stale tab cannot act on an older step. */
export function bumpRevision(session: FlowCase) { session.revision++; session.error = null; session.notice = null; }
function closeStep(session: FlowCase, result: string) {
  const step = session.step;
  if (!step) return;
  const entry: FlowHistoryEntry = { kind: step.kind, title: step.title, by: step.by, result, at: now() };
  session.history.push(entry);
  if (session.history.length > 30) session.history = session.history.slice(-30);
  session.step = null;
}

export function addInput(session: FlowCase, text: string) {
  const trimmed = text.trim();
  if (!trimmed) throw new CaseError('Skriv hva du trenger hjelp med.');
  if (!session.situation) { session.situation = trimmed; addSource(session, 'situation', 'Din beskrivelse', trimmed); }
  else addSource(session, 'note', noteTitle(session), trimmed);
  closeStep(session, 'Ny melding fra deg');
  session.status = 'collecting';
  event(session, 'Innbygger', 'human', 'Ny beskrivelse lagret som kilde. Teksten er ubetrodd data for modellen, ikke instruksjoner.');
  return 'input';
}
export function addFlowDocument(session: FlowCase, source: EvidenceSource) {
  if (session.sources.filter(item => item.kind === 'document').length >= 4) throw new CaseError('Du kan legge til inntil fire dokumenter per sak.', 413);
  const stored = addSource(session, 'document', source.title, source.text, source.pages);
  closeStep(session, 'Nytt dokument fra deg');
  event(session, 'Innbygger', 'human', `La til dokumentet «${source.title}». Innholdet er ubetrodd tekst som du må kontrollere.`);
  return stored;
}

function normalizeAnswer(question: FlowQuestion, raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.length > 400) throw new CaseError(`Svaret på «${question.label}» er for langt.`);
  if (question.kind === 'number') {
    const digits = value.replace(/[ \u00a0\u202f]/g, '');
    if (!/^\d{1,12}$/.test(digits)) throw new CaseError(`«${question.label}» må være et helt tall.`);
    return digits;
  }
  if (question.kind === 'date') { if (!validDateString(value)) throw new CaseError(`«${question.label}» må være en dato på formen ÅÅÅÅ-MM-DD.`); return value; }
  if (question.kind === 'boolean') {
    const label = BOOLEAN_LABELS[value.toLocaleLowerCase('nb-NO')];
    if (!label) throw new CaseError(`«${question.label}» må besvares med ja eller nei.`);
    return label;
  }
  if (question.kind === 'select' && question.options.length && !question.options.includes(value)) throw new CaseError(`«${question.label}» må være ett av alternativene.`);
  return value;
}
/** Answers become confirmed citizen facts directly; the model never gets to reinterpret a labelled field. */
export function answerQuestions(session: FlowCase, answers: { key: string; value: string }[], note: string) {
  const step = session.step;
  if (!step || step.kind !== 'ask') throw new CaseError('Det er ingen spørsmål å svare på nå.', 409);
  const lines: { question: FlowQuestion; value: string }[] = [];
  const seen = new Set<string>();
  for (const answer of answers) {
    const question = step.questions.find(item => item.key === answer.key);
    if (!question) throw new CaseError('Svaret gjaldt et ukjent spørsmål. Last inn siden på nytt.');
    if (seen.has(answer.key)) throw new CaseError('Hvert spørsmål kan bare besvares én gang.');
    seen.add(answer.key);
    const value = normalizeAnswer(question, answer.value);
    if (value !== null) lines.push({ question, value });
  }
  const unanswered = step.questions.filter(question => !lines.some(line => line.question.key === question.key)).map(question => question.key);
  session.skipped = [...new Set([...session.skipped, ...unanswered])].slice(-40);
  if (lines.length) {
    const source = addSource(session, 'answers', 'Dine svar', lines.map(line => `${line.question.label}: ${line.value}`).join('\n'));
    for (const line of lines) {
      addFact(session, { key: line.question.key, label: line.question.label, value: line.value, origin: 'citizen', status: 'confirmed', sourceId: source.id, quote: `${line.question.label}: ${line.value}`, detail: 'Oppgitt av deg i spørsmålsskjemaet.' });
    }
  }
  const trimmedNote = note.trim();
  if (trimmedNote) addSource(session, 'note', noteTitle(session), trimmedNote);
  closeStep(session, lines.length ? `${lines.length} svar lagret` : 'Hoppet over');
  event(session, 'Innbygger', 'human', lines.length ? `${lines.length} svar lagret som bekreftede opplysninger.` : 'Spørsmålene ble hoppet over.');
  return lines.length || trimmedNote ? 'answers' : 'questions-skipped';
}

/** Approval covers every fact shown. Edited values become the citizen's own; declined KS sources are remembered. */
export async function approveReview(session: FlowCase, input: { facts: { id: string; value: string }[]; remove: string[]; fetch: FlowFetchable[]; note: string }, client?: KsClient) {
  const step = session.step;
  if (!step || step.kind !== 'review') throw new CaseError('Det er ingen opplysninger å godkjenne nå.', 409);
  const active = activeFacts(session).filter(fact => step.factIds.includes(fact.id));
  const ids = [...input.facts.map(fact => fact.id), ...input.remove];
  if (new Set(ids).size !== ids.length || ids.some(id => !active.some(fact => fact.id === id)) || input.fetch.some(source => !step.fetch.includes(source))) throw new CaseError('Godkjenningen inneholder opplysninger eller kilder som ikke ble vist.', 409);
  for (const id of input.remove) {
    const fact = active.find(item => item.id === id);
    if (fact) { fact.status = 'rejected'; event(session, 'Innbygger', 'human', `${fact.label}: fjernet av deg.`); }
  }
  for (const item of input.facts) {
    const fact = active.find(candidate => candidate.id === item.id);
    if (!fact || fact.status === 'rejected') continue;
    const value = item.value.trim();
    if (!value) throw new CaseError(`«${fact.label}» kan ikke være tom. Fjern opplysningen i stedet.`);
    if (value.length > 400) throw new CaseError(`«${fact.label}» er for lang.`);
    if (value !== fact.value) {
      fact.value = value; fact.origin = 'citizen'; fact.quote = null; fact.detail = 'Rettet av deg i kontrollen.';
      event(session, 'Innbygger', 'human', `${fact.label}: rettet av deg.`);
    }
    fact.status = 'confirmed';
  }
  const latestByKey = new Map<string, FlowFact>();
  for (const fact of session.facts.filter(item => item.status === 'confirmed')) {
    const previous = latestByKey.get(fact.key);
    if (previous) previous.status = 'superseded';
    latestByKey.set(fact.key, fact);
  }
  const trimmedNote = input.note.trim();
  if (trimmedNote) addSource(session, 'note', noteTitle(session), trimmedNote);
  const requested = input.fetch.filter(source => step.fetch.includes(source) && !session.ks.fetched.includes(source));
  const declined = step.fetch.filter(source => !requested.includes(source) && !session.ks.fetched.includes(source));
  if (declined.length) {
    session.ks.declined = [...new Set([...session.ks.declined, ...declined])];
    event(session, 'Innbygger', 'human', `Valgte å ikke hente: ${declined.map(source => FLOW_SOURCES[source].lower).join(', ')}. Opplysningene kan fylles inn manuelt.`);
  }
  const failures: string[] = [];
  for (const source of requested) {
    try { await fetchKsSource(session, source, client); }
    catch (error) {
      const message = error instanceof CaseError ? error.message : 'KS-tjenesten svarte ikke.';
      failures.push(`${FLOW_SOURCES[source].title}: ${message}`);
      event(session, 'KS API', 'failed', `${FLOW_SOURCES[source].title} kunne ikke hentes. ${message}`);
    }
  }
  if (failures.length) session.notice = `Noen KS-opplysninger kunne ikke hentes. ${failures.join(' ')} Du kan fylle dem inn selv.`;
  closeStep(session, 'Godkjent av deg');
  event(session, 'Innbygger', 'human', 'Opplysningene er kontrollert og godkjent.');
  return requested.length > failures.length ? 'review-approved-and-fetched' : 'review-approved';
}

function registerFact(session: FlowCase, source: FlowSource, key: string, label: string, value: string, quote: string) {
  const collision = activeFacts(session).find(fact => fact.key === key && fact.status === 'confirmed' && !sameValue(fact.value, value));
  addFact(session, { key, label, value, origin: 'ks', status: collision ? 'proposed' : 'confirmed', sourceId: source.id, quote,
    detail: collision ? `Hentet fra ${source.title}. Avviker fra det du oppga; fjern den verdien som ikke gjelder.` : `Hentet fra ${source.title}.` });
}
/** One KS source at a time. Register snapshots are stored without identities; facts get an exact quote from the snapshot. */
export async function fetchKsSource(session: FlowCase, source: FlowFetchable, client?: KsClient) {
  if (session.ks.fetched.includes(source)) return;
  const ks = client ?? ksClient();
  const at = now();
  try {
    if (source === 'husstand') {
      const household = await ks.readHousehold();
      const members = household.value.medlemmer;
      const adults = members.filter(member => member.rolle !== 'barn').length;
      const children = members.filter(member => member.rolle === 'barn').length;
      const type = household.value.type;
      const stored = addSource(session, 'register', FLOW_SOURCES.husstand.title,
        JSON.stringify(withoutIdentities({ type, kommune: household.value.kommune, kommunenummer: household.value.kommunenummer, medlemmer: members.map(({ rolle }) => ({ rolle })), syntetisk: true }), null, 2));
      registerFact(session, stored, 'household', 'Husstand', `${adults} ${adults === 1 ? 'voksen' : 'voksne'}, ${children} barn (${HOUSEHOLD_TYPES[type] ?? type.toLocaleLowerCase('nb-NO').replace(/_/g, ' ')})`, `"type": ${JSON.stringify(type)}`);
      registerFact(session, stored, 'municipality', 'Kommune', household.value.kommune, `"kommune": ${JSON.stringify(household.value.kommune)}`);
    } else if (source === 'sfo') {
      const [places, rates] = await Promise.all([ks.readSfo(), ks.readRates()]);
      const placeSource = addSource(session, 'register', FLOW_SOURCES.sfo.title,
        JSON.stringify(places.value.map(({ sfonavn, kommune, trinn, manedspris, syntetisk }) => ({ sfonavn, kommune, trinn, manedspris, syntetisk })), null, 2));
      const place = places.value[0];
      if (place) {
        registerFact(session, placeSource, 'sfo_place', 'SFO-plass', `${place.sfonavn}, ${place.trinn}. trinn`, `"sfonavn": ${JSON.stringify(place.sfonavn)}`);
        registerFact(session, placeSource, 'sfo_monthly_price', 'Månedspris for SFO-plassen (kr)', String(place.manedspris), `"manedspris": ${place.manedspris}`);
      } else registerFact(session, placeSource, 'sfo_place', 'SFO-plass', 'Ingen registrert SFO-plass', '[]');
      const schemes = rates.value.ordninger.filter(item => item.tjeneste === 'sfo');
      const ratesSource = addSource(session, 'register', 'Satser for SFO i kommunen',
        JSON.stringify({ gjelderFra: rates.value.gjelderFra, kilde: rates.value.kilde, maksAndelAvInntekt: rates.value.maksAndelAvInntekt, maanederMedBetaling: rates.value.maanederMedBetaling, ordninger: schemes }, null, 2));
      registerFact(session, ratesSource, 'sfo_rates', 'Satser for SFO', `Maks ${Math.round(rates.value.maksAndelAvInntekt * 100)} % av husholdningens inntekt. ${schemes.map(item => `${item.navn}${item.inntektsgrense ? ` (inntektsgrense ${item.inntektsgrense} kr)` : ''}`).join('; ')}`, `"maksAndelAvInntekt": ${rates.value.maksAndelAvInntekt}`);
    } else {
      const granted = await ks.grantIncomeConsent({ approved: true, caseId: session.id });
      session.ks.consent = granted.value;
      event(session, 'Innbygger', 'human', `Samtykke registrert hos KS Fiks: ${KS_DEMO_INCOME_PURPOSE}.`);
      const income = await ks.readIncome(granted.value);
      const assessment = await ks.readSfoAssessment(granted.value);
      const incomeSource = addSource(session, 'register', 'Inntektsgrunnlag',
        JSON.stringify({ inntektsaar: income.value.inntektsaar, stadie: income.value.stadie, beregningsbeloep: income.value.beregningsbeloep, beregningstype: income.value.beregningstype, feilmeldinger: income.value.feilmeldinger, syntetisk: income.value.syntetisk }, null, 2));
      registerFact(session, incomeSource, 'household_income_annual', 'Husholdningens årsinntekt (kr)', String(income.value.beregningsbeloep), `"beregningsbeloep": ${income.value.beregningsbeloep}`);
      registerFact(session, incomeSource, 'income_year', 'Inntektsår', String(income.value.inntektsaar), `"inntektsaar": ${income.value.inntektsaar}`);
      const assessmentSource = addSource(session, 'register', 'Regelvurdering for redusert SFO-betaling', JSON.stringify(withoutIdentities(assessment.value), null, 2));
      registerFact(session, assessmentSource, 'ks_sfo_assessment', 'KS regelvurdering for redusert SFO-betaling', `${assessment.value.godkjent ? 'Vilkår oppfylt' : 'Vilkår ikke oppfylt'}: ${assessment.value.melding}`, `"godkjent": ${assessment.value.godkjent}`);
    }
    session.ks.fetched.push(source); session.ks.fetchedAt = at; session.ks.personId = ksPersonId();
    event(session, 'KS API', 'source-read', `Hentet ${FLOW_SOURCES[source].lower} fra ${FLOW_SOURCES[source].api}. ${SANDBOX_NOTE}.`);
  } catch (error) {
    if (error instanceof CaseError) throw error;
    if (error instanceof KsDemoError) throw new CaseError(error.message, error.code.startsWith('consent') ? 409 : 502);
    throw new CaseError('KS-tjenesten kunne ikke fullføre forespørselen. Kontroller at KS-tjenestene kjører (npm run start:ks).', 502);
  }
}

function reviewSummary(session: FlowCase) {
  return [session.situation, ...session.facts.filter(fact => fact.status === 'confirmed').map(fact => `${fact.label}: ${fact.value}`)].join('\n').slice(0, 4000);
}

/** Validate before storing a draft, and again before dispatch. No side effects here. */
export function validateExecution(session: FlowCase, execution: FlowExecution): FlowExecution {
  const proposal = session.step?.kind === 'action' ? session.step.proposal : null;
  if (!proposal || proposal.type !== execution.type) throw new CaseError('Handlingen samsvarer ikke med det gjeldende forslaget.', 409);
  if (execution.type === 'email') {
    const to = execution.to.trim(), subject = execution.subject.trim(), body = execution.body.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || to.length > 200) throw new CaseError('Oppgi én gyldig e-postadresse til mottakeren.');
    if (!subject || subject.length > 160 || /[\r\n]/.test(subject) || !body || body.length > 4000) throw new CaseError('Kontroller e-postens emne og tekst.');
    return { type: 'email', to, subject, body };
  }
  if (execution.type === 'form' && proposal.type === 'form') {
    if (Object.keys(execution.fields).some(id => !proposal.fields.some(field => field.id === id))) throw new CaseError('Skjemaet inneholdt et ukjent felt.');
    return { type: 'form', fields: Object.fromEntries(proposal.fields.map(field => {
      const value = (execution.fields[field.id] ?? field.value).trim();
      if (!field.editable && value !== field.value) throw new CaseError(`«${field.label}» må rettes i opplysningskontrollen.`, 409);
      if (field.required && !value) throw new CaseError(`«${field.label}» må fylles ut.`);
      if (value.length > 1000) throw new CaseError(`«${field.label}» er for lang.`);
      return [field.id, value];
    })) };
  }
  if (execution.type === 'reminder') {
    if (!validDateString(execution.date) || (execution.time !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(execution.time))) throw new CaseError('Velg en gyldig dato og klokkeslett.');
    if (!execution.title.trim() || execution.title.length > 120 || execution.note.length > 400) throw new CaseError('Kontroller påminnelsens tittel og merknad.');
    return { ...execution, title: execution.title.trim(), note: execution.note.trim(), time: execution.time || '09:00' };
  }
  if (execution.type === 'contact') {
    const summary = (execution.summary ?? (proposal.type === 'contact' ? proposal.summary : '') ?? reviewSummary(session)).trim();
    if (!summary || summary.length > 4000) throw new CaseError('Sammendraget må ha mellom ett og 4000 tegn.');
    return { type: 'contact', summary };
  }
  throw new CaseError('Handlingen kunne ikke kontrolleres.');
}

/** Called only by the approval executor after its durable dispatch claim. */
export async function executeAction(session: FlowCase, execution: FlowExecution, client?: KsClient): Promise<FlowOutcome> {
  execution = validateExecution(session, execution);
  const step = session.step;
  if (!step || step.kind !== 'action' || !step.proposal) throw new CaseError('Det er ingen foreslått handling å utføre nå.', 409);
  if (step.proposal.type !== execution.type) throw new CaseError('Handlingen samsvarer ikke med forslaget. Last inn siden på nytt.', 409);
  const reference = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const base = { id: randomUUID(), createdAt: now(), revision: session.revision };
  let outcome: FlowOutcome;
  if (execution.type === 'email' && step.proposal.type === 'email') {
    const to = execution.to.trim(); const subject = execution.subject.trim(); const body = execution.body.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || to.length > 200) throw new CaseError('Oppgi én gyldig e-postadresse til mottakeren.');
    if (!subject || subject.length > 160 || !body || body.length > 4000) throw new CaseError('E-posten må ha et emne og en tekst på inntil 4000 tegn.');
    const saved = recordMockEmail(session.id, base.id, { to, subject, body });
    outcome = { ...base, kind: 'email', status: 'mocked', resourceId: saved.id, title: subject, reference: reference('DEMO-EPOST'), localOnly: true, recipient: step.proposal.contact,
      detail: 'Godkjent melding er lagret i demoens utboks. Dette er en simulert e-post; ingenting er sendt til mottakeren.', payload: { to, subject, body } };
  } else if (execution.type === 'form' && step.proposal.type === 'form') {
    const proposal = step.proposal;
    if (Object.keys(execution.fields).some(id => !proposal.fields.some(field => field.id === id))) throw new CaseError('Skjemaet inneholdt et ukjent felt.');
    const filled = proposal.fields.map(field => {
      const value = (execution.fields[field.id] ?? field.value).trim();
      if (!field.editable && value !== field.value) throw new CaseError(`«${field.label}» er en bekreftet opplysning. Rett den i kontrollen, så oppdateres skjemaet.`, 409);
      if (field.required && !value) throw new CaseError(`«${field.label}» må fylles ut.`);
      if (value.length > 1000) throw new CaseError(`«${field.label}» kan ha høyst 1000 tegn.`);
      return { id: field.id, label: field.label, value };
    });
    if (proposal.submission === 'ks-sandbox') {
      const template = templateFor(proposal.templateId);
      if (!template?.ksProcess) throw new CaseError('Dette skjemaet kan ikke sendes til KS-sandkassen.', 409);
      const ks = client ?? ksClient();
      let created: Awaited<ReturnType<KsClient['createApplication']>>;
      try { created = await ks.createApplication({ ...template.ksProcess, caseId: session.id }); }
      catch (error) {
        if (error instanceof KsDemoError) throw new CaseError(error.message, 502);
        throw new CaseError('KS-sandkassen kunne ikke ta imot testsøknaden. Kontroller at KS-tjenestene kjører (npm run start:ks).', 502);
      }
      const receipt = { soknadId: created.value.soknadId, prosessId: created.value.prosessId, status: created.value.status, opprettet: created.value.opprettet,
        oppgaveId: created.value.oppgave?.oppgaveId ?? null, advarsel: created.value.oppgave?.advarsel ?? null, syntetisk: true };
      if (session.sources.length < 60) addSource(session, 'register', 'KS API · Kvittering for testsøknad', JSON.stringify(receipt, null, 2));
      event(session, 'KS API', 'source-read', `Sendte testsøknaden «${template.ksProcess.prosessNavn}» til KS workshop API. Søknads-ID ${receipt.soknadId}${receipt.oppgaveId ? `, saksbehandleroppgave ${receipt.oppgaveId}` : ''}.`);
      outcome = { ...base, kind: 'form', status: 'submitted', title: proposal.title, reference: receipt.soknadId, localOnly: false, recipient: proposal.recipient,
        detail: receipt.oppgaveId ? 'Testsøknaden er registrert i KS-sandkassen, og en saksbehandleroppgave er opprettet i Fiks-simulatoren.' : 'Testsøknaden er registrert i KS-sandkassen. Saksbehandleroppgaven kunne ikke opprettes.',
        payload: { fields: filled, ksSoknadId: receipt.soknadId, ksOppgaveId: receipt.oppgaveId, ksWarning: receipt.advarsel } };
    } else {
      outcome = { ...base, kind: 'form', status: 'prepared', title: proposal.title, reference: reference('SKJEMA'), localOnly: true, recipient: proposal.recipient,
        detail: `Skjemaet er kontrollert av deg og klargjort lokalt. Selve innsendingen gjør du hos ${proposal.recipient.name}.`, payload: { fields: filled } };
    }
  } else if (execution.type === 'reminder' && step.proposal.type === 'reminder') {
    const today = now().slice(0, 10);
    if (!validDateString(execution.date) || execution.date < today) throw new CaseError('Påminnelsen må ha en dato som er i dag eller senere.');
    const title = execution.title.trim();
    if (!title) throw new CaseError('Påminnelsen må ha en tittel.');
    const reminder = createReminder(session.id, base.id, execution, session.expiresAt);
    outcome = { ...base, kind: 'reminder', status: 'scheduled', resourceId: reminder.id, title, reference: reference('PAAMINNELSE'), localOnly: true, recipient: null,
      detail: 'Påminnelsen er planlagt i Europe/Oslo. Varslet vises i denne appen når tiden er inne. Bakgrunnsarbeideren må kjøre; saken kan gjenåpnes etter at nettleseren er lukket.', payload: { date: execution.date, time: execution.time, note: execution.note.trim() } };
  } else if (execution.type === 'contact' && step.proposal.type === 'contact') {
    const review = createReview(session.id, base.id, { title: `Vurdering: ${step.proposal.contact.name}`, summary: execution.summary!, recipient: step.proposal.contact });
    outcome = { ...base, kind: 'contact', status: 'queued', resourceId: review.id, title: `Menneskelig vurdering`, reference: reference('VURDERING'), localOnly: true, recipient: step.proposal.contact,
      detail: 'Det godkjente sammendraget ligger i demoens lokale kø for menneskelig vurdering. Det er ikke sendt til en kommune eller NAV.', payload: { body: execution.summary } };
  } else throw new CaseError('Handlingen samsvarer ikke med forslaget.', 409);
  session.outcomes.push(outcome);
  closeStep(session, `Utført: ${outcome.title}`);
  session.status = 'acted';
  event(session, 'Innbygger', 'human', `${ACTION_LABELS[outcome.kind]} godkjent og utført av deg (${outcome.reference}).`);
  return outcome;
}
export function skipProposal(session: FlowCase) {
  if (!session.step || session.step.kind !== 'action') throw new CaseError('Det er ingen foreslått handling å hoppe over.', 409);
  closeStep(session, 'Hoppet over av deg');
  event(session, 'Innbygger', 'human', 'Den foreslåtte handlingen ble hoppet over. Assistenten foreslår noe annet.');
  return 'action-skipped';
}
export function continueFlow(session: FlowCase) {
  if (session.status !== 'acted' && session.step?.kind !== 'done') throw new CaseError('Det er ingen fullført handling å gå videre fra.', 409);
  closeStep(session, 'Gikk videre');
  return session.outcomes.length ? 'action-done' : 'continue';
}
export function retryFlow(session: FlowCase) {
  if (!session.situation) throw new CaseError('Beskriv situasjonen din først.');
  closeStep(session, 'Prøvd på nytt');
  return 'retry';
}

/** Citizen corrections invalidate an action rather than changing an approved payload. */
export function reviewFlowFacts(session: FlowCase) {
  closeStep(session, 'Rett opplysninger');
  const step: PlannedStep = { kind: 'review', title: 'Kontroller opplysningene dine', message: 'Rett eller fjern opplysninger. Et nytt handlingsutkast må godkjennes etterpå.', rationale: 'Du ba om å rette saken.', questions: [], factIds: activeFacts(session).map(fact => fact.id), fetch: [], next: null, proposal: null };
  session.step = { ...step, component: componentForStep(step), id: randomUUID(), createdAt: now(), revision: session.revision, durationMs: 0, model: null, by: 'rule' };
  session.status = 'step'; session.stepCount++;
}

/** Explicit user intent can select a capability even when model inference is unavailable. */
export function chooseFlowAction(session: FlowCase, type: FlowExecution['type'], templateId?: string) {
  if (!session.situation) throw new CaseError('Beskriv situasjonen først.');
  const selectedTemplate = templateId ? templateFor(templateId) : null;
  if (templateId && (type !== 'form' || !selectedTemplate)) throw new CaseError('Velg et skjema som finnes i tjenestekatalogen.');
  const contact = flowContact('citizen-service');
  let proposal: FlowProposal;
  if (type === 'email') proposal = { type, contact, ...fallbackFlowEmail(session, contact), aiDrafted: false };
  else if (type === 'contact') proposal = { type, contact, reason: 'Du ønsker hjelp fra et menneske.', summary: reviewSummary(session) };
  else if (type === 'reminder') proposal = normalizeReminder(session, {}, 'Følg opp saken').proposal;
  else {
    const forms = FLOW_FORMS.map(template => buildFlowForm(session, template));
    proposal = selectedTemplate ? buildFlowForm(session, selectedTemplate) : forms.find(form => form.fields.every(field => !field.required || !!field.value)) ?? buildFlowForm(session, FLOW_FORMS.at(-1)!);
    // The generic citizen-authored request is editable, including its subject.
    if (proposal.templateId === 'general-request') proposal.fields = proposal.fields.map(field => ({ ...field, editable: true }));
  }
  closeStep(session, 'Du valgte neste handling');
  const step: PlannedStep = { kind: 'action', title: ACTION_LABELS[type], message: 'Kontroller innholdet. Deretter får du se det lagrede utkastet før du godkjenner.', rationale: 'Du valgte denne handlingen.', questions: [], factIds: activeFacts(session).map(fact => fact.id), fetch: [], next: null, proposal };
  session.step = { ...step, component: componentForStep(step), id: randomUUID(), createdAt: now(), revision: session.revision, durationMs: 0, model: null, by: 'rule' };
  session.status = 'step'; session.stepCount++;
}

/** The bounded, identity-free case view the planner sees. Register snapshots stay server-side; only their facts travel. */
export function buildFlowContext(session: FlowCase, lastEvent: string, previous: FlowHistoryEntry | null) {
  return {
    _security: MODEL_SECURITY, today: now().slice(0, 10), responseLanguage: 'Norwegian Bokmål (norsk bokmål)', lastEvent,
    situation: session.situation,
    sources: session.sources.filter(source => source.kind !== 'register').slice(-12).map(({ id, kind, title, text }) => ({ id, kind, title, text: text.slice(0, 6000) })),
    facts: activeFacts(session).map(({ id, key, label, value, origin, status }) => ({ id, key, label, value, origin, status })),
    skipped: session.skipped,
    ksSources: {
      available: flowFetchables.filter(source => !session.ks.fetched.includes(source) && !session.ks.declined.includes(source)).map(source => ({ id: source, title: FLOW_SOURCES[source].title, description: FLOW_SOURCES[source].description })),
      fetched: session.ks.fetched, declined: session.ks.declined,
    },
    catalogue: {
      components: FLOW_COMPONENTS,
      forms: FLOW_FORMS.map(form => ({ id: form.id, title: form.title, recipient: CONTACT_POINTS[form.recipientId].name, submission: form.submission, description: form.description, fields: form.fields.map(({ id, label, kind, required }) => ({ id, label, kind, required })) })),
      contacts: Object.values(CONTACT_POINTS).map(({ id, name, role, organisation }) => ({ id, name, role, organisation })),
    },
    previousStep: previous, history: session.history.slice(-8),
    outcomes: session.outcomes.map(({ kind, title, reference, createdAt, status, detail }) => ({ kind, title, reference, createdAt, status, detail })),
  };
}

function addProposedFact(session: FlowCase, proposed: FlowPlannerOutput['facts'][number]): boolean {
  const source = session.sources.find(item => item.id === proposed.sourceId && item.kind !== 'register');
  const key = proposed.key.trim(); const value = proposed.value.trim(); const quote = proposed.quote.trim(); const label = proposed.label.trim().slice(0, 120);
  if (!source || !KEY_PATTERN.test(key) || !value || !quote || !source.text.includes(quote)) {
    event(session, 'Kontroll', 'blocked', `Et KI-forslag (${label || key}) manglet et ordrett sitat fra kilden og ble utelatt.`);
    return false;
  }
  if (/\d/.test(value) && !narrativeWithinEvidence(value, quote)) {
    event(session, 'Kontroll', 'blocked', `Et KI-forslag (${label || key}) hadde et tall som ikke står i sitatet og ble utelatt.`);
    return false;
  }
  if (activeFacts(session).some(fact => fact.key === key && sameValue(fact.value, value))) return false;
  addFact(session, { key, label: label || key, value: value.slice(0, 200), origin: source.kind === 'document' ? 'document' : 'citizen', status: 'proposed', sourceId: source.id, quote,
    detail: source.kind === 'document' ? `KI-forslag fra dokumentet «${source.title}».` : 'KI-forslag fra det du skrev.' });
  return true;
}
function buildProposal(session: FlowCase, action: NonNullable<FlowPlannerOutput['action']>, title: string): FlowProposal | null {
  if (action.type === 'email') {
    const contact = flowContact(action.contactId);
    const subject = (action.subject ?? '').trim(); const body = (action.body ?? '').trim();
    if (subject && body && narrativeOk(subject, session) && narrativeOk(body, session) && !/\[[^\]]+\]/.test(body)) {
      return { type: 'email', contact, subject: subject.slice(0, 160), body: body.slice(0, 3000), aiDrafted: true };
    }
    event(session, 'Kontroll', 'blocked', 'KI-utkastet til e-post manglet innhold eller inneholdt tall/påstander uten grunnlag. Et fast utkast brukes i stedet.');
    return { type: 'email', contact, ...fallbackFlowEmail(session, contact), aiDrafted: false };
  }
  if (action.type === 'form') {
    const template = templateFor(action.templateId);
    if (!template) { event(session, 'Kontroll', 'blocked', 'Modellen foreslo et skjema som ikke finnes i katalogen.'); return null; }
    const proposal = buildFlowForm(session, template, action.fields ?? []);
    // A form is only proposed once every required field rests on a confirmed or register fact; free text is never enough.
    const unconfirmed = proposal.fields.filter(field => field.required && !['confirmed', 'register'].includes(field.origin));
    if (unconfirmed.length) { event(session, 'Kontroll', 'blocked', `Skjemaet manglet bekreftede opplysninger for ${unconfirmed.map(field => field.label).join(', ')}. Opplysningene må bekreftes eller hentes først.`); return null; }
    return proposal;
  }
  if (action.type === 'reminder') {
    const { proposal, adjusted } = normalizeReminder(session, { title: action.subject, date: action.date, time: action.time, note: action.note }, title);
    if (adjusted) event(session, 'Kontroll', 'blocked', 'Påminnelsen fra modellen hadde en ugyldig dato eller en merknad uten grunnlag og ble justert.');
    return proposal;
  }
  const contact = flowContact(action.contactId);
  const reason = (action.reason ?? '').trim();
  return { type: 'contact', contact, reason: reason && narrativeOk(reason, session) ? reason : 'En person kan hjelpe deg videre med saken.', summary: reviewSummary(session) };
}
/** Turn a schema-valid model output into a step, or null when nothing verifiable remains. */
function normalizeStep(session: FlowCase, output: FlowPlannerOutput, lastEvent: string): PlannedStep | null {
  const clean = (text: string, fallback: string, what: string) => {
    const value = text.trim();
    if (!value) return fallback;
    if (narrativeOk(value, session)) return value;
    event(session, 'Kontroll', 'blocked', `${what} fra modellen inneholdt tall uten kildegrunnlag eller en påstand om vedtak/innsending og ble utelatt.`);
    return fallback;
  };
  const title = output.title.trim().slice(0, 120) || STEP_LABELS[output.kind];
  const base = { title, message: clean(output.message, NEUTRAL_MESSAGE, 'Meldingen'), rationale: clean(output.rationale, NEUTRAL_RATIONALE, 'Begrunnelsen'), questions: [] as FlowQuestion[], factIds: [] as string[], fetch: [] as FlowFetchable[], next: null, proposal: null };
  const known = new Set(activeFacts(session).map(fact => fact.key));
  if (output.kind === 'ask') {
    const seen = new Set<string>();
    const questions: FlowQuestion[] = output.questions
      .filter(question => KEY_PATTERN.test(question.key) && !known.has(question.key) && !session.skipped.includes(question.key) && !seen.has(question.key) && !!seen.add(question.key))
      .slice(0, 5)
      .map(question => ({ key: question.key, label: question.label.trim().slice(0, 160), kind: question.kind, hint: question.hint ? clean(question.hint, '', 'Hjelpeteksten') || null : null,
        options: question.kind === 'select' ? (question.options ?? []).slice(0, 8) : [], required: question.required ?? true }));
    if (!questions.length) { event(session, 'Kontroll', 'blocked', 'Modellen spurte bare om opplysninger som allerede finnes eller er hoppet over.'); return null; }
    return { ...base, kind: 'ask', questions, factIds: activeFacts(session).map(fact => fact.id) };
  }
  if (output.kind === 'review') {
    let added = 0;
    for (const proposed of output.facts) if (addProposedFact(session, proposed)) added++;
    const fetch = output.fetch.filter(source => !session.ks.fetched.includes(source) && !session.ks.declined.includes(source));
    const facts = activeFacts(session);
    if (!facts.length && !fetch.length) { event(session, 'Kontroll', 'blocked', 'Modellen foreslo en kontroll uten opplysninger eller kilder.'); return null; }
    if (!added && !fetch.length && !facts.some(fact => fact.status === 'proposed') && lastEvent.startsWith('review-approved')) { event(session, 'Kontroll', 'blocked', 'Modellen gjentok en kontroll uten noe nytt.'); return null; }
    return { ...base, kind: 'review', factIds: facts.map(fact => fact.id), fetch, next: output.next ? clean(output.next, '', 'Teksten om neste steg') || null : null };
  }
  if (output.kind === 'action') {
    if (!output.action) { event(session, 'Kontroll', 'blocked', 'Modellen foreslo en handling uten innhold.'); return null; }
    const proposal = buildProposal(session, output.action, title);
    if (!proposal) return null;
    return { ...base, kind: 'action', factIds: activeFacts(session).map(fact => fact.id), proposal };
  }
  return { ...base, kind: 'done', factIds: activeFacts(session).map(fact => fact.id) };
}

/** One planner call per citizen command. The model proposes; validation and the rule fallback keep the flow moving. */
export async function planNextStep(session: FlowCase, lastEvent: string, infer: ModelCall = callFlowModel, persist: Persist = saveFlowCase) {
  const previous = session.history.at(-1) ?? null;
  session.step = null; session.status = 'thinking'; session.error = null;
  const revision = session.revision; const startedAt = Date.now();
  event(session, 'Planlegger', 'started', 'Leser saken og vurderer neste steg.');
  persist(session);
  let output: FlowPlannerOutput | null = null; let failure: string | null = null;
  try { output = await infer(FLOW_PLANNER_PROMPT, buildFlowContext(session, lastEvent, previous), flowStepSchema, 'triage'); }
  catch (error) { failure = error instanceof Error ? error.message : 'Modellen svarte ikke.'; }
  if (session.revision !== revision) throw new CaseError('Opplysningene er endret. Prøv igjen.', 409);
  let by: FlowStep['by'] = 'model';
  let step = output ? normalizeStep(session, output, lastEvent) : null;
  if (!step) {
    by = 'rule';
    step = rulePlan(session, lastEvent);
    event(session, 'Kontroll', failure ? 'failed' : 'blocked', failure ? `Modellen kunne ikke brukes: ${failure} Et regelbasert forslag brukes i stedet.` : 'Modellforslaget kunne ikke kontrolleres mot kildene. Et regelbasert forslag brukes i stedet.');
  }
  if (output?.component && by === 'model' && output.component !== componentForStep(step)) {
    event(session, 'Kontroll', 'blocked', 'Modellen valgte en komponent som ikke passer til steget. Den registrerte komponenten brukes.');
  }
  session.step = { ...step, component: componentForStep(step), id: randomUUID(), by, model: by === 'model' ? flowModelName() : null, createdAt: now(), revision, durationMs: Date.now() - startedAt };
  session.status = 'step'; session.stepCount++;
  event(session, by === 'model' ? 'Planlegger' : 'Regler', 'completed', `Neste steg: ${STEP_LABELS[step.kind]} – ${step.title}.`);
  persist(session);
  return session.step;
}
