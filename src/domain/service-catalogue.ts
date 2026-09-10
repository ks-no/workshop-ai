import { UDIR_SOURCE } from './rules';
import { citationFor, confirmedValue, FACT_LABELS } from './assistant-verification';
import type { AssistantCase, EvidenceSource, FactKey, ServiceCheck, ServiceId, ServiceResult } from './assistant-types';

export const SERVICE_CATALOGUE: { id: ServiceId; title: string; description: string; sourceIds: string[]; requiredFacts: FactKey[] }[] = [
  { id: 'family', title: 'Familie og SFO', description: 'Forbered vurdering av SFO-betaling ved endret familie eller inntekt.', sourceIds: ['guidance-sfo'], requiredFacts: ['uses_sfo', 'household_income_annual', 'income_basis', 'cohabitant_missing'] },
  { id: 'housing', title: 'Bolig og bostøtte', description: 'Samle bolig- og inntektsgrunnlag før du går videre til Husbanken eller kommunen.', sourceIds: ['guidance-housing', 'guidance-housing-apply'], requiredFacts: ['monthly_rent', 'household_size', 'household_income_annual', 'income_basis'] },
  { id: 'moving', title: 'Flytting', description: 'Forbered flyttedato og ny kommune før du selv melder flytting.', sourceIds: ['guidance-moving'], requiredFacts: ['move_date', 'new_municipality'] },
];

/** Short official excerpts checked on this date, not live register lookups. */
export function guidanceSources(): EvidenceSource[] {
  const entries = [
    { id: 'guidance-sfo', title: 'Udir – finansiering av SFO (kort kildeutdrag)', text: 'Kommunen skal tilby reduksjon i foreldrebetalinga, slik at foreldrebetalinga per barn utgjer maksimalt seks prosent av inntektene til hushaldet.', url: UDIR_SOURCE },
    { id: 'guidance-housing', title: 'Husbanken – bostøtte (kort kildeutdrag)', text: 'Bostøtte er en støtteordning for deg som har lave inntekter og høye boutgifter.', url: 'https://www.husbanken.no/person/bostotte/' },
    { id: 'guidance-housing-apply', title: 'Husbanken – slik søker du (kort kildeutdrag)', text: 'Det kan hende du må laste opp vedlegg til søknaden din.', url: 'https://husbanken.no/person/bostotte/slik-soker-du/' },
    { id: 'guidance-moving', title: 'Skatteetaten – flytte i Norge (kort kildeutdrag)', text: 'Flyttemeldingen må du sende tidligst 31 dager før og senest 8 dager etter du har flyttet.', url: 'https://www.skatteetaten.no/person/folkeregister/flytte/i-norge/' },
  ];
  return entries.map(entry => ({ ...entry, kind: 'guidance', retrievedAt: '2026-09-03T00:00:00.000Z', purpose: 'Veiledning til forberedelse; gir ikke vedtak eller registerverifisering.', period: 'Kildeutdrag kontrollert 3. september 2026; kontroller gjeldende veiledning ved innsending.' }));
}

function factCheck(session: AssistantCase, key: FactKey, question: string): ServiceCheck {
  const value = confirmedValue(session, key);
  const labels: Record<string, string> = { true: 'ja', false: 'nei', household_year: 'hele husholdningens årsinntekt', individual_year: 'én persons årsinntekt', month: 'månedsinntekt', unknown: 'uavklart inntektsgrunnlag' };
  const display = value === undefined ? '' : labels[value] ?? value;
  const fact = value === undefined ? undefined : session.facts.find(item => item.key === key && item.value === value && item.status === 'confirmed');
  const source = fact && session.sources.find(item => item.id === fact.citation.sourceId);
  const detail = source?.kind === 'register'
    ? `Hentet fra KS: ${display}. Du kan rette opplysningen hvis situasjonen din er annerledes.`
    : `Bekreftet av deg: ${display}. Opplysningen er lagret som innbyggerens egen bekreftelse.`;
  return { id: key, label: FACT_LABELS[key], status: value === undefined ? 'missing' : 'ready', detail: value === undefined ? question : detail, factKeys: [key] };
}

export function prepareService(id: ServiceId, session: AssistantCase, reason: string): ServiceResult {
  const service = SERVICE_CATALOGUE.find(candidate => candidate.id === id);
  if (!service) throw new Error('Ukjent tjeneste.');
  const sourceIds = service.sourceIds.filter(sourceId => session.sources.some(source => source.id === sourceId && source.kind === 'guidance'));
  const findings = sourceIds.flatMap(sourceId => {
    const source = session.sources.find(candidate => candidate.id === sourceId && candidate.kind === 'guidance')!;
    const citation = citationFor(source, source.text);
    return citation ? [{ text: source.text, citation }] : [];
  });
  for (const fact of session.facts) {
    if (fact.status !== 'confirmed' || !service.requiredFacts.includes(fact.key) || confirmedValue(session, fact.key) !== fact.value) continue;
    const source = session.sources.find(candidate => candidate.id === fact.citation.sourceId);
    if (source && citationFor(source, fact.citation.quote) && !sourceIds.includes(source.id)) sourceIds.push(source.id);
  }
  const result: ServiceResult = { id, title: service.title, reason, status: 'needs-information', summary: '', checks: [], findings, sourceIds, questions: [], assessment: null, error: null };
  const check = (key: FactKey, question: string) => result.checks.push(factCheck(session, key, question));
  const human = (checkId: string, label: string, detail: string, factKeys: FactKey[] = []) => result.checks.push({ id: checkId, label, status: 'human', detail, factKeys });

  if (id === 'family') {
    const usesSfo = confirmedValue(session, 'uses_sfo');
    for (const sourceId of ['ks-household', 'ks-sfo', 'ks-rates', 'ks-income', 'ks-assessment']) {
      const source = session.sources.find(candidate => candidate.id === sourceId && candidate.kind === 'register');
      if (source && !sourceIds.includes(source.id)) sourceIds.push(source.id);
    }
    const ksSfo = session.sources.find(source => source.id === 'ks-sfo');
    const ksIncome = session.sources.find(source => source.id === 'ks-income');
    const ksAssessment = session.sources.find(source => source.id === 'ks-assessment');
    if (usesSfo === 'false') {
      result.summary = 'Du har bekreftet at du ikke bruker SFO. Vi lager ingen ny SFO-vurdering.';
      human('family-guidance', 'Avklar et annet familietilbud', 'Kontakt kommunen dersom du trenger hjelp med barnehage eller andre familietjenester.', ['uses_sfo']);
    } else {
      if (!ksSfo) check('uses_sfo', 'Bruker barnet SFO?');
      if (!ksIncome) human('income-consent', 'Velg om inntektsgrunnlaget skal hentes', 'KS-sandkassen krever et uttrykkelig samtykke før inntektsgrunnlaget kan leses. Du kan fortsatt bruke sjekklisten uten å hente det.');
      if (!ksAssessment) human('sfo-rule', 'Kjør regelvurdering etter samtykke', 'Et resultat fra KS-regelmotoren mangler. Vi beregner ikke eller fyller inn et svar lokalt.');
      else {
        const citation = citationFor(ksAssessment, ksAssessment.text);
        if (citation) result.findings.push({ text: 'KS-sandkassens deterministiske regelresultat er lagret som et øyeblikksbilde. Det er testdata, ikke et kommunalt vedtak.', citation });
        human('sfo-snapshot', 'Kontroller KS-resultatet mot situasjonen nå', 'Regelresultatet brukte KS-registerets syntetiske inntektsgrunnlag. Opplysninger du senere skriver i samtalen om endret inntekt endrer ikke dette øyeblikksbildet. En person må kontrollere avvik.');
      }
      human('sfo-price', 'Kontroller SFO-plass, pris og gjeldende regel', 'KS API oppgir klassetrinn og månedspris. Manglende timer, matpris eller andre tariffdetaljer fylles ikke inn av KI; kommunen må kontrollere dem.');
      if (confirmedValue(session, 'cohabitant_missing') === 'true') human('household-review', 'Avklar hvem som inngår i husholdningen', 'En meldt endring i husholdningen krever manuell avklaring før resultatet kan brukes.', ['cohabitant_missing']);
      result.summary = ksAssessment ? 'Et deterministisk resultat fra KS-sandkassen er hentet og må kontrolleres mot dagens situasjon. Dette er ikke et vedtak.' : 'SFO-sjekklisten viser hva som må avklares før kommunen kan vurdere redusert betaling.';
    }
  } else if (id === 'housing') {
    check('monthly_rent', 'Hva betaler du i husleie per måned?');
    check('household_size', 'Hvor mange personer inngår i husholdningen?');
    check('household_income_annual', 'Hva er samlet årsinntekt for husholdningen?');
    check('income_basis', 'Gjelder inntekten hele husholdningen og et helt år?');
    human('housing-documents', 'Finn bolig- og inntektsdokumentasjon', 'Forbered leiekontrakt, oversikt over boutgifter og dokumentasjon på inntektsendringer. Husbanken eller kommunen avgjør hvilke vedlegg som trengs.', ['monthly_rent', 'household_income_annual']);
    human('housing-period', 'Avklar månedens inntekt og bosted', 'Årsinntekt er bakgrunnsinformasjon. Kontroller riktig søknadsmåned, inntektene Husbanken ber om, boligadresse og kommunen du bor i. Vi deler ikke årsinntekt på tolv.', ['income_basis']);
    human('housing-handoff', 'Gå videre til Husbanken eller kommunen', 'Kontroller vilkår og søknaden i den offisielle tjenesten. Det er ikke beregnet bostøtte eller avgjort om du har rett til støtte.');
    result.summary = 'Boliggrunnlaget og en konkret dokumentliste er samlet. Bostøttebeløp og rett til støtte må vurderes i den offisielle tjenesten.';
  } else {
    check('move_date', 'Hvilken dato skal du flytte? Oppgi en bestemt dato.');
    check('new_municipality', 'Hvilken kommune flytter du til?');
    human('moving-address', 'Kontroller full adresse og hvem som flytter', 'Ha gateadresse, postnummer og eventuelt bolignummer klart. Kontroller hvem flyttemeldingen skal gjelde.', ['new_municipality']);
    human('moving-deadline', 'Kontroller fristen hos Skatteetaten', 'Den siterte veiledningen gjelder flytting i Norge. Ved flytting til eller fra utlandet må du velge den aktuelle veiledningen hos Skatteetaten.', ['move_date']);
    human('moving-handoff', 'Meld flytting selv hos Skatteetaten', 'Åpne den offisielle tjenesten, kontroller opplysningene og send når du er klar. Ingen flyttemelding er sendt her.');
    result.summary = 'Flyttesjekklisten er laget med dato, kommune og punkter du kontrollerer før du selv melder flytting.';
  }

  const missingGuidance = service.sourceIds.some(sourceId => !findings.some(finding => finding.citation.sourceId === sourceId));
  if (missingGuidance) result.checks.push({ id: 'guidance-missing', label: 'Veiledningskilde mangler', status: 'missing', detail: 'Veiledningen må være lagret med kontrollerbart kildeutdrag før overlevering.', factKeys: [] });
  result.questions = result.checks.filter(item => item.status === 'missing' && item.factKeys.length).map(item => ({ key: item.factKeys[0], question: item.detail, serviceIds: [id] }));
  result.status = result.checks.some(item => item.status === 'missing') ? 'needs-information' : result.checks.some(item => item.status === 'human') ? 'needs-review' : 'ready';
  return result;
}

/** Remove the retired false warning from cases saved before the guidance count was corrected. */
export function repairStoredGuidanceChecks(session: AssistantCase): boolean {
  let changed = false;
  for (const result of session.services) {
    if (!result.checks.some(check => check.id === 'guidance-missing')) continue;
    const service = SERVICE_CATALOGUE.find(candidate => candidate.id === result.id);
    if (!service) continue;
    const complete = service.sourceIds.every(sourceId => {
      const source = session.sources.find(candidate => candidate.id === sourceId && candidate.kind === 'guidance');
      return !!source && !!citationFor(source, source.text);
    });
    if (!complete) continue;
    result.checks = result.checks.filter(check => check.id !== 'guidance-missing');
    result.status = result.checks.some(check => check.status === 'missing') ? 'needs-information' : result.checks.some(check => check.status === 'human') ? 'needs-review' : 'ready';
    changed = true;
  }
  return changed;
}
