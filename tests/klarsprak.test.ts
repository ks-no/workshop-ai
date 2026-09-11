import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EvidenceSource } from '../src/domain/assistant-types';
import { computeKlarsprakAmounts, klarsprakEvidence, parseKlarsprakSources, plainLanguageTemplate, regulationText, validKlarsprakText } from '../src/domain/klarsprak';
import { kroner } from '../src/domain/format';

const now = '2026-09-10T08:00:00.000Z';
function source(id: string, value: unknown): EvidenceSource {
  return { id, kind: 'register', title: id, text: JSON.stringify(value), url: null, retrievedAt: now, purpose: 'test', period: 'test' };
}
function sources(): EvidenceSource[] {
  return [
    source('ks-sfo', [{ sfonavn: 'Sol SFO', kommune: 'Oslo', trinn: 2, manedspris: 4500, syntetisk: true }]),
    source('ks-rates', {
      gjelderFra: '2025-01-01', kilde: 'KS-sandkassen', maksAndelAvInntekt: 0.06, maanederMedBetaling: 12,
      ordninger: [{ id: 'sfo-moderasjon', navn: 'SFO-moderasjon', tjeneste: 'sfo',
        regel: 'Husholdningen skal høyst betale 6 % av inntekten til SFO per år.', beskrivelse: 'Redusert foreldrebetaling for SFO.' }],
    }),
  ];
}

test('parseKlarsprakSources reads the SFO place and the matching sfo-ordning from cached KS sources', () => {
  const parsed = parseKlarsprakSources(sources());
  assert.ok(parsed);
  assert.equal(parsed?.place.manedspris, 4500);
  assert.equal(parsed?.ordning.navn, 'SFO-moderasjon');
});

test('parseKlarsprakSources returns null without live KS data', () => {
  assert.equal(parseKlarsprakSources([]), null);
  assert.equal(parseKlarsprakSources([source('ks-sfo', [{ sfonavn: 'x' }])]), null);
});

test('computeKlarsprakAmounts derives the monthly cap and saving from income, cap share and payment months', () => {
  const amounts = computeKlarsprakAmounts(612000, 0.06, 12, 4500);
  assert.equal(amounts.monthlyCapNok, 3060);
  assert.equal(amounts.monthlyAfterNok, 3060);
  assert.equal(amounts.monthlySavingNok, 1440);
  assert.equal(amounts.capSharePercent, 6);
});

test('computeKlarsprakAmounts never reduces below the ordinary price', () => {
  const amounts = computeKlarsprakAmounts(3000000, 0.06, 12, 4500);
  assert.equal(amounts.monthlyAfterNok, 4500);
  assert.equal(amounts.monthlySavingNok, 0);
});

test('regulationText presents the stored regel/beskrivelse and satsgrunnlag fields as they stand', () => {
  const parsed = parseKlarsprakSources(sources())!;
  const text = regulationText(parsed);
  assert.match(text, /Husholdningen skal høyst betale 6 % av inntekten til SFO per år\./);
  assert.match(text, /Redusert foreldrebetaling for SFO\./);
  assert.match(text, /Maks andel av inntekt: 6 %/);
  assert.match(text, /Betaling fordeles over 12 måneder/);
  assert.match(text, /KS-sandkassen.*2025-01-01/);
});

test('validKlarsprakText requires the text to lead with an amount grounded in the rule-engine evidence', () => {
  const amounts = computeKlarsprakAmounts(612000, 0.06, 12, 4500);
  const evidence = klarsprakEvidence('Regel om SFO.', amounts, 612000, null);
  assert.equal(validKlarsprakText('Dere betaler 3 060 kroner i måneden fremover.', evidence, 'nb'), true);
  assert.equal(validKlarsprakText('Regelen om SFO gjelder dere. Dere betaler 3 060 kroner.', evidence, 'nb'), false, 'does not lead with the amount');
  assert.equal(validKlarsprakText('Dere betaler 4000 kroner i måneden.', evidence, 'nb'), false, 'amount not from the rule engine');
});

test('plainLanguageTemplate is deterministic and always passes validKlarsprakText, in both nb and vi', () => {
  const amounts = computeKlarsprakAmounts(612000, 0.06, 12, 4500);
  const evidence = klarsprakEvidence('Regel om SFO.', amounts, 612000, null);
  const nb = plainLanguageTemplate(amounts, 612000, 'SFO', 'nb');
  const vi = plainLanguageTemplate(amounts, 612000, 'SFO', 'vi');
  assert.equal(validKlarsprakText(nb, evidence, 'nb'), true);
  assert.equal(validKlarsprakText(vi, evidence, 'vi'), true);
  assert.ok(nb.includes(kroner(3060)));
  assert.ok(vi.includes(kroner(3060)));
  assert.ok(nb.includes(kroner(4500)) && vi.includes(kroner(4500)), 'same formatted amount in both languages');
});

test('plainLanguageTemplate states the ordinary price without a reduction claim when the cap does not lower it', () => {
  const amounts = computeKlarsprakAmounts(3000000, 0.06, 12, 4500);
  const evidence = klarsprakEvidence('Regel om SFO.', amounts, 3000000, null);
  const nb = plainLanguageTemplate(amounts, 3000000, 'SFO', 'nb');
  assert.equal(validKlarsprakText(nb, evidence, 'nb'), true);
  assert.doesNotMatch(nb, /rett til redusert betaling/);
});
