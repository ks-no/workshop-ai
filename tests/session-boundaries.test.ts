import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCase, deleteCase, getCase, CaseError } from '../src/server/case-service';

test('concurrent starts cannot exceed the 200-session capacity', async () => {
  const outcomes = await Promise.allSettled(Array.from({ length: 201 }, () => createCase('standard', true)));
  const created = outcomes.filter(outcome => outcome.status === 'fulfilled');
  try {
    assert.equal(created.length, 200);
    const rejected = outcomes.filter(outcome => outcome.status === 'rejected');
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0].reason instanceof CaseError);
    assert.equal(rejected[0].reason.status, 503);
  } finally { for (const outcome of created) deleteCase(outcome.value.id); }
});
test('expired sessions cannot be resumed or kept in the store', async () => {
  const session = await createCase('standard', true);
  session.expiresAt = Date.now() - 1;
  assert.throws(() => getCase(session.id), (error: unknown) => error instanceof CaseError && error.status === 401);
  assert.throws(() => getCase(session.id), /utløpt/);
});
