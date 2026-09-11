import type { ContactPoint, ModelStatus } from './assistant-types';
import type { KsDemoConsent } from '../providers/ks-demo-client';
import type { FlowComponentId } from './flow-components';
import type { FlowActivity } from './flow-action-types';

/**
 * The step-driven front-page flow ("Søk én gang"). A planner (AI model, with a rule-based
 * fallback) reads the whole case and proposes exactly one next step: ask for more
 * information, show what the case holds for correction and approval (optionally fetching
 * KS sources), propose a concrete end action, or conclude. Node validates every proposal
 * against the stored sources; the citizen approves before anything is executed.
 */
export const flowFetchables = ['husstand', 'inntekt', 'sfo'] as const;
export type FlowFetchable = typeof flowFetchables[number];
export const flowFieldKinds = ['text', 'number', 'date', 'boolean', 'select', 'textarea'] as const;
export type FlowFieldKind = typeof flowFieldKinds[number];
export const flowStepKinds = ['ask', 'review', 'action', 'done'] as const;
export type FlowStepKind = typeof flowStepKinds[number];
export const flowActionTypes = ['email', 'form', 'reminder', 'contact'] as const;
export type FlowActionType = typeof flowActionTypes[number];

export type FlowSource = {
  id: string; kind: 'situation' | 'answers' | 'note' | 'document' | 'register';
  title: string; text: string; at: string; pages?: { page: number; text: string }[];
};
/** A fact is open-ended (any key/label) but always carries its origin. Only the citizen or a register makes it confirmed. */
export type FlowFact = {
  id: string; key: string; label: string; value: string;
  origin: 'citizen' | 'document' | 'ks';
  status: 'proposed' | 'confirmed' | 'rejected' | 'superseded';
  sourceId: string | null; quote: string | null; detail: string; createdAt: string;
};
export type FlowQuestion = { key: string; label: string; kind: FlowFieldKind; hint: string | null; options: string[]; required: boolean };
export type FlowFormField = {
  id: string; label: string; kind: FlowFieldKind; required: boolean; value: string;
  origin: 'confirmed' | 'register' | 'suggested' | 'empty'; editable: boolean; factId: string | null;
};
export type FlowProposal =
  | { type: 'email'; contact: ContactPoint; subject: string; body: string; aiDrafted: boolean }
  | { type: 'form'; templateId: string; title: string; recipient: ContactPoint; submission: 'ks-sandbox' | 'local'; fields: FlowFormField[]; attachments: string[] }
  | { type: 'reminder'; title: string; date: string; time: string | null; note: string }
  | { type: 'contact'; contact: ContactPoint; reason: string; summary?: string };
export type FlowStep = {
  component?: FlowComponentId;
  id: string; kind: FlowStepKind; title: string; message: string; rationale: string;
  by: 'model' | 'rule'; model: string | null; createdAt: string; revision: number; durationMs: number;
  /** ask */ questions: FlowQuestion[];
  /** review */ factIds: string[]; fetch: FlowFetchable[]; next: string | null;
  /** action */ proposal: FlowProposal | null;
};
export type FlowOutcome = {
  status?: 'mocked' | 'prepared' | 'submitted' | 'scheduled' | 'queued';
  resourceId?: string;
  id: string; kind: FlowActionType; title: string; reference: string; detail: string; createdAt: string; revision: number;
  localOnly: boolean; recipient: ContactPoint | null;
  payload: {
    to?: string; subject?: string; body?: string;
    fields?: { id: string; label: string; value: string }[]; ksSoknadId?: string; ksOppgaveId?: string | null; ksWarning?: string | null;
    date?: string; time?: string | null; note?: string;
  };
};
export type FlowEvent = { id: string; at: string; agent: string; type: 'started' | 'completed' | 'failed' | 'blocked' | 'human' | 'source-read'; detail: string };
export type FlowHistoryEntry = { kind: FlowStepKind; title: string; by: 'model' | 'rule'; result: string; at: string };
export type FlowCase = {
  id: string; createdAt: string; updatedAt: string; expiresAt: string; revision: number;
  status: 'collecting' | 'thinking' | 'step' | 'acted' | 'error';
  situation: string; sources: FlowSource[]; facts: FlowFact[]; skipped: string[];
  step: FlowStep | null; history: FlowHistoryEntry[]; outcomes: FlowOutcome[]; events: FlowEvent[];
  error: string | null; notice: string | null; stepCount: number;
  ks: { personId: string | null; fetched: FlowFetchable[]; declined: FlowFetchable[]; fetchedAt: string | null; consent: KsDemoConsent | null };
};
export type FlowResponse = { session: FlowCase | null; model: ModelStatus; activity?: FlowActivity };
export type FlowExecution =
  | { type: 'email'; to: string; subject: string; body: string }
  | { type: 'form'; fields: Record<string, string> }
  | { type: 'reminder'; title: string; date: string; time: string | null; note: string }
  | { type: 'contact'; summary?: string };
export type FlowCommand =
  | { action: 'start' }
  | { action: 'input'; text: string; revision: number; caseId: string }
  | { action: 'answers'; answers: { key: string; value: string }[]; note: string; revision: number; caseId: string }
  | { action: 'approve'; facts: { id: string; value: string }[]; remove: string[]; fetch: FlowFetchable[]; note: string; revision: number; caseId: string }
  | { action: 'prepare'; execution: FlowExecution; revision: number; caseId: string }
  | { action: 'execute'; draftId: string; revision: number; caseId: string }
  | { action: 'choose'; type: FlowActionType; templateId?: string; revision: number; caseId: string }
  | { action: 'review-facts'; revision: number; caseId: string }
  | { action: 'skip'; revision: number; caseId: string }
  | { action: 'continue'; revision: number; caseId: string }
  | { action: 'retry'; revision: number; caseId: string };
