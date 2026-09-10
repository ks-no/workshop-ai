import { factKeys, type AssistantCase, type Citation, type EvidenceSource, type FactKey, type ProposedFact } from './assistant-types';

export const FACT_LABELS: Record<FactKey, string> = {
  job_lost: 'Har mistet jobben', has_children: 'Har barn', uses_sfo: 'Bruker SFO',
  needs_housing: 'Ønsker hjelp med bolig', moving: 'Skal flytte',
  household_income_annual: 'Husholdningens årsinntekt (kr)', income_basis: 'Hva inntekten gjelder',
  monthly_rent: 'Månedlig husleie (kr)', household_size: 'Antall personer i husholdningen',
  move_date: 'Flyttedato', new_municipality: 'Ny kommune', cohabitant_missing: 'Samboer mangler i grunnlaget',
};

/** A citation proves where text appeared, not that its assertion is true. */
export function citationFor(source: EvidenceSource, quote: string): Citation | null {
  if (typeof quote !== 'string' || !quote.trim() || quote.length > 2000 || !source.text.includes(quote)) return null;
  const page = source.pages?.find(candidate => candidate.text.includes(quote));
  if (source.pages && !page) return null;
  if (page && (!Number.isInteger(page.page) || page.page < 1)) return null;
  const text = page?.text ?? source.text;
  const offset = text.indexOf(quote);
  const lineStart = text.slice(0, offset).split('\n').length;
  return { sourceId: source.id, quote, lineStart, lineEnd: lineStart + quote.split('\n').length - 1, page: page?.page ?? null };
}

const booleanKeys = new Set<FactKey>(['job_lost', 'has_children', 'uses_sfo', 'needs_housing', 'moving', 'cohabitant_missing']);
const numericLimits: Partial<Record<FactKey, [number, number]>> = {
  household_income_annual: [0, 100_000_000], monthly_rent: [0, 1_000_000], household_size: [1, 30],
};

function citedNumber(quote: string, value: string): boolean {
  // Preserve scalar meaning: never derive annual income from a monthly amount or use a substring of a larger amount.
  const tokens = quote.matchAll(/[+\-]?\d+(?:[ \u00a0\u202f]\d{3})*(?:[.,]\d+)?/g);
  return [...tokens].some(token => token[0].replace(/[ \u00a0\u202f]/g, '') === value
    && !/[\p{L}\p{N}]/u.test(quote[token.index - 1] ?? '')
    && !/[\p{L}\p{N}]/u.test(quote[token.index + token[0].length] ?? ''));
}

function validDate(value: string, quote: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return false;
  const [year, month, day] = value.split('-');
  const variants = [value, `${day}.${month}.${year}`, `${Number(day)}.${Number(month)}.${year}`];
  return variants.some(date => {
    const index = quote.indexOf(date);
    return index >= 0 && !/\d/.test(quote[index - 1] ?? '') && !/\d/.test(quote[index + date.length] ?? '');
  });
}

/** Validated model output is still a proposal; human confirmation is the only route to a confirmed fact. */
export function validateProposal(proposal: ProposedFact, sources: EvidenceSource[]): { citation: Citation; value: string } | null {
  if (!proposal || !factKeys.includes(proposal.key) || typeof proposal.value !== 'string') return null;
  const matching = sources.filter(source => source.id === proposal.sourceId);
  if (matching.length !== 1 || matching[0].kind === 'guidance') return null;
  const citation = citationFor(matching[0], proposal.quote);
  if (!citation) return null;
  const value = proposal.value.trim();
  if (!value || value.length > 200) return null;
  if (booleanKeys.has(proposal.key)) return value === 'true' || value === 'false' ? { citation, value } : null;
  const limits = numericLimits[proposal.key];
  if (limits) {
    if (!/^(0|[1-9]\d*)$/.test(value)) return null;
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < limits[0] || number > limits[1] || !citedNumber(citation.quote, value)) return null;
  } else if (proposal.key === 'move_date') {
    if (!validDate(value, citation.quote)) return null;
  } else if (proposal.key === 'income_basis') {
    if (!['household_year', 'individual_year', 'month', 'unknown'].includes(value)) return null;
  } else if (proposal.key === 'new_municipality' && !citation.quote.includes(value)) return null;
  return { citation, value };
}

export function confirmedValue(session: Pick<AssistantCase, 'facts'>, key: FactKey): string | undefined {
  const relevant = session.facts.filter(fact => fact.key === key);
  if (relevant.some(fact => fact.status === 'conflict')) return undefined;
  const confirmed = relevant.filter(fact => fact.status === 'confirmed');
  const values = new Set(confirmed.map(fact => fact.value));
  return values.size === 1 ? confirmed[0].value : undefined;
}

function narrativeNumbers(input: string): string[] {
  return [...input.matchAll(/[+\-]?\d+(?:[.,]\d+|[ \u00a0\u202f]\d{3}(?!\d))*/g)].map(match => match[0]);
}

function narrativeNumberFormat(language: string) {
  if (!/^(?:nb|nn|no|en|vi)(?:-[A-Z]{2})?$/.test(language)) return undefined;
  const formatter = new Intl.NumberFormat(language.replace(/^no(?=-|$)/, 'nb'));
  const parts = formatter.formatToParts(12345.6);
  return { formatter, group: parts.find(part => part.type === 'group')!.value, decimal: parts.find(part => part.type === 'decimal')!.value };
}

function ungroupNarrativeNumber(token: string, format: ReturnType<typeof narrativeNumberFormat>): string | undefined {
  if (!format) return undefined;
  const sign = /^[+\-]/.test(token) ? token[0] : '';
  const unsigned = sign ? token.slice(1) : token;
  const pieces = unsigned.split(format.decimal);
  if (pieces.length > 2 || (pieces[1] !== undefined && !/^\d+$/.test(pieces[1]))) return undefined;
  const whole = /[ \u00a0\u202f]/.test(format.group) ? pieces[0].replace(/[ \u00a0\u202f]/g, format.group) : pieces[0];
  const integer = whole.split(format.group).join('');
  if (!/^\d+$/.test(integer)) return undefined;
  // Reformat the whole integer to validate grouping, without rounding through Number.
  if (whole.includes(format.group) && format.formatter.format(BigInt(integer)) !== whole) return undefined;
  // Decimal marks remain literal: the language of an evidence source is not assumed.
  return sign + integer + (pieces[1] === undefined ? '' : format.decimal + pieces[1]);
}

/** A bounded check for fabricated amounts/actions, not a proof of semantic truth. */
export function narrativeWithinEvidence(text: string, evidence: string, responseLanguage = 'nb'): boolean {
  const decisive = /\b(?:du (?:har rett til|får utbetalt|er innvilget)|(?:søknaden|saken) (?:din )?(?:er|ble) (?:allerede )?(?:godkjent|innvilget|sendt)|(?:vi|jeg) har (?:sendt|godkjent|innvilget)|you (?:are entitled|have been approved)|(?:application|case) (?:has been|is|was) (?:approved|submitted)|we (?:have submitted|approved))\b/i;
  if (decisive.test(text)) return false;
  const removeSpaces = (number: string) => number.replace(/[ \u00a0\u202f]/g, '');
  const supported = new Set(narrativeNumbers(evidence).map(removeSpaces));
  const format = narrativeNumberFormat(responseLanguage);
  return narrativeNumbers(text).every(number => {
    if (supported.has(removeSpaces(number))) return true;
    const ungrouped = ungroupNarrativeNumber(number, format);
    return ungrouped !== undefined && supported.has(ungrouped);
  });
}
