import type { ContactPoint } from './assistant-types';
import type { FlowExecution, FlowOutcome, FlowProposal } from './flow-types';
export type ActionDraft = {
  id: string;
  stepId: string;
  revision: number;
  execution: FlowExecution;
  proposal: FlowProposal;
  createdAt: string;
  status: 'prepared' | 'superseded' | 'running' | 'completed' | 'uncertain';
};
export type ActionAttempt = {
  leaseExpiresAt?: string;
  ownerPid?: number;
  ownerHost?: string;
  id: string;
  draftId: string;
  status: 'running' | 'completed' | 'uncertain';
  createdAt: string;
  outcome: FlowOutcome | null;
  error: string | null;
};
export type MockEmail = {
  id: string;
  outcomeId: string;
  to: string;
  subject: string;
  body: string;
  status: 'mock-recorded';
  createdAt: string;
};
export type ReminderInput = { title: string; date: string; time: string | null; note: string };
export type FlowReminder = ReminderInput & {
  id: string;
  outcomeId: string;
  version: number;
  dueAt: string;
  timezone: 'Europe/Oslo';
  status: 'scheduled' | 'fired' | 'cancelled';
  createdAt: string;
};
export type FlowNotification = {
  id: string;
  reminderId: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
};
export type FlowReview = {
  id: string;
  outcomeId: string;
  title: string;
  summary: string;
  recipient: ContactPoint;
  status: 'queued' | 'in-progress' | 'resolved';
  reply: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type FlowActivity = {
  checklist?: ChecklistMark[];
  draft: ActionDraft | null;
  attempts: ActionAttempt[];
  outbox: MockEmail[];
  reminders: FlowReminder[];
  notifications: FlowNotification[];
  reviews: FlowReview[];
};
export type ChecklistMark = { id: string; key: string; checked: boolean; version: number; updatedAt: string };
