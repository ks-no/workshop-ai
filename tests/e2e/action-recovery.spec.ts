import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

test('uncertain action can be explicitly resolved without sending, then prepared with a new approval', async ({ page, context, baseURL }) => {
  const execution = { type: 'email' as const, to: 'test@example.org', subject: 'Test', body: 'Min forespørsel' };
  // Use the normal TS runtime for server fixtures; Playwright's transform does not load JSON modules.
  const fixture = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import { createFlowCase, saveFlowCase } from './src/server/flow-store.ts';
    import { chooseFlowAction } from './src/server/flow-service.ts';
    import { executeApprovedAction, prepareAction } from './src/server/flow-action-store.ts';
    const session = createFlowCase(); session.situation = 'Jeg trenger hjelp med en henvendelse.';
    chooseFlowAction(session, 'email'); saveFlowCase(session);
    const draft = prepareAction(session, ${JSON.stringify(execution)});
    await executeApprovedAction(session, draft.id, async () => { throw new Error('test dispatch interruption'); }, saveFlowCase).catch(() => {});
    console.log(JSON.stringify({ caseId: session.id, draftId: draft.id }));
  `], { encoding: 'utf8' }));
  try {
    await context.addCookies([{ name: 'sok-flow-session', value: fixture.caseId, url: baseURL!, httpOnly: true, sameSite: 'Strict' }]);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Avklar tidligere handling' })).toBeVisible();
    await page.getByText('Jeg har kontrollert at handlingen ikke ble registrert', { exact: true }).click();
    const unlock = page.getByRole('button', { name: 'Lagre avklaring og tillat nytt utkast' });
    await expect(unlock).toBeDisabled();
    await page.getByRole('textbox', { name: 'Hvordan kontrollerte du utfallet?' }).fill('Kontrollert testutboksen: ingen melding er registrert.');
    await page.getByRole('checkbox', { name: 'Jeg bekrefter at handlingen ikke ble registrert' }).check();
    await unlock.click();
    await expect(page.getByRole('heading', { name: 'Handlingen kan forberedes på nytt' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Handlingen kan forberedes på nytt' })).toBeVisible();
    const current = (await (await page.request.get('/api/flow')).json()).session;
    const prepared = await page.request.post('/api/flow', { data: { action: 'prepare', caseId: fixture.caseId, revision: current.revision, execution } });
    expect(prepared.ok()).toBe(true);
    const data = await prepared.json();
    expect(data.activity.draft.status).toBe('prepared');
    expect(data.activity.draft.id).not.toBe(fixture.draftId);
    expect(data.activity.outbox).toEqual([]);
  } finally {
    const { session } = await (await page.request.get('/api/flow')).json();
    if (session?.id === fixture.caseId) await page.request.delete('/api/flow', { data: { caseId: session.id, revision: session.revision } });
  }
});
