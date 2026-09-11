import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verify as verifyEd25519 } from 'node:crypto';
import type { AssistantCase, EvidenceSource, MemoryFact } from '../src/domain/assistant-types';
import { verifiableCredentialSchema } from '../src/domain/wallet-credential';
import { buildModerationCredential, walletCredentialPackage } from '../src/server/wallet-credential';

const INCOME_NOK = 542_000;
const FODSELSNUMMER = '12345678901';

function assessmentSource(overrides: Partial<{ godkjent: boolean; beregningsbeloep: number; inntektsgrense: number; gjelderFra: string }> = {}): EvidenceSource {
  const text = JSON.stringify({
    godkjent: overrides.godkjent ?? true, melding: 'Inntekten er under grensen for redusert betaling.',
    grunnlag: { ordningNavn: 'SFO – redusert foreldrebetaling', beregningsbeloep: overrides.beregningsbeloep ?? INCOME_NOK, inntektsgrense: overrides.inntektsgrense ?? 600_000, gjelderFra: overrides.gjelderFra ?? '2026-08-01' },
  });
  return { id: 'ks-assessment', kind: 'register', title: 'KS API · Regelvurdering for SFO', text, url: null, retrievedAt: '2026-09-01T00:00:00.000Z', purpose: 'Forberede vurdering av SFO-betaling', period: 'Øyeblikksbilde' };
}
function incomeFact(value: string): MemoryFact {
  return { id: 'fact-income', key: 'household_income_annual', value, label: 'Husholdningens årsinntekt (kr)', status: 'confirmed', citation: { sourceId: 'ks-income', quote: value, lineStart: 1, lineEnd: 1, page: null }, createdAt: '2026-09-01T00:00:00.000Z', confirmedAt: '2026-09-01T00:00:00.000Z' };
}
function session(overrides: Partial<Pick<AssistantCase, 'sources' | 'facts'>> = {}): AssistantCase {
  const now = '2026-09-01T00:00:00.000Z';
  return {
    id: 'wallet-test', createdAt: now, updatedAt: now, expiresAt: now, revision: 1, status: 'ready',
    messages: [], facts: overrides.facts ?? [], sources: overrides.sources ?? [], services: [], questions: [], unsupported: [],
    runs: [], events: [], summary: '', analyzedRevision: 1, handoff: null, error: null, ksData: null, critique: [],
  };
}

test('no deterministic KS result means no credential is issued', () => {
  assert.equal(buildModerationCredential(session()), null);
});

test('a matching KS outcome produces a schema-valid Verifiable Credential with no income or identifier leakage', () => {
  const current = session({ sources: [assessmentSource()], facts: [incomeFact(String(INCOME_NOK))] });
  const credential = buildModerationCredential(current);
  assert.ok(credential);
  const result = verifiableCredentialSchema.safeParse(credential);
  assert.equal(result.success, true, JSON.stringify(result.error?.issues));
  assert.equal(credential!.credentialSubject.ordning, 'SFO – redusert foreldrebetaling');
  assert.equal(credential!.credentialSubject.utfall, 'innvilget');
  assert.equal(credential!.credentialSubject.gyldigFra, '2026-08-01');
  assert.equal(credential!.credentialSubject.gyldigTil, '2027-08-01');

  const serialized = JSON.stringify(credential);
  assert.ok(!serialized.includes(String(INCOME_NOK)), 'the income figure used to reach the outcome must not appear in the credential');
  assert.ok(!serialized.includes('600000') && !serialized.includes('600_000'), 'the income threshold must not appear in the credential');
  assert.ok(!/\d{11}/.test(serialized), 'no 11-digit fødselsnummer-shaped number may appear in the credential');
  assert.equal(serialized.includes(FODSELSNUMMER), false);
});

test('a conflicting basis between the citizen and the stored KS result blocks credential issuance', () => {
  const current = session({ sources: [assessmentSource()], facts: [incomeFact('999999')] });
  assert.equal(buildModerationCredential(current), null);
});

test('a denied outcome is still issuable, marked as avslag', () => {
  const current = session({ sources: [assessmentSource({ godkjent: false })], facts: [incomeFact(String(INCOME_NOK))] });
  const credential = buildModerationCredential(current);
  assert.equal(credential?.credentialSubject.utfall, 'avslag');
});

test('the demo proof is a real Ed25519 signature over the unsigned credential fields', () => {
  const current = session({ sources: [assessmentSource()], facts: [incomeFact(String(INCOME_NOK))] });
  const credential = buildModerationCredential(current)!;
  const { proof, ...unsigned } = credential;
  const publicKey = Buffer.from(proof.publicKeyBase64, 'base64');
  const ok = verifyEd25519(null, Buffer.from(JSON.stringify(unsigned), 'utf8'), { key: publicKey, format: 'der', type: 'spki' }, Buffer.from(proof.proofValue, 'base64'));
  assert.equal(ok, true);
});

test('a gjelderFra the KS response left free-form still yields a valid validity period', () => {
  const current = session({ sources: [assessmentSource({ gjelderFra: 'skoleåret 2026/2027' })], facts: [incomeFact(String(INCOME_NOK))] });
  const credential = buildModerationCredential(current);
  assert.ok(credential, 'the credential must still be issued, with today as the fallback start date');
  assert.match(credential.credentialSubject.gyldigFra, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(verifiableCredentialSchema.safeParse(credential).success, true);
  assert.ok(Date.parse(credential.validUntil) > Date.parse(credential.validFrom));
});

test('the wallet package exposes a scannable OpenID4VCI credential offer alongside the credential', () => {
  const current = session({ sources: [assessmentSource()], facts: [incomeFact(String(INCOME_NOK))] });
  const pkg = walletCredentialPackage(current)!;
  assert.ok(pkg.credentialOfferUri.startsWith('openid-credential-offer://?credential_offer='));
  const offer = JSON.parse(decodeURIComponent(pkg.credentialOfferUri.split('credential_offer=')[1]));
  assert.deepEqual(offer.credential_configuration_ids, ['ModerasjonsbevisCredential']);
  assert.ok(pkg.qrSvg.startsWith('<svg'));
  assert.match(pkg.demoNotice, /[Dd]emosignatur/);
});
