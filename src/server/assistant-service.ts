import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { runPythonRuntime, type AgentJob } from './assistant-runtime';
import { modelRoles } from '../domain/assistant-types';
import type { AssistantCase, AssistantMessage, AssistantStepName, CritiqueRound, EvidenceSource, MemoryFact, FollowUp, AgentRun, ModelRole, ServiceResult, StructuredAnswer, ServiceId, Outcome } from '../domain/assistant-types';
import { FACT_LABELS, citationFor, validateProposal, narrativeWithinEvidence } from '../domain/assistant-verification';
import { SERVICE_CATALOGUE, guidanceSources, prepareService } from '../domain/service-catalogue';
import { applicationDraftFor, consentParagraph, modelVisibleTools, pendingConsentsFor } from '../domain/tool-catalogue';
import { FORM_CATALOGUE, formFlowFor, formFor, screenEligibility, stageParagraph } from '../domain/form-catalogue';
import { allowedActionKinds, buildFormDraft, citizenNarrative, contactFor, emailEvidence, fallbackEmailDraft, missingFormFields, normalizeRecommendation, openItemsForRecipient, resolveNextActions, ruleRecommendation, unresolvedFacts } from '../domain/assistant-actions';
import { CaseError } from './case-service';
import { saveAssistantCase } from './assistant-store';
import { submitKsApplication } from './assistant-ks';
import { emailPrompt, emailSchema, answerSchema, callModel, criticAlwaysPass, criticPrompt, criticSchema, draftRevisionPrompt, markModelSuccess, maxRevisions, modelName, planSchema, polishPrompt, TRIAGE_PROMPT, specialistPrompt, specialistSchema, responseLanguageName, type ModelCall } from './assistant-model';
import { democacheTimeoutMs, lookupDemocache, type DemocacheEntry } from './assistant-democache';
import { ksPersonId } from './ks-runtime';
import { walletCredentialPackage } from './wallet-credential';

type Persist = (session: AssistantCase) => void;
/** Live step visibility for the SSE route; the polling-based JSON path passes no hooks. */
export type AnalyzeHooks = { onStep?: (step: AssistantStepName) => void; onCritique?: (round: CritiqueRound) => void; signal?: AbortSignal; forceDemoCache?: boolean };
const STRUCTURED_ANSWER_PURPOSE = 'Direkte svar fra strukturert spørsmålsskjema; lagret som innbyggerens eget valg.';
const MODEL_SECURITY = { integrity: 'untrusted', confidentiality: 'private', allowedCapabilities: ['analyze'] } as const;

/** Reduce model-visible evidence to public guidance and exact quotes already tied to relevant facts. */
function minimalModelSources(session: AssistantCase, sourceIds: Set<string>, facts: MemoryFact[]) {
  return session.sources.flatMap(source => {
    if (!sourceIds.has(source.id)) return [];
    const text = source.kind === 'guidance'
      ? source.text
      : [...new Set(facts.filter(fact => fact.citation.sourceId === source.id).map(fact => fact.citation.quote))].join('\n');
    if (!text) return [];
    return [{ id: source.id, kind: source.kind, title: source.title, text }];
  });
}
export function invalidateAnalysis(session: AssistantCase) {
  session.revision++; session.analyzedRevision = null; session.services = []; session.questions = [];
  session.intent = null; session.summary = ''; session.unsupported = []; session.error = null; session.status = 'collecting'; session.pendingConsents = [];
  // Drafts belong to one analysed revision. Executed outcomes are history and stay.
  session.drafts = { email: null, form: null };
  session.outcomes ??= [];
  session.critique = []; session.draftAnswer = null; session.revisionSkipped = false;
}
function event(session: AssistantCase, runId: string, agent: string, type: AssistantCase['events'][number]['type'], detail: string) {
  session.events.push({ id: randomUUID(), runId, agent, type, at: new Date().toISOString(), detail });
}
export function addMessage(session: AssistantCase, message: string) {
  if (session.sources.length >= 80) throw new CaseError('Samtalen har nådd kildegrensen. Lagre planen og start en ny samtale.', 413);
  invalidateAnalysis(session);
  const now = new Date().toISOString();
  const sourceId = `message-${randomUUID()}`;
  session.sources.push({ id: sourceId, kind: 'conversation', title: `Din beskrivelse ${session.messages.filter(item => item.role === 'user').length + 1}`,
    text: message, url: null, retrievedAt: now, purpose: 'Forstå behov og foreslå opplysninger du selv kontrollerer.', period: 'Oppgitt i denne samtalen.' });
  session.messages.push({ id: randomUUID(), role: 'user', text: message, at: now, sourceId });
}
export function addConfirmedAnswers(session: AssistantCase, message: string, answers: StructuredAnswer[]) {
  addMessage(session, message);
  const source = session.sources.at(-1)!;
  source.purpose = STRUCTURED_ANSWER_PURPOSE;
  const seen = new Set<string>();
  for (const answer of answers) {
    if (seen.has(answer.key)) throw new CaseError('Det samme spørsmålet kan bare besvares én gang per innsending.');
    seen.add(answer.key);
    const valid = validateProposal({ key: answer.key, value: answer.value, sourceId: source.id, quote: answer.quote }, [source]);
    if (!valid) throw new CaseError('Et svar hadde ugyldig format eller manglet i den lagrede teksten. Kontroller feltet og prøv igjen.');
    session.facts.filter(item => item.key === answer.key && !['rejected', 'superseded'].includes(item.status)).forEach(item => { item.status = 'superseded'; });
    session.facts.push({ id: randomUUID(), key: answer.key, value: valid.value, label: FACT_LABELS[answer.key], status: 'confirmed', citation: valid.citation, createdAt: new Date().toISOString(), confirmedAt: new Date().toISOString() });
    event(session, '', 'Innbygger', 'human', `${FACT_LABELS[answer.key]}: bekreftet direkte i spørsmålsskjemaet.`);
  }
}
function localizedNotice(language: string | undefined, kind: 'summary' | 'reason') {
  const notices: Record<string, Record<typeof kind, string>> = {
    nb: { summary: 'Kontroller forslagene og kildene i oversikten. Demoen kan bare forberede en sak for videre hjelp.', reason: 'Mulig relevant spor. Kontroller om det passer situasjonen din.' },
    en: { summary: 'Review the proposals and sources in your overview. This demo can only prepare a case for further assistance.', reason: 'This service may be relevant. Check whether it fits your situation.' },
    vi: { summary: 'Hãy kiểm tra các đề xuất và nguồn trong hồ sơ. Bản demo chỉ chuẩn bị hồ sơ để bạn nhận hỗ trợ tiếp theo.', reason: 'Dịch vụ này có thể phù hợp. Hãy kiểm tra xem có đúng với hoàn cảnh của bạn không.' },
  };
  return (notices[language?.split('-')[0] || 'nb'] || notices.nb)[kind];
}
function explicitServiceHints(message: string): ServiceId[] {
  const normalized = message.toLocaleLowerCase();
  const hints: ServiceId[] = [];
  if (/\b(sfo|skolefritidsordning|foreldrebetaling|after[- ]school)\b/u.test(normalized)) hints.push('family');
  if (/\b(bolig|bostøtte|husleie|boutgift|housing|rent)\b/u.test(normalized)) hints.push('housing');
  if (/\b(flytt\w*|adresseendring|move|moving|relocat\w*)\b/u.test(normalized)) hints.push('moving');
  return hints;
}
function refreshConflicts(session: AssistantCase, key: MemoryFact['key']) {
  const active = session.facts.filter(item => item.key === key && !['rejected', 'superseded'].includes(item.status));
  const conflict = new Set(active.map(item => item.value)).size > 1;
  active.filter(item => item.status !== 'confirmed').forEach(item => { item.status = conflict ? 'conflict' : 'proposed'; });
}
export function decideFact(session: AssistantCase, factId: string, decision: 'confirm' | 'reject') {
  const fact = session.facts.find(item => item.id === factId);
  if (!fact || !['proposed', 'conflict'].includes(fact.status)) throw new CaseError('Forslaget finnes ikke eller er allerede behandlet.', 409);
  invalidateAnalysis(session);
  if (decision === 'confirm') {
    session.facts.filter(item => item.key === fact.key && item.id !== fact.id && !['rejected', 'superseded'].includes(item.status)).forEach(item => { item.status = 'superseded'; });
    fact.status = 'confirmed'; fact.confirmedAt = new Date().toISOString();
  } else fact.status = 'rejected';
  refreshConflicts(session, fact.key);
  const shouldReanalyze = !session.facts.some(item => ['proposed', 'conflict'].includes(item.status));
  event(session, '', 'Innbygger', 'human', `${fact.label}: ${decision === 'confirm' ? 'bekreftet' : 'avvist'}. Tidligere analyse er ugyldig.`);
  return { shouldReanalyze };
}
export async function decideFactAndContinue(session: AssistantCase, factId: string, decision: 'confirm' | 'reject', infer: ModelCall = callModel, persist: Persist = saveAssistantCase, hooks: AnalyzeHooks = {}) {
  const outcome = decideFact(session, factId, decision);
  if (outcome.shouldReanalyze) await analyzeCase(session, infer, persist, hooks);
  return outcome;
}
export function addDocument(session: AssistantCase, source: EvidenceSource) {
  if (session.sources.filter(item => item.kind === 'document').length >= 4 || session.sources.length >= 80) throw new CaseError('Du kan legge til inntil fire dokumenter per samtale.', 413);
  invalidateAnalysis(session); session.sources.push(source);
  session.messages.push({ id: randomUUID(), role: 'user', text: `La til dokumentet «${source.title}». Kontroller innholdet før det brukes.`, at: source.retrievedAt, sourceId: source.id });
}
function mergeQuestions(questions: FollowUp[], session: AssistantCase): FollowUp[] {
  const byKey = new Map<string, FollowUp>();
  const confirmed = new Set(session.facts.filter(fact => fact.status === 'confirmed').map(fact => fact.key));
  for (const question of questions) {
    if (confirmed.has(question.key as MemoryFact['key']) && question.key !== 'income_basis') continue;
    if (question.key === 'income_basis' && session.facts.some(fact => fact.key === 'income_basis' && fact.status === 'confirmed' && fact.value === 'household_year')) continue;
    const existing = byKey.get(question.key);
    if (existing) existing.serviceIds = [...new Set([...existing.serviceIds, ...question.serviceIds])];
    else byKey.set(question.key, { ...question });
  }
  return [...byKey.values()].slice(0, 8);
}
const stageLabels: Record<ModelRole, string> = { triage: 'Triage', draft: 'Utkast', critic: 'Kritiker', polish: 'Språkvask' };
function stageRole(value: unknown): ModelRole {
  return modelRoles.includes(value as ModelRole) ? value as ModelRole : 'draft';
}
/** The revised draft and the polish step share answerSchema, so the job id decides here, not the role. */
function jobSchema(id: string, role: ModelRole) {
  if (id === 'critic') return criticSchema;
  if (id === 'draft-revision' || id === 'polish') return answerSchema;
  return role === 'triage' ? planSchema : specialistSchema;
}
/**
 * Democachen er sikkerhetsnettet fra issue #12: et forhåndsberegnet svar for standardsaken
 * (person-022, sfo-moderasjon), lagret som fil, aldri generert på demodagen. Oppslaget skjer
 * her, før Python-runtimen i det hele tatt spawnes, og treffer kun på en eksakt hash av
 * normalisert henvendelse pluss KS_PERSON_ID — alt annet går til levende modell som før.
 */
export async function analyzeCase(session: AssistantCase, infer: ModelCall = callModel, persist: Persist = saveAssistantCase, hooks: AnalyzeHooks = {}) {
  const latestUser = [...session.messages].reverse().find(message => message.role === 'user');
  const entry = latestUser ? lookupDemocache(latestUser.text, ksPersonId()) : null;
  if (entry && hooks.forceDemoCache) {
    applyDemocacheAnswer(session, entry, 'manual');
    persist(session);
    return session;
  }
  if (!entry) return runLiveAnalysis(session, infer, persist, hooks);
  // Et cache-treff finnes: gi den levende modellen et forsøk, men kutt den av ved terskelen.
  // runLiveAnalysis kaster aldri (den fanger alt internt), så det holder å vente på den ferdig
  // avbrutt og se om resultatet ble en feil.
  const controller = new AbortController();
  const upstream = hooks.signal;
  if (upstream) {
    if (upstream.aborted) controller.abort();
    else upstream.addEventListener('abort', () => controller.abort(), { once: true });
  }
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, democacheTimeoutMs());
  try { await runLiveAnalysis(session, infer, persist, { ...hooks, signal: controller.signal }); }
  finally { clearTimeout(timer); }
  // Brukeren avbrøt selv (f.eks. lukket fanen) uten at vår terskel eller en modellfeil var årsaken:
  // ikke lat som en cache traff når ingenting egentlig feilet mot Cloudflare.
  if (session.status !== 'error' || (upstream?.aborted && !timedOut)) return session;
  applyDemocacheAnswer(session, entry, timedOut ? 'auto-timeout' : 'auto-error');
  persist(session);
  return session;
}
type DemocacheTrigger = 'manual' | 'auto-timeout' | 'auto-error';
/** Sjekklisten bygges av de faktiske sesjonsfaktaene som før; kun oppsummering og sluttsvar er forhåndsberegnet. */
function applyDemocacheAnswer(session: AssistantCase, entry: DemocacheEntry, trigger: DemocacheTrigger) {
  session.language = entry.language;
  const definition = SERVICE_CATALOGUE.find(item => item.id === entry.serviceId)!;
  const snapshots = guidanceSources();
  for (const sourceId of definition.sourceIds) {
    if (!session.sources.some(source => source.id === sourceId)) session.sources.push(snapshots.find(source => source.id === sourceId)!);
  }
  const service = prepareService(entry.serviceId, session, entry.reason);
  service.summary = entry.serviceSummary;
  session.services = [service];
  session.summary = entry.summary;
  session.intent = 'personalized';
  session.questions = mergeQuestions(service.questions, session);
  session.analyzedRevision = session.revision;
  session.status = session.facts.some(fact => ['proposed', 'conflict'].includes(fact.status)) ? 'awaiting-human' : 'ready';
  session.error = null;
  const detail = trigger === 'manual' ? 'Forhåndsberegnet svar hentet manuelt med hurtigtasten.'
    : `Sikkerhetsnettet brukte det forhåndsberegnede svaret fordi modellkallet ${trigger === 'auto-timeout' ? 'passerte tidsgrensen' : 'feilet'} mot Cloudflare.`;
  event(session, '', 'Sikkerhetsnett', 'completed', detail);
  session.messages.push({ id: randomUUID(), role: 'assistant', language: entry.language, text: entry.answer, at: new Date().toISOString(), sourceId: null, sourceIds: [...service.sourceIds], precomputed: true });
}
async function runLiveAnalysis(session: AssistantCase, infer: ModelCall = callModel, persist: Persist = saveAssistantCase, hooks: AnalyzeHooks = {}) {
  invalidateAnalysis(session);
  const revision = session.revision;
  session.status = 'analyzing'; session.error = null; session.analyzedRevision = null; session.services = [];
  const run = (agent: string, stage: ModelRole): AgentRun => {
    const value: AgentRun = { id: randomUUID(), agent, stage, revision, status: 'running', startedAt: new Date().toISOString(), completedAt: null, model: modelName(stage), durationMs: null, framework: 'Microsoft Agent Framework 1.17.0 · Python' };
    session.runs.push(value); event(session, value.id, agent, 'started', 'Modellanalysen er startet.'); persist(session); return value;
  };
  const finish = (item: AgentRun, error?: string) => {
    item.status = error ? 'failed' : 'completed'; item.completedAt = new Date().toISOString(); item.durationMs = Date.now() - Date.parse(item.startedAt);
    event(session, item.id, item.agent, error ? 'failed' : 'completed', error || 'Strukturert svar mottatt og kontrollert.'); persist(session);
  };
  let triageRun: AgentRun | undefined;
  const running = new Map<string, AgentRun>();
  const visibleSources = new Map<string, { id: string; kind: string; title: string; text: string }[]>();
  let latestUser: AssistantMessage | undefined;
  // Critic/polish tail state. The host owns stage order and the bound; Python only executes jobs.
  const stageRuns = new Map<string, AgentRun>();
  let answer = '';
  let criticRound = 0;
  let nextStage: 'critic' | 'revise' | 'polish' | 'done' = 'critic';
  const assembledAnswer = () => session.intent === 'information' && session.services.length
    ? session.services.map(service => service.summary).filter(Boolean).join('\n\n') || session.summary
    : session.summary;
  const tailSources = () => [...new Map([...visibleSources.values()].flat().map(source => [source.id, source])).values()];
  // The drafted answer counts as evidence for the tail: rewording grounded text must pass,
  // introducing an ungrounded number must not. Each service summary was already checked.
  const tailEvidence = () => [...tailSources().map(source => source.text), assembledAnswer()].join('\n');
  const nextStageJob = (): AgentJob | null => {
    if (nextStage === 'done' || !session.services.length || !answer) return null;
    hooks.onStep?.(nextStage);
    const language = session.language || 'nb';
    const review = session.critique.at(-1) ?? null;
    const stage: ModelRole = nextStage === 'revise' ? 'draft' : nextStage;
    const id = nextStage === 'revise' ? 'draft-revision' : nextStage;
    const item = run(nextStage === 'revise' ? 'Utkast etter kritikk' : stageLabels[stage], stage);
    stageRuns.set(id, item);
    return { id, name: item.agent, role: stage, model: modelName(stage),
      prompt: nextStage === 'critic' ? criticPrompt(language) : nextStage === 'revise' ? draftRevisionPrompt(language) : polishPrompt(language),
      schema: z.toJSONSchema(nextStage === 'critic' ? criticSchema : answerSchema),
      context: { _security: MODEL_SECURITY, responseLanguage: responseLanguageName(language), intent: session.intent,
        citizenQuestion: latestUser?.text || '', draft: answer, review,
        openQuestions: session.questions.map(({ key, question }) => ({ key, question })), sources: tailSources() } };
  };
  try {
    const evidence = session.sources.filter(source => ['conversation', 'document'].includes(source.kind)).slice(-12);
    const context = {
      _security: MODEL_SECURITY,
      currentLanguage: session.language || 'nb', today: new Date().toISOString().slice(0, 10), catalogue: SERVICE_CATALOGUE,
      conversation: session.messages.slice(-12),
      memory: session.facts.slice(-80).map(({ key, value, status, citation }) => ({ key, value, status, sourceId: citation.sourceId })),
      sources: evidence.map(({ id, title, text, kind }) => ({ id, title, kind, text: text.slice(0, 14000) })),
      ksDataAvailable: !!session.ksData,
      tools: modelVisibleTools('coordinator', session),
    };
    const triage: AgentJob = { id: 'triage', name: 'Triage', role: 'triage', model: modelName('triage'),
      prompt: TRIAGE_PROMPT, context, schema: z.toJSONSchema(planSchema) };
    await runPythonRuntime({ mode: 'workflow', triage, hostModels: infer !== callModel }, async (method, data) => {
      if (method === 'model') {
        if (infer === callModel) throw new Error('Unexpected host model request');
        const role = stageRole(data.role);
        try { return { output: await infer<unknown>(String(data.prompt), data.context, jobSchema(String(data.id), role), role) }; }
        catch (error) { return { error: error instanceof Error ? error.message : 'Model failed' }; }
      }
      if (method === 'started') {
        const role = stageRole(data.role);
        const item = run(String(data.name), role);
        running.set(String(data.id), item);
        if (role === 'triage') { triageRun = item; hooks.onStep?.('triage'); }
        return null;
      }
      if (method === 'prepare') {
        if (!triageRun) throw new Error('Triage did not start');
        const plan = planSchema.parse(data.output);
        if (infer === callModel) markModelSuccess();
        if (session.revision !== revision) throw new CaseError('Opplysningene er endret. Kjør analysen på nytt.', 409);
        for (const proposed of plan.facts) {
          if (session.facts.length >= 160) { event(session, triageRun.id, 'Kontroll', 'blocked', 'Grensen for lagrede opplysninger er nådd.'); break; }
          if (!evidence.some(source => source.id === proposed.sourceId)) continue;
          const valid = validateProposal(proposed, evidence);
          if (!valid) { event(session, triageRun.id, 'Kontroll', 'blocked', 'Et AI-forslag manglet en gyldig kilde eller entydig verdi og ble utelatt.'); continue; }
          const proposalSource = evidence.find(source => source.id === proposed.sourceId);
          if (proposalSource?.purpose === STRUCTURED_ANSWER_PURPOSE && session.facts.some(fact => fact.key === proposed.key && fact.status === 'confirmed' && fact.citation.sourceId === proposed.sourceId)) continue;
          if (session.facts.some(fact => fact.key === proposed.key && fact.value === valid.value && (['confirmed', 'proposed', 'conflict'].includes(fact.status) || fact.citation.sourceId === proposed.sourceId))) continue;
          session.facts.push({ id: randomUUID(), key: proposed.key, value: valid.value, label: FACT_LABELS[proposed.key], status: 'proposed', citation: valid.citation, createdAt: new Date().toISOString(), confirmedAt: null });
          refreshConflicts(session, proposed.key);
        }
        session.language = plan.language === 'no' ? 'nb' : plan.language;
        session.intent = plan.intent || 'personalized';
        latestUser = [...session.messages].reverse().find(message => message.role === 'user' && evidence.some(source => source.id === message.sourceId && source.kind === 'conversation'));
        if (latestUser) latestUser.language = session.language;
        const triageEvidence = evidence.map(source => source.text).join('\n');
        if (!narrativeWithinEvidence(plan.summary, triageEvidence, session.language)) {
          event(session, triageRun.id, 'Kontroll', 'blocked', 'En KI-oppsummering med ubekreftede tall eller påstand om vedtak/innsending ble utelatt.');
          plan.summary = localizedNotice(session.language, 'summary');
        }
        plan.services = plan.services.map(service => ({ ...service, reason: narrativeWithinEvidence(service.reason, triageEvidence, session.language) ? service.reason : localizedNotice(session.language, 'reason') }));
        session.summary = plan.summary; session.unsupported = plan.unsupported;
        session.questions = mergeQuestions(plan.questions, session);
        finish(triageRun);
        let selected = [...new Map(plan.services.map(service => [service.id, service])).values()];
        if (!selected.length && latestUser) {
          selected = explicitServiceHints(latestUser.text).map(id => ({ id, reason: localizedNotice(session.language, 'reason') }));
          if (selected.length) event(session, triageRun.id, 'Ruting', 'completed', 'Et tydelig tjenesteord i spørsmålet sikret at riktig fagagent ble startet.');
        }
        // Form catalogue: facts that make a form possible pull in its service, so eligibility can be screened.
        const latestText = latestUser?.text ?? '';
        if (session.intent === 'personalized') for (const form of FORM_CATALOGUE) {
          if (selected.some(service => service.id === form.serviceId) || screenEligibility(session, form, latestText).eligibility !== 'possible') continue;
          selected.push({ id: form.serviceId, reason: localizedNotice(session.language, 'reason') });
          event(session, triageRun.id, 'Ruting', 'completed', `Opplysninger i samtalen tyder på at ${form.title.nb} kan være aktuelt. Tjenesten ble lagt til for vurdering.`);
        }
        const snapshots = guidanceSources();
        for (const service of selected) {
          const definition = SERVICE_CATALOGUE.find(item => item.id === service.id)!;
          for (const sourceId of definition.sourceIds) {
            if (!session.sources.some(source => source.id === sourceId)) session.sources.push(snapshots.find(source => source.id === sourceId)!);
            event(session, triageRun.id, 'Kildeverktøy', 'source-read', `Leste kontrollert veiledningsutdrag: ${sourceId}. Ikke et live registeroppslag.`);
          }
        }
        session.services = selected.map(service => prepareService(service.id, session, service.reason));
        if (session.intent === 'information') session.services.forEach(service => { service.status = 'ready'; service.checks = []; service.questions = []; service.assessment = null; });
        // Tool catalogue: the model nominates tools; Node decides which consents to ask for. Nothing runs here.
        const requested = (plan.toolRequests ?? []).map(request => request.tool);
        // Eligibility screen: a form whose screening facts are unknown asks first; consent is only requested when the form is possible.
        for (const service of session.services) {
          const form = formFor(service.id);
          if (!form || session.intent !== 'personalized') { service.formFlow = null; continue; }
          const screen = screenEligibility(session, form, latestText);
          service.formFlow = { formId: form.id, title: form.title.nb, eligibility: screen.eligibility, stage: 'screening', missing: [], questions: screen.questions };
          if (screen.questions.length) session.questions = mergeQuestions([...screen.questions, ...session.questions], session);
          event(session, triageRun.id, 'Skjemakatalog', 'completed', `${form.title.nb}: ${screen.eligibility === 'possible' ? 'kan være aktuelt; ber om samtykke til å hente opplysninger' : screen.eligibility === 'unknown' ? 'uavklart; spør innbyggeren før noe hentes' : 'ikke aktuelt ut fra oppgitte opplysninger'}.`);
        }
        const eligible = selected.map(service => service.id).filter(id => { const flow = session.services.find(service => service.id === id)?.formFlow; return !flow || flow.eligibility === 'possible'; });
        const resolved = pendingConsentsFor(session, eligible, requested, revision);
        session.pendingConsents = resolved.consents;
        for (const consent of resolved.consents) event(session, triageRun.id, 'Verktøykatalog', 'tool-requested', `${consent.title} (${consent.integration}): ${consent.requestedBy === 'model' ? 'koordinatoren ba om verktøyet' : 'katalogen krever verktøyet for valgt tjeneste'}. Venter på samtykke; ingenting er hentet.`);
        for (const toolId of resolved.ignored) event(session, triageRun.id, 'Kontroll', 'blocked', `Verktøyforespørselen «${toolId}» ble ikke tilbudt: ikke knyttet til en valgt tjeneste, feil hensikt eller allerede avslått.`);
        persist(session);
        const jobs: AgentJob[] = selected.map(selectedService => {
          const definition = SERVICE_CATALOGUE.find(item => item.id === selectedService.id)!;
          const service = session.services.find(item => item.id === selectedService.id)!;
          const facts = session.facts.filter(fact => definition.requiredFacts.includes(fact.key) && ['confirmed', 'proposed', 'conflict'].includes(fact.status));
          const sourceIds = new Set([...service.sourceIds, ...facts.map(fact => fact.citation.sourceId)]);
          // Specialists see public guidance plus exact cited fact excerpts. Register snapshots stay server-side.
          const sources = minimalModelSources(session, sourceIds, facts);
          visibleSources.set(service.id, sources);
          return { id: service.id, name: definition.title, role: 'draft', model: modelName('draft'),
            prompt: specialistPrompt(definition.title, session.language || 'nb'), schema: z.toJSONSchema(specialistSchema),
            context: { _security: MODEL_SECURITY, responseLanguage: responseLanguageName(session.language), intent: session.intent,
              citizenQuestion: session.intent === 'information' ? latestUser?.text || '' : '', service: definition, reason: selectedService.reason,
              facts: facts.map(({ key, value, status }) => ({ key, value, status })), checks: service.checks,
              questions: service.questions, assessment: service.assessment, sources, allowedActions: allowedActionKinds(session, service) } };
        });
        if (jobs.length) hooks.onStep?.('draft');
        return { jobs };
      }
      if (method === 'specialist') {
        const service = session.services.find(item => item.id === data.id);
        const agentRun = running.get(String(data.id));
        if (!service || !agentRun) throw new Error('Unknown specialist');
        if (typeof data.error === 'string') {
          service.status = 'error'; service.error = data.error; finish(agentRun, data.error); return null;
        }
        const output = specialistSchema.parse(data.output);
        if (infer === callModel) markModelSuccess();
        const sources = visibleSources.get(service.id) || [];
        if (narrativeWithinEvidence(output.summary, sources.map(source => source.text).join('\n'), session.language)) service.summary = output.summary;
        else {
          service.summary = localizedNotice(session.language, 'summary');
          event(session, agentRun.id, 'Kontroll', 'blocked', 'En KI-oppsummering med ubekreftede tall eller påstand om vedtak/innsending ble utelatt. Se den faste sjekklisten.');
        }
        for (const finding of output.findings) {
          const visible = sources.find(source => source.id === finding.sourceId);
          const source = session.sources.find(item => item.id === finding.sourceId);
          const citation = visible?.text.includes(finding.quote) && source ? citationFor(source, finding.quote) : null;
          if (citation && narrativeWithinEvidence(finding.text, finding.quote, session.language)) service.findings.push({ text: finding.text, citation });
          else event(session, agentRun.id, 'Kontroll', 'blocked', 'En spesialistpåstand manglet eksakt kilde og ble utelatt.');
        }
        service.questions = mergeQuestions([...output.questions.filter(question => service.checks.some(check => check.status !== 'ready' && check.factKeys.includes(question.key as MemoryFact['key']))).map(question => ({ ...question, serviceIds: [service.id] })), ...service.questions], session);
        // The agent recommends an end action; Node keeps only kinds the service can actually offer.
        const reasonAccepted = !!output.nextAction && narrativeWithinEvidence(output.nextAction.reason, sources.map(source => source.text).join('\n'), session.language);
        service.recommendedAction = normalizeRecommendation(session, service, output.nextAction, reasonAccepted);
        if (output.nextAction && service.recommendedAction.by === 'rule') event(session, agentRun.id, 'Kontroll', 'blocked', 'Spesialisten anbefalte en handling tjenesten ikke kan tilby. Regelbasert neste steg brukes i stedet.');
        else if (output.nextAction) event(session, agentRun.id, service.id, 'completed', `Anbefalt neste steg: ${service.recommendedAction.kind}.`);
        finish(agentRun);
        return null;
      }
      if (method === 'stage') {
        if (!answer) { answer = assembledAnswer(); session.draftAnswer = answer; }
        const previous = data.id ? stageRuns.get(String(data.id)) : undefined;
        if (previous && typeof data.error === 'string') { finish(previous, data.error); nextStage = 'done'; }
        else if (previous) try {
          if (String(data.id) === 'critic') {
            const review = criticSchema.parse(data.output);
            if (infer === callModel) markModelSuccess();
            criticRound++;
            const round: CritiqueRound = { round: criticRound, verdict: review.verdict, gaps: review.gaps, notes: review.notes, at: new Date().toISOString() };
            session.critique.push(round);
            hooks.onCritique?.(round);
            finish(previous);
            const forcedPass = review.verdict === 'REVISE' && criticAlwaysPass();
            if (forcedPass) { session.revisionSkipped = true; event(session, previous.id, 'Kritiker', 'blocked', 'CRITIC_ALWAYS_PASS er på: kritikken vises, men revisjonsrunden hoppes over.'); }
            const revising = !forcedPass && review.verdict === 'REVISE' && criticRound < maxRevisions();
            if (review.verdict === 'REVISE' && !revising && !forcedPass) event(session, previous.id, 'Kritiker', 'blocked', `Kritikeren ba om endringer, men grensen på ${maxRevisions()} runder er nådd. Utkastet vises som det er.`);
            nextStage = revising ? 'revise' : 'polish';
          } else {
            const rewritten = answerSchema.parse(data.output);
            if (infer === callModel) markModelSuccess();
            if (narrativeWithinEvidence(rewritten.answer, tailEvidence(), session.language)) answer = rewritten.answer;
            else event(session, previous.id, 'Kontroll', 'blocked', 'Et omskrevet svar innførte tall eller påstander uten kilde og ble forkastet. Forrige versjon beholdes.');
            finish(previous);
            nextStage = String(data.id) === 'polish' ? 'done' : 'critic';
          }
        } catch {
          // The draft is already grounded and checked. A malformed review ends the tail
          // instead of failing an analysis that is otherwise complete.
          finish(previous, 'Kvalitetskontrollen kunne ikke leses. Utkastet vises uten språkvask.');
          nextStage = 'done';
        }
        const job = nextStageJob();
        return job ? { job } : null;
      }
      throw new Error('Unknown workflow request');
    }, hooks.signal);
    if (session.revision !== revision) throw new CaseError('Opplysningene er endret. Kjør analysen på nytt.', 409);
    session.questions = mergeQuestions([...session.questions, ...session.services.flatMap(service => service.questions)], session);
    for (const service of session.services) service.recommendedAction ??= ruleRecommendation(session, service);
    session.analyzedRevision = revision;
    const pending = session.facts.some(fact => ['proposed', 'conflict'].includes(fact.status));
    session.status = session.services.some(service => service.status === 'error') ? 'error' : pending || !session.services.length ? 'awaiting-human' : 'ready';
    session.error = session.status === 'error' ? 'En spesialist kunne ikke fullføre. De andre resultatene er bevart. Prøv analysen på nytt.' : null;
    for (const service of session.services) {
      service.applicationDraft = session.intent === 'personalized' ? applicationDraftFor(service.id, session) : null;
      if (service.applicationDraft?.filled) event(session, '', 'Verktøykatalog', 'completed', `Fylte ut «${service.applicationDraft.title}»: ${service.applicationDraft.filled} av ${service.applicationDraft.fields.length} felt fra bekreftede opplysninger og hentede kilder. Ingenting er sendt.`);
    }
    for (const service of session.services) {
      if (!service.formFlow) continue;
      service.formFlow = formFlowFor(service, session, service.formFlow.eligibility);
      if (service.formFlow?.stage === 'collecting') session.questions = mergeQuestions([...session.questions, ...service.formFlow.questions], session);
    }
    const formService = session.services.find(service => service.formFlow);
    const consentAsk = formService?.formFlow
      ? stageParagraph(formService.formFlow, formService, session, session.pendingConsents ?? [], session.language || 'nb')
      : consentParagraph(session.pendingConsents ?? [], session.language || 'nb');
    const finalAnswer = (answer || assembledAnswer()) + (consentAsk ? `\n\n${consentAsk}` : '');
    const answerSourceIds = session.intent === 'information'
      ? session.services.flatMap(service => service.sourceIds)
      : [...evidence.map(source => source.id), ...session.facts.map(fact => fact.citation.sourceId)];
    session.messages.push({ id: randomUUID(), role: 'assistant', language: session.language || 'nb', text: finalAnswer, at: new Date().toISOString(), sourceId: null, sourceIds: [...new Set(answerSourceIds)] });
    persist(session);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Analysen kunne ikke fullføres.';
    for (const item of [...running.values(), ...stageRuns.values()]) if (item.status === 'running') finish(item, message);
    session.status = 'error'; session.error = message; session.analyzedRevision = null; persist(session);
  }
  return session;
}

export function prepareHandoff(session: AssistantCase, confirmed: boolean) {
  if (session.handoff) return session;
  if (!confirmed || session.analyzedRevision !== session.revision || !session.services.length || session.status === 'analyzing' || session.services.some(item => ['error', 'needs-information'].includes(item.status)) || session.facts.some(fact => ['proposed', 'conflict'].includes(fact.status))) {
    throw new CaseError('Kontroller alle forslag og oppdater planen før du bekrefter overleveringen.', 409);
  }
  session.handoff = { id: `PLAN-${randomUUID().slice(0, 8).toUpperCase()}`, createdAt: new Date().toISOString(), revision: session.revision, serviceIds: session.services.map(service => service.id), localOnly: true, status: 'prepared-for-human-review', credential: walletCredentialPackage(session) };
  session.status = 'handed-off';
  event(session, '', 'Innbygger', 'human', 'Gjeldende plan bekreftet. Lokal dokumentpakke opprettet for menneskelig oppfølging; ingenting sendt til kommunen.');
  return session;
}
export function handoffDocument(session: AssistantCase) {
  if (!session.handoff) throw new CaseError('Bekreft planen før du laster ned dokumentpakken.', 409);
  return { notice: 'Lokal demopakke. AI-forslag er kontrollert av innbygger, ikke verifisert av myndighet. Ingen søknad er sendt til en virkelig kommune. Utførte handlinger og åpne spørsmål følger med.',
    ...session, outcomes: session.outcomes ?? [], nextActions: resolveNextActions(session),
    services: session.services.map((service: ServiceResult) => ({ ...service, unresolved: service.checks.filter(check => check.status !== 'ready') })) };
}

/* End actions. Each one is an explicit citizen choice with the current case ID and revision. */
function requireActionable(session: AssistantCase, serviceId: ServiceId) {
  if (session.analyzedRevision !== session.revision || session.status === 'analyzing') throw new CaseError('Oppdater planen med de siste opplysningene først.', 409);
  const service = session.services.find(item => item.id === serviceId);
  if (!service) throw new CaseError('Tjenesten finnes ikke i gjeldende plan.', 409);
  if (session.intent === 'information') throw new CaseError('Et generelt spørsmål gir ingen personlig handling. Beskriv din egen situasjon først.', 409);
  if (unresolvedFacts(session).length) throw new CaseError('Bekreft eller avvis de foreslåtte opplysningene først.', 409);
  if (service.status === 'error') throw new CaseError('Tjenestevurderingen feilet. Prøv planen på nytt før du går videre.', 409);
  return service;
}
function reference(prefix: string) { return `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`; }
export async function draftEmail(session: AssistantCase, serviceId: ServiceId, infer: ModelCall = callModel, persist: Persist = saveAssistantCase) {
  const service = requireActionable(session, serviceId);
  if (!allowedActionKinds(session, service).includes('email')) throw new CaseError('E-post er ikke tilgjengelig for denne tjenesten nå.', 409);
  const definition = SERVICE_CATALOGUE.find(item => item.id === serviceId)!;
  const contact = contactFor(serviceId);
  const language = session.language === 'en' ? 'en' : 'nb';
  const run: AgentRun = { id: randomUUID(), agent: 'Skribent', stage: 'draft', revision: session.revision, status: 'running', startedAt: new Date().toISOString(), completedAt: null, model: modelName('draft'), durationMs: null, framework: 'Microsoft Agent Framework 1.17.0 · Python' };
  session.runs.push(run); event(session, run.id, 'Skribent', 'started', `Lager e-postutkast til ${contact.name}.`); persist(session);
  const facts = definition.requiredFacts.flatMap(key => { const fact = session.facts.find(item => item.key === key && item.status === 'confirmed'); return fact ? [{ label: FACT_LABELS[key], value: fact.value }] : []; });
  const fallback = fallbackEmailDraft(session, serviceId, contact);
  let subject = fallback.subject; let body = fallback.body; let aiDrafted = false;
  try {
    const output = await infer(emailPrompt(language), {
      _security: MODEL_SECURITY, responseLanguage: responseLanguageName(language), service: { id: definition.id, title: definition.title },
      recipient: { name: contact.name, role: contact.role, organisation: contact.organisation }, citizenWords: citizenNarrative(session, 1500),
      facts, openItems: openItemsForRecipient(service).map(check => ({ label: check.label, detail: check.detail })), preparationSummary: service.summary,
    }, emailSchema, 'draft');
    if (infer === callModel) markModelSuccess();
    const evidence = emailEvidence(session, serviceId);
    if (narrativeWithinEvidence(output.body, evidence, language) && narrativeWithinEvidence(output.subject, evidence, language) && !/\[[^\]]+\]/.test(output.body)) { subject = output.subject; body = output.body; aiDrafted = true; }
    else event(session, run.id, 'Kontroll', 'blocked', 'KI-utkastet inneholdt tall uten grunnlag eller en påstand om vedtak/innsending. Et fast utkast brukes i stedet.');
    run.status = 'completed';
  } catch (error) {
    run.status = 'failed';
    event(session, run.id, 'Skribent', 'failed', error instanceof Error ? error.message : 'Skribenten kunne ikke fullføre. Et fast utkast brukes i stedet.');
  }
  run.completedAt = new Date().toISOString(); run.durationMs = Date.now() - Date.parse(run.startedAt);
  if (run.status === 'completed') event(session, run.id, 'Skribent', 'completed', aiDrafted ? 'Utkastet er kontrollert mot bekreftede opplysninger. Innbyggeren leser over og sender selv.' : 'Et fast utkast fra bekreftede opplysninger er klart.');
  session.drafts ??= { email: null, form: null };
  session.drafts.email = { id: randomUUID(), serviceId, to: contact, subject, body, revision: session.revision, createdAt: new Date().toISOString(), aiDrafted };
  persist(session);
  return session.drafts.email;
}
export function sendEmail(session: AssistantCase, serviceId: ServiceId, input: { to: string; subject: string; body: string }): Outcome {
  const draft = session.drafts?.email;
  if (!draft || draft.serviceId !== serviceId || draft.revision !== session.revision) throw new CaseError('Lag et e-postutkast for gjeldende plan først.', 409);
  requireActionable(session, serviceId);
  const to = input.to.trim(); const subject = input.subject.trim(); const body = input.body.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || to.length > 200) throw new CaseError('Oppgi én gyldig e-postadresse til mottakeren.');
  if (!subject || subject.length > 160 || !body || body.length > 4000) throw new CaseError('E-posten må ha et emne og en tekst på inntil 4000 tegn.');
  const outcome: Outcome = { id: randomUUID(), kind: 'email', serviceId, createdAt: new Date().toISOString(), revision: session.revision, reference: reference('EPOST'),
    status: 'sent-to-mail-client', recipient: draft.to, title: subject, localOnly: true,
    detail: 'E-posten er lest gjennom av deg og overlevert til ditt e-postprogram. Selve sendingen skjer der.', payload: { to, subject, body } };
  (session.outcomes ??= []).push(outcome);
  session.drafts!.email = null;
  event(session, '', 'Innbygger', 'human', `E-post til ${draft.to.name} godkjent og overlevert til e-postprogrammet (${outcome.reference}).`);
  return outcome;
}
export function fillForm(session: AssistantCase, serviceId: ServiceId) {
  const service = requireActionable(session, serviceId);
  if (!allowedActionKinds(session, service).includes('form')) throw new CaseError('Det finnes ikke et skjema for denne tjenesten.', 409);
  const draft = buildFormDraft(session, serviceId, new Date().toISOString(), randomUUID());
  if (!draft) throw new CaseError('Det finnes ikke et skjema for denne tjenesten.', 409);
  const missing = missingFormFields(draft);
  if (missing.length) throw new CaseError(`Skjemaet mangler bekreftede opplysninger: ${missing.map(field => field.label).join(', ')}. Svar på spørsmålene først.`, 409);
  session.drafts ??= { email: null, form: null };
  session.drafts.form = draft;
  event(session, '', 'Skjemaverktøy', 'completed', `Fylte ut «${draft.title}» fra ${draft.fields.filter(field => field.origin !== 'empty').length} bekreftede opplysninger. Ingen verdi er beregnet eller antatt.`);
  return draft;
}
export async function submitForm(session: AssistantCase, serviceId: ServiceId, fields: Record<string, string>, submit: typeof submitKsApplication = submitKsApplication): Promise<Outcome> {
  const draft = session.drafts?.form;
  if (!draft || draft.serviceId !== serviceId || draft.revision !== session.revision) throw new CaseError('Fyll ut skjemaet for gjeldende plan først.', 409);
  requireActionable(session, serviceId);
  if (Object.keys(fields).some(id => !draft.fields.some(field => field.id === id))) throw new CaseError('Skjemaet inneholdt et ukjent felt.');
  const filled = draft.fields.map(field => {
    const value = (fields[field.id] ?? field.value).trim();
    if (!field.editable && value !== field.value) throw new CaseError(`«${field.label}» er en bekreftet opplysning. Rett den i oversikten, så oppdateres skjemaet.`, 409);
    if (field.required && !value) throw new CaseError(`«${field.label}» må fylles ut.`);
    if (value.length > 1000) throw new CaseError(`«${field.label}» kan ha høyst 1000 tegn.`);
    return { id: field.id, label: field.label, value };
  });
  let outcome: Outcome;
  if (draft.submission === 'ks-sandbox') {
    const receipt = await submit(session, draft);
    outcome = { id: randomUUID(), kind: 'form', serviceId, createdAt: new Date().toISOString(), revision: session.revision, reference: receipt.soknadId,
      status: 'submitted-to-ks-sandbox', recipient: draft.recipient, title: draft.title, localOnly: false,
      detail: receipt.oppgaveId ? 'Testsøknaden er registrert i KS-sandkassen, og en saksbehandleroppgave er opprettet i Fiks-simulatoren.' : 'Testsøknaden er registrert i KS-sandkassen. Saksbehandleroppgaven kunne ikke opprettes.',
      payload: { fields: filled, ksSoknadId: receipt.soknadId, ksOppgaveId: receipt.oppgaveId, ksWarning: receipt.advarsel } };
  } else {
    outcome = { id: randomUUID(), kind: 'form', serviceId, createdAt: new Date().toISOString(), revision: session.revision, reference: reference('SKJEMA'),
      status: 'prepared-locally', recipient: draft.recipient, title: draft.title, localOnly: true,
      detail: `Skjemaet er kontrollert av deg og klargjort lokalt. Selve innsendingen gjør du i ${draft.recipient.name}.`, payload: { fields: filled } };
  }
  (session.outcomes ??= []).push(outcome);
  session.drafts!.form = null;
  event(session, '', 'Innbygger', 'human', `«${draft.title}» kontrollert og ${outcome.localOnly ? 'klargjort lokalt' : 'sendt inn til KS-sandkassen'} (${outcome.reference}).`);
  return outcome;
}
export function discardDraft(session: AssistantCase, kind: 'email' | 'form') {
  session.drafts ??= { email: null, form: null };
  if (!session.drafts[kind]) throw new CaseError('Det finnes ikke noe utkast å forkaste.', 409);
  session.drafts[kind] = null;
  event(session, '', 'Innbygger', 'human', kind === 'email' ? 'E-postutkastet ble forkastet uten å sendes.' : 'Skjemautkastet ble forkastet uten å sendes.');
}
