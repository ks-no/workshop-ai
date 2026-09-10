import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { runPythonRuntime, type AgentJob } from './assistant-runtime';
import { modelRoles } from '../domain/assistant-types';
import type { AssistantCase, AssistantMessage, CritiqueRound, EvidenceSource, MemoryFact, FollowUp, AgentRun, ModelRole, ServiceResult, StructuredAnswer, ServiceId } from '../domain/assistant-types';
import { FACT_LABELS, citationFor, validateProposal, narrativeWithinEvidence } from '../domain/assistant-verification';
import { SERVICE_CATALOGUE, guidanceSources, prepareService } from '../domain/service-catalogue';
import { applicationDraftFor, consentParagraph, modelVisibleTools, pendingConsentsFor } from '../domain/tool-catalogue';
import { FORM_CATALOGUE, formFlowFor, formFor, screenEligibility, stageParagraph } from '../domain/form-catalogue';
import { CaseError } from './case-service';
import { saveAssistantCase } from './assistant-store';
import { answerSchema, callModel, criticPrompt, criticSchema, draftRevisionPrompt, markModelSuccess, maxRevisions, modelName, planSchema, polishPrompt, TRIAGE_PROMPT, specialistPrompt, specialistSchema, responseLanguageName, type ModelCall } from './assistant-model';

type Persist = (session: AssistantCase) => void;
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
  session.intent = null; session.summary = ''; session.unsupported = []; session.error = null; session.status = 'collecting';
  session.critique = []; session.pendingConsents = [];
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
export async function decideFactAndContinue(session: AssistantCase, factId: string, decision: 'confirm' | 'reject', infer: ModelCall = callModel, persist: Persist = saveAssistantCase) {
  const outcome = decideFact(session, factId, decision);
  if (outcome.shouldReanalyze) await analyzeCase(session, infer, persist);
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
export async function analyzeCase(session: AssistantCase, infer: ModelCall = callModel, persist: Persist = saveAssistantCase) {
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
        if (role === 'triage') triageRun = item;
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
              questions: service.questions, assessment: service.assessment, sources } };
        });
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
        finish(agentRun);
        return null;
      }
      if (method === 'stage') {
        if (!answer) answer = assembledAnswer();
        const previous = data.id ? stageRuns.get(String(data.id)) : undefined;
        if (previous && typeof data.error === 'string') { finish(previous, data.error); nextStage = 'done'; }
        else if (previous) try {
          if (String(data.id) === 'critic') {
            const review = criticSchema.parse(data.output);
            if (infer === callModel) markModelSuccess();
            criticRound++;
            const round: CritiqueRound = { round: criticRound, verdict: review.verdict, gaps: review.gaps, notes: review.notes, at: new Date().toISOString() };
            session.critique.push(round);
            finish(previous);
            const revising = review.verdict === 'REVISE' && criticRound < maxRevisions();
            if (review.verdict === 'REVISE' && !revising) event(session, previous.id, 'Kritiker', 'blocked', `Kritikeren ba om endringer, men grensen på ${maxRevisions()} runder er nådd. Utkastet vises som det er.`);
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
    });
    if (session.revision !== revision) throw new CaseError('Opplysningene er endret. Kjør analysen på nytt.', 409);
    session.questions = mergeQuestions([...session.questions, ...session.services.flatMap(service => service.questions)], session);
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
  session.handoff = { id: `PLAN-${randomUUID().slice(0, 8).toUpperCase()}`, createdAt: new Date().toISOString(), revision: session.revision, serviceIds: session.services.map(service => service.id), localOnly: true, status: 'prepared-for-human-review' };
  session.status = 'handed-off';
  event(session, '', 'Innbygger', 'human', 'Gjeldende plan bekreftet. Lokal dokumentpakke opprettet for menneskelig oppfølging; ingenting sendt til kommunen.');
  return session;
}
export function handoffDocument(session: AssistantCase) {
  if (!session.handoff) throw new CaseError('Bekreft planen før du laster ned dokumentpakken.', 409);
  return { notice: 'Lokal demopakke. AI-forslag er kontrollert av innbygger, ikke verifisert av myndighet. Ingen søknad er sendt. Åpne spørsmål følger med.',
    ...session, services: session.services.map((service: ServiceResult) => ({ ...service, unresolved: service.checks.filter(check => check.status !== 'ready') })) };
}
