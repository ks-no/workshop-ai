'use client';

import { useState } from 'react';
import { PktCheckbox } from './punkt-react';
import type { AssistantCase, AssistantCommand } from '../domain/assistant-types';
import { AssistantButton, AssistantIcon } from './assistant-controls';
import { useAssistantLocale } from './assistant-i18n';

/** Renders the consents the server left pending after the last analysis. The card decides nothing itself. */
export function AssistantKsAction({ session, busy, act }: {
  session: AssistantCase;
  busy: boolean;
  act: (command: AssistantCommand, label: string) => Promise<boolean>;
}) {
  const { t, dateTime } = useAssistantLocale();
  const [approvedVersion, setApprovedVersion] = useState<string | null>(null);
  const version = `${session.id}:${session.revision}`;
  const approved = !busy && approvedVersion === version;
  const pending = (session.pendingConsents ?? []).filter(consent => consent.revision === session.revision);
  const family = session.services.some(service => service.id === 'family');

  if (session.handoff) return null;

  if (!pending.length && family && session.ksData?.incomeReadAt) return <section className="assistant-data-action is-complete" role="status">
    <div className="assistant-data-action-heading"><AssistantIcon name="check" aria-hidden="true" /><div><span className="assistant-next-step-kicker">{t('Fullført')}</span><h2>{t('Opplysningene er hentet')}</h2></div></div>
    <p>{t('Agentene fortsatte automatisk med de nye kildene og fylte ut søknadsutkastet. Du kan kontrollere og rette opplysningene i oversikten.')}</p>
    <p className="small">{t('Hentet')} <time dateTime={session.ksData.incomeReadAt}>{dateTime(session.ksData.incomeReadAt)}</time>.</p>
  </section>;

  if (!pending.length && family && session.ksAccessDecision?.status === 'declined') return <section className="assistant-data-action is-declined" role="status">
    <div className="assistant-data-action-heading"><AssistantIcon name="document-text" aria-hidden="true" /><div><span className="assistant-next-step-kicker">{t('Ditt valg')}</span><h2>{t('Vi fortsetter uten å hente opplysninger')}</h2></div></div>
    <p>{t('Ingen personopplysninger blir hentet. Svar på spørsmålene under med det du vet.')}</p>
  </section>;

  if (!pending.length) return null;

  return <section className="assistant-data-action" aria-labelledby="assistant-data-action-heading">
    <div className="assistant-data-action-heading"><AssistantIcon name="alert-warning" aria-hidden="true" /><div><span className="assistant-next-step-kicker">{t('Handling kreves')}</span><h2 id="assistant-data-action-heading">{t('Kan jeg hente opplysninger for deg?')}</h2></div></div>
    <p>{t('Assistenten har bedt om tilgang til disse kildene for å forberede saken. Ingenting hentes før du velger.')}</p>
    <ul>
      {pending.map(consent => <li key={consent.toolId}><strong>{t(consent.title)}</strong> · {t(consent.integration)}<br /><span className="small">{t(consent.purpose)}{consent.requestedBy === 'model' ? ` ${t('Foreslått av koordinatoren.')}` : ''}</span></li>)}
      <li className="small">{t('Testidentitet via ID-porten digdir-mock; ingen oppslag om deg')}</li>
    </ul>
    <PktCheckbox id="assistant-ks-access-consent" className="assistant-confirm-choice" disabled={busy} checked={approved} onChange={event => setApprovedVersion(event.target.checked ? version : null)} label={t('Jeg samtykker til at disse syntetiske opplysningene hentes for denne vurderingen.')} />
    <div className="assistant-data-action-actions">
      <AssistantButton skin="primary" disabled={!approved} onClick={() => {
        setApprovedVersion(null);
        void act({ action: 'tool-consent', toolIds: pending.map(consent => consent.toolId), approved: true, caseId: session.id, revision: session.revision }, 'Henter opplysninger med samtykke');
      }}>{t('Samtykk, hent og fortsett')}<AssistantIcon name="arrow-right" aria-hidden="true" /></AssistantButton>
      <AssistantButton skin="tertiary" disabled={busy} onClick={() => {
        setApprovedVersion(null);
        void act({ action: 'tool-consent', toolIds: pending.map(consent => consent.toolId), approved: false, caseId: session.id, revision: session.revision }, 'Fortsetter uten å hente');
      }}>{t('Fortsett uten å hente')}</AssistantButton>
    </div>
    <p className="small">{t('Et ja starter neste agentsteg automatisk. Du kan fortsatt rette hentede opplysninger.')}</p>
  </section>;
}
