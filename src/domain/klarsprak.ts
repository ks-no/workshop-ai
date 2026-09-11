import { z } from 'zod';
import type { EvidenceSource } from './assistant-types';
import { narrativeWithinEvidence } from './assistant-verification';
import { kroner } from './format';

const sfoPlaceSchema = z.object({
  sfonavn: z.string().min(1), kommune: z.string().min(1), trinn: z.number(),
  manedspris: z.number().finite().nonnegative(), syntetisk: z.boolean().optional(),
}).passthrough();
const ordningSchema = z.object({
  navn: z.string().min(1), tjeneste: z.string().min(1), regel: z.string().min(1), beskrivelse: z.string().optional(),
}).passthrough();
const ratesSchema = z.object({
  gjelderFra: z.string().min(1), kilde: z.string().min(1),
  maksAndelAvInntekt: z.number().min(0).max(1), maanederMedBetaling: z.number().int().min(1).max(12),
  ordninger: z.array(ordningSchema),
}).passthrough();

export type KlarsprakSources = { place: z.infer<typeof sfoPlaceSchema>; rates: z.infer<typeof ratesSchema>; ordning: z.infer<typeof ordningSchema> };

/** The SFO place and rates are read from already-fetched KS sources, never a fresh sandbox call. */
export function parseKlarsprakSources(sources: EvidenceSource[]): KlarsprakSources | null {
  const sfoSource = sources.find(item => item.id === 'ks-sfo');
  const ratesSource = sources.find(item => item.id === 'ks-rates');
  if (!sfoSource || !ratesSource) return null;
  try {
    const places = z.array(sfoPlaceSchema).min(1).parse(JSON.parse(sfoSource.text));
    const rates = ratesSchema.parse(JSON.parse(ratesSource.text));
    const ordning = rates.ordninger.find(item => item.tjeneste === 'sfo');
    if (!ordning) return null;
    return { place: places[0], rates, ordning };
  } catch { return null; }
}

export type KlarsprakAmounts = {
  monthlyBeforeNok: number; capSharePercent: number; paymentMonths: number;
  monthlyCapNok: number; monthlyAfterNok: number; monthlySavingNok: number;
};

/** The only place amounts are derived. Every candidate klarspråk text is checked against these, never trusted on its own. */
export function computeKlarsprakAmounts(incomeNok: number, capShare: number, paymentMonths: number, monthlyPriceNok: number): KlarsprakAmounts {
  const monthlyCapNok = Math.round((incomeNok * capShare) / paymentMonths);
  const monthlyAfterNok = Math.min(monthlyPriceNok, monthlyCapNok);
  return {
    monthlyBeforeNok: monthlyPriceNok, capSharePercent: Math.round(capShare * 1000) / 10, paymentMonths,
    monthlyCapNok, monthlyAfterNok, monthlySavingNok: monthlyPriceNok - monthlyAfterNok,
  };
}

/** Presents the stored regel/beskrivelse and satsgrunnlag fields as they stand, not a paraphrase. */
export function regulationText(sources: KlarsprakSources): string {
  const { rates, ordning } = sources;
  return [
    ordning.regel, ordning.beskrivelse,
    `Maks andel av inntekt: ${Math.round(rates.maksAndelAvInntekt * 1000) / 10} %. Betaling fordeles over ${rates.maanederMedBetaling} måneder.`,
    `Kilde: ${rates.kilde}, gjeldende fra ${rates.gjelderFra}.`,
  ].filter((part): part is string => Boolean(part)).join(' ');
}

/** Every number a klarspråk candidate may legitimately use, so narrativeWithinEvidence can reject anything else. */
export function klarsprakEvidence(regulation: string, amounts: KlarsprakAmounts, incomeNok: number, thresholdNok: number | null): string {
  const numbers = [amounts.monthlyBeforeNok, amounts.monthlyCapNok, amounts.monthlyAfterNok, amounts.monthlySavingNok,
    amounts.capSharePercent, amounts.paymentMonths, incomeNok, thresholdNok].filter((value): value is number => value !== null);
  return `${regulation} ${numbers.join(' ')}`;
}

// The issue's own example splits consequence and amount across two sentences ("Dere har rett til
// redusert betaling. Månedsprisen går fra 4 500 til 3 060 kroner."), so the amount only needs to land
// within the first two sentences, not the very first. But the opening sentence still must not be the
// legal basis itself (the thing the citizen is meant to hear last, not first).
const ruleReference = /\b(regel(en)?|forskrift(en)?|paragraf(en)?|lov(en)?|regulation|rule|section|quy định)\b/i;
function leadsWithAmount(text: string): boolean {
  const sentences = text.split(/(?<=[.!?])\s/);
  const lead = sentences.slice(0, 2).join(' ');
  return /\d/.test(lead) && !ruleReference.test(sentences[0] ?? '');
}

/** Gate reused for every candidate text, whichever of ai-gateway/own-model/template produced it. */
export function validKlarsprakText(text: string, evidence: string, language: string): boolean {
  return text.trim().length > 0 && leadsWithAmount(text) && narrativeWithinEvidence(text, evidence, language);
}

/** Deterministic last resort: no model involved, so it always passes validKlarsprakText. */
export function plainLanguageTemplate(amounts: KlarsprakAmounts, incomeNok: number, scheme: string, language: 'nb' | 'vi'): string {
  const before = kroner(amounts.monthlyBeforeNok); const after = kroner(amounts.monthlyAfterNok);
  const cap = kroner(amounts.monthlyCapNok); const income = kroner(incomeNok);
  const reduced = amounts.monthlyAfterNok < amounts.monthlyBeforeNok;
  if (language === 'vi') {
    return reduced
      ? `Quý vị được giảm mức phí ${scheme}. Giá mỗi tháng giảm từ ${before} xuống còn ${after}. Theo quy định, hộ gia đình tối đa phải trả ${amounts.capSharePercent} % thu nhập hằng năm cho ${scheme}, chia đều trong ${amounts.paymentMonths} tháng. Với thu nhập làm căn cứ là ${income}, mức trần hằng tháng là ${cap}, thấp hơn giá thông thường ${before}. Quý vị trả ${after} mỗi tháng cho đến khi thu nhập hoặc chỗ học thay đổi.`
      : `Quý vị trả giá thông thường cho ${scheme}: ${before} mỗi tháng. Quy định giới hạn mức phí ở ${amounts.capSharePercent} % thu nhập hằng năm, chia đều trong ${amounts.paymentMonths} tháng. Với thu nhập làm căn cứ là ${income}, mức trần là ${cap} mỗi tháng, không thấp hơn giá thông thường, nên không có giảm giá.`;
  }
  return reduced
    ? `Dere har rett til redusert betaling for ${scheme}. Månedsprisen går fra ${before} til ${after}. Regelen sier at husholdningen høyst skal betale ${amounts.capSharePercent} % av årsinntekten til ${scheme}, fordelt over ${amounts.paymentMonths} måneder. Med et inntektsgrunnlag på ${income} blir taket ${cap} i måneden, som er lavere enn ordinær pris på ${before}. Dere betaler ${after} i måneden helt til inntekten eller plassen endres.`
    : `Dere betaler ordinær pris for ${scheme}: ${before} i måneden. Regelen setter et tak på ${amounts.capSharePercent} % av årsinntekten til ${scheme}, fordelt over ${amounts.paymentMonths} måneder. Med et inntektsgrunnlag på ${income} blir taket ${cap} i måneden, som ikke er lavere enn ordinær pris, så det gis ingen reduksjon.`;
}
