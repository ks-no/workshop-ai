'use client';

import { AssistantButton, AssistantIcon } from './assistant-controls';
import { factLabel, factValue, localizeCheck, serviceLabel, useAssistantLocale } from './assistant-i18n';
import { PktCheckbox, PktTabs, PktTag } from './punkt-react';
import { AssistantMarkdown } from './assistant-markdown';
import { AssistantPlanBoard } from './assistant-plan-board';
import { AssistantSfoAnswer } from './assistant-sfo-answer';
import { AssistantActionList, AssistantOutcomes } from './assistant-actions';
import { AssistantWalletCredential } from './assistant-wallet-credential';
import { AssistantInnsyn } from './assistant-innsyn';

import { useState } from 'react';
import type { AgentRun, AssistantCase, AssistantCommand, MemoryFact, ServiceResult, FollowUp, EvidenceSource } from '../domain/assistant-types';
import { ore } from '../domain/format';
import { AssistantEvidence, AssistantSource } from './assistant-evidence';

type CaseAction = (command: AssistantCommand, label: string) => Promise<boolean>;
export type AssistantCaseView = 'overview' | 'board' | 'review' | 'activity' | 'sources' | 'innsyn';
const factStatuses: Record<MemoryFact['status'], string> = { proposed: 'Til bekreftelse', confirmed: 'Bekreftet av deg', rejected: 'Avvist av deg', superseded: 'Erstattet', conflict: 'Motstridende opplysning' };
const serviceStatuses: Record<ServiceResult['status'], string> = { ready: 'Forberedt', 'needs-information': 'Trenger opplysninger', 'needs-review': 'Kontroller før du går videre', error: 'Kunne ikke fullføres' };

export function AssistantCasePanel({ session, busy, modelAvailable, view, selectedActivityId, onViewChange, act, onQuestions }: {
  session: AssistantCase | null; busy: boolean; modelAvailable: boolean; act: CaseAction;
  view: AssistantCaseView; selectedActivityId: string | null; onViewChange: (view: AssistantCaseView) => void;
  onQuestions: (questions: FollowUp[]) => void;
}) {
  const { locale, t, dateTime } = useAssistantLocale();
  const [confirmedVersion, setConfirmedVersion] = useState<string | null>(null);
  const consentVersion = session ? `${session.id}:${session.revision}` : null;
  const facts = session?.facts.filter(fact => !['rejected', 'superseded'].includes(fact.status)) ?? [];
  const historicFacts = session?.facts.filter(fact => ['rejected', 'superseded'].includes(fact.status)) ?? [];
  const unresolved = facts.filter(fact => ['proposed', 'conflict'].includes(fact.status));
  const personalized = session?.intent !== 'information';
  const stale = !!session && session.analyzedRevision !== session.revision;
  const completed = !!session?.services.length && session.services.every(service => !['error', 'needs-information'].includes(service.status));
  const canHandoff = !!session && !busy && !stale && !unresolved.length && completed && !session.handoff;
  const remaining = session?.services.flatMap(service => service.checks.filter(check => check.status !== 'ready').map(check => ({ ...localizeCheck(check, locale), service: serviceLabel(service.id, locale) }))) ?? [];
  const views: { id: AssistantCaseView; text: string; controls: string; tag?: { text: string; skin: 'blue-light' } }[] = [
    { id: 'overview', text: t('Oversikt'), controls: 'assistant-overview' },
    { id: 'board', text: t('Tavle'), controls: 'assistant-board' },
    { id: 'review', text: t('Neste steg'), controls: 'assistant-review' },
    ...(session?.runs.length ? [{ id: 'activity' as const, text: t('Aktivitet'), controls: 'assistant-activity-panel' }] : []),
    { id: 'sources', text: t('Kilder'), controls: 'assistant-sources', tag: session?.sources.length ? { text: String(session.sources.length), skin: 'blue-light' } : undefined },
    ...(session ? [{ id: 'innsyn' as const, text: t('Forvaltningsinnsyn'), controls: 'assistant-innsyn' }] : []),
  ];
  const selectedRun = session?.runs.find(run => run.id === selectedActivityId) ?? session?.runs.at(-1) ?? null;
  const selectedEvents = selectedRun ? session?.events.filter(item => item.runId === selectedRun.id) ?? [] : [];

  function factAction(fact: MemoryFact, decision: 'confirm' | 'reject') {
    if (!session) return;
    setConfirmedVersion(null);
    const continues = unresolved.length === 1;
    void act({ action: 'fact', factId: fact.id, decision, revision: session.revision, caseId: session.id }, continues ? 'Oppdaterer planen automatisk' : decision === 'confirm' ? 'Lagrer bekreftelsen' : 'Avviser opplysningen');
  }

  return <div className="assistant-case-content">
    <div className="assistant-plan-tabs" aria-label={t('Planvisning')}><PktTabs tabs={views.map(item => ({ text: item.text, active: view === item.id, controls: item.controls, tag: item.tag }))} onTabSelected={index => onViewChange(views[index]?.id ?? 'overview')} /></div>
    {<div id="assistant-board" role="tabpanel" aria-label={t('Tavle')} hidden={view !== 'board'}><AssistantPlanBoard session={session} busy={busy} onQuestions={onQuestions} /></div>}
    <div id="assistant-overview" role="tabpanel" aria-label={t('Oversikt')} hidden={view !== 'overview'}>
    {session && personalized && <AssistantSfoAnswer session={session} />}
    <section className="assistant-case-section" aria-labelledby="case-heading">
      <div className="assistant-section-heading"><h2 id="case-heading" tabIndex={-1}>{t("Din felles oversikt")}</h2>{session && <span className="small">{t("Lagres i denne demoen")}</span>}</div>
      <p className="assistant-section-intro">{t("Opplysningene brukes på tvers av tjenestene. Du bestemmer hva som stemmer.")}</p>
      {session?.summary && <div className="assistant-case-summary"><p className="small">{t("KI-tolkning av situasjonen. Kontroller at den stemmer.")}</p><AssistantMarkdown text={session.summary} language={session.language || 'nb'} /></div>}
      {!facts.length && <div className="assistant-empty"><AssistantIcon name="document-text" aria-hidden="true"  /><p>{t("Når du forteller om situasjonen din, samler vi opplysninger her. Ingenting er bekreftet før du sier ja.")}</p></div>}
      {!!unresolved.length && <p className="assistant-inline-notice">{t("Se over")} {unresolved.length} {t('opplysninger')}. {t("Planen oppdateres automatisk når den siste er avklart.")}</p>}
      <div className="assistant-facts">{facts.map(fact => <article className={`assistant-fact ${fact.status === 'conflict' ? 'is-conflict' : ''}`} key={fact.id}>
        <div className="assistant-fact-main"><div className="assistant-fact-copy"><h3>{factLabel(fact.key, fact.label, locale)}</h3><p className="assistant-fact-value">{factValue(fact.value, locale)}</p></div><PktTag size="small" skin={fact.status === 'confirmed' ? 'green' : fact.status === 'conflict' ? 'yellow' : 'blue-light'}>{fact.status === 'confirmed' && <AssistantIcon name="check" aria-hidden="true"  />}{t(fact.status === 'confirmed' && session?.sources.some(source => source.id === fact.citation.sourceId && source.kind === 'register') ? 'Hentet fra KS' : factStatuses[fact.status])}</PktTag></div>
        {fact.status === 'conflict' && <p className="assistant-conflict-copy"><AssistantIcon name="alert-warning" aria-hidden="true"  />{t("Det finnes ulike verdier for denne opplysningen. Bekreft den korrigerte verdien. Når alle forslag er avklart, oppdateres planen automatisk.")}</p>}
        <div className="assistant-fact-footer"><AssistantEvidence citation={fact.citation} sources={session?.sources ?? []} />
        {!session?.handoff && <div className="assistant-fact-actions">
          {fact.status !== 'confirmed' && <AssistantButton skin="secondary" size="small" disabled={busy} onClick={() => factAction(fact, 'confirm')}>{t(unresolved.length === 1 ? fact.status === 'conflict' ? 'Bekreft korrigering og oppdater planen' : 'Bekreft og oppdater planen' : fact.status === 'conflict' ? 'Bekreft korrigering' : 'Bekreft')} <span className="sr-only">{factLabel(fact.key, fact.label, locale)}: {factValue(fact.value, locale)}</span></AssistantButton>}
          {fact.status !== 'confirmed' && <AssistantButton skin="tertiary" size="small" disabled={busy} onClick={() => factAction(fact, 'reject')}>{t("Avvis")}<span className="sr-only"> {factLabel(fact.key, fact.label, locale)}: {factValue(fact.value, locale)}</span></AssistantButton>}
          <AssistantButton skin="tertiary" size="small" disabled={busy} onClick={() => onQuestions([{ key: fact.key, question: factLabel(fact.key, fact.label, locale), serviceIds: [] }])}>{t("Rett opplysningen")}<span className="sr-only"> {factLabel(fact.key, fact.label, locale)}</span></AssistantButton>
        </div>}
        </div>
      </article>)}</div>
      {!!historicFacts.length && <details className="assistant-history-facts"><summary>{t("Avviste og erstattede opplysninger (")}{historicFacts.length})</summary>{historicFacts.map(fact => <div className="assistant-historic-fact" key={fact.id}><strong>{factLabel(fact.key, fact.label, locale)}: {factValue(fact.value, locale)}</strong><p className="small">{t(factStatuses[fact.status])}</p><AssistantEvidence citation={fact.citation} sources={session?.sources ?? []} /></div>)}</details>}
    </section>

    {!!session?.services.length && <section className="assistant-case-section" aria-labelledby="services-heading">
      <div className="assistant-section-heading"><h2 id="services-heading" tabIndex={-1}>{t(personalized ? "Planen din" : "Svar og kilder")}</h2>{stale && <span className="assistant-state">{t("Trenger oppdatering")}</span>}</div>
      {stale && <p className="assistant-inline-notice">{t("Opplysningene er endret. Oppdater planen for å bruke siste versjon.")}</p>}
      {session.services.map(service => <article className="assistant-service" key={service.id}>
        <div className="assistant-service-heading"><h3>{serviceLabel(service.id, locale)}</h3><PktTag size="small" skin={service.status === 'error' ? 'red' : 'blue-light'}>{t(serviceStatuses[service.status])}</PktTag></div>
        <p className="small">{t("KI-tolkning. Kontroller mot kildene og sjekklisten.")}</p><AssistantMarkdown text={service.summary} language={session.language || 'nb'} /><div className="small assistant-service-reason">{t("Hvorfor denne tjenesten (KI-tolkning):")} <AssistantMarkdown text={service.reason} language={session.language || 'nb'} /></div>
        <AnswerSources service={service} sources={session.sources} onOpenSources={() => onViewChange('sources')} />
        {service.error && <p className="assistant-error" role="alert">{t(service.error)}</p>}
        <ul className="assistant-checks">{service.checks.map(original => { const check = localizeCheck(original, locale); return <li key={check.id}><span className={`assistant-check-status ${check.status === 'ready' ? 'is-ready' : ''}`}>{check.status === 'ready' ? <AssistantIcon name="check" aria-label={t("Klart")}  /> : t(check.status === 'human' ? 'Vurdering' : 'Mangler')}</span><div><strong>{check.label}</strong><p className="small">{check.detail}</p></div></li>; })}</ul>
        {service.assessment && <div className="assistant-assessment"><strong>{t(service.assessment.title)}</strong><p>{t(service.assessment.explanation)}</p>{service.assessment.calculation && <dl><div><dt>{t("Beregnet SFO-betaling")}</dt><dd>{ore(service.assessment.calculation.monthlyAfterOre)} {t("per måned")}</dd></div><div><dt>{t("Mat kommer i tillegg")}</dt><dd>{ore(service.assessment.calculation.monthlyFoodOre)} {t("per måned")}</dd></div></dl>}<p className="small">{t("Fast beregning i demoen ·")} {service.assessment.ruleVersion}</p></div>}
        {!!service.findings.length && <details className="assistant-findings"><summary>{t("Begrunnelse og kilder")}</summary><p className="small">{t("KI-tolkninger må kontrolleres. Et ordrett sitat viser hvor teksten finnes, men beviser ikke at tolkningen er riktig.")}</p>{service.findings.map((finding, i) => <div key={`${finding.citation.sourceId}-${i}`}><>{finding.text === finding.citation.quote ? <p>{finding.text}</p> : <AssistantMarkdown text={finding.text} language={session.language || 'nb'} />}</><AssistantEvidence citation={finding.citation} sources={session.sources} /></div>)}</details>}
      </article>)}
      {!session.handoff && (stale || session.status === 'error') && <AssistantButton skin="secondary" className="assistant-update" disabled={busy || !modelAvailable} onClick={() => { setConfirmedVersion(null); void act({ action: 'analyze', revision: session.revision, caseId: session.id }, 'Oppdaterer planen'); }}><AssistantIcon name="arrow-circle" aria-hidden="true"  />{t(session.status === 'error' ? "Prøv planen på nytt" : "Oppdater planen")}</AssistantButton>}
    </section>}

    {!!session?.unsupported.length && <section className="assistant-case-section"><h2>{t("Dette må du få hjelp med")}</h2><ul className="assistant-plain-list">{session.unsupported.map((item, i) => <li key={i} lang={session.language || 'nb'}>{item}</li>)}</ul><p className="small">{t("Demoen kan forberede familie/SFO, bolig og flytting. Andre tjenester er ikke koblet til.")}</p></section>}

    </div>

    <div id="assistant-review" role="tabpanel" aria-label={t('Neste steg')} hidden={view !== 'review'}>
    {!!session?.services.length && <AssistantActionList session={session} busy={busy} modelAvailable={modelAvailable} act={act} onQuestions={onQuestions} />}
    {!!session?.outcomes?.length && <section className="assistant-case-section"><AssistantOutcomes session={session} /></section>}
    {!!session?.services.length && personalized && <section className="assistant-case-section assistant-handoff" aria-labelledby="handoff-heading">
      <h2 id="handoff-heading" tabIndex={-1}>{t(session.handoff ? 'Gjennomgangen er fullført' : 'Kontroller og fullfør')}</h2>
      {session.handoff ? <><div className="assistant-completion-status"><AssistantIcon name="check" aria-hidden="true" /><div><strong>{t(session.outcomes?.length ? 'Handlingene dine er registrert' : 'Ingen søknad er sendt')}</strong><p>{t(session.outcomes?.length ? 'Du har fullført gjennomgangen. Kvitteringene og en lokal oppsummering er klare til nedlasting.' : 'Du har fullført gjennomgangen. En lokal oppsummering er klar til nedlasting.')}</p></div></div><h3>{t('Dette kan du gjøre nå')}</h3><ol className="assistant-next-actions"><li>{t('Last ned oppsummeringen og behold den til eget bruk.')}</li><li>{t('Fortsett hos kommunen eller den relevante offentlige tjenesten. Punkter merket for kontroll må fortsatt vurderes av en person.')}</li><li>{t('Når du er ferdig med demoen, velg Avslutt og slett.')}</li></ol><p className="small">{t("Gjennomført")} {dateTime(session.handoff.createdAt)}</p><a className="pkt-btn pkt-btn--secondary pkt-btn--medium" href={`/api/assistant/receipt?caseId=${encodeURIComponent(session.id)}&revision=${session.revision}`} download><AssistantIcon name="download" aria-hidden="true"  />{t("Last ned oppsummeringen (JSON)")}</a>{session.handoff.credential && <AssistantWalletCredential credential={session.handoff.credential} />}</> : <>
        <p>{t("Denne demoen kan ikke sende en søknad. Kontroller punktene nedenfor, bekreft at du har lest dem, og fullfør gjennomgangen.")}</p>
        <ol className="assistant-review-steps"><li>{t('Les hva du eller en saksbehandler fortsatt må kontrollere.')}</li><li>{t('Kontroller at opplysningene og kildene stemmer.')}</li><li>{t('Kryss av og velg Fullfør gjennomgangen.')}</li></ol>
        {!!remaining.length && <details className="assistant-remaining" open><summary>{t("Dette må fortsatt følges opp (")}{remaining.length})</summary><ul>{remaining.map((item, i) => <li key={`${item.service}-${item.id}-${i}`}><strong>{item.service}: {item.label}</strong><p>{item.detail}</p></li>)}</ul></details>}
        {!canHandoff && <p className="small">{t(unresolved.length ? 'Bekreft eller avvis opplysningene først.' : stale ? 'Oppdater planen med de siste opplysningene først.' : !completed ? 'Alle tjenestevurderinger må fullføres først.' : 'Vent til arbeidet er fullført.')}</p>}
        <PktCheckbox id="assistant-handoff-consent" className="assistant-confirm-choice" checked={confirmedVersion === consentVersion && canHandoff} disabled={!canHandoff} onChange={event => setConfirmedVersion(event.target.checked ? consentVersion : null)} label={t('Jeg har kontrollert opplysningene og forstår hva som fortsatt må følges opp.')} />
        <AssistantButton skin="primary" disabled={!canHandoff || confirmedVersion !== consentVersion} onClick={() => { void act({ action: 'handoff', confirmed: true, revision: session.revision, caseId: session.id }, 'Fullfører gjennomgangen'); }}>{t("Fullfør gjennomgangen")}</AssistantButton>
        <p className="small">{t("Dette lager bare en lokal oppsummering. Ingenting sendes.")}</p>
      </>}
    </section>}

    {session && <p className="assistant-expiry small">{t("Saken lagres til")} {dateTime(session.expiresAt)}{t(". Du kan avslutte og slette den når som helst.")}</p>}
    </div>

    <div id="assistant-activity-panel" role="tabpanel" aria-label={t('Aktivitet')} hidden={view !== 'activity'}>
      <section className="assistant-case-section assistant-activity-panel" aria-labelledby="activity-heading">
        <div className="assistant-section-heading"><h2 id="activity-heading" tabIndex={-1}>{t('Oppgavedetaljer')}</h2>{selectedRun && <PktTag size="small" skin={selectedRun.status === 'failed' ? 'red' : selectedRun.status === 'running' ? 'blue-light' : 'green'}>{t(selectedRun.status === 'running' ? 'Arbeider' : selectedRun.status === 'completed' ? 'Fullført' : 'Feilet')}</PktTag>}</div>
        {!selectedRun ? <div className="assistant-empty"><AssistantIcon name="document-text" aria-hidden="true" /><p>{t('Ingen agentoppgaver er registrert ennå.')}</p></div> : <>
          <p className="assistant-activity-agent">{t(activityAgentName(selectedRun))}</p>
          <dl className="assistant-activity-meta">
            <div><dt>{t('Startet')}</dt><dd>{dateTime(selectedRun.startedAt)}</dd></div>
            <div><dt>{t('Varighet')}</dt><dd>{selectedRun.durationMs === null ? t('Pågår') : `${Math.round(selectedRun.durationMs / 1000)} ${t('sekunder')}`}</dd></div>
          </dl>
          <h3>{t('Aktiviteter i denne oppgaven')}</h3>
          {!selectedEvents.length ? <p className="small">{t('Ingen detaljer er registrert for denne oppgaven.')}</p> : <ol className="assistant-task-timeline">{selectedEvents.map(item => <li key={item.id}><span className={`assistant-task-dot is-${item.type}`} aria-hidden="true" /><div><strong>{t(activityEventName(item.type))}</strong><p>{t(item.detail)}</p><time className="small" dateTime={item.at}>{dateTime(item.at)}</time></div></li>)}</ol>}
        </>}
      </section>
      {!!session?.critique.length && <section className="assistant-case-section assistant-critique-panel" aria-labelledby="critique-heading">
        <div className="assistant-section-heading"><h2 id="critique-heading" tabIndex={-1}>{t('Kritikerens gjennomgang')}</h2></div>
        <p className="assistant-section-intro">{t('Dette er modellens egen kontroll av utkastet. Det erstatter ikke en saksbehandlers vurdering.')}</p>
        {session.critique.map(round => <article className="assistant-critique-round" key={round.round}>
          <div className="assistant-critique-round-heading"><h3>{t('Runde')} {round.round}</h3><PktTag size="small" skin={round.verdict === 'PASS' ? 'green' : 'yellow'}>{t(round.verdict === 'PASS' ? 'Godkjent' : 'Må revideres')}</PktTag></div>
          {!!round.gaps.length && <ul className="assistant-critique-gaps">{round.gaps.map((gap, i) => <li key={i}>
            <blockquote className="assistant-critique-quote" lang={session.language || 'nb'}><AssistantMarkdown text={gap.quote} language={session.language || 'nb'} /></blockquote>
            <AssistantMarkdown text={gap.point} language={session.language || 'nb'} />
          </li>)}</ul>}
          {!!round.notes && <AssistantMarkdown text={round.notes} language={session.language || 'nb'} />}
        </article>)}
      </section>}
    </div>

    <div id="assistant-sources" role="tabpanel" aria-label={t('Kilder')} hidden={view !== 'sources'}>
      <section className="assistant-case-section assistant-sources-panel" aria-labelledby="sources-heading">
        <div className="assistant-section-heading"><h2 id="sources-heading" tabIndex={-1}>{t('Kilder og referanser')}</h2>{!!session?.sources.length && <span className="small">{session.sources.length}</span>}</div>
        <p className="assistant-section-intro">{t('Her finner du kildene agentene faktisk brukte. Åpne en kilde for å se type, tidspunkt, lagret tekst og lenke til originalen når den finnes.')}</p>
        {!session?.sources.length ? <div className="assistant-empty"><AssistantIcon name="document-text" aria-hidden="true" /><p>{t('Ingen kilder er brukt ennå. Kilder vises her når agentene har analysert spørsmålet ditt.')}</p></div> : <div className="assistant-source-list">{session.sources.map(source => <AssistantSource key={source.id} source={source} />)}</div>}
      </section>
    </div>

    <div id="assistant-innsyn" role="tabpanel" aria-label={t('Forvaltningsinnsyn')} hidden={view !== 'innsyn'}>
      <AssistantInnsyn session={session} active={view === 'innsyn'} />
    </div>
  </div>;
}

function activityAgentName(run: Pick<AgentRun, 'agent' | 'stage'>) {
  if (run.stage === 'triage') return 'Triage';
  if (run.stage === 'critic') return 'Kritiker';
  if (run.stage === 'polish') return 'Språkvask';
  const names: Record<string, string> = { coordinator: 'Koordinator', family: 'Familie og SFO', housing: 'Bolig', moving: 'Flytting', human: 'Du', system: 'Systemet' };
  return names[run.agent] ?? run.agent;
}

function activityEventName(type: string) {
  const names: Record<string, string> = { started: 'Startet', 'source-read': 'Leste kilde', completed: 'Fullført', failed: 'Feilet', human: 'Bekreftelse', blocked: 'Stoppet for avklaring', 'tool-requested': 'Ba om verktøy' };
  return names[type] ?? type;
}

function AnswerSources({ service, sources, onOpenSources }: { service: ServiceResult; sources: EvidenceSource[]; onOpenSources: () => void }) {
  const { t } = useAssistantLocale();
  const usedSources = sources.filter(source => service.sourceIds.includes(source.id));
  if (!usedSources.length) return null;
  return <aside className="assistant-answer-sources" aria-label={t('Kilder for dette svaret')}>
    <strong>{t('Kilder for dette svaret')}</strong>
    <ul>{usedSources.map(source => <li key={source.id}>{source.url && /^https?:\/\//i.test(source.url) ? <a href={source.url} target="_blank" rel="noreferrer">{t(source.title)} <AssistantIcon name="arrow-up-right" aria-hidden="true" /></a> : <span>{t(source.title)}</span>}</li>)}</ul>
    <AssistantButton skin="tertiary" size="small" onClick={onOpenSources}>{t('Se alle kilder og utdrag')}</AssistantButton>
  </aside>;
}
