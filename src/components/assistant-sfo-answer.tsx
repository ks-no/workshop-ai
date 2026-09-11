'use client';

import type { AssistantCase } from '../domain/assistant-types';
import { sfoAnswer } from '../domain/sfo-answer';
import { AssistantEvidence } from './assistant-evidence';
import { useAssistantLocale } from './assistant-i18n';
import { AssistantButton } from './assistant-controls';
import { PktTag } from './punkt-react';
import { useEffect, useId, useState } from 'react';

type KlarsprakContrast = { regulationText: string; texts: { nb: string; vi: string }; source: 'ai-gateway' | 'own-model' | 'template' };
type KlarsprakLanguage = 'nb' | 'vi';

function KlarsprakContrastPanel({ session }: { session: AssistantCase }) {
  const { t } = useAssistantLocale();
  const [contrast, setContrast] = useState<KlarsprakContrast | null>(null);
  const [language, setLanguage] = useState<KlarsprakLanguage>('nb');
  const headingId = useId();
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ caseId: session.id, revision: String(session.revision) });
    fetch(`/api/klarsprak?${params}`, { cache: 'no-store' })
      .then(response => (response.ok ? response.json() as Promise<KlarsprakContrast> : null))
      .then(data => { if (active) setContrast(data); })
      .catch(() => { if (active) setContrast(null); });
    return () => { active = false; };
  }, [session.id, session.revision]);
  if (!contrast) return null;
  const sourceNote = contrast.source === 'template' ? 'Fast tekst fra regelmotoren, ingen språkmodell er brukt. Beløpene er identiske i begge språk.'
    : contrast.source === 'ai-gateway' ? 'Teksten er skrevet om av KS-sandkassens KI-gateway. Den har bare en forklarende rolle og endrer ingen beløp. Beløpene er identiske i begge språk.'
    : 'Teksten er skrevet om av vår egen KI-modell. Beløpene er identiske i begge språk.';
  return <div className="assistant-klarsprak" aria-labelledby={headingId}>
    <div className="assistant-klarsprak-heading">
      <h3 id={headingId}>{t('Forskriftstekst mot klarspråk')}</h3>
      <div className="assistant-klarsprak-toggle" role="group" aria-label={t('Velg språk for klarspråksteksten')}>
        <AssistantButton size="small" skin={language === 'nb' ? 'primary' : 'tertiary'} aria-pressed={language === 'nb'} onClick={() => setLanguage('nb')}>NO</AssistantButton>
        <AssistantButton size="small" skin={language === 'vi' ? 'primary' : 'tertiary'} aria-pressed={language === 'vi'} onClick={() => setLanguage('vi')}>VI</AssistantButton>
      </div>
    </div>
    <div className="assistant-klarsprak-columns">
      <div className="assistant-klarsprak-column" lang="nb"><span className="small">{t('Forskriftstekst og satsgrunnlag')}</span><p>{contrast.regulationText}</p></div>
      <div className="assistant-klarsprak-column" lang={language}><span className="small">{t('Klarspråk')}</span><p>{contrast.texts[language]}</p></div>
    </div>
    <p className="small">{t(sourceNote)}</p>
  </div>;
}

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
      <KlarsprakContrastPanel session={session} />
    </>}
  </section>;
}
