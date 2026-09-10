import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseURL = 'http://127.0.0.1:3210';
const output = resolve('assets/screenshots/pdf-actual');
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1.5,
  locale: 'nb-NO',
  colorScheme: 'light',
});
const page = await context.newPage();

async function capture(name) {
  await page.screenshot({ path: resolve(output, name), animations: 'disabled' });
  console.log(`captured ${name}`);
}

async function snapshot() {
  const response = await page.request.get(`${baseURL}/api/assistant`);
  if (!response.ok()) throw new Error(`Snapshot failed: ${response.status()}`);
  return response.json();
}

try {
  await page.goto(`${baseURL}/?pdf=actual-ui`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Hva kan vi hjelpe deg med?' }).waitFor();
  await capture('01-start.png');

  await page.getByLabel('Hva er situasjonen din?').fill(
    'Jeg har mistet jobben. Barnet mitt går på SFO. Kan jeg få lavere SFO-betaling, og hvilke opplysninger bruker dere?'
  );
  await page.getByRole('button', { name: 'Send melding', exact: true }).click();
  await page.waitForTimeout(700);
  await capture('02-agentarbeid.png');

  await page.getByRole('heading', { name: 'Kan vi hente testopplysninger fra KS?' }).waitFor({ timeout: 240000 });
  await capture('03-samtykke.png');

  await page.getByLabel(/Jeg samtykker til å hente disse syntetiske personopplysningene/).check();
  await page.getByRole('button', { name: 'Samtykk, hent og fortsett' }).click();
  await page.waitForTimeout(700);
  await capture('04-henter-med-samtykke.png');

  await page.getByRole('heading', { name: 'KS-opplysningene er hentet' }).waitFor({ timeout: 240000 });
  await page.waitForTimeout(500);
  await capture('05-ks-hentet.png');

  const sourcesTab = page.getByRole('tab', { name: 'Kilder' });
  if (await sourcesTab.count()) {
    await sourcesTab.click();
    await page.waitForTimeout(300);
    await capture('06-kilder.png');
  }

  const boardTab = page.getByRole('tab', { name: 'Tavle' });
  if (await boardTab.count()) {
    await boardTab.click();
    await page.waitForTimeout(300);
    await capture('07-tavle.png');
  }

  const state = await snapshot();
  console.log(`case=${state.session?.id ?? 'none'} revision=${state.session?.revision ?? 0}`);
} finally {
  await context.close();
  await browser.close();
}
