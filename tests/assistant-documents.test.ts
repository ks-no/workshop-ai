import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDocument } from '../src/server/assistant-documents';
import { citationFor } from '../src/domain/assistant-verification';

const bytes = (text: string) => new TextEncoder().encode(text);

/** Build a real, uncompressed PDF with correct object offsets and one text stream per page. */
function pdf(pageTexts: string[]): Uint8Array {
  const objects: string[] = [];
  const pageIds = pageTexts.map((_, index) => 4 + index * 2);
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pageTexts.forEach((text, index) => {
    const pageId = pageIds[index];
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`);
    const escaped = text.replace(/([\\()])/g, '\\$1');
    const content = text ? `BT /F1 12 Tf 50 750 Td (${escaped}) Tj ET` : '';
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  });
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return bytes(output);
}

test('UTF-8 text is actually extracted with preserved Unicode and precise line citations', async () => {
  const source = await extractDocument('../lønn\\oppgave.txt', bytes('Lønnsoppgave\r\nÅrsinntekt: 320000 kr\r\nTôi cần hỗ trợ.'));
  assert.equal(source.kind, 'document');
  assert.equal(source.title, '..lønnoppgave.txt');
  assert.equal(source.text, 'Lønnsoppgave\nÅrsinntekt: 320000 kr\nTôi cần hỗ trợ.');
  assert.equal(source.pages?.length, 1);
  const citation = citationFor(source, 'Årsinntekt: 320000 kr');
  assert.equal(citation?.page, 1);
  assert.equal(citation?.lineStart, 2);
  assert.equal(citation?.lineEnd, 2);
});

test('real two-page PDF extraction preserves text and identifies the cited page', async () => {
  const source = await extractDocument('lease.pdf', pdf(['Lease agreement. Monthly rent is 12000 NOK.', 'Move date is 2026-10-01. Municipality: Bergen.']));
  assert.equal(source.pages?.length, 2);
  assert.match(source.pages![0].text, /Monthly rent is 12000 NOK/);
  assert.match(source.pages![1].text, /Municipality: Bergen/);
  const citation = citationFor(source, 'Move date is 2026-10-01.');
  assert.equal(citation?.page, 2);
  assert.equal(citation?.lineStart, 1);
  assert.ok(source.text.includes(citation!.quote));
});

test('empty/scanned PDFs and more than ten pages are rejected explicitly', async () => {
  await assert.rejects(extractDocument('scan.pdf', pdf([''])), /nok lesbar tekst|Skannet PDF/);
  await assert.rejects(extractDocument('too-many-pages.pdf', pdf(Array.from({ length: 11 }, () => 'An actual page with readable test text.'))), /inntil ti sider/);
});

test('unsupported, malformed, non-UTF-8 and binary documents never produce evidence', async () => {
  await assert.rejects(extractDocument('photo.png', bytes('Not a supported document image.')), /TXT-fil eller en PDF/);
  await assert.rejects(extractDocument('renamed.pdf', bytes('Plain text renamed as a PDF file.')), /TXT-fil eller en PDF/);
  await assert.rejects(extractDocument('broken.pdf', bytes('%PDF-1.4\nThis is malformed, not a valid PDF document.')), /PDF-en kunne ikke leses/);
  await assert.rejects(extractDocument('bad-encoding.txt', Uint8Array.from([0xc3, 0x28, ...bytes('Long enough content')])), /UTF-8/);
  await assert.rejects(extractDocument('binary.txt', bytes('Long enough but contains a\u0000binary control.')), /nok lesbar tekst/);
});

test('upload byte and text limits are enforced at their boundaries', async () => {
  await assert.rejects(extractDocument('empty.txt', new Uint8Array()), /1 byte/);
  await assert.rejects(extractDocument('oversized.txt', new Uint8Array(1_500_001)), /1,5 MB/);
  await assert.rejects(extractDocument('short.txt', bytes('Too short')), /nok lesbar tekst/);
  const allowed = await extractDocument('limit.txt', bytes('a'.repeat(14000)));
  assert.equal(allowed.text.length, 14000);
  await assert.rejects(extractDocument('long.txt', bytes('a'.repeat(14001))), /14 000 tegn/);
});
