import type { ApplicationDraft, ApplicationField, AssistantCase, PendingConsent, ServiceId, ToolId } from './assistant-types';
import { confirmedValue } from './assistant-verification';

/**
 * Tool catalogue. The model may only nominate a tool by id. Node decides whether the tool is
 * relevant for a selected service, whether it needs consent, and executes it after the citizen's
 * explicit choice. Executors live in the server layer; this module is declarative and pure.
 */
export type ToolDefinition = {
  id: ToolId; title: string; description: string;
  kind: 'guidance' | 'register' | 'compute';
  gate: 'none' | 'consent';
  integration: string;
  /** Roles that may request the tool. Empty means the tool only runs automatically. */
  roles: ('coordinator' | 'specialist')[];
  serviceIds: ServiceId[];
  dependsOn: ToolId[];
  purpose: string;
  /** Node-authored consent wording per language. The model never writes consent text. */
  consent?: Record<'nb' | 'en', string>;
};

export const TOOL_CATALOGUE: ToolDefinition[] = [
  { id: 'read_guidance', title: 'Les veiledningsutdrag', kind: 'guidance', gate: 'none', roles: [], serviceIds: ['family', 'housing', 'moving'], dependsOn: [],
    integration: 'Lagrede utdrag fra Udir, Husbanken og Skatteetaten', purpose: 'Veiledning til forberedelse; gir ikke vedtak eller registerverifisering.',
    description: 'Reads the stored official guidance excerpts for a selected service. Runs automatically for every selected service.' },
  { id: 'ks_connect', title: 'Husstand, SFO-plass og satser', kind: 'register', gate: 'consent', roles: ['coordinator'], serviceIds: ['family'], dependsOn: [],
    integration: 'Kommunen via KS workshop API', purpose: 'Forberede vurdering av SFO-betaling.',
    consent: { nb: 'husstand, SFO-plass og gjeldende satser fra kommunen (KS-sandkassen)', en: 'household, SFO place and current rates from the municipality (KS sandbox)' },
    description: 'Fetches household composition, the child\'s SFO place and current SFO rates from the municipality (KS sandbox). Needs the citizen\'s consent. Request it when the family service is selected for a personalized assessment and the tool is not fetched.' },
  { id: 'ks_income', title: 'Inntektsgrunnlag fra Skatteetaten', kind: 'register', gate: 'consent', roles: ['coordinator'], serviceIds: ['family'], dependsOn: ['ks_connect'],
    integration: 'Skatteetaten via KS Fiks samtykke', purpose: 'Forberede vurdering av SFO-betaling.',
    consent: { nb: 'inntektsgrunnlag fra Skatteetaten via KS Fiks (eget samtykke registreres)', en: 'income basis from Skatteetaten via KS Fiks (a separate consent is registered)' },
    description: 'Fetches the household income basis (Skatteetaten data via a KS Fiks consent) and the deterministic SFO rule result. Needs explicit consent. Request it together with ks_connect.' },
  { id: 'prepare_sfo_application', title: 'Fyll ut søknad om redusert SFO-betaling', kind: 'compute', gate: 'none', roles: [], serviceIds: ['family'], dependsOn: ['ks_connect', 'ks_income'],
    integration: 'Lokal utfylling', purpose: 'Forberede søknadsskjema for menneskelig kontroll. Ingen innsending.',
    description: 'Fills the application draft from confirmed facts and fetched register data. Runs automatically after data is fetched; the model cannot request it.' },
];

const APPLICATION_LEAD: Record<ServiceId, Record<'nb' | 'en', string>> = {
  family: { nb: 'søknaden om redusert SFO-betaling', en: 'the application for reduced SFO payment' },
  housing: { nb: 'bostøttesaken', en: 'the housing allowance case' },
  moving: { nb: 'flyttemeldingen', en: 'the moving notice' },
};

export function toolDefinition(id: ToolId): ToolDefinition { return TOOL_CATALOGUE.find(tool => tool.id === id)!; }

/** Whether the tool's output is already in the case. Fetched tools are never offered again. */
export function toolFetched(session: AssistantCase, id: ToolId): boolean {
  if (id === 'ks_connect') return !!session.ksData;
  if (id === 'ks_income') return !!session.ksData?.incomeReadAt;
  if (id === 'prepare_sfo_application') return !!session.services.find(service => service.id === 'family')?.applicationDraft;
  return true;
}

/** What the model sees: ids, descriptions and state. Never executors or credentials. */
export function modelVisibleTools(role: 'coordinator' | 'specialist', session: AssistantCase) {
  return TOOL_CATALOGUE.filter(tool => tool.roles.includes(role)).map(tool => ({
    id: tool.id, description: tool.description, gate: tool.gate, integration: tool.integration, serviceIds: tool.serviceIds, fetched: toolFetched(session, tool.id),
  }));
}

/**
 * Resolve the planner's tool requests against the catalogue. A gated tool mapped to a selected
 * service is always offered, so the flow does not depend on the model remembering to ask.
 * Requests for tools outside the selected services are ignored and reported.
 */
export function pendingConsentsFor(session: AssistantCase, selected: ServiceId[], requested: ToolId[], revision: number): { consents: PendingConsent[]; ignored: ToolId[] } {
  const ignored: ToolId[] = [];
  const consents: PendingConsent[] = [];
  if (session.intent !== 'personalized' || session.ksAccessDecision?.status === 'declined') return { consents, ignored: [...new Set(requested)] };
  for (const tool of TOOL_CATALOGUE) {
    const wanted = requested.includes(tool.id);
    const relevant = tool.gate === 'consent' && tool.serviceIds.some(id => selected.includes(id));
    if (!relevant) { if (wanted) ignored.push(tool.id); continue; }
    if (toolFetched(session, tool.id)) continue;
    consents.push({ toolId: tool.id, title: tool.title, integration: tool.integration, purpose: tool.purpose, serviceIds: tool.serviceIds, requestedBy: wanted ? 'model' : 'catalogue', revision });
  }
  return { consents, ignored };
}

/** Consent paragraph appended to the assistant reply. Authored by Node from catalogue text, not by the model. */
export function consentParagraph(consents: PendingConsent[], language = 'nb'): string {
  if (!consents.length) return '';
  const lang: 'nb' | 'en' = language.startsWith('en') ? 'en' : 'nb';
  const serviceId = consents[0].serviceIds[0];
  const items = consents.map(consent => toolDefinition(consent.toolId).consent?.[lang]).filter((item): item is string => !!item);
  const list = lang === 'en' ? items.join(' and ') : items.join(' og ');
  return lang === 'en'
    ? `**May I fetch information for you?** To prepare ${APPLICATION_LEAD[serviceId].en} I can fetch ${list}. Nothing is fetched until you choose yes below this message. You can also continue without it and answer the questions yourself.`
    : `**Vil du at jeg henter opplysninger for deg?** For å forberede ${APPLICATION_LEAD[serviceId].nb} kan jeg hente ${list}. Ingenting hentes før du velger ja under denne meldingen. Du kan også fortsette uten og svare på spørsmålene selv.`;
}

function registerJson(session: AssistantCase, sourceId: string): Record<string, unknown> | null {
  const source = session.sources.find(item => item.id === sourceId && item.kind === 'register');
  if (!source) return null;
  try { const value = JSON.parse(source.text); return value && typeof value === 'object' ? value as Record<string, unknown> : null; }
  catch { return null; }
}
function confirmedField(session: AssistantCase, key: 'household_income_annual' | 'income_basis' | 'job_lost' | 'cohabitant_missing' | 'uses_sfo', label: string, format: (value: string) => string, missing: string): ApplicationField {
  const value = confirmedValue(session, key);
  const fact = value === undefined ? undefined : session.facts.find(item => item.key === key && item.value === value && item.status === 'confirmed');
  const fromRegister = fact && session.sources.find(item => item.id === fact.citation.sourceId)?.kind === 'register';
  return value === undefined
    ? { key, label, value: null, sourceId: null, status: 'missing', detail: missing }
    : { key, label, value: format(value), sourceId: fact?.citation.sourceId ?? null, status: 'filled', detail: fromRegister ? 'Hentet fra register etter samtykke.' : 'Bekreftet av deg i samtalen.' };
}

/** The compute tool: fill the SFO application draft from confirmed facts and fetched register snapshots. Never submits. */
export function applicationDraftFor(serviceId: ServiceId, session: AssistantCase): ApplicationDraft | null {
  if (serviceId !== 'family') return null;
  const household = registerJson(session, 'ks-household');
  const sfoPlaces = registerJson(session, 'ks-sfo');
  const income = registerJson(session, 'ks-income');
  const assessment = registerJson(session, 'ks-assessment');
  const members = Array.isArray(household?.medlemmer) ? household.medlemmer as { rolle?: string }[] : [];
  const roles = members.reduce<Record<string, number>>((acc, member) => { const role = member.rolle || 'ukjent'; acc[role] = (acc[role] || 0) + 1; return acc; }, {});
  const place = Array.isArray(sfoPlaces) ? (sfoPlaces as Record<string, unknown>[])[0] : null;
  const yesNo = (value: string) => value === 'true' ? 'Ja' : 'Nei';
  const basis: Record<string, string> = { household_year: 'Hele husholdningens årsinntekt', individual_year: 'Én persons årsinntekt', month: 'Månedsinntekt', unknown: 'Uavklart' };
  const fields: ApplicationField[] = [
    household
      ? { key: 'household', label: 'Husstand', value: `${household.type ?? 'Husstand'}, ${household.kommune ?? ''}`.trim(), sourceId: 'ks-household', status: 'filled', detail: 'Hentet fra kommunen etter samtykke.' }
      : { key: 'household', label: 'Husstand', value: null, sourceId: null, status: 'missing', detail: 'Hentes fra kommunen med samtykke, eller oppgis av deg.' },
    household
      ? { key: 'members', label: 'Husstandsmedlemmer', value: Object.entries(roles).map(([role, count]) => `${count} ${role}`).join(', '), sourceId: 'ks-household', status: 'filled', detail: 'Roller fra husstandsregisteret; navn og identiteter er ikke lagret.' }
      : { key: 'members', label: 'Husstandsmedlemmer', value: null, sourceId: null, status: 'missing', detail: 'Hentes fra kommunen med samtykke.' },
    confirmedField(session, 'uses_sfo', 'Barnet bruker SFO', yesNo, 'Bekreft om barnet har SFO-plass.'),
    place
      ? { key: 'sfo_place', label: 'SFO-plass', value: `${place.sfonavn ?? 'SFO'}, ${place.trinn ?? '?'}. trinn, ${place.manedspris ?? '?'} kr/mnd`, sourceId: 'ks-sfo', status: 'filled', detail: 'Hentet fra kommunen etter samtykke.' }
      : { key: 'sfo_place', label: 'SFO-plass', value: null, sourceId: null, status: 'missing', detail: 'Hentes fra kommunen med samtykke, eller oppgis av deg.' },
    income
      ? { key: 'income_year', label: 'Inntektsår', value: `${income.inntektsaar ?? '?'} (${income.stadie ?? 'ukjent stadie'})`, sourceId: 'ks-income', status: 'filled', detail: 'Hentet fra Skatteetaten via KS Fiks etter samtykke.' }
      : { key: 'income_year', label: 'Inntektsår', value: null, sourceId: null, status: 'missing', detail: 'Hentes fra Skatteetaten med samtykke.' },
    confirmedField(session, 'household_income_annual', 'Husholdningens årsinntekt', value => `${Number(value).toLocaleString('nb-NO')} kr`, 'Hentes fra Skatteetaten med samtykke, eller oppgis av deg.'),
    confirmedField(session, 'income_basis', 'Hva inntekten gjelder', value => basis[value] ?? value, 'Avklar om inntekten gjelder hele husholdningen og et helt år.'),
    confirmedField(session, 'job_lost', 'Vesentlig og varig inntektsendring (mistet jobb)', yesNo, 'Bekreft om inntekten har endret seg vesentlig.'),
    confirmedValue(session, 'cohabitant_missing') === undefined
      ? { key: 'household_change', label: 'Endring i husstanden', value: 'Ingen endring meldt', sourceId: null, status: 'review', detail: 'Si fra hvis samboer eller andre mangler i grunnlaget.' }
      : confirmedField(session, 'cohabitant_missing', 'Endring i husstanden', value => value === 'true' ? 'Samboer mangler i grunnlaget' : 'Ingen endring', ''),
    assessment
      ? { key: 'rule_result', label: 'KS regelresultat (veiledende)', value: assessment.godkjent === true ? 'Oppfyller vilkårene i sandkassen' : 'Oppfyller ikke vilkårene i sandkassen', sourceId: 'ks-assessment', status: 'review', detail: 'Deterministisk testresultat, ikke et vedtak. Kommunen avgjør.' }
      : { key: 'rule_result', label: 'KS regelresultat (veiledende)', value: null, sourceId: null, status: 'missing', detail: 'Beregnes av KS-sandkassen etter samtykke.' },
    { key: 'submission', label: 'Signatur og innsending', value: null, sourceId: null, status: 'review', detail: 'Gjøres av deg i kommunens tjeneste. Demoen sender ingenting.' },
  ];
  return { title: 'Søknad om redusert foreldrebetaling i SFO (utkast)', fields, filled: fields.filter(field => field.status === 'filled').length,
    note: 'Utkastet er fylt fra bekreftede opplysninger og hentede registerutdrag. Kontroller feltene; ingenting er sendt.' };
}
