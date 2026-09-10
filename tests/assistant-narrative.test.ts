import { test } from 'node:test';
import assert from 'node:assert/strict';
import { narrativeWithinEvidence, validateProposal } from '../src/domain/assistant-verification';

test('generated interpretation cannot invent numbers or assert completed official actions', () => {
  const evidence = 'Husleien er 12000 kroner. Bostøtte er en støtteordning.';
  assert.equal(narrativeWithinEvidence('Oppgitt husleie er 12 000 kroner.', evidence), true);
  for (const text of ['Du kan få 10000 kroner.', 'Søknaden er allerede sendt til kommunen.', 'Saken din ble godkjent.', 'Du har rett til bostøtte.', 'We have submitted your application.']) {
    assert.equal(narrativeWithinEvidence(text, evidence), false, text);
  }
  assert.equal(narrativeWithinEvidence('Ingen søknad er sendt. Kommunen må vurdere opplysningene.', evidence), true);
  assert.equal(narrativeWithinEvidence('Du må selv sende søknaden til kommunen.', evidence), true);
});

test('prose grouping follows the response language without confusing decimal separators', () => {
  const evidence = 'Husleien er 13500 kroner.';
  assert.equal(narrativeWithinEvidence('Tiền thuê nhà là 13.500 kr.', evidence, 'vi'), true);
  assert.equal(narrativeWithinEvidence('Your stated rent is 13,500 kr.', evidence, 'en'), true);
  assert.equal(narrativeWithinEvidence('Oppgitt husleie er 13\u00a0500 kr.', evidence, 'nb'), true);
  assert.equal(narrativeWithinEvidence('Your stated rent is 13.500 kr.', evidence, 'en'), false);
  assert.equal(narrativeWithinEvidence('Tiền thuê nhà là 13,500 kr.', evidence, 'vi'), false);
  assert.equal(narrativeWithinEvidence('Oppgitt husleie er 13.500 kr.', evidence, 'nb'), false);
  assert.equal(narrativeWithinEvidence('Tiền thuê nhà là 14.500 kr.', evidence, 'vi'), false);
});

test('locale grouping validates the whole token and preserves large integers and signs exactly', () => {
  assert.equal(narrativeWithinEvidence('Số tiền: 1.234.567 kr.', 'Beløp 1234567 kroner.', 'vi'), true);
  assert.equal(narrativeWithinEvidence('Amount: 1,234,567 kr.', 'Beløp 1234567 kroner.', 'en'), true);
  assert.equal(narrativeWithinEvidence('Số tiền: 9.007.199.254.740.993 kr.', 'Beløp 9007199254740993 kroner.', 'vi'), true);
  assert.equal(narrativeWithinEvidence('Số tiền: 9.007.199.254.740.994 kr.', 'Beløp 9007199254740993 kroner.', 'vi'), false);
  for (const malformed of ['13.50.0', '1.3500', '135.00']) {
    assert.equal(narrativeWithinEvidence(`Số tiền: ${malformed} kr.`, 'Beløp 13500 kroner.', 'vi'), false);
  }
  assert.equal(narrativeWithinEvidence('Amount: -13,500 kr.', 'Beløp 13500 kroner.', 'en'), false);
  assert.equal(narrativeWithinEvidence('Amount: -13,500 kr.', 'Beløp -13500 kroner.', 'en'), true);
  assert.equal(narrativeWithinEvidence('Amount: 13,500.50 kr.', 'Beløp 13500.50 kroner.', 'en'), true);
  assert.equal(narrativeWithinEvidence('Số tiền: 13.500,50 kr.', 'Beløp 13500,50 kroner.', 'vi'), true);
});

test('source separators remain literal and prose locale handling never changes fact extraction', () => {
  assert.equal(narrativeWithinEvidence('Tiền thuê nhà là 13.500 kr.', 'Husleie 13 500 kroner.', 'vi'), true);
  assert.equal(narrativeWithinEvidence('Tiền thuê nhà là 13500 kr.', 'Husleie 13.500 kroner.', 'vi'), false);
  assert.equal(narrativeWithinEvidence('Your rent is 13500 kr.', 'Husleie 13,500 kroner.', 'en'), false);
  assert.equal(narrativeWithinEvidence('Tiền thuê nhà là 13,500 kr.', 'Husleie 13.500 kroner.', 'vi'), false);
  assert.equal(narrativeWithinEvidence('Số tiền: 13.500,50 kr.', 'Beløp 13500.50 kroner.', 'vi'), false);
  assert.equal(narrativeWithinEvidence('Rent: 13.500 kr.', 'Beløp 13500 kroner.', 'unknown'), false);
  const source = { id: 'original-source', kind: 'conversation' as const, title: 'Original source', text: 'Tiền thuê nhà là 13.500 kr.', url: null, retrievedAt: '2026-09-03', purpose: 'Test', period: '2026' };
  assert.equal(validateProposal({ key: 'monthly_rent', value: '13500', sourceId: source.id, quote: source.text }, [source]), null);
});

test('locale-aware prose still blocks completed-action claims and works inside bullets and tables', () => {
  const evidence = 'Husleie 13500 kroner.';
  for (const locale of ['nb', 'en', 'vi']) {
    assert.equal(narrativeWithinEvidence('We have submitted your application.', evidence, locale), false);
    assert.equal(narrativeWithinEvidence('Søknaden er allerede sendt.', evidence, locale), false);
  }
  assert.equal(narrativeWithinEvidence('- Tiền thuê nhà: **13.500 kr**\n- Hãy kiểm tra tài liệu.', evidence, 'vi'), true);
  assert.equal(narrativeWithinEvidence('| Mục | Giá trị |\n| --- | --- |\n| Tiền thuê nhà | 13.500 kr |', evidence, 'vi'), true);
  assert.equal(narrativeWithinEvidence('| Rent | 99,999 kr |', evidence, 'en'), false);
});
