'use client';

import { useState } from 'react';
import { PktCheckbox } from './punkt-react';
import type { AssistantCase, AssistantCommand } from '../domain/assistant-types';
import { AssistantButton, AssistantIcon } from './assistant-controls';
import { useAssistantLocale } from './assistant-i18n';

export function AssistantKsAction({ session, busy, act }: {
  session: AssistantCase;
  busy: boolean;
  act: (command: AssistantCommand, label: string) => Promise<boolean>;
}) {
  const { t, dateTime } = useAssistantLocale();
  const [approvedVersion, setApprovedVersion] = useState<string | null>(null);
  const version = `${session.id}:${session.revision}`;
  const approved = !busy && approvedVersion === version;
  const relevant = session.services.some(service => service.id === 'family');

  if (!relevant || session.handoff) return null;

  if (session.ksData?.incomeReadAt) return <section className="assistant-data-action is-complete" role="status">
    <div className="assistant-data-action-heading"><AssistantIcon name="check" aria-hidden="true" /><div><span className="assistant-next-step-kicker">{t('Fullført')}</span><h2>{t('KS-opplysningene er hentet')}</h2></div></div>
    <p>{t('Agentene fortsatte automatisk med de nye kildene. Du kan kontrollere og rette opplysningene i oversikten.')}</p>
    <p className="small">{t('Hentet')} <time dateTime={session.ksData.incomeReadAt}>{dateTime(session.ksData.incomeReadAt)}</time>.</p>
  </section>;

  if (session.ksAccessDecision?.status === 'declined') return <section className="assistant-data-action is-declined" role="status">
    <div className="assistant-data-action-heading"><AssistantIcon name="document-text" aria-hidden="true" /><div><span className="assistant-next-step-kicker">{t('Ditt valg')}</span><h2>{t('Vi fortsetter uten KS')}</h2></div></div>
    <p>{t('Ingen personopplysninger blir hentet. Svar på spørsmålene under med det du vet.')}</p>
  </section>;

  return <section className="assistant-data-action" aria-labelledby="assistant-data-action-heading">
    <div className="assistant-data-action-heading"><AssistantIcon name="alert-warning" aria-hidden="true" /><div><span className="assistant-next-step-kicker">{t('Handling kreves')}</span><h2 id="assistant-data-action-heading">{t('Kan vi hente testopplysninger fra KS?')}</h2></div></div>
    <p>{t('Agenten trenger personopplysninger for å forberede SFO-vurderingen. Ingenting hentes før du velger.')}</p>
    <ul>
      <li>{t('Husstand og SFO-plass fra KS workshop-sandkassen')}</li>
      <li>{t('Inntektsgrunnlag og regelresultat med uttrykkelig samtykke')}</li>
      <li>{t('Testidentitet via ID-porten digdir-mock; ingen oppslag om deg')}</li>
    </ul>
    <PktCheckbox id="assistant-ks-access-consent" className="assistant-confirm-choice" disabled={busy} checked={approved} onChange={event => setApprovedVersion(event.target.checked ? version : null)} label={t('Jeg samtykker til å hente disse syntetiske personopplysningene fra KS-sandkassen for denne SFO-vurderingen.')} />
    <div className="assistant-data-action-actions">
      <AssistantButton skin="primary" disabled={!approved} onClick={() => {
        setApprovedVersion(null);
        void act({ action: 'ks-access', approved: true, caseId: session.id, revision: session.revision }, 'Henter KS-opplysninger med samtykke');
      }}>{t('Samtykk, hent og fortsett')}<AssistantIcon name="arrow-right" aria-hidden="true" /></AssistantButton>
      <AssistantButton skin="tertiary" disabled={busy} onClick={() => {
        setApprovedVersion(null);
        void act({ action: 'ks-access', approved: false, caseId: session.id, revision: session.revision }, 'Fortsetter uten KS');
      }}>{t('Fortsett uten KS')}</AssistantButton>
    </div>
    <p className="small">{t('Et ja starter neste agentsteg automatisk. Du kan fortsatt rette hentede opplysninger.')}</p>
  </section>;
}
