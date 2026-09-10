import { factKeys, type AssistantCase, type FactKey, type FollowUp, type FormFlow, type PendingConsent, type ServiceId, type ServiceResult } from './assistant-types';
import { FACT_LABELS } from './assistant-verification';
import { consentParagraph } from './tool-catalogue';

/**
 * Form catalogue: which application a service can prepare, how eligibility is screened before
 * any consent is requested, and which questions fill the remaining fields afterwards.
 *
 *   input → screen eligibility → unknown: ask, re-run from the start
 *                              → possible: ask consent → run tools → missing data? ask, re-run → ready
 *                              → unlikely: say so, no consent
 */
export type FormDefinition = {
  id: string; serviceId: ServiceId; title: Record<'nb' | 'en', string>;
  /** Screening facts. A 'true' makes the form possible; a value equal to disqualifyingValue makes it unlikely. */
  screening: { key: FactKey; question: string; disqualifyingValue?: string }[];
  /** An explicit mention of the scheme in the latest message also makes the form possible. */
  keywords: RegExp;
  /** Questions for draft fields that are still missing after tools ran. */
  questions: Partial<Record<FactKey, string>>;
};

export const FORM_CATALOGUE: FormDefinition[] = [{
  id: 'sfo-reduced-payment', serviceId: 'family', title: { nb: 'redusert SFO-betaling', en: 'reduced SFO payment' },
  screening: [
    { key: 'uses_sfo', question: 'Har du barn som bruker eller skal bruke SFO?', disqualifyingValue: 'false' },
    { key: 'has_children', question: 'Har du barn?', disqualifyingValue: 'false' },
  ],
  keywords: /\b(sfo|skolefritidsordning|foreldrebetaling|after[- ]school)\b/iu,
  questions: {
    job_lost: 'Har du mistet jobben eller fått vesentlig lavere inntekt?', uses_sfo: 'Bruker barnet SFO?',
    household_income_annual: 'Hva er samlet årsinntekt for husholdningen?', income_basis: 'Gjelder inntekten hele husholdningen og et helt år?',
    cohabitant_missing: 'Mangler samboer eller andre i husstandsgrunnlaget?',
  },
}];

export function formFor(serviceId: ServiceId): FormDefinition | undefined { return FORM_CATALOGUE.find(form => form.serviceId === serviceId); }

/** Screening may use proposed facts: it only decides whether to ask, never fills the form. */
export function activeValue(session: Pick<AssistantCase, 'facts'>, key: FactKey): string | undefined {
  const active = session.facts.filter(fact => fact.key === key && ['confirmed', 'proposed', 'conflict'].includes(fact.status));
  if (!active.length) return undefined;
  const confirmed = active.find(fact => fact.status === 'confirmed');
  if (confirmed) return confirmed.value;
  const values = new Set(active.map(fact => fact.value));
  return values.size === 1 ? active[0].value : undefined;
}

export function screenEligibility(session: Pick<AssistantCase, 'facts'>, form: FormDefinition, latestText = ''): { eligibility: FormFlow['eligibility']; questions: FollowUp[] } {
  const values = form.screening.map(item => ({ ...item, value: activeValue(session, item.key) }));
  if (values.some(item => item.disqualifyingValue !== undefined && item.value === item.disqualifyingValue)) return { eligibility: 'unlikely', questions: [] };
  if (values.some(item => item.value === 'true') || form.keywords.test(latestText)) return { eligibility: 'possible', questions: [] };
  const first = values[0];
  return { eligibility: 'unknown', questions: [{ key: first.key, question: first.question, serviceIds: [form.serviceId] }] };
}

/** Final stage after tools and specialists ran. Missing means: a fact-backed field with no confirmed value and no proposal awaiting the citizen. */
export function formFlowFor(service: ServiceResult, session: AssistantCase, eligibility: FormFlow['eligibility']): FormFlow | null {
  const form = formFor(service.id);
  if (!form) return null;
  const awaiting = new Set(session.facts.filter(fact => ['proposed', 'conflict'].includes(fact.status)).map(fact => fact.key));
  const missing = (service.applicationDraft?.fields ?? [])
    .filter(field => field.status === 'missing' && (factKeys as readonly string[]).includes(field.key) && !awaiting.has(field.key as FactKey))
    .map(field => field.key as FactKey);
  const pending = (session.pendingConsents ?? []).some(consent => consent.serviceIds.includes(service.id));
  const stage: FormFlow['stage'] = eligibility === 'unlikely' ? 'not-applicable' : eligibility === 'unknown' ? 'screening'
    : pending ? 'consent' : missing.length || awaiting.size ? 'collecting' : 'ready';
  return { formId: form.id, title: form.title.nb, eligibility, stage, missing,
    questions: missing.map(key => ({ key, question: form.questions[key] ?? FACT_LABELS[key], serviceIds: [service.id] })) };
}

/** Node-authored paragraph for the assistant reply, per stage. The model never writes this. */
export function stageParagraph(flow: FormFlow, service: ServiceResult, session: AssistantCase, consents: PendingConsent[], language = 'nb'): string {
  const form = formFor(service.id)!;
  const lang: 'nb' | 'en' = language.startsWith('en') ? 'en' : 'nb';
  const title = form.title[lang];
  const draft = service.applicationDraft;
  const filled = draft ? `${draft.filled}/${draft.fields.length}` : '';
  const awaiting = session.facts.some(fact => ['proposed', 'conflict'].includes(fact.status));
  const labels = flow.missing.map(key => FACT_LABELS[key].toLocaleLowerCase()).join(lang === 'en' ? ', ' : ', ');
  switch (flow.stage) {
    case 'screening': {
      const asks = (session.questions.length ? session.questions : flow.questions).map(question => question.question).join(' ');
      return lang === 'en'
        ? `**Could you be entitled to ${title}?** To find out I first need to know: ${asks} Answer in the form below and I will assess again.`
        : `**Kan du ha rett til ${title}?** For å vurdere det trenger jeg først svar på: ${asks} Svar i skjemaet under, så vurderer jeg på nytt.`;
    }
    case 'consent': return consentParagraph(consents, language);
    case 'collecting': return lang === 'en'
      ? `**The draft application for ${title} has ${filled} fields filled.**${labels ? ` I still need: ${labels}.` : ''}${awaiting ? ' Please also confirm the proposed details in your overview.' : ''} Answer below and I will update the draft.`
      : `**Søknadsutkastet for ${title} har ${filled} felt fylt.**${labels ? ` Jeg mangler fortsatt: ${labels}.` : ''}${awaiting ? ' Bekreft også forslagene i oversikten.' : ''} Svar under, så oppdaterer jeg utkastet.`;
    case 'ready': return lang === 'en'
      ? `**The draft application for ${title} is filled in (${filled} fields).** Check the fields on the plan board. Nothing has been submitted; you confirm the plan and submit it yourself.`
      : `**Søknadsutkastet for ${title} er fylt ut (${filled} felt).** Kontroller feltene i tavlen. Ingenting er sendt; du bekrefter planen og sender selv.`;
    case 'not-applicable': return lang === 'en'
      ? `Based on what you have told me, ${title} does not seem relevant right now. Tell me if something is wrong.`
      : `Ut fra det du har oppgitt ser ${title} ikke ut til å være aktuelt nå. Si fra hvis noe er feil.`;
  }
}
