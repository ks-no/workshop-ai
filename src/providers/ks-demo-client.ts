import { z } from 'zod';

const label = z.string().min(1).max(1000);
const identifier = z.string().min(1).max(160);
const personId = z.string().regex(/^person-\d{3,6}$/);
const amount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const date = z.iso.date();
const object = z.record(z.string(), z.unknown());
const personSchema = z.object({
  personId, syntetiskFodselsnummer: z.string().regex(/^\d{11}$/),
  navn: z.object({ fornavn: label, mellomnavn: z.string().nullable().optional(), etternavn: z.string().max(1000) }).passthrough(),
  foedselsdato: date, personstatus: z.enum(['BOSATT', 'UTFLYTTET', 'DOED', 'INAKTIV', 'MIDLERTIDIG', 'OPPHOERT', 'FORSVUNNET']),
  bostedsadresse: z.object({ kommune: label, kommunenummer: z.string().regex(/^\d{4}$/) }).passthrough(),
  rolle: z.enum(['foresatt', 'barn', 'voksen']).nullable(), husstandId: identifier.nullable(), syntetisk: z.literal(true),
}).passthrough();
const householdSchema = z.object({
  husstandId: identifier, type: label, adresse: z.string().max(2000).nullable(), kommune: label,
  kommunenummer: z.string().regex(/^\d{4}$/),
  medlemmer: z.array(z.object({ personId, rolle: z.enum(['foresatt', 'barn', 'voksen']) }).passthrough()).min(1).max(100),
  syntetisk: z.literal(true),
}).passthrough();
const sfoSchema = z.object({
  personId, sfoId: identifier, sfonavn: label, kommune: label,
  trinn: z.number().int().min(1).max(13), manedspris: amount, syntetisk: z.literal(true),
}).passthrough();
const ratesSchema = z.object({
  gjelderFra: date, kilde: label, maksAndelAvInntekt: z.number().min(0).max(1),
  maanederMedBetaling: z.number().int().min(1).max(12),
  ordninger: z.array(z.object({
    id: identifier, navn: label, tjeneste: label, regel: label, beskrivelse: z.string().max(4000).optional(),
    inntektsgrense: amount.optional(), trinnFra: z.number().int().min(1).max(13).optional(),
    trinnTil: z.number().int().min(1).max(13).optional(),
  }).passthrough()).max(100),
}).passthrough();
const catalogueSchema = z.array(z.object({
  metode: z.enum(['GET', 'POST', 'PUT', 'DELETE']), sti: z.string().startsWith('/api/').max(500), ressurs: label,
  beskrivelse: z.string().max(4000), tilgang: z.enum(['aapen', 'egne-data', 'bred']),
  kreverSamtykke: z.string().max(160).nullable(), syntetisk: z.literal(true),
}).passthrough()).max(200);
const incomeSchema = z.object({
  inntektsaar: z.number().int().min(1900).max(2200), stadie: z.enum(['OPPGJOER', 'UTKAST', 'UKJENT']),
  beregningsbeloep: amount, beregningstype: z.literal('BARNEHAGE_SFO'),
  personer: z.array(object).max(100), visningsposter: z.array(object).max(100), inntekt: object, fradrag: object,
  feilmeldinger: z.array(z.object({ kode: label, melding: label }).passthrough()).max(100), syntetisk: z.literal(true),
}).passthrough();
const sfoAssessmentSchema = z.object({
  godkjent: z.boolean(), melding: label,
  grunnlag: z.record(z.string(), z.unknown()).optional(),
}).passthrough();
const applicationSchema = z.object({
  soknadId: identifier, personId, prosessId: z.string().min(1).max(160), status: z.literal('SENDT_INN'),
  opprettet: z.iso.datetime(), sporingsId: identifier, syntetisk: z.literal(true),
  oppgave: z.object({ oppgaveId: z.string().max(160).optional(), advarsel: z.string().max(1000).optional(), detalj: z.string().max(2000).optional(), syntetisk: z.boolean().optional() }).passthrough().optional(),
}).passthrough();
const revisjonSchema = z.array(z.object({
  hendelseId: identifier, tidspunkt: z.iso.datetime(), syntetisk: z.literal(true), sporingsId: identifier,
  handling: label, ressurs: label, formaal: label.optional(),
  aktor: z.object({ type: z.enum(['innbygger', 'system', 'utvikler', 'ukjent']), id: z.string().max(160).nullable(), acr: label.optional(), paaVegneAv: identifier.optional() }).passthrough(),
}).passthrough()).max(500);
const consentSchema = z.object({
  samtykkeId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/), personId, formaal: label,
  dataKilder: z.array(z.string().min(1).max(160)).max(20),
  status: z.enum(['VENTER_PAA_SVAR', 'SAMTYKKET', 'IKKE_SAMTYKKET', 'TRUKKET', 'UTLOEPT']),
  opprettet: z.iso.datetime(), utloper: z.iso.datetime(), sporingsId: identifier,
  syntetisk: z.literal(true),
}).passthrough();

export type KsDemoPerson = z.infer<typeof personSchema>;
export type KsDemoHousehold = z.infer<typeof householdSchema>;
export type KsDemoSfoPlace = z.infer<typeof sfoSchema>;
export type KsDemoRates = z.infer<typeof ratesSchema>;
export type KsDemoCatalogueEntry = z.infer<typeof catalogueSchema>[number];
export type KsDemoIncome = z.infer<typeof incomeSchema>;
export type KsDemoConsent = z.infer<typeof consentSchema>;
export type KsDemoSfoAssessment = z.infer<typeof sfoAssessmentSchema>;
export type KsDemoApplication = z.infer<typeof applicationSchema>;
export type KsDemoRevisjonshendelse = z.infer<typeof revisjonSchema>[number];
export type KsDemoSnapshot<T> = {
  value: T;
  source: { url: string; retrievedAt: string; text: string; synthetic: true; resource: string };
};
export type KsDemoConfig = {
  backendBaseUrl: string; fiksBaseUrl: string; personId: string;
  getCitizenToken: () => Promise<string>; getConsentToken: () => Promise<string>; timeoutMs?: number;
  /** Correlates every sandbox call with this case's own revisjonslogg (GET /api/revisjonslogg/:sporingsId). */
  sporingsId?: string;
};
export const KS_DEMO_INCOME_PURPOSE = 'Forberede vurdering av SFO-betaling';
export type KsDemoErrorCode = 'configuration' | 'authentication' | 'authorization' | 'consent-required' | 'consent-expired'
  | 'not-found' | 'conflict' | 'unavailable' | 'invalid-response';
export class KsDemoError extends Error {
  constructor(public readonly code: KsDemoErrorCode, message: string, public readonly status?: number, public readonly submissionNotSent = false) {
    super(message); this.name = 'KsDemoError';
  }
}
const invalidResponse = () => new KsDemoError('invalid-response', 'KS-demo API-et returnerte et svar som ikke kunne kontrolleres. Ingen opplysninger er lagt til.');
const unavailable = () => new KsDemoError('unavailable', 'KS-demo API-et kunne ikke nås eller svaret ble avbrutt. Prøv igjen når tjenesten er tilgjengelig.');
const MAX_BYTES = 512_000;
function baseUrl(value: string): string {
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
    return url.origin;
  } catch { throw new KsDemoError('configuration', 'Kontroller serveradressene til KS-demo API-et.', undefined, true); }
}
async function readText(response: Response): Promise<string> {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) {
    await response.body?.cancel(); throw invalidResponse();
  }
  const reader = response.body?.getReader();
  if (!reader) throw invalidResponse();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.byteLength;
      if (length > MAX_BYTES) { await reader.cancel(); throw invalidResponse(); }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw invalidResponse(); }
}
function httpError(status: number, data: unknown): KsDemoError {
  const reason = typeof data === 'object' && data !== null && 'grunn' in data ? data.grunn : null;
  if (status === 401) return new KsDemoError('authentication', 'KS-demo API-et avviste innloggingen. Kontroller serverens testbruker og token.', status);
  if (status === 403 && reason === 'utloept_samtykke') return new KsDemoError('consent-expired', 'Samtykket til inntektsopplysninger er utløpt. Et nytt valg er nødvendig.', status);
  if (status === 403 && reason === 'mangler_samtykke') return new KsDemoError('consent-required', 'KS-demo API-et krever samtykke før inntektsopplysninger kan leses.', status);
  if (status === 403) return new KsDemoError('authorization', 'KS-demo API-et avviste tilgangen til disse opplysningene.', status);
  if (status === 404) return new KsDemoError('not-found', 'KS-demo API-et fant ikke den etterspurte opplysningen.', status);
  if (status === 409) return new KsDemoError('conflict', 'KS-demo API-et avviste endringen fordi tilstanden er endret. Kontroller samtykket på nytt.', status);
  return new KsDemoError('unavailable', `KS-demo API-et kunne ikke fullføre forespørselen (HTTP ${status}).`, status);
}

/** A server-side client for the workshop APIs. Token loaders belong to the server bootstrap. */
export function createKsDemoClient(config: KsDemoConfig, fetchImpl: typeof fetch = fetch) {
  const backend = baseUrl(config.backendBaseUrl); const fiks = baseUrl(config.fiksBaseUrl);
  if (!personId.safeParse(config.personId).success || (config.timeoutMs !== undefined && (!Number.isFinite(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > 30_000))) {
    throw new KsDemoError('configuration', 'Kontroller serverens KS-testbruker og tidsgrense.', undefined, true);
  }
  const subject = config.personId;
  /** Tags a resource read with this case's sporingsId, so revisjonslogg entries can be correlated back to it. */
  function withSporingsId(path: string): string {
    if (!config.sporingsId) return path;
    return `${path}${path.includes('?') ? '&' : '?'}sporingsId=${encodeURIComponent(config.sporingsId)}`;
  }
  async function request<T>(base: string, path: string, resource: string, schema: z.ZodType<T>,
    tokenLoader?: () => Promise<string>, method = 'GET', body?: unknown): Promise<KsDemoSnapshot<T>> {
    const url = base + path;
    const applicationSubmission = method === 'POST' && base === backend && path === '/api/soknader';
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (tokenLoader) {
      let token: string;
      try { token = await tokenLoader(); }
      catch { throw new KsDemoError('authentication', 'Innloggingen til KS-demo API-et kunne ikke fullføres.', undefined, applicationSubmission); }
      if (!token || token.length > 20_000 || /\s/.test(token)) throw new KsDemoError('authentication', 'Serveren mangler et gyldig token for KS-demo API-et.', undefined, applicationSubmission);
      headers.Authorization = `Bearer ${token}`;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 8000);
    try {
      const response = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', cache: 'no-store', signal: controller.signal });
      const text = await readText(response);
      let data: unknown;
      try { data = JSON.parse(text); }
      catch { if (!response.ok) throw httpError(response.status, null); throw invalidResponse(); }
      if (!response.ok) throw httpError(response.status, data);
      const parsed = schema.safeParse(data);
      if (!parsed.success) throw invalidResponse();
      return { value: parsed.data, source: { url, retrievedAt: new Date().toISOString(), text, synthetic: true, resource } };
    } catch (error) { throw error instanceof KsDemoError ? error : unavailable(); }
    finally { clearTimeout(timer); }
  }
  function validConsent(input: unknown, status: KsDemoConsent['status'] = 'SAMTYKKET'): KsDemoConsent {
    const parsed = consentSchema.safeParse(input);
    if (!parsed.success || parsed.data.personId !== subject || parsed.data.formaal !== KS_DEMO_INCOME_PURPOSE
      || parsed.data.dataKilder.length !== 1 || parsed.data.dataKilder[0] !== 'inntekt') {
      throw new KsDemoError('consent-required', 'Et gyldig inntektsamtykke for denne testbrukeren mangler.');
    }
    if (parsed.data.status === 'UTLOEPT' || Date.parse(parsed.data.utloper) <= Date.now()) throw new KsDemoError('consent-expired', 'Inntektssamtykket er utløpt. Et nytt valg er nødvendig.');
    if (parsed.data.status !== status) throw new KsDemoError('consent-required', 'Inntektssamtykket er ikke aktivt. Kontroller valget før opplysningene leses.');
    return parsed.data;
  }
  const readRates = () => request(backend, withSporingsId('/api/regler/satser'), 'satser', ratesSchema);
  return {
    async readPerson() {
      const result = await request(backend, withSporingsId(`/api/personer/${subject}`), 'person', personSchema, config.getCitizenToken);
      if (result.value.personId !== subject) throw invalidResponse();
      return result;
    },
    async readHousehold() {
      const result = await request(backend, withSporingsId(`/api/personer/${subject}/husstand`), 'husstand', householdSchema, config.getCitizenToken);
      if (!result.value.medlemmer.some(member => member.personId === subject)) throw invalidResponse();
      return result;
    },
    readSfo: () => request(backend, withSporingsId(`/api/personer/${subject}/sfo`), 'sfo', z.array(sfoSchema).max(100), config.getCitizenToken),
    readRates, readRules: readRates,
    readCatalogue: () => request(backend, withSporingsId('/api/katalog/ressurser'), 'ressurser', catalogueSchema),
    readRevisjonslogg: (sporingsId: string) => request(backend, `/api/revisjonslogg/${encodeURIComponent(sporingsId)}`, 'revisjonslogg', revisjonSchema, config.getCitizenToken),
    async grantIncomeConsent(choice: { approved: true; caseId: string }): Promise<KsDemoSnapshot<KsDemoConsent>> {
      const parsed = z.object({ approved: z.literal(true), caseId: z.uuid() }).strict().safeParse(choice);
      if (!parsed.success) throw new KsDemoError('consent-required', 'Du må uttrykkelig samtykke før inntektsopplysninger hentes.');
      const created = await request(fiks, '/fiks/samtykke', 'inntektssamtykke', consentSchema, config.getConsentToken, 'POST', {
        personId: subject, formaal: KS_DEMO_INCOME_PURPOSE, dataKilder: ['inntekt'], sporingsId: parsed.data.caseId,
      });
      const pending = validConsent(created.value, 'VENTER_PAA_SVAR');
      if (pending.sporingsId !== parsed.data.caseId) throw invalidResponse();
      const granted = await request(fiks, `/fiks/samtykke/${pending.samtykkeId}/svar`, 'inntektssamtykke', consentSchema, config.getConsentToken, 'PUT', {
        status: 'SAMTYKKET', sporingsId: parsed.data.caseId,
      });
      validConsent(granted.value);
      if (granted.value.samtykkeId !== pending.samtykkeId || granted.value.sporingsId !== parsed.data.caseId) throw invalidResponse();
      return granted;
    },
    /** An empty lookup does not prove that an earlier submission was never stored. */
    async readApplications(caseId: string, prosessId: string): Promise<KsDemoSnapshot<KsDemoApplication[]>> {
      if (!z.uuid().safeParse(caseId).success || !z.string().regex(/^[a-z0-9-]{1,80}$/).safeParse(prosessId).success) {
        throw new KsDemoError('configuration', 'Oppslaget mangler en gyldig saks- eller prosessidentitet.');
      }
      const result = await request(backend, `/api/personer/${subject}/soknader`, 'soknader', z.array(applicationSchema).max(2000), config.getCitizenToken);
      if (result.value.some(application => application.personId !== subject)) throw invalidResponse();
      const value = result.value.filter(application => application.sporingsId === caseId && application.prosessId === prosessId);
      // Keep evidence scoped to the requested case, including the source payload.
      return { value, source: { ...result.source, text: JSON.stringify(value) } };
    },
    /** Submit a test application for the configured test citizen. The sandbox also creates a Fiks casework task, best effort. */
    async createApplication(input: { prosessId: string; prosessNavn: string; caseId: string }): Promise<KsDemoSnapshot<KsDemoApplication>> {
      const parsed = z.object({ prosessId: z.string().regex(/^[a-z0-9-]{1,80}$/), prosessNavn: z.string().min(1).max(160), caseId: z.uuid() }).strict().safeParse(input);
      if (!parsed.success) throw new KsDemoError('configuration', 'Skjemaet mangler en gyldig prosessidentitet for KS-sandkassen.', undefined, true);
      const created = await request(backend, '/api/soknader', 'soknad', applicationSchema, config.getCitizenToken, 'POST', {
        personId: subject, prosessId: parsed.data.prosessId, prosessNavn: parsed.data.prosessNavn, sporingsId: parsed.data.caseId,
      });
      if (created.value.personId !== subject || created.value.sporingsId !== parsed.data.caseId || created.value.prosessId !== parsed.data.prosessId) throw invalidResponse();
      return created;
    },
    async readSfoAssessment(receipt: KsDemoConsent): Promise<KsDemoSnapshot<KsDemoSfoAssessment>> {
      const consent = validConsent(receipt);
      const current = await request(fiks, `/fiks/samtykke/${consent.samtykkeId}`, 'inntektssamtykke', consentSchema, config.getConsentToken);
      validConsent(current.value);
      if (current.value.samtykkeId !== consent.samtykkeId || current.value.sporingsId !== consent.sporingsId) throw invalidResponse();
      return request(backend, withSporingsId(`/api/regler/sjekk/ordning?personId=${encodeURIComponent(subject)}&tjeneste=sfo`), 'sfo-vurdering', sfoAssessmentSchema, config.getCitizenToken);
    },
    async readIncome(receipt: KsDemoConsent): Promise<KsDemoSnapshot<KsDemoIncome>> {
      const consent = validConsent(receipt);
      const current = await request(fiks, `/fiks/samtykke/${consent.samtykkeId}`, 'inntektssamtykke', consentSchema, config.getConsentToken);
      validConsent(current.value);
      if (current.value.samtykkeId !== consent.samtykkeId || current.value.sporingsId !== consent.sporingsId) throw invalidResponse();
      // The backend, rather than the raw Fiks register route, enforces consent again.
      return request(backend, withSporingsId(`/api/personer/${subject}/inntekt`), 'inntektsgrunnlag', incomeSchema, config.getCitizenToken);
    },
  };
}
