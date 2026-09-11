'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode, type Ref } from 'react';
import { ArrowLeft, ArrowRight, CaretRight, EnvelopeSimple, Phone, Sparkle } from '@phosphor-icons/react';
import {
  Alert, Button, Card, CardBlock, Checkbox, ChipButton, ChipRemovable, Details, DetailsContent, DetailsSummary, Divider, ErrorSummary,
  EXPERIMENTAL_FileUpload, Field, FieldDescription, Fieldset, FieldsetLegend, Heading, Label, Link as DsLink, ListItem, ListUnordered, Paragraph, Radio, Select, SelectOption, Spinner, Tag, Textfield, ValidationMessage,
} from '@digdir/designsystemet-react';
import { componentForStep, type FlowComponentId } from '../domain/flow-components';
import { FamilyOverview } from './family-overview';
import { FlowActivityPanel } from './flow-activity-panel';
import { dateTime } from '../domain/format';
import { ACTION_LABELS, FLOW_SOURCES } from '../domain/flow-catalogue';
import type { FlowCase, FlowCommand, FlowExecution, FlowFact, FlowFetchable, FlowOutcome, FlowProposal, FlowQuestion, FlowResponse, FlowStep } from '../domain/flow-types';
import type { ContactPoint, ModelStatus } from '../domain/assistant-types';
import styles from './sok-wizard.module.css';

/**
 * "Søk én gang": a step-driven guide built with Designsystemet. After every input the planner
 * (an AI model through the Python runtime, or fixed rules when it is unavailable) proposes one
 * next step: ask for more, show what the case holds for correction and approval, propose an
 * end action, or conclude. Every value shows its source; the citizen edits and approves
 * before anything is used or executed.
 */
type Task = { title: string; detail: string };
type Busy = { heading: string; hint: string; tasks: Task[] };
type Phase = 'start' | 'thinking' | 'ask' | 'review' | 'action' | 'acted' | 'done' | 'summary' | 'error';
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type CaseCommand = DistributiveOmit<Extract<FlowCommand, { caseId: string }>, 'caseId' | 'revision'>;
const SUGGESTIONS = [
  'Jeg har mistet jobben og har barn på SFO',
  'Jeg skal flytte til en ny kommune',
  'Jeg trenger hjelp til å søke bostøtte',
  'Jeg vil vite hvilke rettigheter barnet mitt har',
];
const ACCEPTED_FILES = '.txt,.pdf,text/plain,application/pdf';
const CITIZEN_SOURCE = 'Oppgitt av deg';

async function readResponse(response: Response): Promise<FlowResponse> {
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Vi fikk ikke fullført handlingen. Prøv igjen.');
  return body as FlowResponse;
}
function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}
function modelLabel(model: ModelStatus | null) {
  if (!model) return 'Språkmodell';
  if (!model.available) return 'Regelbasert forslag – språkmodellen er ikke tilgjengelig';
  return `modellen ${model.model} via AI Factory`;
}
function activeFacts(session: FlowCase, step?: FlowStep | null) {
  return session.facts.filter(fact => (fact.status === 'proposed' || fact.status === 'confirmed') && (!step || !step.factIds.length || step.factIds.includes(fact.id)));
}
function factSource(session: FlowCase, fact: FlowFact) {
  if (fact.status === 'proposed') return fact.quote ? `KI-forslag fra det du skrev: «${fact.quote}». Sjekk før du godkjenner.` : 'KI-forslag. Sjekk før du godkjenner.';
  const source = session.sources.find(item => item.id === fact.sourceId);
  if (fact.origin === 'ks') return `Hentet fra ${source?.title ?? 'kommunens registre'}${source ? `, ${dateTime(source.at)}` : ''}.`;
  if (fact.origin === 'document') return `Fra dokumentet «${source?.title ?? 'dokumentet'}».`;
  return '';
}

export function SokWizard() {
  const [snapshot, setSnapshot] = useState<FlowResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [summaryView, setSummaryView] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [showDraft, setShowDraft] = useState(true);
  const [situation, setSituation] = useState('');
  const [uploads, setUploads] = useState<File[]>([]);
  const latest = useRef<FlowCase | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const situationRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  const accept = useCallback((next: FlowResponse) => { latest.current = next.session; setSnapshot(next); }, []);
  const refresh = useCallback(async () => {
    const next = await readResponse(await fetch('/api/flow', { cache: 'no-store' }));
    accept(next);
    return next;
  }, [accept]);
  useEffect(() => {
    let active = true;
    fetch('/api/flow', { cache: 'no-store' }).then(readResponse).then(next => {
      if (!active) return;
      accept(next);
      if (next.session?.situation) setNotice('Vi har hentet saken du holdt på med. Du kan fortsette der du slapp, eller starte på nytt.');
    }).catch(() => { /* The start screen works without a stored case. */ })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accept]);

  const session = snapshot?.session ?? null;
  const model = snapshot?.model ?? null;
  const step = session?.step ?? null;
  const phase: Phase = busy ? 'thinking'
    : !session || !session.situation ? 'start'
      : summaryView ? 'summary'
        : session.status === 'thinking' ? 'thinking'
          : session.status === 'acted' ? 'acted'
            : step ? step.kind
              : 'error';
  const component = step ? componentForStep(step) : null;
  const storedDraft = snapshot?.activity?.draft;
  const draft = storedDraft?.status === 'prepared' && storedDraft.stepId === step?.id && storedDraft.revision === session?.revision ? storedDraft : null;
  useEffect(() => {
    if (!session || busy) return;
    const timer = setInterval(() => { void refresh().catch(() => {}); }, 15000);
    return () => clearInterval(timer);
  }, [session, busy, refresh]);

  // A reload while the server is still planning: keep asking until the step arrives.
  useEffect(() => {
    if (busy || session?.status !== 'thinking') return;
    const timer = setInterval(() => { void refresh().catch(() => { /* Keep waiting. */ }); }, 2000);
    return () => clearInterval(timer);
  }, [busy, session?.status, refresh]);
  useEffect(() => {
    if (phase !== 'start') { heading.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); }
  }, [phase, step?.id]);

  const headers = { 'Content-Type': 'application/json' };
  const thinkingTasks = (first: Task, extra: Task[] = []): Task[] => [first, ...extra, { title: 'Vurderer hva som mangler', detail: modelLabel(model) }, { title: 'Velger neste steg', detail: 'Spørre om mer, vise det vi har, eller foreslå en handling.' }];

  async function command(body: FlowCommand, work: Busy) {
    setBusy(work); setError(''); setNotice('');
    try {
      const next = await readResponse(await fetch('/api/flow', { method: 'POST', headers, body: JSON.stringify(body) }));
      accept(next);
      return next;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Vi fikk ikke fullført handlingen. Prøv igjen.');
      try { await refresh(); } catch { /* The action error stays visible. */ }
      return null;
    } finally { setBusy(null); }
  }
  async function begin() {
    const text = situation.trim() || (uploads.length ? 'Se vedlagt dokument.' : '');
    if (!text) return;
    setBusy({ heading: 'Vi tolker situasjonen din', hint: 'Assistenten leser det du skrev og velger neste steg. Ingen opplysninger om deg hentes ennå.',
      tasks: thinkingTasks({ title: 'Leser det du skrev', detail: 'Teksten er ubetrodd data for modellen, ikke instruksjoner.' }, uploads.map(file => ({ title: `Leser ${file.name}`, detail: 'Tekst og tall i dokumentet blir forslag du kontrollerer.' }))) });
    setError(''); setNotice('');
    try {
      let active = latest.current;
      if (!active) {
        active = (await readResponse(await fetch('/api/flow', { method: 'POST', headers, body: JSON.stringify({ action: 'start' }) }))).session;
        if (!active) throw new Error('Kunne ikke starte en ny sak. Prøv igjen.');
        latest.current = active;
      }
      for (const file of uploads) {
        const form = new FormData(); form.set('file', file); form.set('revision', String(active.revision)); form.set('caseId', active.id);
        const next = await readResponse(await fetch('/api/flow/document', { method: 'POST', body: form }));
        accept(next); active = next.session ?? active;
      }
      const next = await readResponse(await fetch('/api/flow', { method: 'POST', headers, body: JSON.stringify({ action: 'input', text, revision: active.revision, caseId: active.id }) }));
      accept(next); setUploads([]); setSituation('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Vi fikk ikke startet saken. Prøv igjen.');
      try { await refresh(); } catch { /* Keep the error. */ }
    } finally { setBusy(null); }
  }
  const withCase = (body: CaseCommand): FlowCommand | null => {
    const active = latest.current;
    return active ? { ...body, caseId: active.id, revision: active.revision } as FlowCommand : null;
  };
  async function answer(answers: { key: string; value: string }[], note: string) {
    const body = withCase({ action: 'answers', answers, note });
    if (body) await command(body, { heading: 'Vi bruker svarene dine', hint: 'Svarene lagres som opplysninger du selv har bekreftet.', tasks: thinkingTasks({ title: 'Lagrer svarene dine', detail: `${answers.length} svar merkes «oppgitt av deg».` }) });
  }
  async function approve(input: { facts: { id: string; value: string }[]; remove: string[]; fetch: FlowFetchable[]; note: string }) {
    const body = withCase({ action: 'approve', ...input });
    if (body) await command(body, { heading: input.fetch.length ? 'Henter KS-opplysninger med samtykke' : 'Vi bruker det du godkjente', hint: input.fetch.length ? 'Bare det du valgte hentes. Du kontrollerer alt før det brukes.' : 'Opplysningene er nå bekreftet av deg.',
      tasks: thinkingTasks({ title: 'Registrerer godkjenningen', detail: `${input.facts.length} opplysninger er bekreftet av deg.` }, input.fetch.map(key => ({ title: `Henter ${FLOW_SOURCES[key].lower}`, detail: 'Henter fra kommunens registre.' }))) });
  }
  async function prepare(execution: FlowExecution) {
    const body = withCase({ action: 'prepare', execution });
    if (!body) return;
    const next = await command(body, { heading: 'Lagrer utkastet', hint: 'Du får kontrollere det nøyaktige innholdet før du godkjenner.', tasks: [{ title: 'Lagrer utkast', detail: 'Ingen handling er utført ennå.' }] });
    if (next) setShowDraft(true);
  }
  async function executeDraft() {
    if (!draft) return;
    const body = withCase({ action: 'execute', draftId: draft.id });
    if (body) await command(body, { heading: 'Utfører det godkjente utkastet', hint: 'Resultatet vises når serveren har svart.', tasks: [{ title: 'Venter på resultat', detail: 'Ikke send samme handling på nytt mens du venter.' }] });
  }
  async function choose(type: 'email' | 'form' | 'reminder' | 'contact', templateId?: string) {
    const body = withCase({ action: 'choose', type, ...(templateId ? { templateId } : {}) });
    setOverviewOpen(false);
    if (body) { setSummaryView(false); setShowDraft(false); await command(body, { heading: 'Forbereder valgt handling', hint: 'Du kan redigere før du godkjenner.', tasks: [{ title: 'Lager forslag', detail: 'Bruker opplysningene i saken.' }] }); }
  }
  async function reviewFacts() {
    setOverviewOpen(false);
    const body = withCase({ action: 'review-facts' });
    if (body) { setShowDraft(false); await command(body, { heading: 'Henter opplysningene', hint: 'Rett opplysningene før du fortsetter.', tasks: [{ title: 'Åpner opplysningene', detail: 'Utkastet må godkjennes på nytt etter endringer.' }] }); }
  }
  async function simple(action: 'skip' | 'continue' | 'retry') {
    const body = withCase({ action });
    if (body) await command(body, { heading: action === 'skip' ? 'Vi ser etter et annet forslag' : 'Vi ser hva som kan gjøres videre', hint: 'Assistenten leser hele saken på nytt.', tasks: thinkingTasks({ title: 'Leser saken på nytt', detail: 'Opplysninger, kilder og utførte handlinger.' }) });
  }
  async function addMore(text: string) {
    const body = withCase({ action: 'input', text });
    if (body) { setSummaryView(false); await command(body, { heading: 'Vi tolker det du la til', hint: 'Assistenten leser hele saken på nytt.', tasks: thinkingTasks({ title: 'Leser det du skrev', detail: 'Teksten er ubetrodd data for modellen, ikke instruksjoner.' }) }); }
  }
  async function reset() {
    const active = latest.current;
    if (active) {
      try { const response = await fetch('/api/flow', { method: 'DELETE', headers, body: JSON.stringify({ caseId: active.id, revision: active.revision }) }); if (!response.ok) throw new Error('Kunne ikke slette saken. Prøv igjen.'); }
      catch (reason) { setError(reason instanceof Error ? reason.message : 'Kunne ikke slette saken.'); return; }
    }
    latest.current = null;
    setSnapshot(current => current ? { ...current, session: null } : current);
    setSituation(''); setUploads([]); setError(''); setNotice(''); setSummaryView(false); setOverviewOpen(false);
  }
  function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    setUploads(current => { const known = new Set(current.map(file => file.name)); return [...current, ...files.filter(file => !known.has(file.name))].slice(0, 4); });
    event.target.value = '';
  }
  const removeUpload = (name: string) => setUploads(current => current.filter(file => file.name !== name));
  function applySuggestion(text: string) { setSituation(text); situationRef.current?.focus(); }

  return <div className={styles.app} data-color-scheme="light" data-color="accent" data-size="md">
    <header className={styles.topBar}>
      <div className={styles.brand}><span className={styles.brandMark} aria-hidden="true">é</span><span>Søk én gang</span></div>
      {phase !== 'start' && <Button variant="tertiary" data-size="sm" disabled={!!busy} onClick={() => void reset()}>Start på nytt</Button>}
    </header>
    {session && <Paragraph data-size="sm" className={styles.stageLabel}>Steg {session.stepCount} · {phase === 'thinking' ? 'Arbeider med saken' : 'Du styrer hva som skjer videre'}</Paragraph>}

    <main id="main" className={styles.content}><div className={styles.container}>
      {session?.situation && (overviewOpen
        ? <Button className={styles.overviewReturn} variant="secondary" disabled={!!busy} aria-expanded={true} aria-controls="family-overview" onClick={() => setOverviewOpen(false)}><ArrowLeft aria-hidden="true" />Tilbake til veiviseren</Button>
        : <Card variant="tinted" data-color="accent" className={styles.overviewInvitation} aria-labelledby="overview-invitation-heading">
          <CardBlock className={styles.cardStack}>
            <Heading id="overview-invitation-heading" level={2} data-size="xs">Se hva som kan hjelpe familien din</Heading>
            <Paragraph data-size="sm">Utforsk aktuelle tjenester i et kart, samle dokumentene i en sjekkliste og følg saken i en tidslinje.</Paragraph>
            <Button className={styles.overviewCta} variant="primary" data-size="sm" disabled={!!busy} aria-expanded={false} aria-controls="family-overview" onClick={() => setOverviewOpen(true)}>Utforsk familieoversikten<ArrowRight aria-hidden="true" /></Button>
          </CardBlock>
        </Card>)}
      {overviewOpen && session && <div id="family-overview"><FamilyOverview session={session} activity={snapshot?.activity} onChoose={(type, templateId) => void choose(type, templateId)} onReview={() => void reviewFacts()} onRefresh={refresh} /></div>}
      <div hidden={overviewOpen}>
      {notice && phase !== 'thinking' && <Alert data-color="info" role="status" className={styles.stackSm}>{notice}</Alert>}
      {error && phase !== 'thinking' && <Alert data-color="danger" role="alert" className={styles.stackSm}>{error}</Alert>}
      {session?.notice && phase !== 'thinking' && phase !== 'start' && <Alert data-color="warning" role="status" className={styles.stackSm}>{session.notice}</Alert>}

      {phase === 'start' && <Screen kind="start" eyebrow="Kom i gang" heading="Hva trenger du hjelp med?" hint="Du trenger ikke vite hvilken tjeneste. Beskriv situasjonen med egne ord, så finner assistenten ut hva som er neste steg: spørre om mer, vise det vi har, eller foreslå en handling." headingRef={heading}>
        <Textfield multiline ref={situationRef} id="situation" label="Beskriv situasjonen din" rows={6} value={situation} onChange={event => setSituation(event.target.value)}
          placeholder="F.eks: Jeg mistet jobben forrige måned og har et barn på SFO …" autoFocus suppressHydrationWarning />
        <NavRow onNext={() => void begin()} nextDisabled={loading || (!situation.trim() && uploads.length === 0)} nextLabel="Gå videre" />
        {!loading && <Paragraph data-size="xs" className={`${styles.subtle} ${styles.modelLine}`}><Sparkle size={16} aria-hidden="true" />{model?.available ? `Neste steg foreslås av ${modelLabel(model)}. Du godkjenner alt før det brukes.` : `${model?.message ?? 'Språkmodellen er ikke tilgjengelig.'} Flyten bruker faste regler inntil modellen svarer.`}</Paragraph>}
        <Paragraph data-size="xs" className={styles.subtle}>Saken og tilknyttede påminnelser slettes etter 90 dager. Varsler vises i denne appen.</Paragraph>
        <Divider />
        <div className={styles.stackSm}>
          <Paragraph data-size="sm" className={styles.subtle}>Trenger du inspirasjon? Trykk på et eksempel for å bruke det som utgangspunkt.</Paragraph>
          <div className={styles.chips}>
            {SUGGESTIONS.map(text => <ChipButton key={text} data-wrap="wrap" onClick={() => applySuggestion(text)}>{text}</ChipButton>)}
          </div>
        </div>
        <Details>
          <DetailsSummary>Legg ved dokument (valgfritt)</DetailsSummary>
          <DetailsContent><UploadField label="Dokument" description="TXT eller tekstbasert PDF, inntil 1,5 MB. Tall og tekst blir forslag du kontrollerer." uploads={uploads} onChange={handleFileUpload} onRemove={removeUpload} /></DetailsContent>
        </Details>
      </Screen>}

      {phase === 'thinking' && <ThinkingScreen heading={busy?.heading ?? 'Assistenten arbeider med saken'} hint={busy?.hint ?? 'Vi henter fremdriften. Dette kan ta opptil ett minutt.'}
        tasks={busy?.tasks ?? thinkingTasks({ title: 'Leser saken', detail: 'Planleggingen pågår på serveren.' })} headingRef={heading} />}

      {phase === 'ask' && component === 'question-form' && session && step && <AskScreen key={step.id} session={session} step={step} onSubmit={answer} onSkip={() => void answer([], '')} headingRef={heading} />}
      {phase === 'review' && component === 'evidence-review' && session && step && <ReviewScreen key={step.id} session={session} step={step} onApprove={approve} headingRef={heading} />}
      {session && step?.proposal && step.kind === 'action' && component && ['email-draft', 'application-draft', 'reminder-editor', 'human-review'].includes(component) && session.status !== 'acted' && <div hidden={phase === 'thinking' || summaryView}>
        <div hidden={!!draft && showDraft}>
          <ActionScreen key={step.id} component={component} session={session} step={step} proposal={step.proposal} onExecute={prepare} onSkip={() => void simple('skip')} headingRef={heading} />
          <Button variant="tertiary" onClick={() => void reviewFacts()}>Rett opplysninger</Button>
        </div>
        {draft && showDraft && <Screen kind="approval" eyebrow="Godkjenn utkast" heading="Kontroller før du godkjenner" hint="Dette er innholdet som brukes. Endringer krever et nytt utkast." headingRef={heading}>
          <DraftPreview execution={draft.execution} proposal={draft.proposal} />
          <NavRow onNext={() => void executeDraft()} nextLabel="Godkjenn og utfør" nextDisabled={draft.status !== 'prepared'} onBack={() => setShowDraft(false)} backLabel="Rediger utkast" />
        </Screen>}
      </div>}
      {phase === 'acted' && session && <ActedScreen session={session} onSummary={() => setSummaryView(true)} headingRef={heading} />}
      {((phase === 'done' && component === 'completion-summary') || phase === 'summary') && session && <SummaryScreen session={session} step={phase === 'done' ? step : null} onMore={addMore} onContinue={phase === 'summary' ? () => setSummaryView(false) : () => void simple('continue')} onReset={() => void reset()} headingRef={heading} />}
      {phase === 'error' && session && <Screen kind="error" eyebrow="Noe stoppet" heading="Assistenten kunne ikke fullføre steget" hint={session.error ?? 'Det finnes ikke noe aktivt steg. Prøv igjen, eller start på nytt.'} headingRef={heading}>
        <NavRow onNext={() => void simple('retry')} nextLabel="Prøv igjen" onBack={() => void reset()} backLabel="Start på nytt" />
        <ActivityLog session={session} />
      </Screen>}
      {session && phase !== 'start' && phase !== 'thinking' && <>
        <Details><DetailsSummary>Velg en handling</DetailsSummary><DetailsContent className={styles.stackSm}>
          <Button variant="secondary" onClick={() => void choose('form')}>Forbered skjema</Button>
          <Button variant="secondary" onClick={() => void choose('email')}>Forbered e-post</Button>
          <Button variant="secondary" onClick={() => void choose('reminder')}>Lag påminnelse</Button>
          <Button variant="secondary" onClick={() => void choose('contact')}>Be om menneskelig vurdering</Button>
        </DetailsContent></Details>
        {snapshot?.activity && <FlowActivityPanel caseId={session.id} revision={session.revision} activity={snapshot.activity} outcomes={session.outcomes} onRefresh={refresh} />}
      </>}
      </div>
    </div></main>
  </div>;
}

function Screen({ kind, eyebrow, heading, hint, headingRef, children }: {
  kind: string; eyebrow: string; heading: string; hint?: string; headingRef: Ref<HTMLHeadingElement>; children: ReactNode;
}) {
  return <section className={styles.screen} data-testid="flow-step" data-kind={kind}>
    <div className={styles.screenHeader}>
      <Tag data-color="accent" data-size="sm">{eyebrow}</Tag>
      <Heading level={1} data-size="md" ref={headingRef} tabIndex={-1}>{heading}</Heading>
      {hint && <Paragraph variant="long" className={styles.subtle}>{hint}</Paragraph>}
    </div>
    {children}
  </section>;
}

/** Model and fetch work shown as a running task. The last task stays open until the server answers. */
function ThinkingScreen({ heading, hint, tasks, headingRef }: { heading: string; hint: string; tasks: Task[]; headingRef: Ref<HTMLHeadingElement> }) {
  return <Screen kind="thinking" eyebrow="Arbeider med saken" heading={heading} hint={hint} headingRef={headingRef}>
    <Card data-color="neutral" aria-busy="true"><CardBlock className={styles.cardStack}>
      <div className={styles.taskTitle}><Spinner data-size="sm" aria-hidden="true" /><Paragraph role="status">Venter på svar fra serveren</Paragraph></div>
      <Details><DetailsSummary>Hva forespørselen gjelder</DetailsSummary><DetailsContent>
        <ListUnordered>{tasks.map(task => <ListItem key={task.title}>{task.title}. {task.detail}</ListItem>)}</ListUnordered>
      </DetailsContent></Details>
    </CardBlock></Card>
  </Screen>;
}

/** Who proposed the step, and the user-facing rationale. Never hidden reasoning. */
function StepMeta({ step }: { step: FlowStep }) {
  return <div className={styles.stackSm}>
    <div className={styles.chips}>
      <Tag data-size="sm" data-color={step.by === 'model' ? 'accent' : 'warning'}>{step.by === 'model' ? `KI-forslag · ${step.model}` : 'Regelbasert forslag'}</Tag>
    </div>
    <Details>
      <DetailsSummary>Slik tenkte assistenten</DetailsSummary>
      <DetailsContent className={styles.stackSm}>
        <Paragraph data-size="sm">{step.rationale}</Paragraph>
        <Paragraph data-size="xs" className={styles.subtle}>Forslaget er sjekket mot opplysningene i saken før du ser det. Du bestemmer selv hva som brukes.</Paragraph>
      </DetailsContent>
    </Details>
  </div>;
}
function ActivityLog({ session }: { session: FlowCase }) {
  const events = session.events.slice(-10).reverse();
  if (!events.length) return null;
  return <Details>
    <DetailsSummary>Hva har skjedd i saken</DetailsSummary>
    <DetailsContent>
      <ul className={styles.eventList}>{events.map(item => <li key={item.id}><strong>{item.agent}</strong> · {dateTime(item.at)} · {item.detail}</li>)}</ul>
    </DetailsContent>
  </Details>;
}
function MoreInfo({ value, onChange, id = 'more-info' }: { value: string; onChange: (value: string) => void; id?: string }) {
  return <Details defaultOpen={!!value.trim()}>
    <DetailsSummary>Er det noe mer vi bør vite?</DetailsSummary>
    <DetailsContent>
      <Textfield multiline id={id} label="Legg til" description="Lagres som noe du selv har oppgitt." rows={3} value={value} onChange={event => onChange(event.target.value)} placeholder="F.eks: Inntekten min går ned fra neste måned." suppressHydrationWarning />
    </DetailsContent>
  </Details>;
}

function QuestionField({ question, value, error, onChange }: { question: FlowQuestion; value: string; error?: string; onChange: (value: string) => void }) {
  const id = `question-${question.key}`;
  if (question.kind === 'boolean') {
    return <Fieldset>
      <FieldsetLegend>{question.label}</FieldsetLegend>
      {question.hint && <FieldDescription>{question.hint}</FieldDescription>}
      <div className={styles.stackSm}>
        <Radio name={id} label="Ja" value="Ja" checked={value === 'Ja'} onChange={() => onChange('Ja')} />
        <Radio name={id} label="Nei" value="Nei" checked={value === 'Nei'} onChange={() => onChange('Nei')} />
      </div>
      {error && <ValidationMessage>{error}</ValidationMessage>}
    </Fieldset>;
  }
  if (question.kind === 'select') {
    return <Field>
      <Label htmlFor={id}>{question.label}</Label>
      {question.hint && <FieldDescription>{question.hint}</FieldDescription>}
      <Select id={id} value={value} onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}>
        <SelectOption value="">Velg …</SelectOption>
        {question.options.map(option => <SelectOption key={option} value={option}>{option}</SelectOption>)}
      </Select>
      {error && <ValidationMessage>{error}</ValidationMessage>}
    </Field>;
  }
  if (question.kind === 'textarea') return <Textfield multiline id={id} label={question.label} description={question.hint ?? undefined} rows={3} value={value} onChange={event => onChange(event.target.value)} error={error || undefined} suppressHydrationWarning />;
  return <Textfield id={id} label={question.label} description={question.hint ?? undefined} type={question.kind === 'date' ? 'date' : 'text'} inputMode={question.kind === 'number' ? 'numeric' : undefined} value={value} onChange={event => onChange(event.target.value)} error={error || undefined} />;
}

function AskScreen({ session, step, onSubmit, onSkip, headingRef }: { session: FlowCase; step: FlowStep; onSubmit: (answers: { key: string; value: string }[], note: string) => void; onSkip: () => void; headingRef: Ref<HTMLHeadingElement> }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    const missing = step.questions.filter(question => question.required && !(values[question.key] ?? '').trim());
    if (missing.length) { setErrors(Object.fromEntries(missing.map(question => [question.key, 'Fyll ut feltet, eller hopp over spørsmålene.']))); return; }
    onSubmit(step.questions.map(question => ({ key: question.key, value: (values[question.key] ?? '').trim() })).filter(answer => answer.value), note);
  }
  return <Screen kind="ask" eyebrow={`Steg ${session.stepCount} · Vi trenger mer`} heading={step.title} hint={step.message} headingRef={headingRef}>
    <StepMeta step={step} />
    <form className={styles.stack} onSubmit={submit} noValidate>
      <FieldErrors errors={errors} prefix="question-" />
      {step.questions.map(question => <QuestionField key={question.key} question={question} value={values[question.key] ?? ''} error={errors[question.key]}
        onChange={value => { setValues(current => ({ ...current, [question.key]: value })); setErrors(current => (current[question.key] ? { ...current, [question.key]: '' } : current)); }} />)}
      <MoreInfo value={note} onChange={setNote} />
      <NavRow nextType="submit" nextLabel="Send svar" onBack={onSkip} backLabel="Hopp over spørsmålene" />
    </form>
    <ActivityLog session={session} />
  </Screen>;
}

function ReviewScreen({ session, step, onApprove, headingRef }: { session: FlowCase; step: FlowStep; onApprove: (input: { facts: { id: string; value: string }[]; remove: string[]; fetch: FlowFetchable[]; note: string }) => void; headingRef: Ref<HTMLHeadingElement> }) {
  const facts = activeFacts(session, step);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(facts.map(fact => [fact.id, fact.value])));
  const [removed, setRemoved] = useState<string[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>(() => Object.fromEntries(step.fetch.map(key => [key, true])));
  const [note, setNote] = useState('');
  const visible = facts.filter(fact => !removed.includes(fact.id));
  const chosen = step.fetch.filter(key => selected[key]);
  const proposedCount = visible.filter(fact => fact.status === 'proposed').length;
  return <Screen kind="review" eyebrow={`Steg ${session.stepCount} · Kontroller opplysninger`} heading={step.title} hint={step.message} headingRef={headingRef}>
    <StepMeta step={step} />
    {visible.length ? <Card data-color="neutral"><CardBlock className={styles.cardStack}>
      <Heading level={2} data-size="2xs">Dette har vi nå</Heading>
      <Paragraph data-size="sm" className={styles.subtle}>{proposedCount ? `${proposedCount} av opplysningene er KI-forslag fra det du skrev eller la ved. ` : ''}Rett det som ikke stemmer, eller fjern opplysningen. Alt du godkjenner merkes som bekreftet av deg.</Paragraph>
      <div className={styles.stack}>
        {visible.map(fact => <div key={fact.id} className={styles.factRow}>
          <Textfield id={`fact-${fact.id}`} label={fact.label} description={factSource(session, fact) || undefined} value={values[fact.id] ?? ''} onChange={event => { const value = event.target.value; setValues(current => ({ ...current, [fact.id]: value })); }} />
          <div className={styles.factMeta}>
            <Tag data-size="sm" data-color={fact.status === 'proposed' ? 'warning' : fact.origin === 'ks' ? 'info' : 'success'}>{fact.status === 'proposed' ? 'KI-forslag – kontroller' : fact.origin === 'ks' ? 'Hentet fra KS' : CITIZEN_SOURCE}</Tag>
            <Button variant="tertiary" data-size="sm" onClick={() => setRemoved(current => [...current, fact.id])}>Fjern {fact.label.toLocaleLowerCase('nb-NO')}</Button>
          </div>
        </div>)}
      </div>
    </CardBlock></Card> : <Alert data-color="info">Vi har ingen bekreftede opplysninger ennå.</Alert>}
    {step.fetch.length > 0 && <Fieldset>
      <FieldsetLegend>Vi foreslår å hente fra kommunens registre</FieldsetLegend>
      <FieldDescription>Ved å hente samtykker du til at opplysningene brukes i saken. Huk vekk det du ikke vil dele – da fyller du det inn selv.</FieldDescription>
      <div className={styles.stackSm}>
        {step.fetch.map(key => <Checkbox key={key} value={key} label={FLOW_SOURCES[key].title} description={FLOW_SOURCES[key].description}
          checked={!!selected[key]} onChange={event => { const checked = event.target.checked; setSelected(current => ({ ...current, [key]: checked })); }} />)}
      </div>
    </Fieldset>}
    <MoreInfo value={note} onChange={setNote} />
    {step.next && <Paragraph data-size="sm" className={styles.subtle}>{step.next}</Paragraph>}
    <NavRow onNext={() => onApprove({ facts: visible.map(fact => ({ id: fact.id, value: values[fact.id] ?? fact.value })), remove: removed, fetch: chosen, note })}
      nextLabel={chosen.length ? `Godkjenn og hent ${chosen.length} av ${step.fetch.length} opplysninger` : 'Godkjenn og gå videre'} />
    <ActivityLog session={session} />
  </Screen>;
}

function ContactCard({ contact, reason }: { contact: ContactPoint; reason?: string }) {
  return <Card data-color="neutral" variant="tinted"><CardBlock className={styles.cardStack}>
    <Heading level={2} data-size="2xs">{contact.name}</Heading>
    <Paragraph data-size="sm">{contact.role} · {contact.organisation}</Paragraph>
    {reason && <Paragraph data-size="sm">{reason}</Paragraph>}
    <dl className={styles.sourceList}>
      {contact.phone && <div><dt>Telefon</dt><dd><Phone size={16} aria-hidden="true" /> <DsLink href={`tel:${contact.phone.replace(/\s/g, '')}`}>{contact.phone}</DsLink>{contact.hours ? ` · ${contact.hours}` : ''}</dd></div>}
      {contact.email && <div><dt>E-post</dt><dd><EnvelopeSimple size={16} aria-hidden="true" /> {contact.email}</dd></div>}
      {contact.url && <div><dt>Nettside</dt><dd><DsLink href={contact.url} target="_blank" rel="noreferrer">{contact.url}</DsLink></dd></div>}
    </dl>
    <Paragraph data-size="xs" className={styles.subtle}>{contact.note}</Paragraph>
  </CardBlock></Card>;
}

function ActionScreen({ component, session, step, proposal, onExecute, onSkip, headingRef }: { component: FlowComponentId; session: FlowCase; step: FlowStep; proposal: FlowProposal; onExecute: (execution: FlowExecution) => void; onSkip: () => void; headingRef: Ref<HTMLHeadingElement> }) {
  const [to, setTo] = useState(proposal.type === 'email' ? proposal.contact.email ?? '' : '');
  const [subject, setSubject] = useState(proposal.type === 'email' ? proposal.subject : proposal.type === 'reminder' ? proposal.title : '');
  const [body, setBody] = useState(proposal.type === 'email' ? proposal.body : proposal.type === 'reminder' ? proposal.note : proposal.type === 'contact' ? proposal.summary ?? proposal.reason : '');
  const [date, setDate] = useState(proposal.type === 'reminder' ? proposal.date : '');
  const [time, setTime] = useState(proposal.type === 'reminder' ? proposal.time ?? '' : '');
  const [fields, setFields] = useState<Record<string, string>>(() => proposal.type === 'form' ? Object.fromEntries(proposal.fields.filter(field => field.editable).map(field => [field.id, field.value])) : {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const eyebrow = `Steg ${session.stepCount} · ${ACTION_LABELS[proposal.type]}`;

  if (component === 'email-draft' && proposal.type === 'email') {
    const submit = () => {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) { setErrors({ to: 'Oppgi én gyldig e-postadresse.' }); return; }
      if (!subject.trim() || !body.trim()) { setErrors({ body: 'E-posten må ha et emne og en tekst.' }); return; }
      onExecute({ type: 'email', to: to.trim(), subject: subject.trim(), body: body.trim() });
    };
    return <Screen kind="action" eyebrow={eyebrow} heading={step.title} hint={step.message} headingRef={headingRef}>
      <StepMeta step={step} />
      <FieldErrors errors={errors} prefix="email-" />
      <ContactCard contact={proposal.contact} />
      <Alert data-color={proposal.aiDrafted ? 'info' : 'warning'}>{proposal.aiDrafted ? 'Utkastet er skrevet av KI og kontrollert mot opplysningene dine: ingen tall uten grunnlag, ingen påstand om vedtak. Les over og rett før du lagrer i testutboksen.' : 'KI-utkastet ble avvist i kontrollen eller var utilgjengelig, så dette er et fast utkast fra opplysningene dine. Rett det før du lagrer i testutboksen.'}</Alert>
      <div className={styles.stack}>
        <Textfield id="email-to" label="Til" description="Du kan endre mottakeren før du sender." type="email" value={to} onChange={event => setTo(event.target.value)} error={errors.to} />
        <Textfield id="email-subject" label="Emne" value={subject} onChange={event => setSubject(event.target.value)} />
        <Textfield multiline id="email-body" label="E-post" rows={12} value={body} onChange={event => setBody(event.target.value)} error={errors.body} suppressHydrationWarning />
      </div>
      <Paragraph data-size="xs" className={styles.subtle}>Godkjenningen lagrer e-posten i en lokal testutboks. Ingen e-post sendes til mottakeren.</Paragraph>
      <NavRow onNext={submit} nextLabel="Kontroller e-postutkast" onBack={onSkip} backLabel="Foreslå noe annet" />
      <ActivityLog session={session} />
    </Screen>;
  }
  if (component === 'application-draft' && proposal.type === 'form') {
    const ks = proposal.submission === 'ks-sandbox';
    const submit = () => {
      const missing = proposal.fields.filter(field => field.required && !((field.editable ? fields[field.id] : field.value) ?? '').trim());
      if (missing.length) { setErrors(Object.fromEntries(missing.map(field => [field.id, field.editable ? 'Feltet må fylles ut.' : 'Opplysningen mangler. Gå tilbake og legg den til.']))); return; }
      onExecute({ type: 'form', fields });
    };
    return <Screen kind="action" eyebrow={eyebrow} heading={step.title} hint={step.message} headingRef={headingRef}>
      <StepMeta step={step} />
      <FieldErrors errors={errors} prefix="field-" />
      <Card data-color="neutral" variant="tinted"><CardBlock className={styles.cardStack}>
        <Heading level={2} data-size="2xs">{proposal.title}</Heading>
        <Paragraph data-size="sm">Mottaker: {proposal.recipient.name} · {proposal.recipient.organisation}</Paragraph>
        <Paragraph data-size="xs" className={styles.subtle}>{ks ? 'Kommunen registrerer søknaden. Skjemafeltene og dokumentene lagres i denne appen.' : 'Klargjøres lokalt. Selve innsendingen gjør du i den offisielle tjenesten.'} Bekreftede opplysninger kan ikke redigeres her; rett dem ved å legge til mer informasjon.</Paragraph>
      </CardBlock></Card>
      <div className={styles.stack}>
        {proposal.fields.map(field => {
          const origin = field.origin === 'register' ? 'Hentet fra KS · kan ikke redigeres her' : field.origin === 'confirmed' ? 'Bekreftet av deg · kan ikke redigeres her' : field.origin === 'suggested' ? 'Forslag – kontroller og rett' : field.required ? 'Må fylles ut' : 'Valgfritt';
          if (!field.editable) return <Textfield key={field.id} id={`field-${field.id}`} label={field.label} description={origin} value={field.value} readOnly error={errors[field.id]} />;
          return <Textfield key={field.id} id={`field-${field.id}`} label={field.label} description={origin} multiline={field.kind === 'textarea'} rows={field.kind === 'textarea' ? 4 : undefined}
            value={fields[field.id] ?? ''} onChange={(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { const value = event.target.value; setFields(current => ({ ...current, [field.id]: value })); setErrors(current => (current[field.id] ? { ...current, [field.id]: '' } : current)); }} error={errors[field.id]} suppressHydrationWarning />;
        })}
      </div>
      {proposal.attachments.length > 0 && <Details>
        <DetailsSummary>Dokumentasjon du bør ha klar</DetailsSummary>
        <DetailsContent><ListUnordered data-size="sm">{proposal.attachments.map(item => <ListItem key={item}>{item}</ListItem>)}</ListUnordered></DetailsContent>
      </Details>}
      <NavRow onNext={submit} nextLabel="Kontroller skjemautkast" onBack={onSkip} backLabel="Foreslå noe annet" />
      <ActivityLog session={session} />
    </Screen>;
  }
  if (component === 'reminder-editor' && proposal.type === 'reminder') {
    const today = new Date().toISOString().slice(0, 10);
    const submit = () => {
      if (!subject.trim()) { setErrors({ title: 'Påminnelsen må ha en tittel.' }); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today) { setErrors({ date: 'Velg en dato som er i dag eller senere.' }); return; }
      onExecute({ type: 'reminder', title: subject.trim(), date, time: /^\d{2}:\d{2}$/.test(time) ? time : null, note: body.trim() });
    };
    return <Screen kind="action" eyebrow={eyebrow} heading={step.title} hint={step.message} headingRef={headingRef}>
      <StepMeta step={step} />
      <div className={styles.stack}>
        <FieldErrors errors={errors} prefix="reminder-" />
        <Textfield id="reminder-title" label="Påminnelse" value={subject} onChange={event => setSubject(event.target.value)} error={errors.title} />
        <div className={styles.fieldGrid}>
          <Textfield id="reminder-date" label="Dato" type="date" min={today} value={date} onChange={event => setDate(event.target.value)} error={errors.date} />
          <Textfield id="reminder-time" label="Klokkeslett (valgfritt)" type="time" value={time} onChange={event => setTime(event.target.value)} />
        </div>
        <Textfield multiline id="reminder-note" label="Merknad" rows={3} value={body} onChange={event => setBody(event.target.value)} suppressHydrationWarning />
      </div>
      <Paragraph data-size="xs" className={styles.subtle}>Påminnelsen lagres i saken. Du får et varsel her når den forfaller. Du kan endre eller avbryte den i saken. Tidssone: Europe/Oslo.</Paragraph>
      <NavRow onNext={submit} nextLabel="Kontroller påminnelsen" onBack={onSkip} backLabel="Foreslå noe annet" />
      <ActivityLog session={session} />
    </Screen>;
  }
  if (component !== 'human-review' || proposal.type !== 'contact') return <Alert data-color="danger">Forslaget passer ikke til en registrert komponent. Last inn saken på nytt.</Alert>;
  return <Screen kind="action" eyebrow={eyebrow} heading={step.title} hint={step.message} headingRef={headingRef}>
    <StepMeta step={step} />
    <ContactCard contact={proposal.contact} reason={proposal.reason} />
    <Textfield multiline label="Oppsummering til menneskelig vurdering" value={body} onChange={event => setBody(event.target.value)} rows={8} />
    <Paragraph>Oppsummeringen legges i den lokale køen for menneskelig vurdering. Den sendes ikke til en virkelig offentlig tjeneste.</Paragraph>
    <NavRow onNext={() => onExecute({ type: 'contact', summary: body.trim() })} nextDisabled={!body.trim()} nextLabel="Kontroller oppsummeringen" onBack={onSkip} backLabel="Foreslå noe annet" />
    <ActivityLog session={session} />
  </Screen>;
}

function OutcomeCard({ session, outcome }: { session: FlowCase; outcome: FlowOutcome }) {
  return <Card data-color={outcome.localOnly ? 'neutral' : 'success'} variant="tinted"><CardBlock className={styles.cardStack}>
    <div className={styles.chips}><Tag data-size="sm" data-color={outcome.localOnly ? 'neutral' : 'success'}>{ACTION_LABELS[outcome.kind]}</Tag><Tag data-size="sm" data-color="neutral">{outcome.reference}</Tag></div>
    <Heading level={2} data-size="2xs">{outcome.title}</Heading>
    <Paragraph data-size="sm">{outcome.kind === 'reminder' ? 'Påminnelsen ble opprettet i saken. Se gjeldende status nedenfor.' : outcome.kind === 'contact' && outcome.status === 'queued' ? 'Oppsummeringen ble lagt i den lokale vurderingskøen. Se gjeldende status nedenfor.' : outcome.detail}</Paragraph>
    {outcome.recipient && <Paragraph data-size="xs" className={styles.subtle}>Mottaker: {outcome.recipient.name} · {outcome.recipient.organisation}</Paragraph>}
    {outcome.kind === 'form' && outcome.payload.ksSoknadId && <dl className={styles.sourceList}>
      <div><dt>KS søknads-ID</dt><dd>{outcome.payload.ksSoknadId}</dd></div>
      <div><dt>Saksbehandleroppgave i Fiks</dt><dd>{outcome.payload.ksOppgaveId ?? 'ikke opprettet'}</dd></div>
      {outcome.payload.ksWarning && <div><dt>Merknad fra KS</dt><dd>{outcome.payload.ksWarning}</dd></div>}
    </dl>}
    {outcome.kind === 'reminder' && <Paragraph data-size="sm">Gjeldende dato og status vises under Påminnelser. Kvitteringen beskriver den opprinnelige opprettelsen.</Paragraph>}
    <div className={styles.navRow}>
      {outcome.kind === 'form' && outcome.localOnly && outcome.recipient?.url && <Button asChild variant="secondary"><a href={outcome.recipient.url} target="_blank" rel="noreferrer">Åpne den offisielle tjenesten</a></Button>}
      <Button asChild variant="tertiary" data-size="sm"><a href={`/api/flow/outcome?caseId=${encodeURIComponent(session.id)}&outcomeId=${encodeURIComponent(outcome.id)}`} download>Last ned kvittering</a></Button>
    </div>
    <Paragraph data-size="xs" className={styles.subtle}>{outcome.localOnly ? 'Lagret lokalt med testopplysninger. Ingenting er sendt til en offentlig tjeneste.' : 'KS har registrert en testsøknad. Skjemafeltene og dokumentene lagres bare i denne appen. Dette er ikke en søknad til en virkelig kommune.'}</Paragraph>
  </CardBlock></Card>;
}

function ActedScreen({ session, onSummary, headingRef }: { session: FlowCase; onSummary: () => void; headingRef: Ref<HTMLHeadingElement> }) {
  const outcome = session.outcomes.at(-1);
  return <Screen kind="acted" eyebrow="Resultat" heading={outcome ? outcome.status === 'mocked' ? 'E-posten er lagret i testutboksen' : outcome.status === 'queued' ? 'Vurderingen er lagt i lokal kø' : outcome.status === 'prepared' ? 'Skjemaet er klart til videre bruk' : outcome.status === 'scheduled' ? 'Påminnelsen ble opprettet' : outcome.localOnly ? 'Forberedelsen er registrert' : 'KS har registrert testsøknaden' : 'Resultatet er registrert'} hint="Kvitteringen ligger i saken. Du kan avslutte med en oppsummering." headingRef={headingRef}>
    {outcome && <OutcomeCard session={session} outcome={outcome} />}
    <div className={styles.navRow}>
      <Button variant="primary" type="button" onClick={onSummary}>Se oppsummering<ArrowRight aria-hidden="true" /></Button>
    </div>
    <ActivityLog session={session} />
  </Screen>;
}

function SummaryScreen({ session, step, onMore, onContinue, onReset, headingRef }: { session: FlowCase; step: FlowStep | null; onMore: (text: string) => void; onContinue: () => void; onReset: () => void; headingRef: Ref<HTMLHeadingElement> }) {
  const [more, setMore] = useState('');
  const facts = activeFacts(session);
  const documents = session.sources.filter(source => source.kind === 'document');
  return <Screen kind={step ? 'done' : 'summary'} eyebrow={step ? 'Ferdig' : 'Oppsummering'} heading={step?.title ?? 'Oppsummering av saken'} hint={step?.message ?? 'Dette er det som er samlet og utført i saken. Kommunen gjør vedtak; ingen søknad er sendt til en virkelig kommune.'} headingRef={headingRef}>
    {step && <StepMeta step={step} />}
    {session.outcomes.length > 0 && <div className={styles.stack}>
      <Heading level={2} data-size="xs">Resultater og forberedelser</Heading>
      {session.outcomes.map(outcome => <OutcomeCard key={outcome.id} session={session} outcome={outcome} />)}
    </div>}
    <Card data-color="neutral"><CardBlock className={styles.cardStack}>
      <Heading level={2} data-size="2xs">Opplysningene i saken</Heading>
      {facts.length ? <dl className={styles.sourceList}>{facts.map(fact => <div key={fact.id}><dt>{fact.label}</dt><dd>{fact.value}<br /><span className={styles.subtle}>{factSource(session, fact)}</span></dd></div>)}</dl> : <Paragraph data-size="sm" className={styles.subtle}>Ingen opplysninger er lagret.</Paragraph>}
    </CardBlock></Card>
    <Details>
      <DetailsSummary>Hvor kommer opplysningene fra?</DetailsSummary>
      <DetailsContent>
        <dl className={styles.sourceList}>
          <div><dt>Din beskrivelse og svar</dt><dd>{CITIZEN_SOURCE}. Kommunen må kontrollere det du oppgir.</dd></div>
          {documents.length > 0 && <div><dt>Dokumenter</dt><dd>{documents.map(source => source.title).join(', ')}. Ubetrodd tekst; tall og påstander er forslag du har kontrollert.</dd></div>}
          {session.ks.fetched.length > 0 && <div><dt>Kommunens registre</dt><dd>{session.ks.fetched.map(key => FLOW_SOURCES[key].title).join(', ')}{session.ks.fetchedAt ? `, hentet ${dateTime(session.ks.fetchedAt)}` : ''}. Testmiljø med syntetiske opplysninger.</dd></div>}
          {session.ks.declined.length > 0 && <div><dt>Ikke hentet</dt><dd>{session.ks.declined.map(key => FLOW_SOURCES[key].lower).join(', ')} – valgt bort av deg.</dd></div>}
          <div><dt>Neste steg og forslag</dt><dd>Språkmodell i demoen, kontrollert mot kildene. Kommunen gjør vedtak.</dd></div>
        </dl>
      </DetailsContent>
    </Details>
    <Card data-color="neutral"><CardBlock className={styles.cardStack}>
      <Heading level={2} data-size="2xs">Legg til mer</Heading>
      <Textfield multiline id="more-text" label="Er det noe mer vi bør hjelpe deg med?" rows={3} value={more} onChange={event => setMore(event.target.value)} placeholder="F.eks: Jeg skal også flytte i oktober." suppressHydrationWarning />
      <div className={styles.actionList}>
        <Button variant="secondary" className={styles.actionButton} disabled={!more.trim()} onClick={() => onMore(more.trim())}>Send og fortsett<CaretRight aria-hidden="true" /></Button>
        <Button variant="secondary" className={styles.actionButton} onClick={onContinue}>{step ? 'Er det mer vi kan gjøre?' : 'Tilbake til saken'}<CaretRight aria-hidden="true" /></Button>
        <Button variant="secondary" className={styles.actionButton} onClick={onReset}>Start en ny sak<CaretRight aria-hidden="true" /></Button>
      </div>
    </CardBlock></Card>
    <ActivityLog session={session} />
    <Paragraph data-size="xs" className={`${styles.subtle} ${styles.footerNote}`}>Syntetiske testopplysninger · Saken og tilknyttede påminnelser slettes etter 90 dager · Ingen ekte søknad sendes</Paragraph>
  </Screen>;
}

function NavRow({ onNext, onBack, nextDisabled = false, nextLabel = 'Neste', backLabel = 'Tilbake', nextType = 'button' }: {
  onNext?: () => void; onBack?: () => void; nextDisabled?: boolean; nextLabel?: string; backLabel?: string; nextType?: 'button' | 'submit';
}) {
  return <div className={styles.navRow}>
    <Button variant="primary" type={nextType} onClick={nextType === 'button' ? onNext : undefined} disabled={nextDisabled}>{nextLabel}<ArrowRight aria-hidden="true" /></Button>
    {onBack && <Button variant="tertiary" type="button" onClick={onBack}><ArrowLeft aria-hidden="true" />{backLabel}</Button>}
  </div>;
}

function UploadField({ label, description, uploads, onChange, onRemove }: {
  label: string; description: string; uploads: File[]; onChange: (event: ChangeEvent<HTMLInputElement>) => void; onRemove: (name: string) => void;
}) {
  return <div className={styles.stack}>
    <Field>
      <Label>{label}</Label>
      <EXPERIMENTAL_FileUpload>
        <FieldDescription>{description}</FieldDescription>
        <Button asChild variant="secondary"><span>Velg fil</span></Button>
        {/* ds-field decorates this input before React hydrates; the attributes are equivalent. */}
        <input type="file" multiple accept={ACCEPTED_FILES} onChange={onChange} suppressHydrationWarning />
      </EXPERIMENTAL_FileUpload>
    </Field>
    {uploads.length > 0 && <div className={styles.chips}>
      {uploads.map(file => <ChipRemovable key={file.name} aria-label={`Fjern ${file.name}`} onClick={() => onRemove(file.name)}>{file.name} · {formatSize(file.size)}</ChipRemovable>)}
    </div>}
  </div>;
}

function DraftPreview({ execution, proposal }: { execution: FlowExecution; proposal: FlowProposal }) {
  return <Card data-color="neutral"><CardBlock className={styles.cardStack}>
    {proposal.type === 'form' && <Paragraph>Mottaker: {proposal.recipient.name}. {proposal.submission === 'ks-sandbox' ? 'KS registrerer en testsøknad. Skjemafeltene og dokumentene lagres bare i denne appen.' : 'Forberedes lokalt; du sender selv i den offisielle tjenesten.'}</Paragraph>}
    {execution.type === 'email' && <><Alert data-color="info">Lokal testutboks. Ingen e-post sendes.</Alert><Paragraph>Til: {execution.to}</Paragraph><Heading level={2} data-size="xs">{execution.subject}</Heading><Paragraph className={styles.preservedText}>{execution.body}</Paragraph></>}
    {execution.type === 'form' && proposal.type === 'form' && <><dl className={styles.sourceList}>{proposal.fields.map(field => <div key={field.id}><dt>{field.label}</dt><dd className={styles.preservedText}>{execution.fields[field.id] ?? field.value}</dd></div>)}</dl><Paragraph data-size="sm">Ingen dokumentvedlegg sendes fra dette skjemaet.</Paragraph></>}
    {execution.type === 'reminder' && <><Heading level={2} data-size="xs">{execution.title}</Heading><Paragraph>{execution.date} {execution.time ?? ''} · Europe/Oslo</Paragraph><Paragraph className={styles.preservedText}>{execution.note}</Paragraph><Paragraph>Påminnelsen vises i denne appen når den forfaller.</Paragraph></>}
    {execution.type === 'contact' && <><Alert data-color="info">Legges i en lokal kø for menneskelig vurdering.</Alert><Paragraph className={styles.preservedText}>{execution.summary}</Paragraph></>}
  </CardBlock></Card>;
}

function FieldErrors({ errors, prefix }: { errors: Record<string, string>; prefix: string }) {
  const entries = Object.entries(errors).filter(([, message]) => message);
  if (!entries.length) return null;
  return <ErrorSummary role="alert"><ErrorSummary.Heading>Kontroller disse feltene</ErrorSummary.Heading><ErrorSummary.List>
    {entries.map(([key, message]) => <ErrorSummary.Item key={key}><ErrorSummary.Link href={`#${prefix}${key}`}>{message}</ErrorSummary.Link></ErrorSummary.Item>)}
  </ErrorSummary.List></ErrorSummary>;
}
