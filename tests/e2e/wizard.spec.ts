import { test, expect } from '@playwright/test';

// The planner may use a local model; allow it time. Without a model the rule planner answers within seconds.
const PLANNER = { timeout: 180_000 };

test('the front page focuses the input, shows the planner at work, and lets the citizen start over', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Hva trenger du hjelp med?' })).toBeVisible();
  await expect(page.getByLabel('Beskriv situasjonen din')).toBeFocused();
  await expect(page.getByRole('progressbar', { name: 'Fremdrift' })).toHaveAttribute('aria-valuenow', '0');
  await expect(page.getByRole('button', { name: 'Start på nytt' })).toHaveCount(0);
  const next = page.getByRole('button', { name: 'Gå videre' });
  await expect(next).toBeDisabled();

  await page.getByRole('button', { name: 'Jeg har mistet jobben og har barn på SFO' }).click();
  await expect(page.getByLabel('Beskriv situasjonen din')).toHaveValue('Jeg har mistet jobben og har barn på SFO');
  await expect(next).toBeEnabled();
  await next.click();

  await expect(page.getByRole('heading', { name: 'Vi tolker situasjonen din' })).toBeVisible();
  await expect(page.getByText('Pågående oppgave')).toBeVisible();
  await expect(page.getByText('Leser det du skrev').first()).toBeVisible();

  const step = page.getByTestId('flow-step');
  await expect(step).toHaveAttribute('data-kind', /^(ask|review|action|done)$/, PLANNER);
  await expect(page.getByText('Slik tenkte assistenten')).toBeVisible();
  await expect(page.getByText(/KI-forslag ·|Regelbasert forslag/).first()).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Fremdrift' })).not.toHaveAttribute('aria-valuenow', '0');
  await expect(page.getByText('Hva har skjedd i saken')).toBeVisible();

  // A reload resumes the same case and step.
  await page.reload();
  await expect(page.getByTestId('flow-step')).toHaveAttribute('data-kind', /^(ask|review|action|done)$/, PLANNER);
  await expect(page.getByText('Vi har hentet saken du holdt på med.')).toBeVisible();

  await page.getByRole('button', { name: 'Start på nytt' }).click();
  await expect(page.getByRole('heading', { name: 'Hva trenger du hjelp med?' })).toBeVisible();
  await expect(page.getByLabel('Beskriv situasjonen din')).toHaveValue('');
  await expect(page.getByRole('progressbar', { name: 'Fremdrift' })).toHaveAttribute('aria-valuenow', '0');
});

test('a written situation or an uploaded text document unlocks the guide', async ({ page }) => {
  await page.goto('/');
  const next = page.getByRole('button', { name: 'Gå videre' });
  await page.getByLabel('Beskriv situasjonen din').fill('   ');
  await expect(next).toBeDisabled();
  await page.getByLabel('Beskriv situasjonen din').fill('');
  await page.getByText('Legg ved dokument (valgfritt)').click();
  await page.locator('input[type="file"]').setInputFiles({ name: 'lonnsslipp.txt', mimeType: 'text/plain', buffer: Buffer.from('Lønnsslipp: brutto lønn 32 000 kr i august 2026.') });
  await expect(page.getByText('lonnsslipp.txt')).toBeVisible();
  await expect(next).toBeEnabled();
  await page.getByRole('button', { name: 'Fjern lonnsslipp.txt' }).click();
  await expect(page.getByText('lonnsslipp.txt')).toHaveCount(0);
  await expect(next).toBeDisabled();
});
