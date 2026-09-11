import type { AssistantCase, ModelRole } from '../domain/assistant-types';
import type { KsDemoRevisjonshendelse } from '../providers/ks-demo-client';
import { UDIR_SOURCE } from '../domain/rules';
import { readModelCalls } from './model-call-log';

export type InnsynEvent = {
  id: string; at: string; kind: 'samtykke' | 'oppslag' | 'modellkall' | 'regelberegning' | 'bekreftelse';
  title: string; detail: string;
  endpoint?: string; scope?: string; syntetisk?: boolean;
  model?: string; role?: ModelRole; latencyMs?: number | null; strippedFields?: string[];
  terskel?: string; inndata?: Record<string, unknown>; beregning?: string; utfall?: string; hjemmel?: string;
};

/** Never show identifiers that could re-identify the innbygger. person-022 is a synthetic test id, not a fødselsnummer. */
function withoutFoedselsnummer(aktor: KsDemoRevisjonshendelse['aktor']) {
  return { type: aktor.type, acr: aktor.acr ?? null };
}

/**
 * One read-only timeline for one sporingsId, joining what this app already keeps on the
 * session (register reads, model runs, citizen decisions) with the KS sandbox's own
 * revisjonslogg for the same id, so the two can be cross-checked in the innsyn tab.
 */
export function buildInnsynTimeline(session: AssistantCase, revisjon: KsDemoRevisjonshendelse[] = []): InnsynEvent[] {
  const events: InnsynEvent[] = [];

  for (const item of session.events) {
    if (item.type !== 'human') continue;
    const kind = /samtykke/i.test(item.detail) ? 'samtykke' : 'bekreftelse';
    events.push({ id: item.id, at: item.at, kind, title: kind === 'samtykke' ? 'Samtykke' : 'Innbyggerbekreftelse', detail: item.detail });
  }

  for (const source of session.sources) {
    if (source.kind !== 'register') continue;
    events.push({
      id: source.id, at: source.retrievedAt, kind: 'oppslag', title: source.title, detail: source.purpose,
      endpoint: source.url ?? undefined, scope: source.scope, syntetisk: true,
    });
  }

  for (const call of readModelCalls(session.id)) {
    events.push({
      id: `${call.agent}-${call.at}`, at: call.at, kind: 'modellkall', title: `Modellkall: ${call.agent}`,
      detail: call.status === 'failed' ? 'Modellkallet feilet.' : 'Strukturert svar mottatt og kontrollert.',
      model: call.model, role: call.role, latencyMs: call.durationMs, strippedFields: call.strippedFields,
    });
  }

  const rates = session.sources.find(item => item.id === 'ks-rates');
  const income = session.sources.find(item => item.id === 'ks-income');
  const assessment = session.sources.find(item => item.id === 'ks-assessment');
  const guidance = session.sources.find(item => item.id === 'guidance-sfo');
  // A stored snapshot that no longer parses must cost the rule step, not the whole timeline.
  try {
    if (rates && income) {
      const ratesData = JSON.parse(rates.text) as { maksAndelAvInntekt: number; maanederMedBetaling: number; gjelderFra: string };
      const incomeData = JSON.parse(income.text) as { beregningsbeloep: number; inntektsaar: number };
      const assessmentData = assessment ? JSON.parse(assessment.text) as { godkjent?: boolean; melding?: string } : null;
      const andel = Math.round(ratesData.maksAndelAvInntekt * 100);
      events.push({
        id: 'regelberegning-sfo', at: income.retrievedAt, kind: 'regelberegning', title: 'Regelberegning: SFO-betaling',
        detail: assessmentData ? String(assessmentData.melding ?? '') : 'Vurdering ikke lest ennå.',
        terskel: `${andel} % av årsinntekten (satser gjeldende fra ${ratesData.gjelderFra})`,
        inndata: { aarsinntekt: incomeData.beregningsbeloep, inntektsaar: incomeData.inntektsaar },
        beregning: `Maks foreldrebetaling = ${andel} % av årsinntekten på ${incomeData.beregningsbeloep} kr, fordelt over ${ratesData.maanederMedBetaling} betalingsmåneder.`,
        utfall: assessmentData ? (assessmentData.godkjent ? 'Innvilget' : 'Ikke innvilget') : 'Ikke vurdert',
        hjemmel: guidance ? `${guidance.text} (${guidance.url})` : UDIR_SOURCE,
      });
    }
  } catch { /* Timeline stays readable without the rule step. */ }

  for (const item of revisjon) {
    events.push({
      id: item.hendelseId, at: item.tidspunkt, kind: 'oppslag', title: `Revisjonslogg: ${item.handling}`,
      detail: `Ressurs: ${item.ressurs}. Aktør: ${JSON.stringify(withoutFoedselsnummer(item.aktor))}.`, syntetisk: true,
    });
  }

  return events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
