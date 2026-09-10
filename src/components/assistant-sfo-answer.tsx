'use client';

import type { AssistantCase } from '../domain/assistant-types';
import { sfoAnswer } from '../domain/sfo-answer';
import { AssistantEvidence } from './assistant-evidence';
import { useAssistantLocale } from './assistant-i18n';
import { PktTag } from './punkt-react';
import { useId } from 'react';

export function AssistantSfoAnswer({ session }: { session: AssistantCase }) {
  const { locale, t } = useAssistantLocale();
  const headingId = useId();
  if (!session.services.some(service => service.id === 'family')) return null;
  const answer = sfoAnswer(session);
  const number = (value: number) => new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'nb-NO').format(value);
  return <section className="assistant-answer-card" aria-labelledby={headingId}>
    <div className="assistant-answer-heading"><div><span className="small">{t('Svar på spørsmålet ditt')}</span><h2 id={headingId}>{t('Resultat for SFO-spørsmålet ditt')}</h2></div>
      <PktTag size="small" skin={answer && !answer.basisConflict && answer.eligible ? 'green' : 'yellow'}>{t(answer ? 'Data fra KS-sandkassen' : 'Ikke avklart ennå')}</PktTag></div>
    {!answer ? <p>{t('Det finnes ikke noe regelresultat ennå. Hent KS-opplysningene og inntektsgrunnlaget med samtykke for å få et svar fra sandkassen.')}</p> : <>
      <p>{t('Resultat fra syntetiske KS-data:')} <strong>{t(answer.eligible ? 'Ja' : 'Nei')}</strong>. {answer.scheme && <>{t('Ordningen som ble kontrollert er')} <strong>{answer.scheme}</strong>.</>}</p>
      <dl className="assistant-answer-values">
        {answer.basisIncomeNok !== null && <div><dt>{t('Inntektsgrunnlag brukt av KS')}</dt><dd>{number(answer.basisIncomeNok)} NOK</dd></div>}
        {answer.thresholdNok !== null && <div><dt>{t('Grense i KS-sandkassen')}</dt><dd>{number(answer.thresholdNok)} NOK</dd></div>}
        {answer.reportedIncomeNok !== null && <div><dt>{t('Årsinntekt du oppga')}</dt><dd>{number(answer.reportedIncomeNok)} NOK</dd></div>}
      </dl>
      {answer.basisConflict ? <div className="assistant-answer-conflict"><strong>{t('Hvorfor dette ikke er et endelig svar')}</strong><p>{t('KS-resultatet bruker et annet husholdningsgrunnlag enn opplysningene du ga.')}{answer.missingPartner && ` ${t('Du oppga også at en partner mangler i husholdningsgrunnlaget.')}`} {t('En person må avklare riktig husholdning og inntekt før spørsmålet kan besvares endelig.')}</p></div> : <p className="small">{t('Dette er et resultat for syntetiske testopplysninger, ikke et kommunalt vedtak.')}</p>}
      <p className="small"><strong>{t('Lagret regelmelding fra KS:')}</strong> <span lang="nb">{answer.message}</span></p>
      <div className="assistant-answer-sources"><strong>{t('Kilde for dette resultatet')}</strong><AssistantEvidence citation={answer.citation} sources={session.sources} /></div>
    </>}
  </section>;
}
