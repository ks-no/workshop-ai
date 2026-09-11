import { test, expect } from '@playwright/test';

test('rendering Punkt controls keeps subsequent server requests available', async ({ page, request }) => {
  // Render first: the Punkt bundle is loaded by SSR and must not leave a fake
  // browser global behind for Next's later requests.
  await page.goto('/assistent');
  await expect(page.getByRole('heading', { name: 'Hva kan vi hjelpe deg med?' })).toBeVisible();
  const response = await request.get('/api/assistant');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/json');
  expect(await response.json()).toHaveProperty('model');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Hva er situasjonen din?' })).toBeEnabled();
});
