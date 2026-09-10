import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKsDemoClient, KS_DEMO_INCOME_PURPOSE, KsDemoError, type KsDemoConsent } from '../src/providers/ks-demo-client';

const receipt: KsDemoConsent = { samtykkeId: 'consent-1', personId: 'person-022', formaal: KS_DEMO_INCOME_PURPOSE,
  dataKilder: ['inntekt'], status: 'SAMTYKKET', opprettet: '2026-09-03T00:00:00.000Z', utloper: '2099-09-03T00:00:00.000Z', sporingsId: 'case-1', syntetisk: true };
function client(fetchImpl: typeof fetch) { return createKsDemoClient({ backendBaseUrl: 'http://127.0.0.1:8080', fiksBaseUrl: 'http://127.0.0.1:8081', personId: 'person-022', getCitizenToken: async () => 'citizen.token.value', getConsentToken: async () => 'consent.token.value' }, fetchImpl); }

test('SFO assessment rechecks the exact consent before calling the deterministic KS route', async () => {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input); calls.push(url);
    if (url.endsWith('/fiks/samtykke/consent-1')) return Response.json(receipt);
    if (url.includes('/api/regler/sjekk/ordning?')) return Response.json({ godkjent: true, melding: 'Syntetisk regelresultat', grunnlag: { beregningsbeloep: 320000, terskel: 651017 } });
    return Response.json({ feil: 'unexpected' }, { status: 404 });
  }) as typeof fetch;
  const result = await client(fetchImpl).readSfoAssessment(receipt);
  assert.equal(result.value.godkjent, true);
  assert.deepEqual(calls, ['http://127.0.0.1:8081/fiks/samtykke/consent-1', 'http://127.0.0.1:8080/api/regler/sjekk/ordning?personId=person-022&tjeneste=sfo']);
  assert.equal(result.source.resource, 'sfo-vurdering');
});

test('foreign or expired consent fails before any network or income disclosure', async () => {
  let calls = 0;
  const current = client((async () => { calls++; throw new Error('must not run'); }) as typeof fetch);
  await assert.rejects(current.readIncome({ ...receipt, personId: 'person-023' }), (error: unknown) => error instanceof KsDemoError && error.code === 'consent-required');
  await assert.rejects(current.readSfoAssessment({ ...receipt, utloper: '2026-01-01T00:00:00.000Z' }), (error: unknown) => error instanceof KsDemoError && error.code === 'consent-expired');
  assert.equal(calls, 0);
});

test('consent creation requires explicit approval and records the bounded SFO purpose', async () => {
  const requests: { url: string; body: unknown }[] = [];
  const pending = { ...receipt, status: 'VENTER_PAA_SVAR' as const, sporingsId: 'b140bc43-5855-47e6-9041-5a783f78cd13' };
  const granted = { ...receipt, sporingsId: pending.sporingsId };
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json(requests.length === 1 ? pending : granted);
  }) as typeof fetch;
  const result = await client(fetchImpl).grantIncomeConsent({ approved: true, caseId: pending.sporingsId });
  assert.equal(result.value.status, 'SAMTYKKET');
  assert.equal(requests[0].body && (requests[0].body as Record<string, unknown>).formaal, KS_DEMO_INCOME_PURPOSE);
  assert.deepEqual(requests[1].body, { status: 'SAMTYKKET', sporingsId: pending.sporingsId });
});
