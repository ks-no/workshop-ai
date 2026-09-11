import type { ContactPoint } from './assistant-types';
import { CONTACT_POINTS } from './assistant-actions';
import { narrativeWithinEvidence } from './assistant-verification';
import { flowFetchables, type FlowCase, type FlowFact, type FlowFetchable, type FlowFieldKind, type FlowFormField, type FlowOutcome, type FlowProposal, type FlowStep } from './flow-types';

/**
 * Closed catalogues for the step flow. The planner may only point at these: KS sources it
 * can propose to fetch, form templates it can fill, and contact points it can address.
 * Everything else (values, quotes, dates) is checked against the case sources by Node.
 */
export const FLOW_SOURCES: Record<FlowFetchable, { title: string; lower: string; api: string; description: string }> = {
  husstand: { title: 'Husstandsopplysninger', lower: 'husstandsopplysninger', api: 'KS API · Husstand', description: 'Husstandstype, kommune og hvem som inngår i husstanden.' },
  inntekt: { title: 'Inntektsgrunnlag og regelvurdering', lower: 'inntektsgrunnlag', api: 'KS API · Inntektsgrunnlag', description: 'Husholdningens inntektsgrunnlag fra siste skatteoppgjør og KS sin regelvurdering for redusert SFO-betaling. Krever et eget samtykke som registreres hos Fiks.' },
  sfo: { title: 'SFO-plass og satser', lower: 'SFO-plass og satser', api: 'KS API · SFO-plasser og satser', description: 'Barnets SFO-plass, klassetrinn, månedspris og gjeldende satser i kommunen.' },
};
export const SANDBOX_NOTE = 'KS workshop-sandkasse med syntetiske testopplysninger';
export const STEP_LABELS: Record<FlowStep['kind'], string> = { ask: 'Spør om mer', review: 'Kontroller og godkjenn', action: 'Foreslått handling', done: 'Ferdig' };
export const ACTION_LABELS: Record<NonNullable<FlowProposal>['type'], string> = { email: 'E-post', form: 'Skjema', reminder: 'Påminnelse', contact: 'Kontakt' };

export type FlowFormTemplate = {
  id: string; title: string; recipientId: string; submission: 'ks-sandbox' | 'local';
  ksProcess: { prosessId: string; prosessNavn: string } | null; description: string;
  fields: { id: string; label: string; kind: FlowFieldKind; required: boolean; factKeys: string[]; citizenText?: boolean }[];
  attachments: string[];
};
export const FLOW_FORMS: FlowFormTemplate[] = [
  {
    id: 'sfo-reduced-payment', title: 'Søknad om redusert foreldrebetaling i SFO', recipientId: 'sfo-office', submission: 'ks-sandbox',
    ksProcess: { prosessId: 'sfo-moderasjon', prosessNavn: 'Redusert betaling i SFO' },
    description: 'Sendes som testsøknad til KS-sandkassen og gir søknads-ID og saksbehandleroppgave.',
    fields: [
      { id: 'household', label: 'Husstand', kind: 'text', required: true, factKeys: ['household', 'household_members', 'husstand', 'family'] },
      { id: 'household_income_annual', label: 'Husholdningens årsinntekt (kr)', kind: 'number', required: true, factKeys: ['household_income_annual', 'annual_income', 'income', 'household_income', 'inntekt'] },
      { id: 'sfo_place', label: 'SFO-plass', kind: 'text', required: true, factKeys: ['sfo_place', 'sfo', 'sfo_name', 'sfo_type'] },
      { id: 'municipality', label: 'Kommune', kind: 'text', required: false, factKeys: ['municipality', 'kommune'] },
      { id: 'situation', label: 'Beskrivelse av situasjonen (dine egne ord)', kind: 'textarea', required: false, factKeys: [], citizenText: true },
      { id: 'message', label: 'Melding til saksbehandler', kind: 'textarea', required: false, factKeys: [] },
    ],
    attachments: ['Dokumentasjon på husholdningens inntekt (skattemelding eller lønnsslipper)', 'Dokumentasjon på endret inntekt dersom situasjonen er ny'],
  },
  {
    id: 'housing-allowance', title: 'Forberedt søknad om bostøtte (til Husbanken)', recipientId: 'husbanken', submission: 'local', ksProcess: null,
    description: 'Klargjøres lokalt. Selve søknaden sender du selv hos Husbanken med innlogging.',
    fields: [
      { id: 'monthly_rent', label: 'Månedlig husleie (kr)', kind: 'number', required: true, factKeys: ['monthly_rent', 'rent', 'husleie'] },
      { id: 'household_size', label: 'Antall personer i husholdningen', kind: 'number', required: true, factKeys: ['household_size', 'household_members_count'] },
      { id: 'household_income_annual', label: 'Husholdningens årsinntekt (kr)', kind: 'number', required: true, factKeys: ['household_income_annual', 'annual_income', 'income', 'household_income', 'inntekt'] },
      { id: 'situation', label: 'Beskrivelse av situasjonen (dine egne ord)', kind: 'textarea', required: false, factKeys: [], citizenText: true },
    ],
    attachments: ['Leiekontrakt', 'Oversikt over boutgifter', 'Dokumentasjon på inntekt for søknadsmåneden'],
  },
  {
    id: 'moving-notice', title: 'Forberedt flyttemelding (til Skatteetaten)', recipientId: 'skatteetaten', submission: 'local', ksProcess: null,
    description: 'Klargjøres lokalt. Flyttemeldingen sender du selv hos Skatteetaten.',
    fields: [
      { id: 'move_date', label: 'Flyttedato', kind: 'date', required: true, factKeys: ['move_date', 'moving_date', 'flyttedato'] },
      { id: 'new_municipality', label: 'Ny kommune', kind: 'text', required: true, factKeys: ['new_municipality', 'municipality', 'kommune'] },
      { id: 'new_address', label: 'Ny adresse (gate, postnummer, eventuelt bolignummer)', kind: 'textarea', required: false, factKeys: ['new_address', 'address'] },
      { id: 'who_moves', label: 'Hvem flytter', kind: 'textarea', required: false, factKeys: ['who_moves', 'household'] },
    ],
    attachments: ['Leiekontrakt eller kjøpekontrakt for ny bolig dersom Skatteetaten ber om det'],
  },
  {
    id: 'general-request', title: 'Henvendelse til kommunen', recipientId: 'citizen-service', submission: 'local', ksProcess: null,
    description: 'En generell henvendelse som klargjøres lokalt for alle andre behov.',
    fields: [
      { id: 'subject', label: 'Hva henvendelsen gjelder', kind: 'text', required: true, factKeys: ['subject', 'topic'] },
      { id: 'description', label: 'Beskrivelse (dine egne ord)', kind: 'textarea', required: true, factKeys: [], citizenText: true },
      { id: 'contact_preference', label: 'Hvordan vil du bli kontaktet', kind: 'text', required: false, factKeys: ['contact_preference', 'phone', 'email'] },
    ],
    attachments: [],
  },
];
export function templateFor(id: string | undefined | null) { return FLOW_FORMS.find(form => form.id === id) ?? null; }
export function flowContact(id: string | undefined | null): ContactPoint { return CONTACT_POINTS[id ?? ''] ?? CONTACT_POINTS['citizen-service']; }

export function activeFacts(session: Pick<FlowCase, 'facts'>) { return session.facts.filter(fact => fact.status === 'proposed' || fact.status === 'confirmed'); }
export function confirmedFacts(session: Pick<FlowCase, 'facts'>) { return session.facts.filter(fact => fact.status === 'confirmed'); }
/** The citizen's own words: situation, answers and notes. Documents and register data are excluded. */
export function citizenWords(session: Pick<FlowCase, 'sources'>, limit = 1200) {
  const text = session.sources.filter(source => ['situation', 'note'].includes(source.kind)).map(source => source.text.trim()).filter(Boolean).join('\n\n');
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}
/** Text a generated narrative may take numbers from: every stored fact and source, plus today's date. */
export function flowEvidence(session: Pick<FlowCase, 'facts' | 'sources'>, today = new Date().toISOString().slice(0, 10)) {
  return [today, ...activeFacts(session).map(fact => `${fact.label}: ${fact.value}`), ...session.sources.map(source => source.text)].join('\n');
}
export function narrativeOk(text: string, session: Pick<FlowCase, 'facts' | 'sources'>) { return narrativeWithinEvidence(text, flowEvidence(session)); }

function factByKeys(session: Pick<FlowCase, 'facts'>, keys: string[]): FlowFact | undefined {
  const confirmed = confirmedFacts(session);
  for (const key of keys) {
    const match = confirmed.findLast(fact => fact.key === key);
    if (match) return match;
  }
  return undefined;
}
function sameValue(a: string, b: string) { return a.trim().toLocaleLowerCase('nb-NO').replace(/\s+/g, ' ') === b.trim().toLocaleLowerCase('nb-NO').replace(/\s+/g, ' '); }

/**
 * Fill a template from confirmed facts first. A model-supplied value only survives as an
 * editable suggestion when its numbers and claims are covered by the stored sources.
 */
export function buildFlowForm(session: Pick<FlowCase, 'facts' | 'sources'>, template: FlowFormTemplate, suggested: { id: string; value: string }[] = []): Extract<FlowProposal, { type: 'form' }> {
  const confirmed = confirmedFacts(session);
  const fields: FlowFormField[] = template.fields.map(field => {
    const proposed = suggested.find(item => item.id === field.id)?.value.trim() ?? '';
    const exact = proposed ? confirmed.find(fact => sameValue(fact.value, proposed)) : undefined;
    const fact = exact ?? factByKeys(session, field.factKeys);
    if (fact) {
      return { id: field.id, label: field.label, kind: field.kind, required: field.required, value: fact.value, origin: fact.origin === 'ks' ? 'register' : 'confirmed', editable: false, factId: fact.id };
    }
    if (field.citizenText) {
      const words = citizenWords(session);
      return { id: field.id, label: field.label, kind: field.kind, required: field.required, value: words, origin: words ? 'suggested' : 'empty', editable: true, factId: null };
    }
    const usable = proposed && narrativeOk(proposed, session) && !/\[[^\]]+\]/.test(proposed) ? proposed : '';
    return { id: field.id, label: field.label, kind: field.kind, required: field.required, value: usable, origin: usable ? 'suggested' : 'empty', editable: true, factId: null };
  });
  return { type: 'form', templateId: template.id, title: template.title, recipient: CONTACT_POINTS[template.recipientId], submission: template.submission, fields, attachments: template.attachments };
}
export function missingFlowFields(fields: Pick<FlowFormField, 'required' | 'value' | 'label'>[]) { return fields.filter(field => field.required && !field.value.trim()); }

/** Deterministic e-mail used when the model is unavailable or its draft fails the evidence check. */
export function fallbackFlowEmail(session: Pick<FlowCase, 'facts' | 'sources' | 'situation'>, contact: ContactPoint): { subject: string; body: string } {
  const facts = confirmedFacts(session).map(fact => `- ${fact.label}: ${fact.value}`);
  const words = citizenWords(session, 600);
  return {
    subject: 'Spørsmål om min situasjon – ønsker veiledning',
    body: [`Hei ${contact.name},`, '', 'Jeg tar kontakt fordi jeg trenger veiledning om neste steg i saken min. Jeg har forberedt opplysningene under.',
      ...(words ? ['', 'Min situasjon med egne ord:', words] : []),
      ...(facts.length ? ['', 'Opplysninger jeg har bekreftet:', ...facts] : []),
      '', 'Kan dere si hvilken dokumentasjon dere trenger og hvordan jeg går videre? Meldingen er forberedt med en digital assistent og testopplysninger; ingen søknad er sendt ennå.', '', 'Med vennlig hilsen'].join('\n'),
  };
}
export function validDateString(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function addDays(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00.000Z`); parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
/** A reminder must lie on or after today; an ungrounded or invalid proposal becomes an editable default a week ahead. */
export function normalizeReminder(session: Pick<FlowCase, 'facts' | 'sources'>, input: { title?: string; date?: string; time?: string; note?: string }, fallbackTitle: string, today = new Date().toISOString().slice(0, 10)): { proposal: Extract<FlowProposal, { type: 'reminder' }>; adjusted: boolean } {
  let adjusted = false;
  const title = (input.title ?? '').trim().slice(0, 120) || fallbackTitle.slice(0, 120);
  let date = (input.date ?? '').trim();
  if (!validDateString(date) || date < today) { date = addDays(today, 7); adjusted = true; }
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test((input.time ?? '').trim()) ? (input.time ?? '').trim() : null;
  let note = (input.note ?? '').trim().slice(0, 400);
  if (note && !narrativeOk(note, session)) { note = ''; adjusted = true; }
  return { proposal: { type: 'reminder', title, date, time, note: adjusted && !note ? 'Foreslått dato. Endre den om du kjenner den riktige fristen.' : note }, adjusted };
}

const RULE_QUESTIONS: { keys: string[]; question: FlowStep['questions'][number] }[] = [
  { keys: ['household', 'household_members', 'husstand', 'family'], question: { key: 'household', label: 'Hvem inngår i husstanden din?', kind: 'text', hint: 'For eksempel «2 voksne, 1 barn i 2. trinn».', options: [], required: true } },
  { keys: ['household_income_annual', 'annual_income', 'income', 'household_income', 'inntekt'], question: { key: 'household_income_annual', label: 'Hva er husholdningens samlede årsinntekt i kroner?', kind: 'number', hint: 'Hele kroner, for eksempel 152000.', options: [], required: true } },
  { keys: ['sfo_place', 'sfo', 'sfo_name', 'sfo_type'], question: { key: 'sfo_place', label: 'Hvilken SFO-plass har barnet ditt?', kind: 'text', hint: 'For eksempel «Full plass, 5 dager i uken, 2. trinn».', options: [], required: true } },
];
type RuleStep = Omit<FlowStep, 'id' | 'createdAt' | 'revision' | 'durationMs' | 'model' | 'by'>;
/** Rule-based planner used only when the model is unavailable or its output fails validation. It follows the SFO demo flow. */
export function rulePlan(session: Pick<FlowCase, 'facts' | 'sources' | 'situation' | 'skipped' | 'ks' | 'outcomes'>, lastEvent: string): RuleStep {
  const facts = activeFacts(session);
  const base = { questions: [], factIds: facts.map(fact => fact.id), fetch: [] as FlowFetchable[], next: null, proposal: null };
  const rationale = 'Regelbasert forslag: språkmodellen var ikke tilgjengelig eller ga et svar som ikke kunne kontrolleres, så flyten følger den faste SFO-sjekken.';
  if (lastEvent === 'action-done' && session.outcomes.length) return { ...base, kind: 'done', title: 'Se resultatene og velg neste steg', rationale: 'Resultatene er lagret i saken.', message: 'Se kvitteringene og statusene under. Du kan velge en ny handling eller legge til informasjon. En lokal forberedelse eller testmelding er ikke en offentlig innsending.' };
  // The fallback must not collect SFO/income data for an unrelated question.
  if (!/\b(sfo|aks|skolefritidsordning)\b/i.test(session.situation)) {
    const rationale = 'Språkmodellen kunne ikke foreslå et kontrollert svar. Du kan velge en handling selv eller be om lokal menneskelig vurdering.';
    if (lastEvent === 'action-skipped') return { ...base, kind: 'done', title: 'Du velger hvordan du vil fortsette', rationale, message: 'Ingen ny handling er utført. Velg en handling nedenfor eller legg til mer informasjon.' };
    const contact = flowContact('citizen-service');
    return { ...base, kind: 'action', title: 'Få hjelp av et menneske', rationale, message: 'Kontroller sammendraget før du deler det med demoens lokale vurderingskø. Du kan også velge en annen handling nedenfor.', proposal: { type: 'contact', contact, reason: 'Behovet må vurderes av et menneske.', summary: [session.situation, ...confirmedFacts(session).map(fact => `${fact.label}: ${fact.value}`)].join('\n').slice(0, 4000) } };
  }
  const fetchable = flowFetchables.filter(source => !session.ks.fetched.includes(source) && !session.ks.declined.includes(source));
  const has = (keys: string[]) => facts.some(fact => keys.includes(fact.key)) || keys.some(key => session.skipped.includes(key));
  if (fetchable.length && !session.outcomes.length && lastEvent !== 'review-approved' && lastEvent !== 'questions-skipped') {
    return { ...base, kind: 'review', title: 'Kontroller det vi har, og velg hva vi kan hente', rationale,
      message: 'Med ditt samtykke kan vi hente husstand, inntektsgrunnlag og SFO-plass fra KS-sandkassen. Huk vekk det du ikke vil dele, så fyller du det inn selv.',
      fetch: fetchable, next: 'Etter henting kontrollerer du opplysningene før neste steg.' };
  }
  const questions = RULE_QUESTIONS.filter(item => !has(item.keys)).map(item => item.question);
  if (questions.length) {
    return { ...base, kind: 'ask', title: 'Vi trenger noen opplysninger fra deg', rationale, questions,
      message: 'Svar på det du kan. Det du oppgir lagres som «oppgitt av deg» og må kontrolleres av kommunen.' };
  }
  if (!session.outcomes.some(outcome => outcome.kind === 'form')) {
    const proposal = buildFlowForm(session, FLOW_FORMS[0]);
    return { ...base, kind: 'action', title: 'Vi har fylt ut søknaden om redusert SFO-betaling', rationale, proposal,
      message: 'Skjemaet er fylt ut fra opplysningene du har bekreftet. Les over, rett det som er redigerbart, og send testsøknaden til KS-sandkassen når du er klar.' };
  }
  return { ...base, kind: 'done', title: 'Alt som kan forberedes her er gjort', rationale,
    message: 'Søknaden er registrert i KS-sandkassen som testsøknad. Kommunen gjør det endelige vedtaket. Du kan legge til mer eller starte på nytt.' };
}

/** Plain-text receipt for an executed action. */
export function flowOutcomeText(outcome: FlowOutcome, caseId: string) {
  const lines = [`Søk én gang · kvittering for ${ACTION_LABELS[outcome.kind].toLocaleLowerCase('nb-NO')}`, `Referanse: ${outcome.reference}`, `Sak: ${caseId} (revisjon ${outcome.revision})`, `Tidspunkt: ${outcome.createdAt}`,
    ...(outcome.recipient ? [`Mottaker: ${outcome.recipient.name} · ${outcome.recipient.organisation}`] : []), `Status: ${outcome.detail}`, ''];
  if (outcome.kind === 'email') lines.push(`Til: ${outcome.payload.to ?? ''}`, `Emne: ${outcome.payload.subject ?? ''}`, '', outcome.payload.body ?? '');
  else if (outcome.kind === 'form') {
    lines.push(outcome.title, '');
    for (const field of outcome.payload.fields ?? []) lines.push(`${field.label}: ${field.value || '(ikke utfylt)'}`);
    if (outcome.payload.ksSoknadId) lines.push('', `KS-sandkasse søknads-ID: ${outcome.payload.ksSoknadId}`, `KS-sandkasse oppgave-ID: ${outcome.payload.ksOppgaveId ?? 'ikke opprettet'}`);
    if (outcome.payload.ksWarning) lines.push(`Merknad fra KS: ${outcome.payload.ksWarning}`);
  } else if (outcome.kind === 'reminder') lines.push(outcome.title, `Dato: ${outcome.payload.date ?? ''}${outcome.payload.time ? ` kl. ${outcome.payload.time}` : ''}`, '', outcome.payload.note ?? '');
  lines.push('', outcome.localOnly ? 'Dette er en lokal forberedelse med testopplysninger. Ingen søknad er sendt til en offentlig tjeneste.' : 'Sendt til KS sin workshop-sandkasse med syntetiske testopplysninger. Dette er ikke en søknad til en virkelig kommune.');
  return lines.join('\n');
}
/** iCalendar text for a reminder outcome, generated locally in the browser. */
export function reminderCalendar(outcome: FlowOutcome) {
  const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, match => `\\${match}`);
  const date = (outcome.payload.date ?? '').replace(/-/g, '');
  const time = outcome.payload.time?.replace(':', '');
  const stamp = new Date(outcome.createdAt).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Søk én gang//Demo//NB', 'BEGIN:VEVENT', `UID:${outcome.id}@sok-en-gang.demo`, `DTSTAMP:${stamp}`,
    time ? `DTSTART;TZID=Europe/Oslo:${date}T${time}00` : `DTSTART;VALUE=DATE:${date}`,
    `SUMMARY:${escape(outcome.title)}`, `DESCRIPTION:${escape(outcome.payload.note ?? '')}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}
