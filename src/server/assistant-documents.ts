import { randomUUID } from 'node:crypto';
import type { EvidenceSource } from '../domain/assistant-types';
import { CaseError } from './case-service';

export async function extractDocument(name: string, bytes: Uint8Array): Promise<EvidenceSource> {
  if (!bytes.length || bytes.length > 1_500_000) throw new CaseError('Dokumentet må være mellom 1 byte og 1,5 MB.', 413);
  const title = name.replace(/[\u0000-\u001f/\\]/g, '').slice(0, 120) || 'Dokument';
  let pages: { page: number; text: string }[];
  if (/\.txt$/i.test(title)) {
    try { pages = [{ page: 1, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n/g, '\n') }]; }
    catch { throw new CaseError('Tekstfilen må være lagret som UTF-8.'); }
  } else if (/\.pdf$/i.test(title) && new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-') {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: bytes, isEvalSupported: false, verbosity: 0 });
    try {
      const info = await parser.getInfo();
      if (info.total > 10) throw new CaseError('Bruk et dokument med inntil ti sider.', 413);
      const extracted = await parser.getText();
      pages = extracted.pages.map(page => ({ page: page.num, text: page.text.replace(/\r\n/g, '\n') }));
    } catch (error) {
      if (error instanceof CaseError) throw error;
      throw new CaseError('PDF-en kunne ikke leses. Bruk en ulåst PDF med tekst, eller lim inn teksten i en TXT-fil.');
    } finally { await parser.destroy(); }
  } else throw new CaseError('Bruk en TXT-fil eller en PDF med lesbar tekst. Bilder og skannede dokumenter støttes ikke ennå.', 415);
  const text = pages.map(page => page.text).join('\n\n');
  if (text.trim().length < 15 || text.includes('\u0000')) throw new CaseError('Dokumentet inneholder ikke nok lesbar tekst. Skannet PDF krever tekstgjenkjenning; lim inn teksten som TXT.');
  if (text.length > 14000) throw new CaseError('Dokumentet har for mye tekst. Bruk et utdrag på inntil 14 000 tegn.', 413);
  return { id: `document-${randomUUID()}`, kind: 'document', title, text, pages, url: null,
    retrievedAt: new Date().toISOString(), purpose: 'Foreslå dokumenterte opplysninger som du selv må kontrollere.', period: 'Dokumentets dato og periode må bekreftes av deg.' };
}
