'use client';

import { PktTag } from './punkt-react';
import type { AssistantCase, FollowUp } from '../domain/assistant-types';
import { AssistantButton } from './assistant-controls';
import { AssistantSource } from './assistant-evidence';
import { factLabel, localizeCheck, serviceLabel, useAssistantLocale } from './assistant-i18n';

export function AssistantPlanBoard({ session, busy, onQuestions }: { session: AssistantCase | null; busy: boolean; onQuestions: (questions: FollowUp[]) => void }) {
  const { locale, t } = useAssistantLocale();
  return <section className="assistant-plan-board" aria-label={t('Tjenestetavle')}>
    <p className="small">{t('Tavlen viser faktiske sjekkpunkter i planen. Du kan svare på manglende opplysninger; vurderinger må fortsatt gjøres av en person.')}</p>
    {!session?.services.length && <p className="assistant-empty">{t('Tjenestene vises her når samtalen har gitt grunnlag for en plan.')}</p>}
    {session?.services.map(service => <article key={service.id} className="assistant-board-service">
      <h3>{serviceLabel(service.id, locale)}</h3>
      <PktTag skin={service.status === 'error' ? 'red' : 'blue-light'} size="small">{t(service.status === 'ready' ? 'Forberedt' : service.status === 'needs-information' ? 'Trenger opplysninger' : service.status === 'needs-review' ? 'Kontroller før du går videre' : 'Kunne ikke fullføres')}</PktTag>
      <ul className="assistant-board-checks">{service.checks.map(original => {
        const check = localizeCheck(original, locale);
        const questions = original.factKeys.map(key => ({ key, question: factLabel(key, original.label, locale), serviceIds: [service.id] }));
        return <li key={check.id} className={`is-${check.status}`}>
          <span className="small">{t(check.status === 'ready' ? 'Bekreftet av deg' : check.status === 'human' ? 'Du må kontrollere' : 'Trenger opplysninger')}</span>
          <h4>{check.label}</h4><p className="small">{check.detail}</p>
          {!!questions.length && !session.handoff && <AssistantButton skin="tertiary" size="small" disabled={busy} onClick={() => onQuestions(questions)}>{t('Svar eller rett opplysninger')}<span className="sr-only">: {check.label}</span></AssistantButton>}
        </li>;
      })}</ul>
      {!service.checks.length && <p className="small">{t('Ingen sjekkpunkter ennå.')}</p>}
      {service.applicationDraft && <details className="assistant-board-sources" open={service.applicationDraft.filled > 0}>
        <summary>{t('Søknadsutkast')} · {service.applicationDraft.filled}/{service.applicationDraft.fields.length} {t('felt fylt')}</summary>
        <p className="small">{t(service.applicationDraft.title)}. {t(service.applicationDraft.note)}</p>
        <ul className="assistant-board-checks">{service.applicationDraft.fields.map(field => <li key={field.key} className={`is-${field.status === 'filled' ? 'ready' : field.status === 'review' ? 'human' : 'missing'}`}>
          <span className="small">{t(field.status === 'filled' ? 'Fylt ut' : field.status === 'review' ? 'Du må kontrollere' : 'Mangler')}</span>
          <h4>{t(field.label)}</h4>
          {field.value && <p><strong>{t(field.value)}</strong></p>}
          <p className="small">{t(field.detail)}</p>
        </li>)}</ul>
      </details>}
      <details className="assistant-board-sources"><summary>{t('Kilder for tjenesten')}</summary>{session.sources.filter(source => service.sourceIds.includes(source.id)).map(source => <AssistantSource key={source.id} source={source} />)}</details>
    </article>)}
  </section>;
}
