import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLOW_COMPONENTS, componentForStep, flowComponentIds } from '../src/domain/flow-components';
import { flowStepSchema } from '../src/server/flow-model';
import type { FlowStep } from '../src/domain/flow-types';

test('planner rejects executable markup and unregistered components at its strict boundary', () => {
  const output = { kind: 'done', title: 'Informasjon', message: 'Du kan kontakte kommunen.', rationale: 'Et generelt spørsmål.' };
  assert.equal(flowStepSchema.safeParse({ ...output, component: 'completion-summary' }).success, true);
  for (const extra of [{ component: 'custom-html' }, { html: '<script>alert(1)</script>' }, { onClick: 'execute()' }]) {
    assert.equal(flowStepSchema.safeParse({ ...output, ...extra }).success, false);
  }
  assert.deepEqual(FLOW_COMPONENTS.map(component => component.id), [...flowComponentIds]);
});

test('every supported action maps to its trusted component and missing proposals fail closed', () => {
  const resolve = (kind: FlowStep['kind'], type?: string) => componentForStep({ kind, proposal: type ? { type } as FlowStep['proposal'] : null });
  assert.equal(resolve('ask'), 'question-form');
  assert.equal(resolve('review'), 'evidence-review');
  assert.equal(resolve('done'), 'completion-summary');
  for (const [type, component] of [['email', 'email-draft'], ['form', 'application-draft'], ['reminder', 'reminder-editor'], ['contact', 'human-review']]) assert.equal(resolve('action', type), component);
  assert.throws(() => resolve('action'), /registered proposal/);
  assert.throws(() => resolve('action', 'custom'), /registered proposal/);
});
