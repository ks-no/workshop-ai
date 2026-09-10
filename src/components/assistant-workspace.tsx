'use client';

import { AssistantButton, AssistantIcon } from './assistant-controls';
import { AssistantSfoAnswer } from './assistant-sfo-answer';
import { AssistantLocaleProvider, useAssistantLocale } from './assistant-i18n';
import { PktProgressbar, PktSelect, PktTextarea, PktTabs } from './punkt-react';
import { AssistantMarkdown } from './assistant-markdown';
import { AssistantQuestionForm } from './assistant-question-form';
import { AssistantKsAction } from './assistant-ks-connection';
import { AssistantEmailDraftPanel, AssistantFormDraftPanel, AssistantNextActions, AssistantOutcomes } from './assistant-actions';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { AssistantCase, AssistantCommand, AssistantMessage, AssistantResponse, EvidenceSource, FollowUp, StructuredAnswer } from '../domain/assistant-types';
import { AssistantCasePanel, type AssistantCaseView } from './assistant-case-panel';

async function readResponse(response: Response): Promise<AssistantResponse> {
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Vi fikk ikke fullført handlingen. Prøv igjen.');
  return body as AssistantResponse;
}

export function AssistantWorkspace() {
  return <AssistantLocaleProvider><Workspace /></AssistantLocaleProvider>;
}

function Workspace() {
  const { locale, setLocale, t } = useAssistantLocale();
  const [editingQuestions, setEditingQuestions] = useState<FollowUp[]>([]);
  const [snapshot, setSnapshot] = useState<AssistantResponse | null>(null);
  const current = useRef<AssistantResponse | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pollError, setPollError] = useState(false);
  const [caseChanged, setCaseChanged] = useState(false);
  const [message, setMessage] = useState('');
  const [messageError, setMessageError] = useState('');
  const [tab, setTab] = useState<'conversation' | 'case'>('conversation');
  const [caseView, setCaseView] = useState<AssistantCaseView>('overview');
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const conversationEnd = useRef<HTMLDivElement>(null);

  const accept = useCallback((next: AssistantResponse, epoch: number) => {
    if (epoch !== generation.current) return;
    const previous = current.current?.session;
    if (previous && next.session) {
      if (previous.id !== next.session.id) {
        setCaseChanged(true);
        setError('En annen demosak er aktiv i nettleseren. Last inn den aktive saken før du fortsetter.');
        return;
      }
      if (next.session.revision < previous.revision) return;
      if (next.session.revision === previous.revision && next.session.updatedAt < previous.updatedAt) return;
    }
    if (previous && !next.session && pending.current) return;
    current.current = next;
    setSnapshot(next);
  }, []);

  const refresh = useCallback(async () => {
    const epoch = generation.current;
    const next = await readResponse(await fetch('/api/assistant', { cache: 'no-store' }));
    accept(next, epoch);
    return next;
  }, [accept]);

  useEffect(() => {
    let active = true;
    void refresh().then(next => {
      if (active && next.session?.messages.length) setNotice('Vi har hentet samtalen og opplysningene du allerede har lagt inn.');
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Kunne ikke hente saken.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);

  const session = snapshot?.session ?? null;
  const model = snapshot?.model ?? null;
  const analyzing = session?.status === 'analyzing';
  const locked = loading || !!busy || analyzing || caseChanged;
  const modelAvailable = model?.available === true;
  const waitingFacts = session?.facts.filter(fact => fact.status === 'proposed' || fact.status === 'conflict').length ?? 0;
  const ksActionRequired = !!session && (session.pendingConsents ?? []).some(consent => consent.revision === session.revision);

  useEffect(() => {
    if (!busy && !analyzing) return;
    let active = true;
    let reading = false;
    const interval = setInterval(() => {
      if (reading) return;
      reading = true;
      void refresh().then(() => { if (active) setPollError(false); })
        .catch(() => { if (active) setPollError(true); }).finally(() => { reading = false; });
    }, 2000);
    return () => { active = false; clearInterval(interval); };
  }, [busy, analyzing, refresh]);

  const messageCount = session?.messages.length ?? 0;
  useEffect(() => {
    if (messageCount > 0) conversationEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [messageCount]);

  async function commandRequest(command: AssistantCommand, epoch: number) {
    const next = await readResponse(await fetch('/api/assistant', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command),
    }));
    accept(next, epoch);
    return next;
  }

  async function ensureSession(epoch: number) {
    if (current.current?.session) return current.current.session;
    const next = await commandRequest({ action: 'start' }, epoch);
    if (!next.session) throw new Error('Kunne ikke starte en ny sak. Prøv igjen.');
    return next.session;
  }

  async function perform(label: string, work: (epoch: number) => Promise<unknown>) {
    if (pending.current || current.current?.session?.status === 'analyzing') return false;
    pending.current = true;
    setBusy(label); setError(''); setNotice(''); setPollError(false);
    const epoch = generation.current;
    try { await work(epoch); return true; }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Vi fikk ikke fullført handlingen. Prøv igjen.');
      try { await refresh(); } catch { /* The action error remains visible if the connection is down. */ }
      return false;
    } finally { pending.current = false; setBusy(''); }
  }

  async function act(command: AssistantCommand, label: string) {
    return perform(label, epoch => commandRequest(command, epoch));
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    await sendText(message.trim());
  }

  async function sendText(text: string) {
    if (text.length < 1) { setMessageError('Skriv hva du trenger hjelp med.'); input.current?.focus(); return false; }
    if (text.length > 4000) { setMessageError('Meldingen kan ha høyst 4000 tegn.'); setError('Meldingen kan ha høyst 4000 tegn.'); return false; }
    if (locked || !modelAvailable) return false;
    const sent = await perform('Leser meldingen og undersøker relevante tjenester', async epoch => {
      const activeCase = await ensureSession(epoch);
      await commandRequest({ action: 'message', message: text, revision: activeCase.revision, caseId: activeCase.id }, epoch);
    });
    if (sent) { setMessage(''); setMessageError(''); setEditingQuestions([]); }
    return sent;
  }

  async function sendAnswers(text: string, answers: StructuredAnswer[]) {
    if (!answers.length) return sendText(text);
    if (locked || !modelAvailable) return false;
    const sent = await perform('Lagrer svarene dine og oppdaterer planen', async epoch => {
      const activeCase = await ensureSession(epoch);
      await commandRequest({ action: 'answers', message: text, answers, revision: activeCase.revision, caseId: activeCase.id }, epoch);
    });
    if (sent) { setEditingQuestions([]); setMessageError(''); }
    return sent;
  }

  function editQuestions(questions: FollowUp[]) {
    setEditingQuestions(questions); setTab('conversation');
    requestAnimationFrame(() => { document.getElementById('assistant-questions')?.scrollIntoView({ block: 'start' }); document.querySelector<HTMLElement>('#assistant-questions input, #assistant-questions select, #assistant-questions textarea')?.focus(); });
  }

  function openCaseSection(id: 'case-heading' | 'services-heading' | 'handoff-heading') {
    setCaseView(id === 'handoff-heading' ? 'review' : 'overview');
    setTab('case');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const target = document.getElementById(id);
      target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      target?.focus({ preventScroll: true });
    }));
  }

  function openActivity(runId: string) {
    setSelectedActivityId(runId);
    setCaseView('activity');
    setTab('case');
    requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById('activity-heading')?.focus({ preventScroll: false })));
  }

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file) { setError('Velg et TXT- eller PDF-dokument først.'); return; }
    if (!/\.(txt|pdf)$/i.test(file.name)) { setError('Velg en TXT-fil eller en tekstbasert PDF. Andre filtyper støttes ikke.'); return; }
    const saved = await perform('Leser dokumentet og oppdaterer saken', async epoch => {
      const activeCase = await ensureSession(epoch);
      const form = new FormData(); form.set('file', file); form.set('revision', String(activeCase.revision)); form.set('caseId', activeCase.id);
      accept(await readResponse(await fetch('/api/assistant/document', { method: 'POST', body: form })), epoch);
    });
    if (saved) { setFile(null); if (fileInput.current) fileInput.current.value = ''; setUploadOpen(false); setNotice('Dokumentet er lagt til som kilde. Kontroller foreslåtte opplysninger i oversikten.'); }
  }

  async function reset() {
    if (pending.current || analyzing) return;
    const activeCase = current.current?.session;
    if (!activeCase) return;
    pending.current = true; setBusy('Sletter saken'); setError('');
    try {
      const response = await fetch('/api/assistant', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseId: activeCase.id, revision: activeCase.revision }) });
      if (!response.ok) throw new Error('Kunne ikke slette saken. Prøv igjen.');
      generation.current += 1;
      const next = { session: null, model: current.current!.model };
      current.current = next; setSnapshot(next); setMessage(''); setFile(null); setConfirmReset(false);
      setUploadOpen(false); setEditingQuestions([]); setTab('conversation'); setCaseView('overview'); setSelectedActivityId(null); setNotice('Samtalen, opplysningene og dokumentene er slettet. Du kan starte på nytt.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Kunne ikke slette saken.'); try { await refresh(); } catch { /* Keep the deletion error visible. */ } }
    finally { pending.current = false; setBusy(''); }
  }

  return <div className="app-shell assistant-app" lang={locale}>
    <a className="skip-link" href="#main">{t("Hopp til innhold")}</a>
    <div className="demo-banner"><span>{t("Hackathondemo · Team Oslo")}</span> {t("Bruk bare testopplysninger. Ingen søknad sendes.")}</div>
    <header className="site-header"><div className="header-inner">
      <Link href="/" className="brand" aria-label={t("Søk én gang, forsiden")}><span className="brand-mark" aria-hidden="true">é</span><span>Søk én gang<span className="brand-tagline">{t("Fra skjema til samtale.")}</span></span></Link>
      <nav aria-label={t("Hovedmeny")}><Link href="/dokumentasjon">{t("Dokumentasjon")}</Link><Link href="/om-demoen">{t("Om løsningen")}</Link>{session && <AssistantButton skin="tertiary" className="assistant-reset" disabled={locked} onClick={() => setConfirmReset(true)}><AssistantIcon name="trash" aria-hidden="true"  /><span>{t("Avslutt og slett")}</span></AssistantButton>}</nav><div className="assistant-locale"><PktSelect id="assistant-ui-locale" label={locale === 'nb' ? 'Grensesnittspråk' : 'Interface language'} useWrapper={false} inputSize="small" value={locale} onChange={event => setLocale(event.target.value as 'nb' | 'en')}><option value="nb">NO – Norsk</option><option value="en">EN – English</option></PktSelect></div>
    </div></header>
    <main id="main" className="assistant-main">
      {confirmReset && <section className="assistant-reset-confirm" aria-label={t("Slett saken")}><div><h2>{t("Slette denne demosaken?")}</h2><p>{t("Samtalen, opplysningene og opplastede dokumenter fjernes. Dette kan ikke angres.")}</p></div><div className="assistant-reset-actions"><AssistantButton skin="secondary" disabled={locked} onClick={() => setConfirmReset(false)}>{t("Behold saken")}</AssistantButton><AssistantButton skin="primary" disabled={locked} onClick={() => void reset()}>{t("Slett saken")}</AssistantButton></div></section>}
      {notice && <p className="assistant-notice" role="status">{t(notice)}</p>}
      {error && <div className="assistant-error" role="alert"><AssistantIcon name="alert-warning" aria-hidden="true"  /><div><p>{t(error)}</p>{caseChanged && <AssistantButton skin="tertiary" onClick={() => window.location.reload()}>{t("Last inn aktiv sak")}</AssistantButton>}</div></div>}
      <div className="assistant-mobile-tabs" aria-label={t('Velg visning')}><PktTabs tabs={[{ text: t('Samtale'), active: tab === 'conversation', controls: 'conversation-panel' }, { text: t('Din oversikt'), active: tab === 'case', controls: 'case-panel', ...(waitingFacts > 0 ? { tag: { text: `${waitingFacts}`, skin: 'blue-light' as const } } : {}) }]} onTabSelected={index => setTab(index === 0 ? 'conversation' : 'case')} /></div>
      <div className="assistant-workspace">
        <section id="conversation-panel" className={`assistant-conversation ${tab === 'conversation' ? 'is-mobile-active' : ''}`} aria-labelledby="conversation-heading">
          <div className="assistant-conversation-scroll" role="region" aria-label={t('Samtale og neste steg')} tabIndex={0}>
          <div className="assistant-conversation-heading"><h1 id="conversation-heading">{t(session?.messages.length ? 'Vi finner veien videre.' : 'Hva kan vi hjelpe deg med?')}</h1><p>{t("Fortell med egne ord. Vi samler det som er relevant for deg, og spør om det som mangler.")}</p></div>
          {!session?.messages.length && <div className="assistant-starting-points"><strong>{t('Du trenger ikke velge tjeneste.')}</strong><p className="small">{t('Beskriv situasjonen din, så finner agenten relevante tjenester og neste steg. Du kan for eksempel skrive om jobb, familie, bolig eller flytting i samme melding.')}</p></div>}
          {!!session?.messages.length && <div className="assistant-messages" aria-label={t("Samtalen")}>{session.messages.map(item => <article key={item.id} className={`assistant-message is-${item.role}`} lang={item.role === 'assistant' ? item.language || 'nb' : undefined}><div className="assistant-message-label" lang={locale}><strong>{t(item.role === 'user' ? 'Du' : 'Innbyggerassistenten · KI-tolkning')}</strong><time dateTime={item.at}>{new Date(item.at).toLocaleTimeString(locale === 'en' ? 'en-GB' : 'nb-NO', { hour: '2-digit', minute: '2-digit' })}</time></div><>{item.role === 'assistant' ? <AssistantMarkdown text={item.text} language={item.language || 'nb'} tableLabel={locale === 'en' ? 'Table' : 'Tabell'} /> : <p>{item.text}</p>}</>{item.role === 'assistant' && <><AssistantMessageSources message={item} sources={session.sources} onOpen={() => { setCaseView('sources'); setTab('case'); }} /><p className="small" lang={locale}>{t("Kontroller tolkningen før du bruker den. Sjekklisten og kildene viser grunnlaget.")}</p></>}</article>)}</div>}
          {(busy || analyzing || !!session?.events.length) && <AssistantActivity session={session} pendingLabel={busy || (analyzing ? 'Arbeider med saken din' : '')} pollError={pollError} selectedTaskId={selectedActivityId} onTaskSelect={openActivity} />}
          {session?.error && session.error !== error && <div className="assistant-error" role="alert"><AssistantIcon name="alert-warning" aria-hidden="true"  /><p>{t(session.error)}</p></div>}
          {session?.intent === 'personalized' && <AssistantKsAction session={session} busy={locked} act={act} />}
          {session?.drafts?.email && !session.handoff && <AssistantEmailDraftPanel key={session.drafts.email.id} session={session} draft={session.drafts.email} busy={locked} act={act} />}
          {session?.drafts?.form && !session.handoff && <AssistantFormDraftPanel key={session.drafts.form.id} session={session} draft={session.drafts.form} busy={locked} act={act} onQuestions={editQuestions} />}
          {session && !session.handoff && !session.drafts?.email && !session.drafts?.form && <AssistantOutcomes session={session} latestOnly />}
          {session && !session.drafts?.email && !session.drafts?.form && <AssistantConversationNextStep session={session} busy={locked} modelAvailable={modelAvailable} hasActiveQuestions={editingQuestions.length > 0 || session.questions.length > 0} ksActionRequired={ksActionRequired} act={act} onOpen={openCaseSection} onQuestions={editQuestions} />}
          {!!session && !session.handoff && !ksActionRequired && (editingQuestions.length > 0 || session.questions.length > 0) && <AssistantQuestionForm key={`${session.id}:${editingQuestions.map(question => question.key).join(',')}`} questions={editingQuestions.length ? editingQuestions : session.questions} busy={locked || !modelAvailable} replyLanguage={session.language || 'nb'} onSend={sendAnswers} />}
          {session?.handoff && <div className="assistant-conversation-finished"><AssistantIcon name="check" aria-hidden="true"  /><h2>{t("Gjennomgangen er fullført.")}</h2><AssistantSfoAnswer session={session} /><AssistantOutcomes session={session} /><p>{t(session.outcomes?.length ? "Handlingene over er utført. Åpne Neste steg for å laste ned oppsummeringen og kvitteringene." : "Ingen søknad er sendt. Åpne Neste steg for å laste ned oppsummeringen og se hva du kan gjøre videre.")}</p><AssistantButton skin="secondary" onClick={() => openCaseSection('handoff-heading')}>{t("Se neste steg")}</AssistantButton></div>}
          {session && !session.handoff && !session.services.length && (session.messages.length > 0 || session.facts.length > 0 || !!session.ksData) && !analyzing && <AssistantButton skin="tertiary" disabled={locked || !modelAvailable} onClick={() => void act({ action: 'analyze', revision: session.revision, caseId: session.id }, 'Oppdaterer planen')}><AssistantIcon name="arrow-circle" aria-hidden="true"  />{t("Oppdater planen")}</AssistantButton>}
          <div ref={conversationEnd} className="assistant-conversation-end" aria-hidden="true" />
          </div>
          {!session?.handoff && <div className="assistant-composer-dock">
            <form className="assistant-composer" onSubmit={send} aria-busy={locked}>
              <PktTextarea id="assistant-message" ref={element => { input.current = element; }} label={t(session?.messages.length ? 'Skriv en melding' : 'Hva er situasjonen din?')} rows={2} inputSize="small" value={message} maxLength={4000} disabled={locked} fullwidth placeholder={t('For eksempel: Jeg har mistet jobben og er usikker på hvordan jeg skal betale husleien.')} onChange={event => { setMessage(event.target.value); setMessageError(''); }} ariaDescribedby={messageError ? 'assistant-message-input-error' : undefined} aria-errormessage={messageError ? 'assistant-message-input-error' : undefined} hasError={!!messageError} errorMessage={t(messageError)} />
              <div className="assistant-composer-actions"><AssistantButton type="button" size="small" skin="tertiary" disabled={locked} aria-expanded={uploadOpen} aria-controls="assistant-upload" onClick={() => setUploadOpen(open => !open)}><AssistantIcon name="attachment" aria-hidden="true"  />{t("Legg ved dokument")}</AssistantButton><AssistantButton type="submit" size="small" skin="primary" disabled={locked || !modelAvailable}>{t(locked ? 'Arbeider…' : 'Send melding')}<AssistantIcon name="arrow-right" aria-hidden="true"  /></AssistantButton></div>
              {!loading && !modelAvailable && <p className="assistant-inline-notice">{t("Du kan skrive et utkast. Sending og dokumentanalyse blir tilgjengelig når språkmodellen er tilkoblet.")}</p>}
            </form>
            {uploadOpen && <form id="assistant-upload" className="assistant-upload" onSubmit={upload}><label htmlFor="assistant-file">{t("Velg et dokument")}</label><p className="small" id="assistant-file-help">{t("TXT eller tekstbasert PDF, inntil 1,5 MB, ti sider og 14 000 tegn. Skannede bilder støttes ikke. Bruk testdokumenter.")}</p><input ref={fileInput} id="assistant-file" type="file" accept=".txt,.pdf,text/plain,application/pdf" disabled={locked} aria-describedby="assistant-file-help" onChange={event => setFile(event.target.files?.[0] ?? null)} /><AssistantButton type="submit" skin="secondary" disabled={locked || !file || !modelAvailable}>{t("Last opp og analyser")}</AssistantButton></form>}
          </div>}
        </section>
        <aside id="case-panel" className={`assistant-case ${tab === 'case' ? 'is-mobile-active' : ''}`} aria-label={t("Din felles saksoversikt")}><AssistantCasePanel key={session?.id ?? 'empty'} session={session} busy={locked} modelAvailable={modelAvailable} view={caseView} selectedActivityId={selectedActivityId} onViewChange={setCaseView} act={act} onQuestions={editQuestions} /></aside>
      </div>
    </main><footer className="site-footer"><span>Søk én gang <span className="footer-separator">/</span> KS Digital hackathon 2026</span><Link href="/om-demoen#personvern">{t('Personvern i demoen')}</Link></footer>
  </div>;
}

function AssistantMessageSources({ message, sources, onOpen }: { message: AssistantMessage; sources: EvidenceSource[]; onOpen: () => void }) {
  const { t } = useAssistantLocale();
  const usedSources = sources.filter(source => message.sourceIds?.includes(source.id));
  if (!usedSources.length) return null;
  return <details className="assistant-message-sources">
    <summary>{t('Kilder for dette svaret')} ({usedSources.length})</summary>
    <ul>{usedSources.map(source => <li key={source.id}>{source.url && /^https?:\/\//i.test(source.url) ? <a href={source.url} target="_blank" rel="noreferrer">{t(source.title)}</a> : t(source.title)}</li>)}</ul>
    <AssistantButton skin="tertiary" size="small" onClick={onOpen}>{t('Se alle kilder og utdrag')}</AssistantButton>
  </details>;
}

function AssistantConversationNextStep({ session, busy, modelAvailable, hasActiveQuestions, ksActionRequired, act, onOpen, onQuestions }: {
  session: AssistantCase;
  busy: boolean;
  modelAvailable: boolean;
  hasActiveQuestions: boolean;
  ksActionRequired: boolean;
  act: (command: AssistantCommand, label: string) => Promise<boolean>;
  onOpen: (id: 'case-heading' | 'services-heading' | 'handoff-heading') => void;
  onQuestions: (questions: FollowUp[]) => void;
}) {
  const { t } = useAssistantLocale();
  if (session.handoff || !session.services.length || ksActionRequired) return null;
  // A general question still ends in a route to a person; a personal case gets the full set of actions.
  if (session.intent === 'information') return session.analyzedRevision === session.revision ? <AssistantNextActions session={session} busy={busy} modelAvailable={modelAvailable} act={act} onQuestions={onQuestions} onOpen={onOpen} /> : null;
  if (hasActiveQuestions) return null;

  const facts = session.facts.filter(fact => !['rejected', 'superseded'].includes(fact.status));
  const unresolved = facts.filter(fact => ['proposed', 'conflict'].includes(fact.status));
  const stale = session.analyzedRevision !== session.revision;
  const completed = session.services.every(service => !['error', 'needs-information'].includes(service.status));
  const remaining = session.services.flatMap(service => service.checks.filter(check => check.status !== 'ready'));

  if (unresolved.length) return <section className="assistant-next-step" aria-labelledby="assistant-next-step-heading">
    <div><span className="assistant-next-step-kicker">{t('Neste steg')}</span><h2 id="assistant-next-step-heading">{t('Se over opplysningene planen bruker')}</h2><p>{t('Vi trenger kontrollen din før planen kan gjøres klar.')} <strong>{unresolved.length} {t('opplysninger')}</strong> {t('venter på deg.')}</p></div>
    <AssistantButton skin="primary" onClick={() => onOpen('case-heading')}>{t('Se over opplysningene')}<AssistantIcon name="arrow-right" aria-hidden="true" /></AssistantButton>
  </section>;

  if (stale || session.status === 'error') return <section className="assistant-next-step" aria-labelledby="assistant-next-step-heading">
    <div><span className="assistant-next-step-kicker">{t('Neste steg')}</span><h2 id="assistant-next-step-heading">{t('Oppdater planen med de siste opplysningene')}</h2><p>{t('Da får du neste handling her i samtalen.')}</p></div>
    <AssistantButton skin="primary" disabled={busy || !modelAvailable} onClick={() => void act({ action: 'analyze', revision: session.revision, caseId: session.id }, 'Oppdaterer planen')}>{t(session.status === 'error' ? 'Prøv planen på nytt' : 'Oppdater planen')}<AssistantIcon name="arrow-right" aria-hidden="true" /></AssistantButton>
  </section>;

  // Ready or still missing information: the end actions decide what the citizen can do now.
  void completed; void remaining;
  return <AssistantNextActions session={session} busy={busy} modelAvailable={modelAvailable} act={act} onQuestions={onQuestions} onOpen={onOpen} />;
}

function AssistantActivity({ session, pendingLabel, pollError, selectedTaskId, onTaskSelect }: { session: AssistantCase | null; pendingLabel: string; pollError: boolean; selectedTaskId: string | null; onTaskSelect: (runId: string) => void }) {
  const { locale, t, dateTime } = useAssistantLocale();
  const latestEvent = session?.events.at(-1);
  const displayedRuns = session?.runs.slice(-12).reverse() ?? [];
  const currentRun = session?.runs.findLast(run => run.status === 'running') ?? session?.runs.at(-1);
  const currentRuns = session?.runs.filter(run => run.revision === session.revision) ?? [];
  const specialistRuns = currentRuns.slice(1);
  const progressValue = specialistRuns.some(run => run.status === 'completed' || run.status === 'failed') ? 85
    : specialistRuns.some(run => run.status === 'running') ? 65
      : currentRuns[0]?.status === 'completed' ? 45
        : currentRuns.length ? 25 : 15;
  const currentLabel = pendingLabel || latestEvent?.detail || 'Agentarbeidet er fullført';
  const currentTitle = pendingLabel || (currentRun ? agentName(currentRun.agent) : currentLabel);
  const currentDetail = latestEvent?.detail && currentTitle !== latestEvent.detail ? latestEvent.detail : '';
  return <div className="assistant-activity">
    {!!displayedRuns.length && <div className="assistant-task-card" role={pendingLabel ? 'status' : undefined} aria-live={pendingLabel ? 'polite' : undefined}>
      <details className="assistant-task-disclosure">
        <summary><AssistantIcon name={currentRun?.status === 'completed' ? 'check' : 'document-text'} aria-hidden="true" /><span><span className="assistant-live-kicker">{t(pendingLabel ? 'Pågående oppgave' : 'Siste oppgave')}</span><strong>{t(currentTitle)}</strong>{currentDetail && <small>{t(currentDetail)}</small>}</span><span className={`assistant-task-status is-${currentRun?.status ?? 'completed'}`}>{t(currentRun?.status === 'running' ? 'Arbeider' : currentRun?.status === 'failed' ? 'Feilet' : 'Fullført')}</span></summary>
        <div className="assistant-task-list" aria-label={t('Agentoppgaver')}>{displayedRuns.map(run => {
          const runEvents = session?.events.filter(item => item.runId === run.id) ?? [];
          const lastDetail = runEvents.at(-1)?.detail;
          const time = new Date(run.startedAt).toLocaleTimeString(locale === 'en' ? 'en-GB' : 'nb-NO', { hour: '2-digit', minute: '2-digit' });
          return <button type="button" key={run.id} onClick={() => onTaskSelect(run.id)} aria-current={selectedTaskId === run.id ? 'true' : undefined} aria-label={`${t('Vis detaljer for')} ${t(agentName(run.agent))}, ${time}`}><AssistantIcon name={run.status === 'completed' ? 'check' : run.status === 'failed' ? 'alert-warning' : 'document-text'} aria-hidden="true" /><span><strong>{t(agentName(run.agent))}<time dateTime={run.startedAt}>{time}</time></strong><small>{lastDetail ? t(lastDetail) : dateTime(run.startedAt)}</small></span><span className={`assistant-task-status is-${run.status}`}>{t(run.status === 'running' ? 'Arbeider' : run.status === 'completed' ? 'Fullført' : 'Feilet')}</span></button>;
        })}</div>
      </details>
      {pendingLabel && <div className="assistant-progress-shell">
        <PktProgressbar className="assistant-progress-bar" valueCurrent={progressValue} valueMax={100} skin="dark-blue" statusType="none" ariaLabel={t('Agentarbeid pågår')} ariaValueText={t(pendingLabel)} />
        <span className="assistant-progress-segment" aria-hidden="true" />
      </div>}
    </div>}
    {pollError && <p className="small" role="status">{t("Fremdriften kunne ikke hentes akkurat nå. Handlingen kan fortsatt kjøre.")}</p>}
  </div>;
}

function agentName(name: string) {
  const names: Record<string, string> = { coordinator: 'Koordinator', family: 'Familie og SFO', housing: 'Bolig', moving: 'Flytting', human: 'Du', system: 'Systemet' };
  return names[name] ?? name;
}
