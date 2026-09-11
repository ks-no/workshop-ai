import { test, expect } from '@playwright/test';

test.afterEach(async ({ page }) => {
  const response = await page.request.get('/api/flow');
  const { session } = await response.json();
  if (session) await page.request.delete('/api/flow', { data: { caseId: session.id, revision: session.revision } });
});

test('family map, checklist persistence and timeline work on mobile without model calls', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const start = await (await page.request.post('/api/flow', { data: { action: 'start' } })).json();
  // Existing real input route uses the configured model/fallback; test runner disables inference.
  const input = await page.request.post('/api/flow', { data: { action: 'input', text: 'Jeg har barn på SFO og trenger hjelp med husleie.', caseId: start.session.id, revision: start.session.revision } });
  expect(input.ok()).toBe(true);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Se hva som kan hjelpe familien din', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('family-invitation-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Utforsk familieoversikten', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Familieoversikt', exact: true })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Barn og SFO', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bolig og boutgifter', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Din sjekkliste', exact: true })).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sakens tidslinje', exact: true })).not.toBeVisible();
  await page.screenshot({ path: test.info().outputPath('support-map-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Se sjekkliste for barn og sfo', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Sjekkliste', exact: true })).toHaveAttribute('aria-selected', 'true');
  const documentCheckbox = page.getByRole('checkbox', { name: 'Dokumentasjon på husholdningens inntekt (skattemelding eller lønnsslipper)', exact: true });
  await documentCheckbox.click();
  await expect(documentCheckbox).toBeChecked();
  await expect(page.getByText('1 av 2 dokumenter markert klare', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Utforsk familieoversikten', exact: true }).click();
  await page.getByRole('tab', { name: 'Sjekkliste', exact: true }).click();
  await expect(documentCheckbox).toBeChecked();
  await page.getByLabel('Velg tjeneste', { exact: true }).selectOption('housing-allowance');
  await page.getByRole('button', { name: 'Fortsett med dette skjemaet' }).click();
  await expect(page.getByRole('heading', { name: 'Forberedt søknad om bostøtte (til Husbanken)', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Utforsk familieoversikten', exact: true }).click();
  await page.getByRole('tab', { name: 'Tidslinje', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Saken startet', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('timeline-mobile.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Tidslinje', exact: true }).press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Sjekkliste', exact: true })).toBeFocused();
  await page.getByRole('tab', { name: 'Sjekkliste', exact: true }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Din sjekkliste', exact: true })).toBeVisible();
});
