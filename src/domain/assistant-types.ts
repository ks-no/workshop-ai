import type { Assessment } from './types';
import type { KsDemoConsent } from '../providers/ks-demo-client';

export const serviceIds = ['family', 'housing', 'moving'] as const;
export type ServiceId = typeof serviceIds[number];
export const modelRoles = ['triage', 'draft', 'critic', 'polish'] as const;
export type ModelRole = typeof modelRoles[number];
export const aiProviders = ['cloudflare', 'telenor'] as const;
export type AiProvider = typeof aiProviders[number];
export const factKeys = ['job_lost', 'has_children', 'uses_sfo', 'needs_housing', 'moving', 'household_income_annual', 'income_basis', 'monthly_rent', 'household_size', 'move_date', 'new_municipality', 'cohabitant_missing'] as const;
export type FactKey = typeof factKeys[number];
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
export type AssistantMessage = { language?: string; id: string; role: 'user' | 'assistant'; text: string; at: string; sourceId: string | null; sourceIds?: string[] };
export type FollowUp = { key: string; question: string; serviceIds: ServiceId[] };
export type StructuredAnswer = { key: FactKey; value: string; quote: string };
export type ModelPlan = { language?: string;
  intent?: 'information' | 'personalized';
  summary: string; services: { id: ServiceId; reason: string }[];
  facts: ProposedFact[]; questions: FollowUp[]; unsupported: string[];
};
export type SpecialistOutput = {
  summary: string;
  findings: { text: string; sourceId: string; quote: string }[];
  questions: { key: string; question: string }[];
};
export type ServiceCheck = { id: string; label: string; status: 'ready' | 'missing' | 'human'; detail: string; factKeys: FactKey[] };
export type ServiceResult = {
  id: ServiceId; title: string; reason: string;
  status: 'needs-information' | 'needs-review' | 'ready' | 'error';
  summary: string; checks: ServiceCheck[];
  findings: { text: string; citation: Citation }[];
  sourceIds: string[]; questions: FollowUp[];
  assessment: Assessment | null; error: string | null;
};
export type AgentEvent = { id: string; runId: string; agent: string; type: 'started' | 'source-read' | 'completed' | 'failed' | 'human' | 'blocked'; at: string; detail: string };
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
  analyzedRevision: number | null; handoff: Handoff | null; error: string | null;
  ksData: { personId: string; connectedAt: string; incomeReadAt: string | null; consent: KsDemoConsent | null } | null;
  ksAccessDecision?: KsAccessDecision | null;
};
export type ModelStatus = { available: boolean; provider: AiProvider; model: string; models?: Record<ModelRole, string>; message: string };
export type AssistantResponse = { session: AssistantCase | null; model: ModelStatus };
export type AssistantCommand =
  | { action: 'start' }
  | { action: 'message'; message: string; revision: number; caseId: string }
  | { action: 'answers'; message: string; answers: StructuredAnswer[]; revision: number; caseId: string }
  | { action: 'analyze'; revision: number; caseId: string }
  | { action: 'fact'; factId: string; decision: 'confirm' | 'reject'; revision: number; caseId: string }
  | { action: 'connect-ks'; revision: number; caseId: string }
  | { action: 'income-consent'; approved: true; revision: number; caseId: string }
  | { action: 'ks-access'; approved: boolean; revision: number; caseId: string }
  | { action: 'handoff'; confirmed: true; revision: number; caseId: string };
