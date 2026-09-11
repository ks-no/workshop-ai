'use client';

import { useState } from 'react';
import { PktTag, PktTextarea, PktTextinput } from './punkt-react';
import { AssistantButton, AssistantIcon } from './assistant-controls';
import { factLabel, factValue, serviceLabel, useAssistantLocale } from './assistant-i18n';
import { resolveNextActions } from '../domain/assistant-actions';
import type { AssistantCase, AssistantCommand, ContactPoint, EmailDraft, FormDraft, FollowUp, NextAction, Outcome, ServiceId } from '../domain/assistant-types';

type Act = (command: AssistantCommand, label: string) => Promise<boolean>;
type OpenSection = (id: 'case-heading' | 'services-heading' | 'handoff-heading') => void;

/** Only a plain address reaches the mail client; the server has already validated the shape. */
export function mailtoHref(to: string, subject: string, body: string) {
  const address = to.replace(/[^A-Za-z0-9._%+@-]/g, '');
  return `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
export function safeExternalUrl(url: string | null) {
  return url && /^https:\/\//i.test(url) ? url : null;
}
const actionIcons: Record<NextAction['kind'], string> = { clarify: 'question', contact: 'user', email: 'email', form: 'clipboard', 'self-service': 'arrow-up-right', summary: 'download' };

function questionsForService(session: AssistantCase, serviceId: ServiceId, locale: 'nb' | 'en'): FollowUp[] {
  const service = session.services.find(item => item.id === serviceId);
  if (!service) return [];
  if (service.questions.length) return service.questions;
  return service.checks.filter(check => check.status === 'missing').flatMap(check => check.factKeys.map(key => ({ key, question: factLabel(key, check.label, locale), serviceIds: [serviceId] })));
}

export function AssistantContactCard({ contact, compact = false }: { contact: ContactPoint; compact?: boolean }) {
  const { t } = useAssistantLocale();
  const url = safeExternalUrl(contact.url);
  return <div className={`assistant-contact-card ${compact ? 'is-compact' : ''}`}>
    <strong>{t(contact.name)}</strong>
    <p className="small">{t(contact.role)} · {t(contact.organisation)}</p>
    <dl className="assistant-contact-meta">
      {contact.phone && <div><dt>{t('Telefon')}</dt><dd><a href={`tel:${contact.phone.replace(/\s/g, '')}`}>{contact.phone}</a></dd></div>}
      {contact.email && <div><dt>{t('E-post')}</dt><dd>{contact.email}</dd></div>}
      {contact.hours && <div><dt>{t('Åpningstid')}</dt><dd>{t(contact.hours)}</dd></div>}
      {url && <div><dt>{t('Nettside')}</dt><dd><a href={url} target="_blank" rel="noreferrer">{t('Åpne tjenesten')} <AssistantIcon name="arrow-up-right" aria-hidden="true" /></a></dd></div>}
    </dl>
    {!compact && <p className="small">{t(contact.note)}</p>}
  </div>;
}

/** The conversation's "what happens now" card: the recommended end action plus the alternatives that are actually available. */
export function AssistantNextActions({ session, busy, modelAvailable, act, onQuestions, onOpen }: {
  session: AssistantCase; busy: boolean; modelAvailable: boolean; act: Act; onQuestions: (questions: FollowUp[]) => void; onOpen: OpenSection;
}) {
  const { locale, t } = useAssistantLocale();
  void modelAvailable;
  const [openContact, setOpenContact] = useState<string | null>(null);
  const actions = resolveNextActions(session).filter(action => action.kind !== 'summary');
  const summary = resolveNextActions(session).find(action => action.kind === 'summary');
  if (!actions.length) return null;
  const recommended = actions.find(action => action.recommended && action.available) ?? actions.find(action => action.available) ?? actions[0];
  const alternatives = actions.filter(action => action.id !== recommended.id);
  const outcomes = session.outcomes ?? [];

  function run(action: NextAction) {
    if (!action.serviceId) return;
    if (action.kind === 'clarify') onQuestions(questionsForService(session, action.serviceId, locale));
    else if (action.kind === 'contact') setOpenContact(current => current === action.id ? null : action.id);
    else if (action.kind === 'email') void act({ action: 'draft-email', serviceId: action.serviceId, revision: session.revision, caseId: session.id }, 'Lager e-postutkast');
    else if (action.kind === 'form') void act({ action: 'fill-form', serviceId: action.serviceId, revision: session.revision, caseId: session.id }, 'Fyller ut skjemaet fra bekreftede opplysninger');
  }
  function control(action: NextAction, primary: boolean) {
    const url = safeExternalUrl(action.url);
    const label = action.done && action.kind !== 'contact' && action.kind !== 'self-service' ? t('Gjør på nytt') : t(action.kind === 'contact' ? (openContact === action.id ? 'Skjul kontaktinformasjon' : 'Vis kontaktinformasjon') : action.kind === 'clarify' ? 'Svar nå' : action.kind === 'email' ? 'Lag e-postutkast' : action.kind === 'form' ? 'Fyll ut skjemaet' : 'Åpne tjenesten');
    if (action.kind === 'self-service' && url) return <a className={`pkt-btn pkt-btn--${primary ? 'primary' : 'secondary'} pkt-btn--${primary ? 'medium' : 'small'}`} href={url} target="_blank" rel="noreferrer">{label} <AssistantIcon name="arrow-up-right" aria-hidden="true" /></a>;
    // E-mail works without the model too: the server then uses the fixed draft built from confirmed facts.
    return <AssistantButton skin={primary ? 'primary' : 'secondary'} size={primary ? 'medium' : 'small'} disabled={busy || !action.available} aria-expanded={action.kind === 'contact' ? openContact === action.id : undefined} onClick={() => run(action)}>{label}{primary && <AssistantIcon name="arrow-right" aria-hidden="true" />}</AssistantButton>;
  }

  return <section className="assistant-next-step is-ready assistant-actions" aria-labelledby="assistant-next-step-heading">
    <div className="assistant-actions-main">
      <span className="assistant-next-step-kicker">{t(recommended.recommended ? 'Anbefalt neste steg' : 'Neste steg')}{recommended.serviceId && <> · {serviceLabel(recommended.serviceId, locale)}</>}</span>
      <h2 id="assistant-next-step-heading">{t(recommended.title)}</h2>
      <p>{t(recommended.reason ?? recommended.detail)}</p>
      {!!recommended.blockers.length && <ul className="assistant-action-blockers small">{recommended.blockers.map(blocker => <li key={blocker}>{t(blocker)}</li>)}</ul>}
      {recommended.done && <p className="small"><AssistantIcon name="check" aria-hidden="true" /> {t('Allerede utført. Kvitteringen ligger under Neste steg.')}</p>}
      <div className="assistant-next-step-actions is-inline">{control(recommended, true)}</div>
      {recommended.kind === 'contact' && openContact === recommended.id && recommended.contact && <AssistantContactCard contact={recommended.contact} />}
    </div>
    {!!alternatives.length && <div className="assistant-alternatives">
      <h3>{t('Andre muligheter')}</h3>
      <ul>{alternatives.map(action => <li key={action.id}>
        <div className="assistant-alternative-copy"><AssistantIcon name={actionIcons[action.kind]} aria-hidden="true" /><div><strong>{t(action.title)}</strong>{action.serviceId && <span className="small"> · {serviceLabel(action.serviceId, locale)}</span>}{!action.available && !!action.blockers.length && <p className="small">{t(action.blockers[0])}</p>}{action.done && <p className="small">{t('Utført')}</p>}</div></div>
        {control(action, false)}
        {action.kind === 'contact' && openContact === action.id && action.contact && <AssistantContactCard contact={action.contact} compact />}
      </li>)}</ul>
    </div>}
    {summary && <p className="small assistant-summary-hint">{summary.done ? t('Saken er fullført.') : summary.available ? <>{t('Når du er ferdig med handlingene, kan du')} <AssistantButton skin="tertiary" size="small" onClick={() => onOpen('handoff-heading')}>{t('fullføre og laste ned oppsummeringen')}</AssistantButton>.</> : t('Oppsummeringen kan lastes ned når alle tjenestevurderinger er fullført.')}{!!outcomes.length && <> {outcomes.length} {t(outcomes.length === 1 ? 'handling er utført.' : 'handlinger er utført.')}</>}</p>}
  </section>;
}

export function AssistantEmailDraftPanel({ session, draft, busy, act }: { session: AssistantCase; draft: EmailDraft; busy: boolean; act: Act }) {
  const { locale, t } = useAssistantLocale();
  const [to, setTo] = useState(draft.to.email ?? '');
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [copied, setCopied] = useState(false);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim()) && subject.trim().length > 0 && body.trim().length > 0 && body.length <= 4000;
  const href = mailtoHref(to.trim(), subject.trim(), body.trim());
  async function copy() {
    try { await navigator.clipboard.writeText(`${t('Til')}: ${to}\n${t('Emne')}: ${subject}\n\n${body}`); setCopied(true); } catch { setCopied(false); }
  }
  return <section className="assistant-draft" aria-labelledby="assistant-email-heading">
    <div className="assistant-data-action-heading"><AssistantIcon name="email" aria-hidden="true" /><div><span className="assistant-next-step-kicker">{t('Utkast · les over før du sender')} · {serviceLabel(draft.serviceId, locale)}</span><h2 id="assistant-email-heading">{t('E-post til')} {t(draft.to.name)}</h2></div></div>
    <p className="small">{t(draft.aiDrafted ? 'KI-utkast kontrollert mot bekreftede opplysninger. Du kan endre alt før du sender.' : 'Fast utkast laget fra bekreftede opplysninger, uten KI. Du kan endre alt før du sender.')} {t('Ingenting sendes fra denne appen; e-posten åpnes i ditt eget e-postprogram.')}</p>
    <div className="assistant-draft-fields">
      <PktTextinput id="assistant-email-to" label={t('Til')} type="email" value={to} fullwidth disabled={busy} maxLength={200} onChange={event => setTo(event.target.value)} />
      <PktTextinput id="assistant-email-subject" label={t('Emne')} value={subject} fullwidth disabled={busy} maxLength={160} onChange={event => setSubject(event.target.value)} />
      <PktTextarea id="assistant-email-body" label={t('Tekst')} rows={12} value={body} fullwidth disabled={busy} maxLength={4000} onChange={event => setBody(event.target.value)} />
    </div>
    <AssistantContactCard contact={draft.to} compact />
    <div className="assistant-data-action-actions">
      {valid && !busy
        ? <a className="pkt-btn pkt-btn--primary pkt-btn--medium" href={href} onClick={() => { void act({ action: 'send-email', serviceId: draft.serviceId, to: to.trim(), subject: subject.trim(), body: body.trim(), revision: session.revision, caseId: session.id }, 'Registrerer e-posten og åpner e-postprogrammet'); }}>{t('Godkjenn og åpne i e-postprogrammet')} <AssistantIcon name="arrow-up-right" aria-hidden="true" /></a>
        : <AssistantButton skin="primary" disabled>{t('Godkjenn og åpne i e-postprogrammet')}</AssistantButton>}
      <AssistantButton skin="secondary" size="small" disabled={busy} onClick={() => void copy()}>{t(copied ? 'Kopiert' : 'Kopier teksten')}</AssistantButton>
      <AssistantButton skin="tertiary" size="small" disabled={busy} onClick={() => void act({ action: 'discard-draft', kind: 'email', revision: session.revision, caseId: session.id }, 'Forkaster utkastet')}>{t('Forkast utkastet')}</AssistantButton>
    </div>
    {!valid && <p className="small" role="status">{t('Fyll inn en gyldig e-postadresse, et emne og en tekst på inntil 4000 tegn.')}</p>}
  </section>;
}

export function AssistantFormDraftPanel({ session, draft, busy, act, onQuestions }: { session: AssistantCase; draft: FormDraft; busy: boolean; act: Act; onQuestions: (questions: FollowUp[]) => void }) {
  const { locale, t } = useAssistantLocale();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(draft.fields.filter(field => field.editable).map(field => [field.id, field.value])));
  const ks = draft.submission === 'ks-sandbox';
  const originLabel: Record<FormDraft['fields'][number]['origin'], string> = { confirmed: 'Bekreftet av deg', register: 'Hentet fra KS', citizen: 'Dine egne ord', empty: 'Ikke utfylt' };
  function submit() {
    const fields = Object.fromEntries(draft.fields.map(field => [field.id, field.editable ? (values[field.id] ?? '') : field.value]));
    void act({ action: 'submit-form', serviceId: draft.serviceId, fields, revision: session.revision, caseId: session.id }, ks ? 'Sender testsøknaden til KS-sandkassen' : 'Klargjør skjemaet');
  }
  return <section className="assistant-draft" aria-labelledby="assistant-form-heading">
    <div className="assistant-data-action-heading"><AssistantIcon name="clipboard" aria-hidden="true" /><div><span className="assistant-next-step-kicker">{t('Utfylt skjema · les over før du sender')} · {serviceLabel(draft.serviceId, locale)}</span><h2 id="assistant-form-heading">{t(draft.title)}</h2></div></div>
    <p className="small">{t('Feltene er fylt ut fra opplysninger du har bekreftet. Ingen verdi er beregnet eller antatt. Bekreftede opplysninger rettes i oversikten, ikke her.')}</p>
    <div className="assistant-form-fields">{draft.fields.map(field => field.editable
      ? <div key={field.id} className={`assistant-form-field is-${field.origin}`}><PktTextarea id={`assistant-form-${field.id}`} label={t(field.label)} helptext={field.origin === 'citizen' ? t('Fylt ut fra dine egne meldinger. Du kan endre teksten.') : undefined} rows={3} value={values[field.id] ?? ''} fullwidth disabled={busy} maxLength={1000} onChange={event => setValues(previous => ({ ...previous, [field.id]: event.target.value }))} /></div>
      : <div key={field.id} className={`assistant-form-field is-${field.origin}`}>
        <span className="assistant-form-label">{factLabel(field.factKey ?? '', field.label, locale)}{field.required && <span aria-hidden="true"> *</span>}</span>
        <div className="assistant-form-value"><span>{field.value ? factValue(field.value, locale) : t('Ikke utfylt')}</span>{field.origin !== 'empty' && <PktTag size="small" skin={field.origin === 'register' ? 'blue-light' : 'green'}>{t(originLabel[field.origin])}</PktTag>}{field.factKey && !session.handoff && <AssistantButton skin="tertiary" size="small" disabled={busy} onClick={() => onQuestions([{ key: field.factKey!, question: factLabel(field.factKey!, field.label, locale), serviceIds: [draft.serviceId] }])}>{t('Rett opplysningen')}<span className="sr-only"> {factLabel(field.factKey, field.label, locale)}</span></AssistantButton>}</div>
      </div>)}</div>
    {!!draft.attachments.length && <div className="assistant-form-attachments"><strong>{t('Dokumentasjon du må legge ved selv')}</strong><ul>{draft.attachments.map(item => <li key={item}>{t(item)}</li>)}</ul></div>}
    <div className="assistant-form-recipient"><strong>{t('Mottaker')}</strong><AssistantContactCard contact={draft.recipient} compact /></div>
    <p className="small">{t(ks ? 'Innsendingen går til KS sin workshop-sandkasse for den konfigurerte testpersonen. Sandkassen registrerer søknaden og oppretter en saksbehandleroppgave. Dette er ikke en søknad til en virkelig kommune.' : 'Denne tjenesten krever innlogging hos mottakeren. Vi klargjør skjemaet og gir deg en kvittering du kan bruke når du fyller ut den offisielle tjenesten.')}</p>
    <div className="assistant-data-action-actions">
      <AssistantButton skin="primary" disabled={busy} onClick={submit}>{t(ks ? 'Godkjenn og send testsøknaden' : 'Godkjenn og klargjør skjemaet')}<AssistantIcon name="arrow-right" aria-hidden="true" /></AssistantButton>
      <AssistantButton skin="tertiary" size="small" disabled={busy} onClick={() => void act({ action: 'discard-draft', kind: 'form', revision: session.revision, caseId: session.id }, 'Forkaster utkastet')}>{t('Forkast utkastet')}</AssistantButton>
    </div>
  </section>;
}

export function AssistantOutcomes({ session, latestOnly = false }: { session: AssistantCase; latestOnly?: boolean }) {
  const { locale, t, dateTime } = useAssistantLocale();
  const outcomes = latestOnly ? (session.outcomes ?? []).slice(-1) : session.outcomes ?? [];
  if (!outcomes.length) return null;
  return <section className={`assistant-outcomes ${latestOnly ? 'is-latest' : ''}`} aria-label={t('Utførte handlinger')}>
    {!latestOnly && <h3>{t('Utførte handlinger')} ({outcomes.length})</h3>}
    {outcomes.map(outcome => <OutcomeCard key={outcome.id} outcome={outcome} caseId={session.id} locale={locale} t={t} dateTime={dateTime} />)}
  </section>;
}
function OutcomeCard({ outcome, caseId, locale, t, dateTime }: { outcome: Outcome; caseId: string; locale: 'nb' | 'en'; t: (text: string) => string; dateTime: (iso: string) => string }) {
  const statusLabel: Record<Outcome['status'], string> = { 'sent-to-mail-client': 'Overlevert til e-postprogrammet', 'submitted-to-ks-sandbox': 'Sendt inn til KS-sandkassen', 'prepared-locally': 'Klargjort lokalt' };
  return <article className="assistant-outcome">
    <div className="assistant-outcome-heading"><AssistantIcon name="check" aria-hidden="true" /><div><span className="assistant-next-step-kicker">{t('Utført')} · {serviceLabel(outcome.serviceId, locale)}</span><h4>{outcome.kind === 'email' ? `${t('E-post til')} ${t(outcome.recipient.name)}` : t(outcome.title)}</h4></div><PktTag size="small" skin={outcome.localOnly ? 'blue-light' : 'green'}>{t(statusLabel[outcome.status])}</PktTag></div>
    <p className="small">{t(outcome.detail)}</p>
    <dl className="assistant-outcome-meta">
      <div><dt>{t('Referanse')}</dt><dd>{outcome.reference}</dd></div>
      {outcome.payload.ksOppgaveId && <div><dt>{t('Saksbehandleroppgave')}</dt><dd>{outcome.payload.ksOppgaveId}</dd></div>}
      <div><dt>{t('Tidspunkt')}</dt><dd>{dateTime(outcome.createdAt)}</dd></div>
    </dl>
    {outcome.payload.ksWarning && <p className="small">{t('Merknad fra KS:')} {outcome.payload.ksWarning}</p>}
    <div className="assistant-outcome-actions">
      <a className="pkt-btn pkt-btn--secondary pkt-btn--small" href={`/api/assistant/outcome?caseId=${encodeURIComponent(caseId)}&outcomeId=${encodeURIComponent(outcome.id)}`} download><AssistantIcon name="download" aria-hidden="true" />{t('Last ned kvittering')}</a>
      {outcome.kind === 'email' && outcome.payload.to && <a className="pkt-btn pkt-btn--tertiary pkt-btn--small" href={mailtoHref(outcome.payload.to, outcome.payload.subject ?? '', outcome.payload.body ?? '')}>{t('Åpne i e-postprogrammet igjen')}</a>}
    </div>
  </article>;
}

/** The review tab's complete list: every end action per service with availability, plus the contact for each. */
export function AssistantActionList({ session, busy, modelAvailable, act, onQuestions }: { session: AssistantCase; busy: boolean; modelAvailable: boolean; act: Act; onQuestions: (questions: FollowUp[]) => void }) {
  const { locale, t } = useAssistantLocale();
  void modelAvailable;
  const actions = resolveNextActions(session).filter(action => action.serviceId);
  if (!actions.length) return null;
  const services = [...new Set(actions.map(action => action.serviceId!))];
  return <section className="assistant-case-section assistant-action-list" aria-labelledby="actions-heading">
    <div className="assistant-section-heading"><h2 id="actions-heading" tabIndex={-1}>{t('Veien videre per tjeneste')}</h2></div>
    <p className="assistant-section-intro">{t('Hver tjeneste ender i en konkret handling. Agenten anbefaler, appen kontrollerer hva som er mulig, og du utfører.')}</p>
    {services.map(serviceId => <div key={serviceId} className="assistant-action-service">
      <h3>{serviceLabel(serviceId, locale)}</h3>
      <ul>{actions.filter(action => action.serviceId === serviceId).map(action => {
        const url = safeExternalUrl(action.url);
        return <li key={action.id} className={action.available ? '' : 'is-blocked'}>
          <div className="assistant-alternative-copy"><AssistantIcon name={actionIcons[action.kind]} aria-hidden="true" /><div><strong>{t(action.title)}</strong>{action.recommended && <PktTag size="small" skin="green">{t('Anbefalt')}</PktTag>}{action.done && <PktTag size="small" skin="blue-light">{t('Utført')}</PktTag>}<p className="small">{t(action.reason ?? action.detail)}</p>{!!action.blockers.length && <ul className="assistant-action-blockers small">{action.blockers.map(blocker => <li key={blocker}>{t(blocker)}</li>)}</ul>}</div></div>
          {action.kind === 'contact' && action.contact && <AssistantContactCard contact={action.contact} compact />}
          {action.kind === 'self-service' && url && <a className="pkt-btn pkt-btn--secondary pkt-btn--small" href={url} target="_blank" rel="noreferrer">{t('Åpne tjenesten')} <AssistantIcon name="arrow-up-right" aria-hidden="true" /></a>}
          {action.kind === 'clarify' && !session.handoff && <AssistantButton skin="secondary" size="small" disabled={busy || !action.available} onClick={() => onQuestions(questionsForService(session, serviceId, locale))}>{t('Svar nå')}</AssistantButton>}
          {action.kind === 'email' && !session.handoff && <AssistantButton skin="secondary" size="small" disabled={busy || !action.available} onClick={() => void act({ action: 'draft-email', serviceId, revision: session.revision, caseId: session.id }, 'Lager e-postutkast')}>{t(action.done ? 'Lag nytt utkast' : 'Lag e-postutkast')}</AssistantButton>}
          {action.kind === 'form' && !session.handoff && <AssistantButton skin="secondary" size="small" disabled={busy || !action.available} onClick={() => void act({ action: 'fill-form', serviceId, revision: session.revision, caseId: session.id }, 'Fyller ut skjemaet fra bekreftede opplysninger')}>{t(action.done ? 'Fyll ut på nytt' : 'Fyll ut skjemaet')}</AssistantButton>}
        </li>;
      })}</ul>
    </div>)}
  </section>;
}
