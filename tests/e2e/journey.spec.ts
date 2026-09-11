import { test, expect } from '@playwright/test';

test('retired SFO entry redirects to the shared citizen assistant', async ({ page }) => {
  await page.goto('/sfo');
  await expect(page).toHaveURL(/\/assistent$/);
  await expect(page.getByRole('heading', { name: 'Hva kan vi hjelpe deg med?' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'SFO-sjekken' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Dokumentasjon', exact: true })).toHaveAttribute('href', '/dokumentasjon');
  await expect(page.getByText('Hackathondemo · Team Oslo', { exact: true })).toBeVisible();
  await expect(page.getByText('Prøv med syntetiske registeropplysninger', { exact: true })).toHaveCount(0);
});

test('documentation and About pages are reachable and share the interface language', async ({ page }) => {
  await page.goto('/assistent');
  await page.getByRole('link', { name: 'Dokumentasjon', exact: true }).click();
  await expect(page).toHaveURL(/\/dokumentasjon$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText('Hackathondemo · Team Oslo', { exact: true })).toBeVisible();
  await page.getByLabel('Grensesnittspråk').selectOption('en');
  await page.getByRole('link', { name: 'About this demo', exact: true }).click();
  await expect(page).toHaveURL(/\/om-demoen$/);
  await expect(page.getByLabel('Interface language')).toHaveValue('en');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'SFO check', exact: true })).toHaveCount(0);
});
