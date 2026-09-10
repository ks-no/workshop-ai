'use client';
import { Check, ArrowDown, Info, ArrowUpRight } from '@phosphor-icons/react';
import type { CaseView } from '../domain/types';
import { kroner, ore } from '../domain/format';
import { UDIR_SOURCE } from '../domain/rules';

export function AssessmentResult({ session }: { session: CaseView }) {
  const { assessment: result, data } = session;
  if (!result) return null;
  const calc = result.calculation;
  return <>
    {result.status === 'manual' && <div className="notice"><Info size={23} /><div><strong>En saksbehandler må se på dette</strong><p>{result.explanation}</p><p className="small">Registerinntekt: {data.income.value.annualNok === null ? 'mangler' : kroner(data.income.value.annualNok)}. {session.answers.currentIncomeNok !== undefined && `Oppgitt av deg: ${kroner(session.answers.currentIncomeNok)}.`}</p></div></div>}
    {calc && <section className="result-card" aria-label="Foreløpig prisberegning">
      <div className="result-top"><span>{result.basedOn === 'citizen' ? 'Prisanslag fra dine opplysninger' : 'Din foreløpige SFO-betaling'}</span><span className="result-badge">Demoberegning</span></div>
      <p className="result-price">{ore(calc.monthlyAfterOre)}<span>per betalingsmåned</span></p>
      <div className="result-comparison"><span>Før inntektsreduksjon <strong>{ore(calc.monthlyBeforeOre)}</strong></span><span><ArrowDown size={19} /> {ore(calc.monthlySavingOre)} mindre</span></div>
      <div className="result-footnote">{calc.freeHours > 0 ? `${calc.freeHours} gratis timer per uke er medregnet. ` : ''}Mat kommer i tillegg: {ore(calc.monthlyFoodOre)} per måned. {calc.paymentMonths} betalingsmåneder.</div>
    </section>}
    <details className="calculation-details"><summary>Se hvordan vi regnet <span>Regler, steg for steg</span></summary>
      {calc ? <dl className="calculation-lines"><div><dt>Årsinntekt som er brukt</dt><dd>{kroner(calc.incomeNok)}</dd></div><div><dt>Årspris før gratistimer og mat</dt><dd>{ore(calc.annualPriceOre)}</dd></div><div><dt>6 % av årsinntekten</dt><dd>{ore(calc.annualCapOre)}</dd></div>
        <div><dt>Betalte timer etter gratisandel</dt><dd>{data.sfo.value.hoursPerWeek - calc.freeHours} av {data.sfo.value.hoursPerWeek} timer</dd></div><div><dt>Pris etter reduksjon, per måned</dt><dd>{ore(calc.monthlyAfterOre)}</dd></div><div><dt>Sum med mat, per måned</dt><dd>{ore(calc.monthlyAfterOre + calc.monthlyFoodOre)}</dd></div></dl> : <p>{result.explanation}</p>}
      <p className="small">Dette er en avgrenset demoberegning. SFO-pris, {data.sfo.value.paymentMonths} betalingsmåneder og forholdsmessig fordeling av gratistimer er demoforutsetninger. Beløp avrundes til nærmeste øre. Ikke et vedtak.</p><a href={UDIR_SOURCE} target="_blank" rel="noreferrer">Les regelgrunnlaget hos Udir <ArrowUpRight size={16} /></a>
    </details>
    <div className="reason-list">{result.reasons.map(reason => <p key={reason}><Check size={18} />{reason}</p>)}</div>
  </>;
}
