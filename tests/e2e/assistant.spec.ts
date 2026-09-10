import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AssistantResponse } from '../../src/domain/assistant-types';

async function snapshot(page: Page): Promise<AssistantResponse> {
  const response = await page.request.get('/api/assistant');
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function noAccessibilityErrors(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(result.violations, JSON.stringify(result.violations, null, 2)).toEqual([]);
}

function expectRecordedRoleModels(response: AssistantResponse) {
  expect(response.model.models).toBeDefined();
  const models = response.model.models!;
  const runs = response.session?.runs ?? [];
  const coordinators = runs.filter(run => run.agent === 'Koordinator');
  const specialists = runs.filter(run => run.agent !== 'Koordinator');
  expect(coordinators.length, response.session?.error || 'The coordinator must have a recorded run.').toBeGreaterThan(0);
  expect(specialists.length, response.session?.error || 'At least one specialist must have a recorded run.').toBeGreaterThan(0);
  for (const run of coordinators) expect(run.model, 'Recorded coordinator model must match its configured role.').toBe(models.coordinator);
  for (const run of specialists) expect(run.model, `Recorded ${run.agent} model must match the specialist role.`).toBe(models.specialist);
}

function twoPagePdf(firstPage: string, secondPage: string, metadataMarker: string): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  [firstPage, secondPage].forEach((text, index) => {
    const contentId = 5 + index * 2;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    const stream = `BT /F1 12 Tf 50 750 Td (${text.replace(/([\\()])/g, '\\$1')}) Tj ET`;
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });
  // This PDF comment is deliberately absent from the document's visible text.
  let document = `%PDF-1.4\n%${metadataMarker}\n`;
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(document);
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(document);
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  document += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(document);
}

test('citizen assistant starts with an honest connection state and no invented case', async ({ page }) => {
  const remoteRequests: string[] = [];
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:3210/')) remoteRequests.push(request.url()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Hva kan vi hjelpe deg med?' })).toBeVisible();
  const initial = await snapshot(page);
  expect(initial.session).toBeNull();
  if (!initial.model.available) await expect(page.getByRole('button', { name: 'Send melding', exact: true })).toBeDisabled();
  await expect(page.locator('.assistant-message')).toHaveCount(0);
  await expect(page.getByText('Du trenger ikke velge tjeneste.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /SFO|Bolig og økonomi|Flytting/ })).toHaveCount(0);
  await expect(page.getByLabel('Hva er situasjonen din?')).toHaveValue('');
  expect((await snapshot(page)).session).toBeNull();
  await page.getByRole('button', { name: 'Legg ved dokument' }).click();
  await expect(page.getByLabel('Velg et dokument')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Last opp og analyser' })).toBeDisabled();
  if (initial.model.available) {
    await page.getByLabel('Hva er situasjonen din?').fill('');
    await page.getByRole('button', { name: 'Send melding', exact: true }).click();
    await expect(page.locator('#assistant-message-input-error')).toContainText('Skriv hva du trenger hjelp med.');
  }
  await noAccessibilityErrors(page);
  expect(remoteRequests, 'Fonts and icons must load locally, including field errors.').toEqual([]);
});

test('a real API case resumes and can be explicitly deleted', async ({ page }) => {
  await page.goto('/');
  expect((await snapshot(page)).session).toBeNull();
  const started = await page.request.post('/api/assistant', { data: { action: 'start' } });
  expect(started.ok()).toBe(true);
  const state = (await started.json() as AssistantResponse).session!;
  await page.reload();
  await expect(page.getByRole('button', { name: 'Avslutt og slett', exact: true })).toBeVisible();
  expect((await snapshot(page)).session?.id).toBe(state.id);
  await page.getByRole('button', { name: 'Avslutt og slett', exact: true }).click();
  await page.getByRole('button', { name: 'Behold saken' }).click();
  expect((await snapshot(page)).session?.id).toBe(state.id);
  await page.getByRole('button', { name: 'Avslutt og slett', exact: true }).click();
  await page.getByRole('button', { name: 'Slett saken', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Samtalen, opplysningene og dokumentene er slettet.' })).toBeVisible();
  expect((await snapshot(page)).session).toBeNull();
  await expect(page.getByRole('button', { name: 'Avslutt og slett', exact: true })).toHaveCount(0);
});

test('mobile conversation and shared case remain usable at 375 pixels', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Hva kan vi hjelpe deg med?' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Samtale' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Din oversikt' }).click();
  await expect(page.getByRole('heading', { name: 'Din felles oversikt' })).toBeVisible();
  await expect(page.getByLabel('Hva er situasjonen din?')).toBeHidden();
  await noAccessibilityErrors(page);
  await page.getByRole('tab', { name: 'Samtale' }).click();
  await expect(page.getByLabel('Hva er situasjonen din?')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await noAccessibilityErrors(page);
});

test('a stale tab cannot delete a replacement case with the same revision', async ({ page, context }) => {
  async function startCase(target: Page) {
    const response = await target.request.post('/api/assistant', { data: { action: 'start' } });
    expect(response.ok()).toBe(true);
    await target.reload();
    await expect(target.getByRole('button', { name: 'Avslutt og slett', exact: true })).toBeVisible();
  }
  await page.goto('/');
  await startCase(page);
  const previous = (await snapshot(page)).session!;
  const other = await context.newPage();
  await other.goto('/');
  await other.getByRole('button', { name: 'Avslutt og slett', exact: true }).click();
  await other.getByRole('button', { name: 'Slett saken', exact: true }).click();
  await expect(other.getByRole('status').filter({ hasText: 'Samtalen, opplysningene og dokumentene er slettet.' })).toBeVisible();
  await startCase(other);
  const replacement = (await snapshot(other)).session!;
  expect(replacement.id).not.toBe(previous.id);
  expect(replacement.revision).toBe(previous.revision);
  await page.getByRole('button', { name: 'Avslutt og slett', exact: true }).click();
  await page.getByRole('button', { name: 'Slett saken', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Last inn aktiv sak' })).toBeVisible();
  expect((await snapshot(other)).session?.id).toBe(replacement.id);
  await page.getByRole('button', { name: 'Last inn aktiv sak' }).click();
  await expect(page.getByRole('button', { name: 'Avslutt og slett', exact: true })).toBeVisible();
  expect((await snapshot(page)).session?.id).toBe(replacement.id);
  await other.close();
});

test('real model document flow shares confirmed memory and creates an explicit local packet', async ({ page }) => {
  test.skip(process.env.ASSISTANT_LIVE_E2E !== '1', 'Opt in to a real configured model with ASSISTANT_LIVE_E2E=1; no browser-side AI simulation.');
  test.setTimeout(420000);
  await page.goto('/');
  await expect(page.getByText('Språkmodellen er konfigurert', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Legg ved dokument' }).click();
  await page.getByLabel('Velg et dokument').setInputFiles({ name: 'test-situasjon.txt', mimeType: 'text/plain', buffer: Buffer.from('Dette er testopplysninger. Jeg har barn og bruker SFO. Jeg har mistet jobben og trenger hjelp med boligutgifter. Hele husholdningens samlede årsinntekt er 320000 kroner. Husleien er 12000 kroner per måned. Vi er 3 personer i husholdningen. Jeg har ingen samboer som mangler i oversikten. Jeg skal flytte til Bergen 2026-11-01.') });
  await page.getByRole('button', { name: 'Last opp og analyser' }).click();
  await expect(page.getByText('Dokumentet er lagt til som kilde.', { exact: false })).toBeVisible({ timeout: 200000 });
  let response = await snapshot(page);
  expectRecordedRoleModels(response);
  let state = response.session!;
  expect(state.sources.some(source => source.kind === 'document' && source.text.includes('320000'))).toBe(true);
  expect(state.runs.some(run => run.status === 'completed')).toBe(true);
  expect(state.services.map(service => service.id).sort()).toEqual(['family', 'housing', 'moving']);
  const proposals = state.facts.filter(fact => fact.status === 'proposed' || fact.status === 'conflict');
  expect(proposals.length).toBeGreaterThan(0);
  await page.locator('.assistant-fact').first().locator('.assistant-evidence > summary').click();
  await expect(page.locator('.assistant-fact').first()).toContainText('linje');
  await expect(page.locator('.assistant-fact').first().locator('blockquote')).not.toBeEmpty();
  for (const [index, fact] of proposals.entries()) {
    await page.locator('.assistant-fact').filter({ has: page.getByRole('heading', { name: fact.label, exact: true }) }).getByRole('button', { name: /^Bekreft / }).click();
    if (index === proposals.length - 1) await expect(page.getByRole('button', { name: 'Send melding', exact: true })).toBeEnabled({ timeout: 200000 });
    else await expect.poll(async () => (await snapshot(page)).session?.facts.find(item => item.id === fact.id)?.status).toBe('confirmed');
  }
  response = await snapshot(page);
  expectRecordedRoleModels(response);
  state = response.session!;
  expect(state.analyzedRevision).toBe(state.revision);
  expect(state.services.map(service => service.id).sort()).toEqual(['family', 'housing', 'moving']);
  expect(state.services.filter(service => service.checks.some(check => check.factKeys.includes('household_income_annual'))).length).toBeGreaterThanOrEqual(1);
  expect(state.facts.filter(fact => fact.key === 'household_income_annual' && fact.status === 'confirmed')).toHaveLength(1);
  expect(state.facts.some(fact => fact.status === 'proposed' || fact.status === 'conflict')).toBe(false);
  await expect(page.getByRole('button', { name: 'Bekreft og klargjør' })).toBeDisabled();
  await page.getByLabel('Jeg har sett over opplysningene og det som gjenstår, og vil klargjøre saksgrunnlaget lokalt.').check();
  await page.getByRole('button', { name: 'Bekreft og klargjør' }).click();
  await expect(page.getByRole('heading', { name: 'Saken er klargjort lokalt' })).toBeVisible();
  await noAccessibilityErrors(page);
  await page.screenshot({ path: test.info().outputPath('assistant-completed-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('tab', { name: 'Din oversikt' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await noAccessibilityErrors(page);
  await page.screenshot({ path: test.info().outputPath('assistant-completed-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  const downloaded = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Last ned saksgrunnlag (JSON)' }).click();
  const path = await (await downloaded).path();
  expect(path).not.toBeNull();
  const packet = JSON.parse(await readFile(path!, 'utf8'));
  expect(packet.handoff.localOnly).toBe(true);
  expect(packet.handoff.revision).toBe(state.revision);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Saken er klargjort lokalt' })).toBeVisible();
});

test('real two-page PDF keeps page-two evidence without storing original bytes', async ({ page }) => {
  test.skip(process.env.ASSISTANT_LIVE_E2E !== '1', 'Opt in to the real configured model with ASSISTANT_LIVE_E2E=1.');
  test.setTimeout(420000);
  const metadataMarker = 'PDF_ORIGINAL_BYTES_ONLY_METADATA_SENTINEL';
  const pdf = twoPagePdf('This is a synthetic test case. I am moving.', 'My move date is 2026-12-04. My new municipality is Trondheim.', metadataMarker);
  await page.goto('/');
  await expect(page.getByText('Språkmodellen er konfigurert', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Legg ved dokument' }).click();
  await page.getByLabel('Velg et dokument').setInputFiles({ name: 'test-moving-two-pages.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.getByRole('button', { name: 'Last opp og analyser' }).click();
  await expect(page.getByText('Dokumentet er lagt til som kilde.', { exact: false })).toBeVisible({ timeout: 200000 });
  let response = await snapshot(page);
  expectRecordedRoleModels(response);
  let state = response.session!;
  expect(state.error).toBeNull();
  expect(state.services.map(service => service.id)).toEqual(['moving']);
  const source = state.sources.find(item => item.kind === 'document' && item.title === 'test-moving-two-pages.pdf')!;
  expect(source.pages).toHaveLength(2);
  expect(source.pages![1]).toMatchObject({ page: 2 });
  expect(source.pages![1].text).toContain('My move date is 2026-12-04.');
  const dateFact = state.facts.find(fact => fact.key === 'move_date' && fact.citation.sourceId === source.id)!;
  expect(dateFact.value).toBe('2026-12-04');
  expect(dateFact.citation).toMatchObject({ page: 2, lineStart: 1 });
  const dateRow = page.locator('.assistant-fact').filter({ has: page.getByRole('heading', { name: dateFact.label, exact: true }) });
  await dateRow.locator('.assistant-evidence > summary').click();
  await expect(dateRow).toContainText('Side 2, linje 1');
  await expect(dateRow.locator('blockquote')).toContainText('2026-12-04');
  await expect(dateRow).toContainText('Opplastet dokument');
  await page.reload();
  await expect(page.getByRole('heading', { name: dateFact.label, exact: true })).toBeVisible();
  state = (await snapshot(page)).session!;
  const database = new DatabaseSync(resolve(process.env.ASSISTANT_DATA_DIR || '.data', 'assistant.sqlite'), { readOnly: true });
  try {
    const row = database.prepare('SELECT body FROM cases WHERE id = ?').get(state.id) as { body: string };
    expect(row.body.includes(metadataMarker)).toBe(false);
    expect(row.body.includes(pdf.toString('base64'))).toBe(false);
    const persisted = JSON.parse(row.body) as NonNullable<AssistantResponse['session']>;
    const persistedSource = persisted.sources.find(item => item.id === source.id)!;
    expect(Object.keys(persistedSource).sort()).toEqual(['id', 'kind', 'pages', 'period', 'purpose', 'retrievedAt', 'text', 'title', 'url']);
    expect(persistedSource.pages?.[1].text).toContain('2026-12-04');
    expect(persistedSource.text.includes('%PDF-')).toBe(false);
  } finally { database.close(); }
  const proposals = state.facts.filter(item => item.status === 'proposed' || item.status === 'conflict');
  for (const [index, fact] of proposals.entries()) {
    await page.locator('.assistant-fact').filter({ has: page.getByRole('heading', { name: fact.label, exact: true }) }).getByRole('button', { name: /^Bekreft / }).click();
    if (index === proposals.length - 1) await expect(page.getByRole('button', { name: 'Send melding', exact: true })).toBeEnabled({ timeout: 200000 });
    else await expect.poll(async () => (await snapshot(page)).session?.facts.find(item => item.id === fact.id)?.status).toBe('confirmed');
  }
  response = await snapshot(page);
  expectRecordedRoleModels(response);
  await page.getByLabel('Jeg har sett over opplysningene og det som gjenstår, og vil klargjøre saksgrunnlaget lokalt.').check();
  await page.getByRole('button', { name: 'Bekreft og klargjør' }).click();
  await expect(page.getByRole('heading', { name: 'Saken er klargjort lokalt' })).toBeVisible();
  expect((await snapshot(page)).session?.handoff?.localOnly).toBe(true);
  await page.getByRole('button', { name: 'Avslutt og slett', exact: true }).click();
  await page.getByRole('button', { name: 'Slett saken', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Samtalen, opplysningene og dokumentene er slettet.' })).toBeVisible();
  expect((await snapshot(page)).session).toBeNull();
  const afterDeletion = new DatabaseSync(resolve(process.env.ASSISTANT_DATA_DIR || '.data', 'assistant.sqlite'), { readOnly: true });
  try { expect(afterDeletion.prepare('SELECT id FROM cases WHERE id = ?').get(state.id)).toBeUndefined(); }
  finally { afterDeletion.close(); }
});

test('real replies follow the question language while Norwegian controls and original quotes remain', async ({ page }) => {
  test.skip(process.env.ASSISTANT_LIVE_E2E !== '1', 'Opt in to the real configured model with ASSISTANT_LIVE_E2E=1.');
  test.setTimeout(420000);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'nb');
  await expect(page.getByText('Svar følger språket du skriver på. Norsk er standard.', { exact: false })).toBeVisible();
  await page.getByLabel('Hva er situasjonen din?').fill('OK');
  await expect(page.getByRole('button', { name: 'Send melding', exact: true })).toBeEnabled();
  const englishQuestion = 'I am moving to Trondheim on 2026-12-04. What should I prepare?';
  await page.getByLabel('Hva er situasjonen din?').fill(englishQuestion);
  await page.getByRole('button', { name: 'Send melding', exact: true }).click();
  await expect(page.locator('.assistant-message.is-assistant')).toHaveCount(1, { timeout: 200000 });
  let response = await snapshot(page);
  expect(response.session?.error).toBeNull();
  expect(response.session?.language).toBe('en');
  expectRecordedRoleModels(response);
  await expect(page.locator('.assistant-message.is-assistant').first()).toHaveAttribute('lang', 'en');
  await expect(page.locator('.assistant-message.is-assistant').first().locator(':scope > .assistant-markdown').first()).toContainText(/\b(you|your|moving|move|relocat\w*|help|information|review|prepare|sources|proposals)\b/i);
  await expect(page.locator('.assistant-case-summary > .assistant-markdown[lang="en"]')).toBeVisible();
  await expect(page.locator('.assistant-service > .assistant-markdown[lang="en"]').first()).toBeVisible();
  const originalFact = response.session!.facts.find(fact => fact.key === 'new_municipality')!;
  expect(originalFact.value).toBe('Trondheim');
  expect(englishQuestion.includes(originalFact.citation.quote)).toBe(true);

  await page.getByLabel('Skriv en melding').fill('Tôi muốn tiếp tục bằng tiếng Việt. Bạn cần thêm thông tin gì để giúp tôi chuyển nhà?');
  await page.getByRole('button', { name: 'Send melding', exact: true }).click();
  await expect(page.locator('.assistant-message.is-assistant')).toHaveCount(2, { timeout: 200000 });
  response = await snapshot(page);
  expect(response.session?.error).toBeNull();
  expect(response.session?.language).toBe('vi');
  expectRecordedRoleModels(response);
  await expect(page.locator('.assistant-message.is-assistant').last()).toHaveAttribute('lang', 'vi');
  await expect(page.locator('.assistant-message.is-assistant').last().locator(':scope > .assistant-markdown').first()).toContainText(/bạn|cần|chuyển|thông tin|hỗ trợ|kiểm tra|nguồn|đề xuất/iu);
  await expect(page.locator('.assistant-service > .assistant-markdown[lang="vi"]').first()).toContainText(/bạn|cần|chuyển|thông tin|hỗ trợ|kiểm tra|nguồn|đề xuất/iu);
  expect(response.session!.facts.find(fact => fact.id === originalFact.id)?.citation.quote).toBe(originalFact.citation.quote);
  expect(response.session!.sources.find(source => source.id === originalFact.citation.sourceId)?.text).toBe(englishQuestion);
  await page.reload();
  await expect(page.locator('.assistant-message.is-assistant').first()).toHaveAttribute('lang', 'en');
  await expect(page.locator('.assistant-message.is-assistant').last()).toHaveAttribute('lang', 'vi');
  await expect(page.getByRole('button', { name: 'Send melding', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Din felles oversikt' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'nb');
  await noAccessibilityErrors(page);
  await page.getByRole('button', { name: 'Avslutt og slett', exact: true }).click();
  await page.getByRole('button', { name: 'Slett saken', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Samtalen, opplysningene og dokumentene er slettet.' })).toBeVisible();
});


test('the compact plan tabs remain usable on desktop and mobile', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Grensesnittspråk')).toHaveValue('nb');
  await expect(page.locator('.assistant-locale .pkt-inputwrapper__label')).toHaveCount(0);
  await expect(page.locator('.assistant-locale .pkt-sr-only')).toHaveText('Grensesnittspråk');
  expect(await page.locator('.assistant-locale .pkt-sr-only').evaluate(element => {
    const style = getComputedStyle(element);
    return { position: style.position, width: style.width, height: style.height, overflow: style.overflow };
  })).toEqual({ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden' });
  await expect(page.getByRole('heading', { name: 'Hva kan vi hjelpe deg med?' })).toBeVisible();
  const messageInput = page.getByLabel('Hva er situasjonen din?');
  const attachButton = page.getByRole('button', { name: 'Legg ved dokument' });
  const sendButton = page.getByRole('button', { name: 'Send melding', exact: true });
  await expect(sendButton).toBeVisible();
  await expect(messageInput).toHaveAttribute('rows', '2');
  await expect(messageInput).toHaveClass(/pkt-input--small/);
  await expect(attachButton).toHaveClass(/pkt-btn--small/);
  await expect(sendButton).toHaveClass(/pkt-btn--small/);
  const composerLayout = await page.evaluate(() => {
    const input = document.querySelector<HTMLElement>('#assistant-message-input')!.getBoundingClientRect();
    const attach = document.querySelector<HTMLElement>('[aria-controls="assistant-upload"]')!.getBoundingClientRect();
    const send = document.querySelector<HTMLElement>('.assistant-composer button[type="submit"]')!.getBoundingClientRect();
    return { inputHeight: input.height, actionOffset: Math.abs(attach.top - send.top) };
  });
  expect(composerLayout.inputHeight).toBeLessThanOrEqual(96);
  expect(composerLayout.actionOffset).toBeLessThanOrEqual(2);
  expect((await snapshot(page)).session).toBeNull();
  await expect(page.getByRole('tab', { name: 'Neste steg', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Kilder', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Tavle', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Tjenestetavle' })).toBeVisible();
  await expect(page.getByText('Tjenestene vises her når samtalen har gitt grunnlag for en plan.', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Neste steg', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Neste steg', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Neste steg' })).not.toHaveAttribute('hidden', '');
  await page.getByRole('tab', { name: 'Kilder', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Kilder', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Kilder' })).not.toHaveAttribute('hidden', '');
  const progressAppearance = await page.evaluate(async () => {
    const probe = document.createElement('div');
    probe.className = 'assistant-progress-shell';
    probe.style.cssText = 'position:fixed;left:-9999px;width:400px;margin:0';
    probe.innerHTML = '<span class="assistant-progress-segment" aria-hidden="true"></span>';
    document.body.append(probe);
    const bar = probe.querySelector<HTMLElement>('.assistant-progress-segment')!;
    const before = getComputedStyle(bar).transform;
    await new Promise(resolve => setTimeout(resolve, 180));
    const result = { before, after: getComputedStyle(bar).transform, bar: getComputedStyle(bar).backgroundColor, track: getComputedStyle(probe).backgroundColor, width: bar.getBoundingClientRect().width };
    probe.remove();
    return result;
  });
  expect(progressAppearance.after).not.toBe(progressAppearance.before);
  expect(progressAppearance.bar).not.toBe(progressAppearance.track);
  expect(progressAppearance.width).toBeGreaterThan(0);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('tab', { name: 'Din oversikt' }).click();
  await page.getByRole('tab', { name: 'Tavle', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await noAccessibilityErrors(page);
});

test('documentation and about pages use normal document scrolling', async ({ page }) => {
  for (const path of ['/dokumentasjon', '/om-demoen']) {
    await page.goto(path);
    const dimensions = await page.evaluate(() => ({
      clientHeight: document.scrollingElement!.clientHeight,
      scrollHeight: document.scrollingElement!.scrollHeight,
      shellOverflow: getComputedStyle(document.querySelector('[class*="shell"]')!).overflow,
    }));
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
    expect(dimensions.shellOverflow).toBe('visible');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await expect(page.locator('footer')).toBeInViewport();
  }
});

test('presentation flows use generic AI labels and provide PNG exports', async ({ page }) => {
  for (const path of ['/dokumentasjon', '/om-demoen', '/diagrams/index.html']) {
    await page.goto(path);
    await expect(page.locator('body')).not.toContainText(/Cloudflare|Qwen|Gemma/i);
  }
  await page.goto('/dokumentasjon');
  const pngLink = page.getByRole('link', { name: 'Last ned PNG' });
  await expect(pngLink).toHaveAttribute('href', '/diagrams/agentic-architecture.png');
  const png = await page.request.get('/diagrams/agentic-architecture.png');
  expect(png.ok()).toBe(true);
  expect(png.headers()['content-type']).toContain('image/png');
  await page.goto('/diagrams/index.html');
  await expect(page.getByRole('link', { name: 'Last ned PNG' })).toHaveAttribute('href', 'agentic-architecture.png');
});

test('agent task disclosure opens a selected run in the right activity panel', async ({ page }) => {
  await page.goto('/');
  const started = await page.request.post('/api/assistant', { data: { action: 'start' } });
  const state = (await started.json() as AssistantResponse).session!;
  const startedAt = new Date().toISOString();
  state.runs = [{ id: 'test-run', agent: 'Koordinator', revision: state.revision, status: 'completed', startedAt, completedAt: startedAt, model: 'test-coordinator-model', durationMs: 2300, framework: 'Microsoft Agent Framework · Python' }];
  state.events = [
    { id: 'test-start', runId: 'test-run', agent: 'Koordinator', type: 'started', at: startedAt, detail: 'Modellanalysen er startet.' },
    { id: 'test-complete', runId: 'test-run', agent: 'Koordinator', type: 'completed', at: startedAt, detail: 'Strukturert svar mottatt og kontrollert.' },
  ];
  const database = new DatabaseSync(resolve(process.env.ASSISTANT_DATA_DIR || '.data', 'assistant.sqlite'));
  try { database.prepare('UPDATE cases SET body = ? WHERE id = ?').run(JSON.stringify(state), state.id); }
  finally { database.close(); }
  await page.reload();
  await page.locator('.assistant-task-disclosure > summary').click();
  const task = page.getByRole('button', { name: /Vis detaljer for Koordinator/ });
  await expect(task).toBeVisible();
  await task.click();
  await expect(page.getByRole('tab', { name: 'Aktivitet', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Oppgavedetaljer' })).toBeVisible();
  const activityPanel = page.getByRole('tabpanel', { name: 'Aktivitet' });
  await expect(activityPanel).not.toContainText('test-coordinator-model');
  await expect(activityPanel).not.toContainText('Microsoft Agent Framework');
  await expect(activityPanel).toContainText('Strukturert svar mottatt og kontrollert.');
  await expect(task).toHaveAttribute('aria-current', 'true');
});

test('production Markdown renderer supports tables and emphasis without HTML images or unsafe links', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', request => requested.push(request.url()));
  const renderer = `import { createElement } from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; import { AssistantMarkdown } from './src/components/assistant-markdown.tsx'; process.stdout.write(renderToStaticMarkup(createElement(AssistantMarkdown, JSON.parse(process.argv[1]))));`;
  // Render the actual component outside Playwright's JSX fixture transform.
  const { stdout: content } = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', renderer, JSON.stringify({
    language: 'en', tableLabel: 'Result table',
    text: '**Check this**\n\n| Task | Owner |\n| --- | --- |\n| Check source | You |\n\n- First\n- Second\n\n```txt\nplain code\n```\n\n[Official source](https://example.org/guidance)\n\n[Unsafe](javascript:alert(1))\n\n![Remote image](https://example.org/tracking.png)\n\n<img src=x onerror="window.injectionRan=true">\n<script>window.injectionRan=true</script>',
  })], { cwd: process.cwd() });
  await page.setContent(`<!doctype html><html lang="en"><head><title>Markdown component contract</title></head><body><main>${content}</main></body></html>`);
  await expect(page.locator('strong')).toHaveText('Check this');
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Task' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Check source' })).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(2);
  await expect(page.locator('pre code')).toHaveText('plain code\n');
  await expect(page.getByRole('link', { name: 'Official source' })).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.locator('img, script, iframe')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Unsafe' })).toHaveCount(0);
  expect(await page.evaluate(() => 'injectionRan' in window)).toBe(false);
  expect(requested).toEqual([]);
});

test('real typed questions send a citizen message and board corrections retain confirmation gates', async ({ page }, testInfo) => {
  test.skip(process.env.ASSISTANT_LIVE_E2E !== '1', 'Requires actual configured Python agents and model transport.');
  test.setTimeout(600000);
  await page.addInitScript(() => localStorage.setItem('sok-assistant-ui-language', 'en'));
  await page.goto('/');
  await page.getByLabel('What is your situation?').fill('I am planning to move within Norway. Help me prepare. I have not provided a date or new municipality yet.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.assistant-message.is-assistant')).toHaveCount(1, { timeout: 200000 });
  let response = await snapshot(page);
  expect(response.session?.error).toBeNull();
  await expect(page.getByLabel('Moving date', { exact: true })).toHaveAttribute('type', 'date');
  await page.getByLabel('Moving date', { exact: true }).fill('2026-12-09');
  await page.getByLabel('New municipality', { exact: true }).fill('Tromsø');
  await page.getByText('Preview message before sending', { exact: true }).click();
  await expect(page.locator('.assistant-answer-preview pre')).toContainText('Moving date: 2026-12-09.');
  await expect(page.locator('.assistant-answer-preview pre')).toContainText('New municipality: Tromsø.');
  const oldRevision = response.session!.revision;
  await page.getByRole('button', { name: 'Send answers', exact: true }).click();
  await expect(page.locator('.assistant-message.is-assistant')).toHaveCount(2, { timeout: 200000 });
  response = await snapshot(page);
  expect(response.session?.error).toBeNull();
  expect(response.session!.revision).toBeGreaterThan(oldRevision);
  expect(response.session!.messages.filter(message => message.role === 'user').at(-1)?.text).toContain('Moving date: 2026-12-09.');
  expect(response.session!.messages.filter(message => message.role === 'user').at(-1)?.text).toContain('New municipality: Tromsø.');
  expect(response.session!.facts.some(fact => fact.key === 'move_date' && fact.value === '2026-12-09' && fact.status === 'confirmed')).toBe(true);
  expect(response.session!.facts.some(fact => fact.key === 'new_municipality' && fact.value === 'Tromsø' && fact.status === 'confirmed')).toBe(true);
  expect(response.session!.facts.some(fact => fact.status === 'proposed' || fact.status === 'conflict')).toBe(false);
  await expect(page.locator('.assistant-fact-actions').getByRole('button', { name: /^Confirm / })).toHaveCount(0);
  expectRecordedRoleModels(response);
  expect(response.session!.runs.every(run => run.framework?.includes('Microsoft Agent Framework'))).toBe(true);
  await page.getByRole('tab', { name: 'Board', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('assistant-punkt-board-en-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('tab', { name: 'Your overview' }).click();
  await page.screenshot({ path: testInfo.outputPath('assistant-punkt-board-en-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await noAccessibilityErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const savedAnswer = await page.locator('.assistant-message.is-assistant').last().locator('.assistant-markdown').innerText();
  await page.evaluate(() => {
    localStorage.setItem('sok-assistant-ui-language', 'nb');
    window.dispatchEvent(new Event('assistant-locale-change'));
  });
  await expect(page.locator('.assistant-message.is-assistant').last().locator('.assistant-markdown')).toHaveText(savedAnswer, { useInnerText: true });
  expect((await snapshot(page)).session?.language).toBe('en');
  await page.getByRole('tab', { name: 'Tavle', exact: true }).click();
  const board = page.getByRole('region', { name: 'Tjenestetavle' });
  await expect(board.getByRole('heading', { name: 'Flytting', exact: true })).toBeVisible();
  await board.locator('li').filter({ has: page.getByRole('heading', { name: 'Flyttedato', exact: true }) }).getByRole('button', { name: /^Svar eller rett opplysninger/ }).click({ timeout: 10000 });
  await expect(page.getByLabel('Flyttedato', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Flyttedato', { exact: true })).toHaveValue('');
  expect((await snapshot(page)).session?.revision).toBe(response.session?.revision);
  await page.getByRole('tab', { name: 'Oversikt', exact: true }).click();
  await noAccessibilityErrors(page);
  await page.getByRole('button', { name: 'Avslutt og slett', exact: true }).click();
  await page.getByRole('button', { name: 'Slett saken', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Samtalen, opplysningene og dokumentene er slettet.' })).toBeVisible();
});

test('the agent routes a personal SFO request to contextual KS consent and supports manual continuation', async ({ page }) => {
  test.setTimeout(240000);
  const mutations: Record<string, unknown>[] = [];
  page.on('request', request => {
    if (request.url().endsWith('/api/assistant') && request.method() === 'POST') mutations.push(request.postDataJSON());
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Hent fra KS', exact: true })).toHaveCount(0);
  await page.getByLabel('Hva er situasjonen din?').fill('Jeg bruker SFO og vil vite om familien min kan betale mindre.');
  await page.getByRole('button', { name: 'Send melding', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Kan jeg hente opplysninger for deg?' })).toBeVisible({ timeout: 200000 });
  await expect(page.locator('.assistant-message.is-assistant').last()).toContainText('Vil du at jeg henter opplysninger for deg?');
  expect((await snapshot(page)).session?.pendingConsents?.map(consent => consent.toolId)).toEqual(['ks_connect', 'ks_income']);
  const state = (await snapshot(page)).session!;
  expect(state.intent).toBe('personalized');
  expect(state.services.some(service => service.id === 'family')).toBe(true);
  expect(state.ksData?.incomeReadAt ?? null).toBeNull();
  await expect(page.getByRole('heading', { name: 'Dette trenger vi å vite' })).toHaveCount(0);
  const consentLabel = 'Jeg samtykker til at disse syntetiske opplysningene hentes for denne vurderingen.';
  await expect(page.getByLabel(consentLabel)).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Samtykk, hent og fortsett', exact: true })).toBeDisabled();
  await page.getByLabel(consentLabel).check();
  await expect(page.getByRole('button', { name: 'Samtykk, hent og fortsett', exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel(consentLabel)).not.toBeChecked();
  await page.getByRole('button', { name: 'Fortsett uten å hente', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Vi fortsetter uten å hente opplysninger' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dette trenger vi å vite' })).toBeVisible();
  const declined = (await snapshot(page)).session!;
  expect(declined.ksAccessDecision?.status).toBe('declined');
  expect(declined.ksData?.incomeReadAt ?? null).toBeNull();
  expect(mutations.find(command => command.action === 'tool-consent')).toMatchObject({ approved: false, toolIds: ['ks_connect', 'ks_income'], caseId: state.id, revision: state.revision });
  expect(declined.pendingConsents).toEqual([]);
  expect(mutations.some(command => ['connect-ks', 'income-consent', 'ks-access'].includes(String(command.action)))).toBe(false);
  await noAccessibilityErrors(page);
  await page.getByRole('button', { name: 'Avslutt og slett', exact: true }).click();
  await page.getByRole('button', { name: 'Slett saken', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Samtalen, opplysningene og dokumentene er slettet.' })).toBeVisible();
});
