import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AssistantCase, EvidenceSource } from '../src/domain/assistant-types';
import type { ModelCall } from '../src/server/assistant-model';
import { buildKlarsprakContrast } from '../src/server/klarsprak-service';
import { kroner } from '../src/domain/format';

const now = '2026-09-10T08:00:00.000Z';
function source(id: string, value: unknown): EvidenceSource {
  return { id, kind: 'register', title: id, text: JSON.stringify(value), url: null, retrievedAt: now, purpose: 'test', period: 'test' };
}
function session(): Pick<AssistantCase, 'sources' | 'facts'> {
  return {
    facts: [],
    sources: [
      source('ks-sfo', [{ sfonavn: 'Sol SFO', kommune: 'Oslo', trinn: 2, manedspris: 4500, syntetisk: true }]),
      source('ks-rates', {
        gjelderFra: '2025-01-01', kilde: 'KS-sandkassen', maksAndelAvInntekt: 0.06, maanederMedBetaling: 12,
        ordninger: [{ id: 'sfo-moderasjon', navn: 'SFO-moderasjon', tjeneste: 'sfo',
          regel: 'Husholdningen skal høyst betale 6 % av inntekten til SFO per år.', beskrivelse: 'Redusert foreldrebetaling for SFO.' }],
      }),
      source('ks-assessment', { godkjent: true, melding: 'Innvilget redusert betaling.',
        grunnlag: { ordningNavn: 'SFO-moderasjon', beregningsbeloep: 612000, inntektsgrense: 500000, gjelderFra: '2025-01-01' } }),
    ],
  };
}
function fetchReturning(body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
}
const failingFetch: typeof fetch = async () => { throw new Error('ECONNREFUSED'); };
const failingInfer: ModelCall = async () => { throw new Error('Modellen er ikke konfigurert.'); };

const previousGatewayEnv = { value: undefined as string | undefined };
beforeEach(() => { previousGatewayEnv.value = process.env.AI_GATEWAY_BASE_URL; });
afterEach(() => {
  if (previousGatewayEnv.value === undefined) delete process.env.AI_GATEWAY_BASE_URL;
  else process.env.AI_GATEWAY_BASE_URL = previousGatewayEnv.value;
});

test('returns null without a finished KS assessment or with a basis conflict', async () => {
  assert.equal(await buildKlarsprakContrast({ facts: [], sources: [] }), null);
  const withConflict = session();
  withConflict.facts.push({ id: 'f1', key: 'cohabitant_missing', value: 'true', label: 'Samboer mangler', status: 'confirmed',
    citation: { sourceId: 'ks-assessment', quote: 'x', lineStart: 1, lineEnd: 1, page: null }, createdAt: now, confirmedAt: now });
  assert.equal(await buildKlarsprakContrast(withConflict), null);
});

test('uses the sandbox ai-gateway when it returns text grounded in the rule-engine amounts', async () => {
  const contrast = await buildKlarsprakContrast(session(), {
    fetchImpl: fetchReturning({ nb: `Dere betaler ${kroner(3060)} i måneden fremover, ned fra ${kroner(4500)}.`, vi: `Quy vi tra ${kroner(3060)} moi thang, giam tu ${kroner(4500)}.` }),
  });
  assert.equal(contrast?.source, 'ai-gateway');
  assert.ok(contrast?.texts.nb.includes(kroner(3060)));
  assert.ok(contrast?.texts.vi.includes(kroner(3060)));
});

test('falls back to the own model when the ai-gateway is unreachable', async () => {
  const infer: ModelCall = async (_system, _context, schema) => schema.parse({ nb: `Dere betaler ${kroner(3060)} i måneden fremover.`, vi: `Quy vi tra ${kroner(3060)} moi thang.` });
  const contrast = await buildKlarsprakContrast(session(), { fetchImpl: failingFetch, infer });
  assert.equal(contrast?.source, 'own-model');
});

test('falls back to the deterministic template when the ai-gateway and the own model are both unavailable', async () => {
  const contrast = await buildKlarsprakContrast(session(), { fetchImpl: failingFetch, infer: failingInfer });
  assert.equal(contrast?.source, 'template');
  assert.ok(contrast?.texts.nb.includes(kroner(3060)));
});

test('a klarspråk text with an amount the rule engine never produced is rejected, whichever source it came from', async () => {
  const invented: ModelCall = async (_system, _context, schema) => schema.parse({ nb: `Dere betaler ${kroner(2000)} i måneden.`, vi: `Quy vi tra ${kroner(2000)} moi thang.` });
  const contrast = await buildKlarsprakContrast(session(), {
    fetchImpl: fetchReturning({ nb: `Dere betaler ${kroner(2000)} i måneden.`, vi: `Quy vi tra ${kroner(2000)} moi thang.` }),
    infer: invented,
  });
  // Both the gateway and the model proposed a fabricated amount, so the gate rejects both and the deterministic template is used instead.
  assert.equal(contrast?.source, 'template');
  assert.ok(contrast?.texts.nb.includes(kroner(3060)));
});

test('the language switch never changes the underlying amount, only the wording', async () => {
  const contrast = await buildKlarsprakContrast(session(), { fetchImpl: failingFetch, infer: failingInfer });
  assert.ok(contrast?.texts.nb.includes(kroner(3060)) && contrast?.texts.vi.includes(kroner(3060)));
  assert.ok(contrast?.texts.nb.includes(kroner(4500)) && contrast?.texts.vi.includes(kroner(4500)));
});

test('gateway responses are ignored when AI_GATEWAY_BASE_URL is not a local sandbox address', async () => {
  process.env.AI_GATEWAY_BASE_URL = 'http://example.com';
  const contrast = await buildKlarsprakContrast(session(), {
    fetchImpl: fetchReturning({ nb: `Dere betaler ${kroner(3060)} i måneden fremover.`, vi: `Quy vi tra ${kroner(3060)} moi thang.` }),
    infer: failingInfer,
  });
  assert.equal(contrast?.source, 'template');
});
