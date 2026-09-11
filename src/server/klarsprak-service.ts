import { z } from 'zod';
import type { AssistantCase } from '../domain/assistant-types';
import { computeKlarsprakAmounts, klarsprakEvidence, parseKlarsprakSources, plainLanguageTemplate, regulationText, validKlarsprakText } from '../domain/klarsprak';
import { sfoAnswer } from '../domain/sfo-answer';
import { callModel, type ModelCall } from './assistant-model';

export type KlarsprakSource = 'ai-gateway' | 'own-model' | 'template';
export type KlarsprakContrast = { regulationText: string; texts: { nb: string; vi: string }; source: KlarsprakSource };

const gatewayResponseSchema = z.object({ nb: z.string().min(1).max(2000), vi: z.string().min(1).max(2000) }).strict();

function gatewayOrigin(): string | null {
  try {
    const url = new URL(process.env.AI_GATEWAY_BASE_URL || 'http://127.0.0.1:8082');
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    return url.origin;
  } catch { return null; }
}

const KLARSPRAK_PROMPT = 'Rewrite the supplied Norwegian regulation text and the already-computed amounts as a short, plain-language (klarspråk) explanation for a citizen, in Norwegian Bokmål (nb) and Vietnamese (vi). Output ONLY the requested JSON with nb and vi string properties. Lead the first sentence with the consequence and the monthly krone amount, not the legal basis. Then explain briefly how the percentage rule produced that amount. Then state what remains (what the citizen still pays, or what could change the result). Use ONLY the numbers already given in the context; never compute, convert or invent a number. This is an explanation of an already-computed result, not a decision.';

/** Never trusts a candidate's own numbers: every source below is re-checked against the rule-engine evidence before use. */
async function fromAiGateway(context: unknown, evidence: string, fetchImpl: typeof fetch): Promise<{ nb: string; vi: string } | null> {
  const origin = gatewayOrigin();
  if (!origin) return null;
  let response: Response;
  try {
    response = await fetchImpl(`${origin}/ai/klarsprak`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(context), signal: AbortSignal.timeout(5000), cache: 'no-store',
    });
  } catch { return null; }
  if (!response.ok) return null;
  let data: unknown;
  try { data = await response.json(); } catch { return null; }
  const parsed = gatewayResponseSchema.safeParse(data);
  if (!parsed.success) return null;
  if (!validKlarsprakText(parsed.data.nb, evidence, 'nb') || !validKlarsprakText(parsed.data.vi, evidence, 'vi')) return null;
  return parsed.data;
}

async function fromOwnModel(context: unknown, evidence: string, infer: ModelCall): Promise<{ nb: string; vi: string } | null> {
  try {
    const result = await infer(KLARSPRAK_PROMPT, context, gatewayResponseSchema, 'draft');
    if (!validKlarsprakText(result.nb, evidence, 'nb') || !validKlarsprakText(result.vi, evidence, 'vi')) return null;
    return result;
  } catch { return null; }
}

/** ai-gateway (sandbox, explain-only) first, then our own model, then the deterministic template. All three read the same rule-engine amounts. */
export async function buildKlarsprakContrast(session: Pick<AssistantCase, 'sources' | 'facts'>,
  options: { fetchImpl?: typeof fetch; infer?: ModelCall } = {}): Promise<KlarsprakContrast | null> {
  const answer = sfoAnswer(session);
  if (!answer || answer.basisConflict || answer.basisIncomeNok === null) return null;
  const sources = parseKlarsprakSources(session.sources);
  if (!sources) return null;
  const amounts = computeKlarsprakAmounts(answer.basisIncomeNok, sources.rates.maksAndelAvInntekt, sources.rates.maanederMedBetaling, sources.place.manedspris);
  const scheme = answer.scheme ?? sources.ordning.navn;
  const regulation = regulationText(sources);
  const evidence = klarsprakEvidence(regulation, amounts, answer.basisIncomeNok, answer.thresholdNok);
  const context = {
    regulationText: regulation, scheme, incomeNok: answer.basisIncomeNok, monthlyBeforeNok: amounts.monthlyBeforeNok,
    monthlyAfterNok: amounts.monthlyAfterNok, monthlyCapNok: amounts.monthlyCapNok, monthlySavingNok: amounts.monthlySavingNok,
    capSharePercent: amounts.capSharePercent, paymentMonths: amounts.paymentMonths,
  };
  const fetchImpl = options.fetchImpl ?? fetch;
  const infer = options.infer ?? callModel;
  let texts = await fromAiGateway(context, evidence, fetchImpl);
  let source: KlarsprakSource = 'ai-gateway';
  if (!texts) { texts = await fromOwnModel(context, evidence, infer); source = 'own-model'; }
  if (!texts) {
    texts = { nb: plainLanguageTemplate(amounts, answer.basisIncomeNok, scheme, 'nb'), vi: plainLanguageTemplate(amounts, answer.basisIncomeNok, scheme, 'vi') };
    source = 'template';
  }
  return { regulationText: regulation, texts, source };
}
