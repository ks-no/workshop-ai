import type { FlowStep } from './flow-types';

/** Model-selectable UI capabilities. Data is rendered by trusted React components. */
export const flowComponentIds = ['question-form', 'evidence-review', 'email-draft', 'application-draft', 'reminder-editor', 'human-review', 'completion-summary'] as const;
export type FlowComponentId = typeof flowComponentIds[number];
export const FLOW_COMPONENTS = [
  { id: 'question-form', kind: 'ask', purpose: 'Collect missing information with typed fields.' },
  { id: 'evidence-review', kind: 'review', purpose: 'Correct cited facts and approve specific data access.' },
  { id: 'email-draft', kind: 'action', action: 'email', purpose: 'Edit and approve a message for the mock outbox. No email is sent.' },
  { id: 'application-draft', kind: 'action', action: 'form', purpose: 'Review a registered application template and its actual submission destination.' },
  { id: 'reminder-editor', kind: 'action', action: 'reminder', purpose: 'Schedule a durable in-app reminder in Europe/Oslo.' },
  { id: 'human-review', kind: 'action', action: 'contact', purpose: 'Approve an exact summary for the local human review queue.' },
  { id: 'completion-summary', kind: 'done', purpose: 'Answer or summarise results without requiring an action.' },
] as const;

export function componentForStep(step: Pick<FlowStep, 'kind' | 'proposal'>): FlowComponentId {
  if (step.kind === 'ask') return 'question-form';
  if (step.kind === 'review') return 'evidence-review';
  if (step.kind === 'done') return 'completion-summary';
  switch (step.proposal?.type) {
    case 'email': return 'email-draft';
    case 'form': return 'application-draft';
    case 'reminder': return 'reminder-editor';
    case 'contact': return 'human-review';
    default: throw new Error('Action step requires a registered proposal');
  }
}
