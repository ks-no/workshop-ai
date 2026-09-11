import type { Assessment } from './types';
import type { KsDemoConsent } from '../providers/ks-demo-client';

export const serviceIds = ['family', 'housing', 'moving'] as const;
export type ServiceId = typeof serviceIds[number];
export const modelRoles = ['triage', 'draft', 'critic', 'polish'] as const;
export type ModelRole = typeof modelRoles[number];
export const aiProviders = ['cloudflare', 'telenor', 'litellm'] as const;
export type AiProvider = typeof aiProviders[number];
export const factKeys = ['job_lost', 'has_children', 'uses_sfo', 'needs_housing', 'moving', 'household_income_annual', 'income_basis', 'monthly_rent', 'household_size', 'move_date', 'new_municipality', 'cohabitant_missing'] as const;
export type FactKey = typeof factKeys[number];
/** Tool catalogue ids. The model may only nominate these; Node validates, gates and executes. */
export const toolIds = ['read_guidance', 'ks_connect', 'ks_income', 'prepare_sfo_application'] as const;
export type ToolId = typeof toolIds[number];
export type PendingConsent = { toolId: ToolId; title: string; integration: string; purpose: string; serviceIds: ServiceId[]; requestedBy: 'model' | 'catalogue'; revision: number };
export type ApplicationField = { key: string; label: string; value: string | null; sourceId: string | null; status: 'filled' | 'missing' | 'review'; detail: string };
export type ApplicationDraft = { title: string; fields: ApplicationField[]; filled: number; note: string };
export type FormFlow = { formId: string; title: string; eligibility: 'unknown' | 'possible' | 'unlikely'; stage: 'screening' | 'consent' | 'collecting' | 'ready' | 'not-applicable'; missing: FactKey[]; questions: FollowUp[] };
export type Citation = { sourceId: string; quote: string; lineStart: number; lineEnd: number; page: number | null };
export type EvidenceSource = {
  id: string; kind: 'conversation' | 'document' | 'register' | 'guidance';
  title: string; text: string; url: string | null; retrievedAt: string;
  purpose: string; period: string; pages?: { page: number; text: string }[];
};
export type ProposedFact = { key: FactKey; value: string; sourceId: string; quote: string };
export type MemoryFact = {
  id: string; key: FactKey; value: string; label: string;
  status: 'proposed' | 'confirmed' | 'rejected' | 'superseded' | 'conflict';
  citation: Citation; createdAt: string; confirmedAt: string | null;
};
export type AssistantMessage = { language?: string; id: string; role: 'user' | 'assistant'; text: string; at: string; sourceId: string | null; sourceIds?: string[]; precomputed?: boolean };
export type FollowUp = { key: string; question: string; serviceIds: ServiceId[] };
export type StructuredAnswer = { key: FactKey; value: string; quote: string };
export type ModelPlan = { language?: string;
  intent?: 'information' | 'personalized';
  summary: string; services: { id: ServiceId; reason: string }[];
  facts: ProposedFact[]; questions: FollowUp[]; unsupported: string[];
  toolRequests?: { tool: ToolId; reason: string }[];
};
export type SpecialistOutput = {
  summary: string;
  findings: { text: string; sourceId: string; quote: string }[];
  questions: { key: string; question: string }[];
  nextAction?: { kind: ActionKind; reason: string };
};
export type ServiceCheck = { id: string; label: string; status: 'ready' | 'missing' | 'human'; detail: string; factKeys: FactKey[] };
export type ServiceResult = {
  id: ServiceId; title: string; reason: string;
  status: 'needs-information' | 'needs-review' | 'ready' | 'error';
  summary: string; checks: ServiceCheck[];
  findings: { text: string; citation: Citation }[];
  sourceIds: string[]; questions: FollowUp[];
  assessment: Assessment | null; error: string | null;
  applicationDraft?: ApplicationDraft | null;
  formFlow?: FormFlow | null;
  recommendedAction?: ActionRecommendation | null;
};
/** End actions the pipeline can resolve into. Node decides availability; the agent may only recommend. */
export const actionKinds = ['clarify', 'contact', 'email', 'form', 'self-service', 'summary'] as const;
export type ActionKind = typeof actionKinds[number];
export type ActionRecommendation = { kind: ActionKind; reason: string; by: 'agent' | 'rule' };
export type ContactPoint = {
  id: string; name: string; role: string; organisation: string;
  email: string | null; phone: string | null; url: string | null; hours: string | null; note: string;
};
export type NextAction = {
  id: string; kind: ActionKind; serviceId: ServiceId | null; title: string; detail: string;
  available: boolean; blockers: string[]; recommended: boolean; reason: string | null;
  contact: ContactPoint | null; url: string | null; done: boolean;
};
export type FormFieldKind = 'boolean' | 'number' | 'date' | 'select' | 'text' | 'textarea';
export type FormField = {
  id: string; label: string; kind: FormFieldKind; required: boolean; factKey: FactKey | null;
  value: string; origin: 'confirmed' | 'register' | 'citizen' | 'empty'; editable: boolean;
};
export type FormDraft = {
  id: string; formId: string; serviceId: ServiceId; title: string; recipient: ContactPoint; fields: FormField[];
  attachments: string[]; submission: 'ks-sandbox' | 'local'; revision: number; createdAt: string;
};
export type EmailDraft = { id: string; serviceId: ServiceId; to: ContactPoint; subject: string; body: string; revision: number; createdAt: string; aiDrafted: boolean };
export type Outcome = {
  id: string; kind: 'email' | 'form'; serviceId: ServiceId; createdAt: string; revision: number; reference: string;
  status: 'sent-to-mail-client' | 'submitted-to-ks-sandbox' | 'prepared-locally';
  recipient: ContactPoint; title: string; detail: string; localOnly: boolean;
  payload: { to?: string; subject?: string; body?: string; fields?: { id: string; label: string; value: string }[]; ksSoknadId?: string; ksOppgaveId?: string | null; ksWarning?: string | null };
};
export type AgentEvent = { id: string; runId: string; agent: string; type: 'started' | 'source-read' | 'completed' | 'failed' | 'human' | 'blocked' | 'tool-requested'; at: string; detail: string };
export type AgentRun = { id: string; agent: string; stage: ModelRole; revision: number; status: 'running' | 'completed' | 'failed'; startedAt: string; completedAt: string | null; model: string; durationMs: number | null; framework?: string };
export type CritiqueGap = { point: string; quote: string };
/** Full critic output per round. Never truncate for display; the UI shows all of it. */
export type CritiqueRound = { round: number; verdict: 'PASS' | 'REVISE'; gaps: CritiqueGap[]; notes: string; at: string };
export type Handoff = { id: string; createdAt: string; revision: number; serviceIds: ServiceId[]; localOnly: true; status: 'prepared-for-human-review' };
export type KsAccessDecision = { status: 'approved' | 'declined'; decidedAt: string };
export type AssistantCase = {
  language?: string;
  id: string; createdAt: string; updatedAt: string; expiresAt: string; revision: number;
  status: 'collecting' | 'analyzing' | 'awaiting-human' | 'ready' | 'handed-off' | 'error';
  messages: AssistantMessage[]; facts: MemoryFact[]; sources: EvidenceSource[];
  intent?: 'information' | 'personalized' | null;
  services: ServiceResult[]; questions: FollowUp[]; unsupported: string[];
  runs: AgentRun[]; events: AgentEvent[]; summary: string; critique: CritiqueRound[];
  /** Assembled answer as it stood before the critic ever saw it; for the naive-vs-godkjent demobryter (#7). */
  draftAnswer?: string | null;
  /** Set when a critic REVISE verdict was intentionally not acted on, see CRITIC_ALWAYS_PASS. */
  revisionSkipped?: boolean;
  analyzedRevision: number | null; handoff: Handoff | null; error: string | null;
  ksData: { personId: string; connectedAt: string; incomeReadAt: string | null; consent: KsDemoConsent | null } | null;
  ksAccessDecision?: KsAccessDecision | null;
  pendingConsents?: PendingConsent[];
  drafts?: { email: EmailDraft | null; form: FormDraft | null };
  outcomes?: Outcome[];
};
export type ModelStatus = { available: boolean; provider: AiProvider; model: string; models?: Record<ModelRole, string>; message: string };
export type AssistantResponse = { session: AssistantCase | null; model: ModelStatus };
/** SSE event names sent over the wire during analyzeCase; the UI maps each to a citizen-facing label. */
export const assistantStepNames = ['triage', 'draft', 'critic', 'revise', 'polish'] as const;
export type AssistantStepName = typeof assistantStepNames[number];
export type AssistantStreamEvent =
  | { event: AssistantStepName; data: Record<string, never> }
  | { event: 'critic-detail'; data: CritiqueRound }
  | { event: 'ferdig'; data: AssistantResponse }
  | { event: 'error'; data: { message: string } };
export type AssistantCommand =
  | { action: 'start' }
  | { action: 'message'; message: string; revision: number; caseId: string; forceDemoCache?: boolean }
  | { action: 'answers'; message: string; answers: StructuredAnswer[]; revision: number; caseId: string }
  | { action: 'analyze'; revision: number; caseId: string; forceDemoCache?: boolean }
  | { action: 'fact'; factId: string; decision: 'confirm' | 'reject'; revision: number; caseId: string }
  | { action: 'connect-ks'; revision: number; caseId: string }
  | { action: 'income-consent'; approved: true; revision: number; caseId: string }
  | { action: 'ks-access'; approved: boolean; revision: number; caseId: string }
  | { action: 'tool-consent'; toolIds: ToolId[]; approved: boolean; revision: number; caseId: string }
  | { action: 'handoff'; confirmed: true; revision: number; caseId: string }
  | { action: 'draft-email'; serviceId: ServiceId; revision: number; caseId: string }
  | { action: 'send-email'; serviceId: ServiceId; to: string; subject: string; body: string; revision: number; caseId: string }
  | { action: 'fill-form'; serviceId: ServiceId; revision: number; caseId: string }
  | { action: 'submit-form'; serviceId: ServiceId; fields: Record<string, string>; revision: number; caseId: string }
  | { action: 'discard-draft'; kind: 'email' | 'form'; revision: number; caseId: string };
