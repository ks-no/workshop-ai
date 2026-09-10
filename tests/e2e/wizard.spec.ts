import { test, expect } from '@playwright/test';

// The planner may use a local model; allow it time. Without a model the rule planner answers within seconds.
const PLANNER = { timeout: 180_000 };

test('the front page focuses the input, shows the planner at work, and lets the citizen start over', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Hva trenger du hjelp med?' })).toBeVisible();
  await expect(page.getByLabel('Beskriv situasjonen din')).toBeFocused();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start på nytt' })).toHaveCount(0);
  const next = page.getByRole('button', { name: 'Gå videre' });
  await expect(next).toBeDisabled();

  await page.getByRole('button', { name: 'Jeg har mistet jobben og har barn på SFO' }).click();
  await expect(page.getByLabel('Beskriv situasjonen din')).toHaveValue('Jeg har mistet jobben og har barn på SFO');
  await expect(next).toBeEnabled();
  await next.click();

  await expect(page.getByRole('heading', { name: 'Vi tolker situasjonen din' })).toBeVisible();
  await expect(page.getByText('Venter på svar fra serveren')).toBeVisible();

  const step = page.getByTestId('flow-step');
  await expect(step).toHaveAttribute('data-kind', /^(ask|review|action|done)$/, PLANNER);
  await expect(page.getByText('Slik tenkte assistenten')).toBeVisible();
  await expect(page.getByText(/KI-forslag ·|Regelbasert forslag/).first()).toBeVisible();
  await expect(page.getByText(/Steg \d+ · Du styrer hva som skjer videre/)).toBeVisible();
  await expect(page.getByText('Hva har skjedd i saken')).toBeVisible();

  // A reload resumes the same case and step.
  await page.reload();
  await expect(page.getByTestId('flow-step')).toHaveAttribute('data-kind', /^(ask|review|action|done)$/, PLANNER);
  await expect(page.getByText('Vi har hentet saken du holdt på med.')).toBeVisible();

  await page.getByRole('button', { name: 'Start på nytt' }).click();
  await expect(page.getByRole('heading', { name: 'Hva trenger du hjelp med?' })).toBeVisible();
  await expect(page.getByLabel('Beskriv situasjonen din')).toHaveValue('');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
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


test('exact edited email is approved into the local outbox without sending', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.getByLabel('Beskriv situasjonen din').fill('Jeg ønsker veiledning fra kommunen.');
  await page.getByRole('button', { name: 'Gå videre' }).click();
  await expect(page.getByTestId('flow-step')).toHaveAttribute('data-kind', /^(ask|review|action|done)$/, PLANNER);
  await page.getByText('Velg en handling', { exact: true }).click();
  await page.getByRole('button', { name: 'Forbered e-post', exact: true }).click();
  await expect(page.getByLabel('Emne', { exact: true })).toBeVisible();
  await page.getByLabel('Til', { exact: true }).fill('veiledning@example.test');
  await page.getByLabel('Emne', { exact: true }).fill('Mitt godkjente emne');
  await page.getByLabel('E-post', { exact: true }).fill('Jeg ønsker hjelp til å finne riktig tjeneste.');
  await page.getByRole('button', { name: 'Kontroller e-postutkast' }).click();
  await expect(page.getByRole('heading', { name: 'Kontroller før du godkjenner' })).toBeVisible();
  await expect(page.getByText('Mitt godkjente emne', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('approval-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Rediger utkast' }).click();
  await expect(page.getByLabel('Emne', { exact: true })).toHaveValue('Mitt godkjente emne');
  await page.getByLabel('Emne', { exact: true }).fill('Mitt endelige emne');
  await page.getByRole('button', { name: 'Kontroller e-postutkast' }).click();
  await page.getByRole('button', { name: 'Godkjenn og utfør' }).click();
  await expect(page.getByText('Lokal testutboks (1)', { exact: true })).toBeVisible();
  await page.getByText('Lokal testutboks (1)', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mitt endelige emne', exact: true }).last()).toBeVisible();
  const snapshot = await (await page.request.get('/api/flow')).json();
  expect(snapshot.activity.outbox).toHaveLength(1);
  expect(snapshot.activity.outbox[0]).toMatchObject({ to: 'veiledning@example.test', subject: 'Mitt endelige emne', body: 'Jeg ønsker hjelp til å finne riktig tjeneste.', status: 'mock-recorded' });
  await page.reload();
  await expect(page.getByText('Lokal testutboks (1)', { exact: true })).toBeVisible();
  await page.getByText('Velg en handling', { exact: true }).click();
  await page.getByRole('button', { name: 'Lag påminnelse', exact: true }).click();
  await expect(page.getByLabel('Påminnelse', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Kontroller før du godkjenner' })).toHaveCount(0);
});

test('reminders can be edited and cancelled durably in the wizard', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.getByLabel('Beskriv situasjonen din').fill('Jeg trenger veiledning om en henvendelse.');
  await page.getByRole('button', { name: 'Gå videre' }).click();
  await expect(page.getByTestId('flow-step')).toHaveAttribute('data-kind', /^(ask|review|action|done)$/, PLANNER);
  await page.getByText('Velg en handling', { exact: true }).click();
  await page.getByRole('button', { name: 'Lag påminnelse', exact: true }).click();
  await page.getByLabel('Påminnelse', { exact: true }).fill('Følg opp henvendelsen');
  const future = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  await page.getByLabel('Dato', { exact: true }).fill(future);
  await page.getByLabel('Klokkeslett (valgfritt)').fill('12:00');
  await page.getByRole('button', { name: 'Kontroller påminnelsen' }).click();
  await page.getByRole('button', { name: 'Godkjenn og utfør' }).click();
  await page.getByRole('button', { name: 'Endre påminnelsen' }).click();
  await page.getByLabel('Tittel på påminnelsen').fill('Min redigerte påminnelse');
  await page.getByRole('button', { name: 'Lagre påminnelsen' }).click();
  await expect(page.getByRole('heading', { name: 'Min redigerte påminnelse' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Min redigerte påminnelse' })).toBeVisible();
  await page.getByRole('button', { name: 'Avbryt påminnelsen' }).click();
  await expect(page.getByText('Avbrutt', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Avbrutt', { exact: true })).toBeVisible();
  expect((await (await page.request.get('/api/flow')).json()).activity.reminders[0].status).toBe('cancelled');
});


test('human review shares the approved summary into the local queue', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.getByLabel('Beskriv situasjonen din').fill('Jeg trenger hjelp av et menneske.');
  await page.getByRole('button', { name: 'Gå videre' }).click();
  await expect(page.getByTestId('flow-step')).toHaveAttribute('data-kind', /^(ask|review|action|done)$/, PLANNER);
  await page.getByText('Velg en handling', { exact: true }).click();
  await page.getByRole('button', { name: 'Be om menneskelig vurdering' }).click();
  await page.getByLabel('Oppsummering til menneskelig vurdering').fill('Jeg ønsker at et menneske vurderer hvilke opplysninger som mangler.');
  await page.getByRole('button', { name: 'Kontroller oppsummeringen' }).click();
  await page.getByRole('button', { name: 'Godkjenn og utfør' }).click();
  await expect(page.getByText('I lokal kø', { exact: true })).toBeVisible();
  const snapshot = await (await page.request.get('/api/flow')).json();
  expect(snapshot.activity.reviews).toHaveLength(1);
  expect(snapshot.activity.reviews[0]).toMatchObject({ summary: 'Jeg ønsker at et menneske vurderer hvilke opplysninger som mangler.', status: 'queued' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('human-review-mobile.png'), fullPage: true });
  await page.reload();
  await expect(page.getByText('I lokal kø', { exact: true })).toBeVisible();
});
