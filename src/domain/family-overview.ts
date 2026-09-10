import { buildFlowForm, FLOW_FORMS } from './flow-catalogue';
import type { FlowActivity } from './flow-action-types';
import type { FlowCase } from './flow-types';

export const familyServices = [
  { templateId: 'sfo-reduced-payment', title: 'Barn og SFO', description: 'Utforsk redusert foreldrebetaling.', icon: 'family' },
  { templateId: 'housing-allowance', title: 'Bolig og boutgifter', description: 'Forbered opplysninger til bostøtte.', icon: 'home' },
  { templateId: 'moving-notice', title: 'Flytting', description: 'Forbered flyttemelding og dokumentasjon.', icon: 'moving' },
  { templateId: 'general-request', title: 'Annen hjelp', description: 'Forbered en henvendelse om andre behov.', icon: 'help' },
] as const;

export function supportMap(session: FlowCase) {
  return familyServices.map(service => {
    const template = FLOW_FORMS.find(form => form.id === service.templateId)!;
    const form = buildFlowForm(session, template);
    const requirements = form.fields.filter(field => field.required).map(field => {
      const fact = session.facts.find(fact => fact.id === field.factId && fact.status === 'confirmed');
      const source = session.sources.find(source => source.id === fact?.sourceId);
      return { id: field.id, label: field.label, confirmed: !!fact, value: fact?.value ?? '', source: source?.title ?? null };
    });
    return { ...service, form, requirements, documents: template.attachments.map((label, index) => ({ key: `${template.id}:document:${index}`, label })) };
  });
}

/** These marks describe document readiness only; they never grant factual/action approval. */
export const checklistKeys = new Set(FLOW_FORMS.flatMap(form => form.attachments.map((_, index) => `${form.id}:document:${index}`)));

export type TimelineEntry = { id: string; at: string; title: string; detail: string; status: string; scheduled: boolean };
export function familyTimeline(session: FlowCase, activity?: FlowActivity): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    { id: 'case-start', at: session.createdAt, title: 'Saken startet', detail: 'Beskrivelsen og valgene dine samles i denne saken.', status: 'Registrert', scheduled: false },
    ...session.sources.filter(source => source.kind === 'document').map(source => ({ id: source.id, at: source.at, title: source.title, detail: 'Dokument lagt ved. Innhold må fortsatt kontrolleres.', status: 'Lastet opp', scheduled: false })),
    ...session.history.map((entry, index) => ({ id: `history-${index}`, at: entry.at, title: entry.title, detail: entry.result, status: 'Gjennomført steg', scheduled: false })),
    ...session.outcomes.filter(outcome => outcome.kind !== 'reminder' && outcome.kind !== 'contact').map(outcome => ({ id: outcome.id, at: outcome.createdAt, title: outcome.title, detail: outcome.detail, status: outcome.status === 'mocked' ? 'Simulert e-post' : outcome.status === 'submitted' ? 'KS-testsøknad' : 'Lokal forberedelse', scheduled: false })),
    ...(activity?.reminders ?? []).map(reminder => ({ id: reminder.id, at: reminder.dueAt, title: reminder.title, detail: `${reminder.note || 'Følg opp saken.'} Tidssone: Europe/Oslo. Dette er en påminnelse, ikke en bekreftet søknadsfrist.`, status: reminder.status === 'cancelled' ? 'Avbrutt' : reminder.status === 'fired' ? 'Varsel opprettet' : 'Planlagt påminnelse', scheduled: reminder.status === 'scheduled' })),
    ...(activity?.reviews ?? []).map(review => ({ id: review.id, at: review.updatedAt, title: review.title, detail: review.reply ?? 'Sammendraget er delt med demoens lokale vurderingskø.', status: review.status === 'resolved' ? 'Besvart lokalt' : review.status === 'in-progress' ? 'Under vurdering' : 'I lokal kø', scheduled: false })),
  ];
  return entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
}
