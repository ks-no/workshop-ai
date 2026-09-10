import type { ActionKind, ActionRecommendation, AssistantCase, ContactPoint, FormDraft, FormField, FormFieldKind, NextAction, Outcome, ServiceId, ServiceResult } from './assistant-types';
import { FACT_LABELS, confirmedValue } from './assistant-verification';
import { SERVICE_CATALOGUE } from './service-catalogue';

/**
 * End actions: how a pipeline run resolves into something the citizen can act on.
 * The catalogue below is server-owned. The agent may recommend one of these kinds
 * with a reason; it cannot invent recipients, forms or submissions.
 */

/** Demo contact points. Phone numbers and URLs are public service channels; e-mail addresses are demo placeholders. */
export const CONTACT_POINTS: Record<string, ContactPoint> = {
  'sfo-office': {
    id: 'sfo-office', name: 'Aktivitetsskolen (AKS) – foreldrebetaling', role: 'Saksbehandler for redusert foreldrebetaling i SFO/AKS', organisation: 'Oslo kommune · Utdanningsetaten',
    email: 'aks-foreldrebetaling@demo.sok-en-gang.example', phone: '21 80 21 80', url: 'https://www.oslo.kommune.no/skole-og-utdanning/aktivitetsskolen/', hours: 'Mandag–fredag 08.00–15.30',
    note: 'Saksbehandlerne svarer på telefon i åpningstiden, eller du kan skrive til dem direkte.',
  },
  'housing-office': {
    id: 'housing-office', name: 'Boligkontoret i bydelen', role: 'Veileder for bostøtte og kommunal bolig', organisation: 'Oslo kommune · bydelens NAV-kontor',
    email: 'boligkontoret@demo.sok-en-gang.example', phone: '21 80 21 80', url: 'https://www.oslo.kommune.no/bolig-og-sosiale-tjenester/', hours: 'Mandag–fredag 09.00–15.00',
    note: 'Bydelen veileder deg og tar imot søknaden; selve vedtaket gjøres av Husbanken.',
  },
  husbanken: {
    id: 'husbanken', name: 'Husbanken – bostøtte', role: 'Statlig bostøtteordning', organisation: 'Husbanken',
    email: null, phone: '22 96 16 00', url: 'https://www.husbanken.no/person/bostotte/', hours: 'Mandag–fredag 09.00–15.00',
    note: 'Offisiell selvbetjening. Søknaden sendes i Husbankens egen tjeneste med innlogging.',
  },
  skatteetaten: {
    id: 'skatteetaten', name: 'Skatteetaten – flyttemelding', role: 'Folkeregisteret', organisation: 'Skatteetaten',
    email: null, phone: '800 80 000', url: 'https://www.skatteetaten.no/person/folkeregister/flytte/i-norge/', hours: 'Mandag–fredag 09.00–15.30',
    note: 'Offisiell selvbetjening. Flyttemeldingen sendes av deg selv i Skatteetatens tjeneste.',
  },
  'citizen-service': {
    id: 'citizen-service', name: 'Innbyggerservice', role: 'Veiledning om kommunale tjenester', organisation: 'Oslo kommune',
    email: 'innbyggerservice@demo.sok-en-gang.example', phone: '21 80 21 80', url: 'https://www.oslo.kommune.no/kontakt-oss/', hours: 'Mandag–fredag 08.00–15.30',
    note: 'For deg som lurer på noe som ikke hører til én bestemt tjeneste.',
  },
};
const SERVICE_CONTACTS: Record<ServiceId, { primary: string; selfService: string | null }> = {
  family: { primary: 'sfo-office', selfService: null },
  housing: { primary: 'housing-office', selfService: 'husbanken' },
  moving: { primary: 'citizen-service', selfService: 'skatteetaten' },
};
export function contactFor(serviceId: ServiceId | null): ContactPoint {
  return CONTACT_POINTS[serviceId ? SERVICE_CONTACTS[serviceId].primary : 'citizen-service'];
}
export function selfServiceFor(serviceId: ServiceId): ContactPoint | null {
  const id = SERVICE_CONTACTS[serviceId].selfService;
  return id ? CONTACT_POINTS[id] : null;
}

type FieldDefinition = { id: string; label: string; kind: FormFieldKind; required: boolean; factKey: FormField['factKey']; citizenText?: boolean };
export type FormDefinition = {
  id: string; serviceId: ServiceId; title: string; recipientId: string; submission: FormDraft['submission'];
  /** KS sandbox process identity when the form can be submitted there. */
  ksProcess: { prosessId: string; prosessNavn: string } | null;
  fields: FieldDefinition[]; attachments: string[];
};
export const FORM_DEFINITIONS: FormDefinition[] = [
  {
    id: 'sfo-reduced-payment', serviceId: 'family', title: 'Søknad om redusert foreldrebetaling i SFO/AKS', recipientId: 'sfo-office', submission: 'ks-sandbox',
    ksProcess: { prosessId: 'sfo-moderasjon', prosessNavn: 'Redusert betaling i SFO' },
    fields: [
      { id: 'uses_sfo', label: FACT_LABELS.uses_sfo, kind: 'boolean', required: true, factKey: 'uses_sfo' },
      { id: 'household_income_annual', label: FACT_LABELS.household_income_annual, kind: 'number', required: true, factKey: 'household_income_annual' },
      { id: 'income_basis', label: FACT_LABELS.income_basis, kind: 'select', required: true, factKey: 'income_basis' },
      { id: 'cohabitant_missing', label: FACT_LABELS.cohabitant_missing, kind: 'boolean', required: false, factKey: 'cohabitant_missing' },
      { id: 'situation', label: 'Beskrivelse av situasjonen (dine egne ord)', kind: 'textarea', required: false, factKey: null, citizenText: true },
      { id: 'message', label: 'Melding til saksbehandler', kind: 'textarea', required: false, factKey: null },
    ],
    attachments: ['Dokumentasjon på husholdningens inntekt (skattemelding eller lønnsslipper)', 'Dokumentasjon på endret inntekt dersom situasjonen er ny'],
  },
  {
    id: 'housing-allowance-prep', serviceId: 'housing', title: 'Forberedt søknad om bostøtte (til Husbanken)', recipientId: 'husbanken', submission: 'local', ksProcess: null,
    fields: [
      { id: 'monthly_rent', label: FACT_LABELS.monthly_rent, kind: 'number', required: true, factKey: 'monthly_rent' },
      { id: 'household_size', label: FACT_LABELS.household_size, kind: 'number', required: true, factKey: 'household_size' },
      { id: 'household_income_annual', label: FACT_LABELS.household_income_annual, kind: 'number', required: true, factKey: 'household_income_annual' },
      { id: 'income_basis', label: FACT_LABELS.income_basis, kind: 'select', required: true, factKey: 'income_basis' },
      { id: 'situation', label: 'Beskrivelse av situasjonen (dine egne ord)', kind: 'textarea', required: false, factKey: null, citizenText: true },
    ],
    attachments: ['Leiekontrakt', 'Oversikt over boutgifter', 'Dokumentasjon på inntekt for søknadsmåneden'],
  },
  {
    id: 'moving-notice-prep', serviceId: 'moving', title: 'Forberedt flyttemelding (til Skatteetaten)', recipientId: 'skatteetaten', submission: 'local', ksProcess: null,
    fields: [
      { id: 'move_date', label: FACT_LABELS.move_date, kind: 'date', required: true, factKey: 'move_date' },
      { id: 'new_municipality', label: FACT_LABELS.new_municipality, kind: 'text', required: true, factKey: 'new_municipality' },
      { id: 'new_address', label: 'Ny adresse (gate, postnummer, eventuelt bolignummer)', kind: 'textarea', required: false, factKey: null },
      { id: 'who_moves', label: 'Hvem flytter', kind: 'textarea', required: false, factKey: null },
    ],
    attachments: ['Leiekontrakt eller kjøpekontrakt for ny bolig dersom Skatteetaten ber om det'],
  },
];
export function formFor(serviceId: ServiceId): FormDefinition | null {
  return FORM_DEFINITIONS.find(form => form.serviceId === serviceId) ?? null;
}

type CaseState = Pick<AssistantCase, 'facts' | 'sources' | 'messages' | 'services' | 'revision' | 'analyzedRevision' | 'status' | 'handoff' | 'intent' | 'language' | 'outcomes' | 'drafts'>;
export function unresolvedFacts(session: Pick<AssistantCase, 'facts'>) {
  return session.facts.filter(fact => ['proposed', 'conflict'].includes(fact.status));
}
function analysisCurrent(session: CaseState) {
  return session.analyzedRevision === session.revision && session.status !== 'analyzing';
}
/** The citizen's own words from the conversation. Automatic upload notices and AI text are excluded. */
export function citizenNarrative(session: Pick<AssistantCase, 'messages' | 'sources'>, limit = 1000) {
  const text = session.messages
    .filter(message => message.role === 'user' && session.sources.some(source => source.id === message.sourceId && source.kind === 'conversation'))
    .map(message => message.text.trim()).filter(Boolean).join('\n\n');
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

/** Fill a form deterministically from confirmed facts. Nothing is inferred, computed or guessed. */
export function buildFormDraft(session: CaseState, serviceId: ServiceId, now = new Date().toISOString(), id = `form-${now}`): FormDraft | null {
  const definition = formFor(serviceId);
  if (!definition) return null;
  const fields: FormField[] = definition.fields.map(field => {
    if (field.factKey) {
      const value = confirmedValue(session, field.factKey);
      const fact = value === undefined ? undefined : session.facts.find(item => item.key === field.factKey && item.value === value && item.status === 'confirmed');
      const register = !!fact && session.sources.some(source => source.id === fact.citation.sourceId && source.kind === 'register');
      return { id: field.id, label: field.label, kind: field.kind, required: field.required, factKey: field.factKey, value: value ?? '', origin: value === undefined ? 'empty' : register ? 'register' : 'confirmed', editable: false };
    }
    const value = field.citizenText ? citizenNarrative(session) : '';
    return { id: field.id, label: field.label, kind: field.kind, required: field.required, factKey: null, value, origin: value ? 'citizen' : 'empty', editable: true };
  });
  return { id, formId: definition.id, serviceId, title: definition.title, recipient: CONTACT_POINTS[definition.recipientId], fields, attachments: definition.attachments, submission: definition.submission, revision: session.revision, createdAt: now };
}
export function missingFormFields(draft: Pick<FormDraft, 'fields'>) {
  return draft.fields.filter(field => field.required && !field.value.trim());
}

const ACTION_TITLES: Record<ActionKind, [string, string]> = {
  clarify: ['Svar på det som mangler', 'Agenten trenger flere opplysninger før neste steg kan gjøres klart.'],
  contact: ['Kontakt riktig person', 'Du kan alltid ta saken videre med en person som kan hjelpe.'],
  email: ['Send en e-post', 'Vi lager et utkast med opplysningene dine. Du leser over og sender selv.'],
  form: ['Fyll ut skjemaet', 'Vi fyller ut skjemaet fra opplysningene du har bekreftet. Du leser over og sender inn.'],
  'self-service': ['Gå til den offisielle tjenesten', 'Søknaden eller meldingen sendes i den offisielle tjenesten med innlogging.'],
  summary: ['Fullfør og last ned oppsummeringen', 'Avslutt med en lokal oppsummering av saken og det som er gjort.'],
};
function serviceOutcome(session: CaseState, kind: Outcome['kind'], serviceId: ServiceId) {
  return (session.outcomes ?? []).some(outcome => outcome.kind === kind && outcome.serviceId === serviceId);
}
/** Which kinds a service can resolve into right now. The agent's recommendation must be one of these. */
export function allowedActionKinds(session: CaseState, service: ServiceResult): ActionKind[] {
  if (session.intent === 'information') return ['contact', ...(selfServiceFor(service.id) ? ['self-service' as const] : [])];
  const kinds: ActionKind[] = [];
  const missing = service.checks.some(check => check.status === 'missing');
  if (missing || service.questions.length) kinds.push('clarify');
  kinds.push('contact');
  if (service.status !== 'error') kinds.push('email');
  if (formFor(service.id) && service.status !== 'error') kinds.push('form');
  if (selfServiceFor(service.id)) kinds.push('self-service');
  return kinds;
}
export function ruleRecommendation(session: CaseState, service: ServiceResult): ActionRecommendation {
  const allowed = allowedActionKinds(session, service);
  const pick = (kind: ActionKind, reason: string): ActionRecommendation => ({ kind, reason, by: 'rule' });
  if (session.intent === 'information') return pick('contact', 'Et generelt spørsmål er besvart fra veiledning. Ta kontakt dersom du vil gå videre med din egen sak.');
  if (service.status === 'error') return pick('contact', 'Analysen kunne ikke fullføres. En person kan hjelpe deg videre.');
  if (allowed.includes('clarify') && service.checks.some(check => check.status === 'missing')) return pick('clarify', 'Noen opplysninger mangler før skjema eller e-post kan gjøres klart.');
  if (allowed.includes('form') && formFor(service.id)?.submission === 'ks-sandbox') return pick('form', 'Alle nødvendige opplysninger er bekreftet. Skjemaet kan fylles ut og sendes inn.');
  if (allowed.includes('self-service')) return pick('self-service', 'Denne tjenesten har en offisiell selvbetjening. Vi har forberedt opplysningene du trenger.');
  if (allowed.includes('email')) return pick('email', 'Opplysningene er klare til å deles med en saksbehandler.');
  return pick('contact', 'Ta kontakt for å gå videre.');
}
export function normalizeRecommendation(session: CaseState, service: ServiceResult, proposed: { kind: ActionKind; reason: string } | undefined, reasonAccepted: boolean): ActionRecommendation {
  if (proposed && allowedActionKinds(session, service).includes(proposed.kind)) {
    const fallback = ruleRecommendation(session, service);
    return { kind: proposed.kind, reason: reasonAccepted ? proposed.reason : fallback.kind === proposed.kind ? fallback.reason : ACTION_TITLES[proposed.kind][1], by: 'agent' };
  }
  return ruleRecommendation(session, service);
}

/** Resolve every end action for the case. Pure: the same case always yields the same list. */
export function resolveNextActions(session: CaseState): NextAction[] {
  const actions: NextAction[] = [];
  const current = analysisCurrent(session);
  const unresolved = unresolvedFacts(session);
  const baseBlockers = [
    ...(current ? [] : ['Planen må oppdateres med de siste opplysningene.']),
    ...(unresolved.length ? [`${unresolved.length} foreslåtte opplysninger må bekreftes eller avvises.`] : []),
  ];
  for (const service of session.services) {
    const recommendation = service.recommendedAction ?? ruleRecommendation(session, service);
    const contact = contactFor(service.id);
    const selfService = selfServiceFor(service.id);
    const form = formFor(service.id);
    const missing = service.checks.filter(check => check.status === 'missing' && check.factKeys.length);
    for (const kind of allowedActionKinds(session, service)) {
      const [title, detail] = ACTION_TITLES[kind];
      const action: NextAction = { id: `${service.id}:${kind}`, kind, serviceId: service.id, title, detail, available: true, blockers: [], recommended: recommendation.kind === kind, reason: recommendation.kind === kind ? recommendation.reason : null, contact: null, url: null, done: false };
      if (kind === 'clarify') {
        action.detail = missing.length ? `Mangler: ${missing.map(check => check.label).join(', ')}.` : detail;
        action.available = !session.handoff;
      } else if (kind === 'contact') {
        action.contact = contact; action.url = contact.url;
      } else if (kind === 'email') {
        action.contact = contact; action.blockers = session.handoff ? ['Saken er fullført og låst.'] : baseBlockers; action.available = !action.blockers.length;
        action.done = serviceOutcome(session, 'email', service.id);
      } else if (kind === 'form') {
        const draft = buildFormDraft(session, service.id, '1970-01-01T00:00:00.000Z', 'preview');
        const missingFields = draft ? missingFormFields(draft) : [];
        action.contact = form ? CONTACT_POINTS[form.recipientId] : contact;
        action.title = form?.title ?? title;
        action.detail = form?.submission === 'ks-sandbox' ? 'Skjemaet fylles ut fra bekreftede opplysninger og sendes inn til KS-sandkassen som testsøknad.' : detail;
        action.blockers = session.handoff ? ['Saken er fullført og låst.'] : [...baseBlockers, ...(missingFields.length ? [`Mangler: ${missingFields.map(field => field.label).join(', ')}.`] : [])];
        action.available = !action.blockers.length;
        action.done = serviceOutcome(session, 'form', service.id);
      } else if (kind === 'self-service' && selfService) {
        action.contact = selfService; action.url = selfService.url; action.title = `Gå til ${selfService.name}`;
      }
      actions.push(action);
    }
  }
  if (session.intent !== 'information' && session.services.length) {
    const completed = session.services.every(service => !['error', 'needs-information'].includes(service.status));
    const blockers = session.handoff ? [] : [...baseBlockers, ...(completed ? [] : ['Alle tjenestevurderinger må fullføres først.'])];
    actions.push({ id: 'case:summary', kind: 'summary', serviceId: null, title: ACTION_TITLES.summary[0], detail: ACTION_TITLES.summary[1], available: !blockers.length && !session.handoff, blockers, recommended: false, reason: null, contact: null, url: null, done: !!session.handoff });
  }
  return actions.sort((a, b) => Number(b.recommended) - Number(a.recommended));
}

/** Checklist items that describe this app's own KS flow, not something a caseworker can act on. */
const INTERNAL_CHECKS = new Set(['income-consent', 'sfo-rule', 'sfo-snapshot', 'guidance-missing']);
export function openItemsForRecipient(service: Pick<ServiceResult, 'checks'> | undefined) {
  return (service?.checks ?? []).filter(check => check.status !== 'ready' && !INTERNAL_CHECKS.has(check.id));
}
/** Deterministic e-mail draft used when no model is available or its draft fails the evidence check. */
export function fallbackEmailDraft(session: CaseState, serviceId: ServiceId, contact: ContactPoint): { subject: string; body: string } {
  const definition = SERVICE_CATALOGUE.find(item => item.id === serviceId);
  const service = session.services.find(item => item.id === serviceId);
  const english = session.language === 'en';
  const facts = (definition?.requiredFacts ?? []).flatMap(key => {
    const value = confirmedValue(session, key);
    return value === undefined ? [] : [`${FACT_LABELS[key]}: ${formatValue(value)}`];
  });
  const remaining = openItemsForRecipient(service).map(check => check.label);
  const narrative = citizenNarrative(session, 600);
  if (english) {
    return {
      subject: `Question about ${definition?.title ?? 'my case'} – request for guidance`,
      body: [`Dear ${contact.name},`, '', `I am contacting you about ${definition?.title ?? 'my situation'}. I have prepared the following information and would like your guidance on the next step.`,
        ...(narrative ? ['', 'My situation in my own words:', narrative] : []),
        ...(facts.length ? ['', 'Confirmed information:', ...facts.map(line => `- ${line}`)] : []),
        ...(remaining.length ? ['', 'Points I still need help with:', ...remaining.map(line => `- ${line}`)] : []),
        '', 'Could you tell me what documentation you need and how to proceed? Please note that this message was prepared with a digital assistant using test information; nothing has been submitted yet.', '', 'Kind regards'].join('\n'),
    };
  }
  return {
    subject: `Spørsmål om ${definition?.title ?? 'min sak'} – ønsker veiledning`,
    body: [`Hei ${contact.name},`, '', `Jeg tar kontakt om ${definition?.title ?? 'min situasjon'}. Jeg har forberedt opplysningene under og ønsker veiledning om neste steg.`,
      ...(narrative ? ['', 'Min situasjon med egne ord:', narrative] : []),
      ...(facts.length ? ['', 'Bekreftede opplysninger:', ...facts.map(line => `- ${line}`)] : []),
      ...(remaining.length ? ['', 'Punkter jeg fortsatt trenger hjelp med:', ...remaining.map(line => `- ${line}`)] : []),
      '', 'Kan dere si hvilken dokumentasjon dere trenger og hvordan jeg går videre? Meldingen er forberedt med en digital assistent og testopplysninger; ingen søknad er sendt ennå.', '', 'Med vennlig hilsen'].join('\n'),
  };
}
/** Text the model's draft may draw numbers from: confirmed fact values, the citizen's own words and checklist labels. */
export function emailEvidence(session: CaseState, serviceId: ServiceId) {
  const service = session.services.find(item => item.id === serviceId);
  return [
    ...session.facts.filter(fact => fact.status === 'confirmed').map(fact => `${fact.label}: ${fact.value}`),
    citizenNarrative(session, 4000),
    ...(service?.checks ?? []).map(check => `${check.label}. ${check.detail}`),
    service?.summary ?? '',
  ].join('\n');
}
export function formatValue(value: string) {
  const labels: Record<string, string> = { true: 'Ja', false: 'Nei', household_year: 'Hele husholdningens årsinntekt', individual_year: 'Én persons årsinntekt', month: 'Månedsinntekt', unknown: 'Inntektsgrunnlaget må avklares' };
  return labels[value] ?? value;
}
/** Plain-text rendering for the downloadable receipt of an executed action. */
export function outcomeText(outcome: Outcome, caseId: string) {
  const lines = [`Søk én gang · kvittering for ${outcome.kind === 'email' ? 'e-post' : 'skjema'}`, `Referanse: ${outcome.reference}`, `Sak: ${caseId} (revisjon ${outcome.revision})`, `Tidspunkt: ${outcome.createdAt}`, `Mottaker: ${outcome.recipient.name} · ${outcome.recipient.organisation}`, `Status: ${outcome.detail}`, ''];
  if (outcome.kind === 'email') lines.push(`Til: ${outcome.payload.to ?? ''}`, `Emne: ${outcome.payload.subject ?? ''}`, '', outcome.payload.body ?? '');
  else {
    lines.push(outcome.title, '');
    for (const field of outcome.payload.fields ?? []) lines.push(`${field.label}: ${field.value || '(ikke utfylt)'}`);
    if (outcome.payload.ksSoknadId) lines.push('', `KS-sandkasse søknads-ID: ${outcome.payload.ksSoknadId}`, `KS-sandkasse oppgave-ID: ${outcome.payload.ksOppgaveId ?? 'ikke opprettet'}`);
    if (outcome.payload.ksWarning) lines.push(`Merknad fra KS: ${outcome.payload.ksWarning}`);
  }
  lines.push('', outcome.localOnly ? 'Dette er en lokal forberedelse med testopplysninger. Ingen søknad er sendt til en offentlig tjeneste.' : 'Sendt til KS sin workshop-sandkasse med syntetiske testopplysninger. Dette er ikke en søknad til en virkelig kommune.');
  return lines.join('\n');
}
