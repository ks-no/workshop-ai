import { z } from 'zod';
import type { AssistantCase, Citation } from './assistant-types';
import { citationFor, confirmedValue } from './assistant-verification';

const storedAssessmentSchema = z.object({
  godkjent: z.boolean(),
  melding: z.string().min(1),
  grunnlag: z.object({
    ordningNavn: z.string().optional(),
    beregningsbeloep: z.number().finite().nonnegative().optional(),
    inntektsgrense: z.number().finite().nonnegative().optional(),
    gjelderFra: z.string().optional(),
  }).passthrough(),
}).passthrough();

export type SfoAnswer = {
  eligible: boolean;
  message: string;
  scheme: string | null;
  basisIncomeNok: number | null;
  thresholdNok: number | null;
  effectiveFrom: string | null;
  reportedIncomeNok: number | null;
  missingPartner: boolean;
  basisConflict: boolean;
  citation: Citation;
};

/** Present the stored deterministic KS result without asking a language model to reinterpret it. */
export function sfoAnswer(session: Pick<AssistantCase, 'sources' | 'facts'>): SfoAnswer | null {
  const source = session.sources.find(candidate => candidate.id === 'ks-assessment' && candidate.kind === 'register');
  if (!source) return null;
  let parsed: z.infer<typeof storedAssessmentSchema>;
  try { parsed = storedAssessmentSchema.parse(JSON.parse(source.text)); }
  catch { return null; }
  const citation = citationFor(source, source.text);
  if (!citation) return null;
  const reported = confirmedValue(session, 'household_income_annual');
  const reportedIncomeNok = reported !== undefined && /^\d+$/.test(reported) ? Number(reported) : null;
  const basisIncomeNok = parsed.grunnlag.beregningsbeloep ?? null;
  const missingPartner = confirmedValue(session, 'cohabitant_missing') === 'true';
  const basisConflict = missingPartner || (reportedIncomeNok !== null && basisIncomeNok !== null && reportedIncomeNok !== basisIncomeNok);
  return {
    eligible: parsed.godkjent,
    message: parsed.melding,
    scheme: parsed.grunnlag.ordningNavn ?? null,
    basisIncomeNok,
    thresholdNok: parsed.grunnlag.inntektsgrense ?? null,
    effectiveFrom: parsed.grunnlag.gjelderFra ?? null,
    reportedIncomeNok,
    missingPartner,
    basisConflict,
    citation,
  };
}
