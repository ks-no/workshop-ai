import type { Answers, Assessment, Calculation, CitizenData } from './types';

export const RULE_VERSION = 'sfo-demo-2026-09';
export const UDIR_SOURCE = 'https://www.udir.no/regelverk-og-tilsyn/skole-og-opplaring/rundskriv-om-skolefritidsordninga/finansiering-av-skolefritidsordninga/';

/** Pure calculation. Prices and proportional allocation of free hours are demo assumptions. */
export function assess(data: CitizenData, answers: Answers): Assessment {
  const result: Assessment = {
    status: 'missing', title: 'Vi mangler en opplysning', explanation: '',
    missing: [], calculation: null, ruleVersion: RULE_VERSION, basedOn: 'registry', reasons: [],
  };
  if (!answers.cohabitant) result.missing.push('cohabitant');
  if (!answers.informationConfirmed) result.missing.push('confirmation');
  const income = answers.currentIncomeNok ?? data.income.value.annualNok;
  if (income === null && answers.correction !== 'other') result.missing.push('income');
  if (result.missing.length) return { ...result, explanation: 'Vi spør bare om det vi ikke kan hente eller bekrefte selv.' };

  const place = data.sfo.value;
  const validIncome = income !== null && Number.isSafeInteger(income) && income >= 0 && income <= 100_000_000;
  const validPrice = Number.isFinite(place.monthlyPriceNok) && place.monthlyPriceNok >= 0;
  const validPlace = Number.isInteger(place.grade) && place.grade >= 1 && place.grade <= 7
    && Number.isFinite(place.hoursPerWeek) && place.hoursPerWeek > 0 && place.hoursPerWeek <= 60
    && Number.isInteger(place.paymentMonths) && place.paymentMonths >= 1 && place.paymentMonths <= 12
    && Number.isFinite(place.monthlyFoodNok) && place.monthlyFoodNok >= 0;
  if (!validIncome || !validPrice || !validPlace) return {
    ...result, status: 'manual', title: 'Kommunen må se på opplysningene',
    explanation: 'Grunnlaget er ufullstendig eller ugyldig. Vi beregner ikke en pris fra usikre tall.',
    reasons: ['Ufullstendig beregningsgrunnlag'],
  };
  if (place.grade > 4) return {
    ...result, status: 'out-of-scope', title: 'Denne sjekken dekker 1.–4. trinn',
    explanation: 'Vi kan ikke vurdere denne SFO-plassen med denne sjekken. Kommunen må veilede om andre ordninger.',
    reasons: ['Klassetrinn utenfor demonstrert ordning'],
  };
  if (answers.cohabitant === 'yes' || answers.correction === 'other') return {
    ...result, status: 'manual', title: 'Takk. Kommunen må se nærmere på dette',
    explanation: 'Endringen er registrert separat. Kommunen må avklare husholdningen eller de korrigerte opplysningene før den kan vurdere betalingen.',
    reasons: ['Innbygger har meldt om endret eller ufullstendig grunnlag'],
  };

  const annualPriceOre = Math.round(place.monthlyPriceNok * 100) * place.paymentMonths;
  const annualCapOre = income * 6;
  const freeHours = place.grade <= 3 ? Math.min(12, place.hoursPerWeek) : 0;
  const paidShare = (place.hoursPerWeek - freeHours) / place.hoursPerWeek;
  const monthlyBeforeOre = Math.round(annualPriceOre * paidShare / place.paymentMonths);
  const monthlyAfterOre = Math.round(Math.min(annualPriceOre, annualCapOre) * paidShare / place.paymentMonths);
  const calculation: Calculation = {
    incomeNok: income, annualPriceOre, annualCapOre, freeHours, monthlyBeforeOre,
    monthlyAfterOre, monthlySavingOre: monthlyBeforeOre - monthlyAfterOre,
    monthlyFoodOre: Math.round(place.monthlyFoodNok * 100), paymentMonths: place.paymentMonths,
  };
  const citizenProvided = answers.currentIncomeNok !== undefined || answers.correction === 'income';
  if (citizenProvided) return {
    ...result, status: 'manual', calculation, basedOn: 'citizen',
    title: 'Vi tar hensyn til at livet endrer seg',
    explanation: 'Vi har laget et prisanslag fra inntekten du oppga. Kommunen må vurdere dokumentasjon og om inntektsnedgangen er varig.',
    reasons: ['Ny inntekt oppgitt av innbygger', 'Registeropplysningen er bevart', 'Krever manuell vurdering'],
  };
  return {
    ...result, calculation, status: calculation.monthlySavingOre > 0 ? 'eligible' : 'no-reduction',
    title: calculation.monthlySavingOre > 0 ? 'Du kan få lavere SFO-betaling' : 'Vi finner ingen ekstra reduksjon',
    explanation: calculation.monthlySavingOre > 0
      ? 'Inntekten og SFO-plassen gir grunnlag for redusert betaling i denne demoberegningen. Du kontrollerer før saken går videre.'
      : 'Med disse opplysningene gir inntektsregelen ingen ekstra reduksjon. Eventuelle gratistimer er allerede trukket fra.',
    reasons: ['SFO-plass på 1.–4. trinn', 'Husholdningen er kontrollert', 'Sammenligning med 6 % av årsinntekten'],
  };
}
