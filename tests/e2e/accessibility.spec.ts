import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AssistantResponse } from '../../src/domain/assistant-types';

type AxeCheck = { screen: string; passed: boolean; violations: unknown[] };
const report: AxeCheck[] = [];

async function auditPage(page: Page, screen: string) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  report.push({ screen, passed: result.violations.length === 0, violations: result.violations });
  expect(result.violations, JSON.stringify(result.violations, null, 2)).toEqual([]);
}

function seedState(sourceId: string) {
  const now = new Date().toISOString();
  return {
    now,
    sources: [{ id: sourceId, kind: 'conversation' as const, title: 'Din beskrivelse 1', text: 'Jeg har mistet jobben og bruker SFO for barnet mitt.', url: null, retrievedAt: now, purpose: 'Forstå behov og foreslå opplysninger du selv kontrollerer.', period: 'Oppgitt i denne samtalen.' }],
    messages: [
      { id: 'seed-user', role: 'user' as const, text: 'Jeg har mistet jobben og bruker SFO for barnet mitt.', at: now, sourceId },
      { id: 'seed-assistant', role: 'assistant' as const, language: 'nb', text: 'Vi har sett på situasjonen din og foreslår redusert foreldrebetaling for SFO. Kontroller opplysningene under.', at: now, sourceId: null, sourceIds: [sourceId] },
    ],
  };
}

async function writeCase(caseId: string, revision: number, body: unknown) {
  const database = new DatabaseSync(resolve(process.env.ASSISTANT_DATA_DIR || '.data', 'assistant.sqlite'));
  try { database.prepare('UPDATE cases SET body = ? WHERE id = ?').run(JSON.stringify(body), caseId); }
  finally { database.close(); }
}

test('start page has no automatically detectable accessibility violations', async ({ page }) => {
  await page.goto('/');
  await auditPage(page, 'startsiden');
});

test('assistant screen with a pending fact and KS consent has no automatically detectable accessibility violations', async ({ page }) => {
  await page.goto('/');
  const started = await page.request.post('/api/assistant', { data: { action: 'start' } });
  const state = (await started.json() as AssistantResponse).session!;
  const seed = seedState('seed-message-mid-flow');
  Object.assign(state, {
    intent: 'personalized',
    messages: seed.messages,
    sources: seed.sources,
    facts: [{ id: 'seed-fact', key: 'uses_sfo', value: 'true', label: 'Bruker SFO', status: 'proposed', citation: { sourceId: seed.sources[0].id, quote: 'bruker SFO', lineStart: 1, lineEnd: 1, page: null }, createdAt: seed.now, confirmedAt: null }],
    services: [{ id: 'family', title: 'Familie og SFO', reason: 'Du nevnte SFO.', status: 'needs-review', summary: 'Du kan ha rett til redusert foreldrebetaling.', checks: [{ id: 'income', label: 'Husstandens inntekt', status: 'missing', detail: 'Vi mangler inntektsopplysninger.', factKeys: ['household_income_annual'] }], findings: [], sourceIds: [seed.sources[0].id], questions: [], assessment: null, error: null }],
    analyzedRevision: state.revision,
    status: 'awaiting-human',
  });
  await writeCase(state.id, state.revision, state);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Bruker SFO' })).toBeVisible();
  await expect(page.getByLabel('Jeg samtykker til å hente disse syntetiske personopplysningene fra KS-sandkassen for denne SFO-vurderingen.')).toBeVisible();
  await auditPage(page, 'assistentskjermen');
});

test('the completed handoff receipt has no automatically detectable accessibility violations', async ({ page }) => {
  await page.goto('/');
  const started = await page.request.post('/api/assistant', { data: { action: 'start' } });
  const state = (await started.json() as AssistantResponse).session!;
  const seed = seedState('seed-message-handoff');
  Object.assign(state, {
    intent: 'personalized',
    messages: seed.messages,
    sources: seed.sources,
    facts: [{ id: 'seed-fact', key: 'uses_sfo', value: 'true', label: 'Bruker SFO', status: 'confirmed', citation: { sourceId: seed.sources[0].id, quote: 'bruker SFO', lineStart: 1, lineEnd: 1, page: null }, createdAt: seed.now, confirmedAt: seed.now }],
    services: [{ id: 'family', title: 'Familie og SFO', reason: 'Du nevnte SFO.', status: 'ready', summary: 'Du har rett til redusert foreldrebetaling.', checks: [{ id: 'income', label: 'Husstandens inntekt', status: 'ready', detail: 'Bekreftet av deg.', factKeys: ['household_income_annual'] }], findings: [], sourceIds: [seed.sources[0].id], questions: [], assessment: null, error: null }],
    analyzedRevision: state.revision,
    status: 'handed-off',
    handoff: { id: 'PLAN-TEST0001', createdAt: seed.now, revision: state.revision, serviceIds: ['family'], localOnly: true, status: 'prepared-for-human-review' },
  });
  await writeCase(state.id, state.revision, state);
  await page.reload();
  await page.getByRole('tab', { name: 'Neste steg', exact: true }).click();
  await expect(page.getByRole('link', { name: /Last ned oppsummeringen/ })).toBeVisible();
  await auditPage(page, 'kvitteringen');
});

async function activeElementHasVisibleFocusRing(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return false;
    const style = getComputedStyle(el);
    const hasRing = (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none';
    if (!hasRing) return false;
    const outlineWidth = parseFloat(style.outlineWidth) || 0;
    const outlineOffset = parseFloat(style.outlineOffset) || 0;
    const rect = el.getBoundingClientRect();
    const ringOuter = { top: rect.top - outlineWidth - outlineOffset, left: rect.left - outlineWidth - outlineOffset, right: rect.right + outlineWidth + outlineOffset, bottom: rect.bottom + outlineWidth + outlineOffset };
    let ancestor = el.parentElement;
    while (ancestor) {
      const ancestorStyle = getComputedStyle(ancestor);
      if (ancestorStyle.overflow !== 'visible' && ancestorStyle.overflowX !== 'visible' && ancestorStyle.overflowY !== 'visible') {
        const ancestorRect = ancestor.getBoundingClientRect();
        // 2px tolerance absorbs subpixel/layout rounding noise; real clipping bugs found in this codebase clip by several px.
        const tolerance = 2;
        const clipped = ringOuter.top < ancestorRect.top - tolerance || ringOuter.left < ancestorRect.left - tolerance || ringOuter.right > ancestorRect.right + tolerance || ringOuter.bottom > ancestorRect.bottom + tolerance;
        if (clipped) return false;
      }
      ancestor = ancestor.parentElement;
    }
    return true;
  });
}

async function tabUntil(page: Page, matches: () => Promise<boolean>, maxPresses = 40) {
  for (let i = 0; i < maxPresses; i++) {
    if (await matches()) return true;
    await page.keyboard.press('Tab');
  }
  return matches();
}

test.describe('tastaturløpet gjennom SFO-saken har synlig fokusmarkering i hvert steg', () => {
  test('fritekstfeltet der innbyggeren beskriver situasjonen sin', async ({ page }) => {
    await page.goto('/');
    await page.request.post('/api/assistant', { data: { action: 'start' } });
    await page.goto('/');
    const textarea = page.locator('.assistant-composer textarea').first();
    await textarea.waitFor({ timeout: 15000 });
    await page.keyboard.press('Tab');
    await expect(await tabUntil(page, async () => (await textarea.evaluate(node => node === document.activeElement)))).toBe(true);
    expect(await activeElementHasVisibleFocusRing(page)).toBe(true);
  });

  test('samtykkeknappen for å hente testopplysninger fra KS', async ({ page }) => {
    await page.goto('/');
    const started = await page.request.post('/api/assistant', { data: { action: 'start' } });
    const state = (await started.json() as AssistantResponse).session!;
    const seed = seedState('seed-ks-consent');
    Object.assign(state, {
      intent: 'personalized',
      messages: [seed.messages[0]],
      sources: seed.sources,
      facts: [],
      services: [{ id: 'family', title: 'Familie og SFO', reason: 'Du nevnte SFO.', status: 'needs-information', summary: 'x', checks: [], findings: [], sourceIds: [seed.sources[0].id], questions: [], assessment: null, error: null }],
      analyzedRevision: state.revision,
      status: 'awaiting-human',
    });
    await writeCase(state.id, state.revision, state);
    await page.reload();
    const consent = page.locator('#assistant-ks-access-consent');
    await consent.waitFor({ timeout: 15000 });
    await consent.focus();
    expect(await activeElementHasVisibleFocusRing(page)).toBe(true);
    await page.keyboard.press('Tab');
    expect(await activeElementHasVisibleFocusRing(page)).toBe(true);
  });

  test('bekreftelseskortet i Neste steg før gjennomgangen fullføres', async ({ page }) => {
    await page.goto('/');
    const started = await page.request.post('/api/assistant', { data: { action: 'start' } });
    const state = (await started.json() as AssistantResponse).session!;
    const seed = seedState('seed-confirm');
    Object.assign(state, {
      intent: 'personalized',
      messages: seed.messages,
      sources: seed.sources,
      facts: [{ id: 'seed-fact', key: 'uses_sfo', value: 'true', label: 'Bruker SFO', status: 'confirmed', citation: { sourceId: seed.sources[0].id, quote: 'bruker SFO', lineStart: 1, lineEnd: 1, page: null }, createdAt: seed.now, confirmedAt: seed.now }],
      services: [{ id: 'family', title: 'Familie og SFO', reason: 'Du nevnte SFO.', status: 'ready', summary: 'Du har rett til redusert foreldrebetaling.', checks: [{ id: 'income', label: 'Husstandens inntekt', status: 'ready', detail: 'Bekreftet av deg.', factKeys: ['household_income_annual'] }], findings: [], sourceIds: [seed.sources[0].id], questions: [], assessment: null, error: null }],
      analyzedRevision: state.revision,
      status: 'awaiting-human',
    });
    await writeCase(state.id, state.revision, state);
    await page.reload();
    await page.getByRole('tab', { name: 'Neste steg', exact: true }).click();
    const confirmCheckbox = page.locator('#assistant-handoff-consent');
    await confirmCheckbox.waitFor({ timeout: 15000 });
    // A prior mouse click (the tab switch above) sets the browser's input modality to pointer, so a scripted
    // .focus() right after it never satisfies :focus-visible even when a real Tab keypress would. Navigate with
    // real keyboard input instead, as a citizen tabbing through the page would.
    await expect(await tabUntil(page, async () => confirmCheckbox.evaluate(node => node === document.activeElement))).toBe(true);
    expect(await activeElementHasVisibleFocusRing(page)).toBe(true);
    await page.keyboard.press('Tab');
    expect(await activeElementHasVisibleFocusRing(page)).toBe(true);
  });

  test('nedlasting av overleveringspakken etter fullført gjennomgang', async ({ page }) => {
    await page.goto('/');
    const started = await page.request.post('/api/assistant', { data: { action: 'start' } });
    const state = (await started.json() as AssistantResponse).session!;
    const seed = seedState('seed-download');
    Object.assign(state, {
      intent: 'personalized',
      messages: seed.messages,
      sources: seed.sources,
      facts: [{ id: 'seed-fact', key: 'uses_sfo', value: 'true', label: 'Bruker SFO', status: 'confirmed', citation: { sourceId: seed.sources[0].id, quote: 'bruker SFO', lineStart: 1, lineEnd: 1, page: null }, createdAt: seed.now, confirmedAt: seed.now }],
      services: [{ id: 'family', title: 'Familie og SFO', reason: 'Du nevnte SFO.', status: 'ready', summary: 'Du har rett til redusert foreldrebetaling.', checks: [{ id: 'income', label: 'Husstandens inntekt', status: 'ready', detail: 'Bekreftet av deg.', factKeys: ['household_income_annual'] }], findings: [], sourceIds: [seed.sources[0].id], questions: [], assessment: null, error: null }],
      analyzedRevision: state.revision,
      status: 'handed-off',
      handoff: { id: 'PLAN-TEST0002', createdAt: seed.now, revision: state.revision, serviceIds: ['family'], localOnly: true, status: 'prepared-for-human-review' },
    });
    await writeCase(state.id, state.revision, state);
    await page.reload();
    await page.getByRole('tab', { name: 'Neste steg', exact: true }).click();
    const downloadLink = page.getByRole('link', { name: /Last ned oppsummeringen/ });
    await downloadLink.waitFor({ timeout: 15000 });
    await tabUntil(page, async () => downloadLink.evaluate(node => node === document.activeElement));
    expect(await activeElementHasVisibleFocusRing(page)).toBe(true);
  });
});

test('samtaleloggen er en ekte aria-live-region med innhold, og stjeler ikke fokus', async ({ page }) => {
  await page.goto('/');
  const started = await page.request.post('/api/assistant', { data: { action: 'start' } });
  const state = (await started.json() as AssistantResponse).session!;
  const seed = seedState('seed-aria-live');
  Object.assign(state, { intent: 'personalized', messages: seed.messages, sources: seed.sources, analyzedRevision: state.revision, status: 'awaiting-human' });
  await writeCase(state.id, state.revision, state);
  await page.reload();
  const log = page.locator('.assistant-messages');
  await log.waitFor({ timeout: 15000 });
  // Ikke bare tilstede i DOM-en: attributtene må ha de riktige verdiene (polite, ikke av), og loggen må
  // faktisk inneholde den strømmede samtalen, ikke bare være en tom innpakning.
  await expect(log).toHaveAttribute('role', 'log');
  await expect(log).toHaveAttribute('aria-live', 'polite');
  await expect(log).toHaveAttribute('aria-atomic', 'false');
  await expect(log).toContainText(seed.messages[0].text);
  await expect(log).toContainText(seed.messages[1].text);
  const textarea = page.locator('.assistant-composer textarea').first();
  await textarea.waitFor({ timeout: 15000 });
  await textarea.focus();
  await expect(textarea).toBeFocused();
  // Ingen av live-regionene skal ha tabIndex, slik at aria-live kun annonserer og aldri stjeler fokus.
  const tabbableLiveRegions = await page.evaluate(() => Array.from(document.querySelectorAll('[aria-live]')).filter(el => el.hasAttribute('tabindex')).length);
  expect(tabbableLiveRegions).toBe(0);
});

test('grensesnittspråket styrer html lang-attributtet', async ({ page }) => {
  await page.goto('/');
  await page.request.post('/api/assistant', { data: { action: 'start' } });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'nb');
  await page.selectOption('#assistant-ui-locale-input', 'en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.selectOption('#assistant-ui-locale-input', 'nb');
  await expect(page.locator('html')).toHaveAttribute('lang', 'nb');
  // Bindingen (document.documentElement.lang = locale i AssistantLocaleProvider) er en generisk
  // tilordning, ikke en nb/en-gren. Grensesnittet tilbyr foreløpig bare nb/en (UiLocale-typen);
  // vietnamesisk som fullverdig grensesnittspråk kommer med #14/klarspråk og vil følge samme mekanisme.
});

test.afterAll(() => {
  const directory = resolve('plans/260903-1502-agentic-citizen-service/reports');
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'issue-15-axe-run.json'), JSON.stringify({
    at: new Date().toISOString(),
    tool: '@axe-core/playwright',
    tags: ['wcag2a', 'wcag2aa', 'wcag21aa'],
    checks: report,
    note: 'Innsynsfanen (issue #11) er ikke med her; den ligger i en egen, ikke sammenslått gren (PR #21) og finnes ikke i dette worktreet.',
  }, null, 2) + '\n');
});
