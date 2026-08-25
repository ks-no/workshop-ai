import { createServer } from "node:http";
import { maskinportenHeader } from "../../digdir-mock/src/client.ts";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { docsHtml, routeOverview } from "../../shared/openapi.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import { cors, readRequestBody, svarhjelpere } from "../../shared/http.ts";
import { feilkode, feilmelding } from "../../shared/errors.ts";
import type {
  FolkeregisterPerson,
  GeonorgeAdresse,
  Organisasjon,
  TenorEnhet
} from "../../shared/registerdata.ts";

const port = Number(process.env.PORT || 8083);
const backendBaseUrl = process.env.BACKEND_BASE_URL || "http://sandbox-backend:8080";

// Imported across the app boundary on purpose: client.ts is where the token
// protocol is defined, and a copy per service is how four subtly different token
// clients happen. Node loads the .ts directly.
const digdirBaseUrl = process.env.DIGDIR_BASE_URL || "http://digdir-mock:8086";
const digdirIssuer = process.env.DIGDIR_ISSUER || "http://localhost:8086";

// This service is a machine with its own hjemmel, not the citizen. It reads person
// data on behalf of whichever test person the agent is working with, so the audit
// log records it as `system` with `paaVegneAv` — never as the person. A service
// that can hand itself a citizen's identity is the opposite of the lesson.
const TOKEN = {
  digdirBaseUrl,
  issuer: digdirIssuer,
  clientId: "tools-api",
  scope: "ks:innbyggerdialog:les",
  resource: "sandbox-backend"
};
const aiBaseUrl = process.env.AI_BASE_URL || "http://ai-gateway:8082";
const matrikkelBaseUrl = process.env.MATRIKKEL_BASE_URL || "http://matrikkel-mock:8085";
const matrikkelMode = String(process.env.MATRIKKEL_MODE || "mock").toLowerCase();
const geonorgeAdresseBaseUrl = process.env.GEONORGE_ADRESSE_API_BASE_URL || "https://ws.geonorge.no/adresser/v1";
const matrikkelHttpTimeoutMs = Number(process.env.MATRIKKEL_HTTP_TIMEOUT_MS || 6000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const brregDataFile = process.env.BRREG_DATA_FILE || path.resolve(__dirname, "../../../data/brreg.seed.json");
const folkeregisterDataFile = process.env.FOLKEREGISTER_DATA_FILE || path.resolve(__dirname, "../../../data/folkeregister.seed.json");
const openapiFile = path.resolve(__dirname, "../../../openapi/tools-api.yaml");
/** De to registrene leses fra disk én gang, ved første verktøykall som trenger dem. */
type BrregRegister = { organisations: Organisasjon[]; byOrgnr: Map<string, Organisasjon> };
type FolkeregisterRegister = {
  persons: FolkeregisterPerson[];
  byFnr: Map<string, FolkeregisterPerson>;
  byPersonId: Map<string, FolkeregisterPerson>;
};

let brregRegisterPromise: Promise<BrregRegister> | null = null;
let folkeregisterRegisterPromise: Promise<FolkeregisterRegister> | null = null;


/*
 * Verktøykatalogen og formene rundt den.
 *
 * Argumentene til et verktøy kommer fra tråden — fra en modell eller en deltaker
 * — og er derfor Record<string, unknown>. Hvert verktøy plukker ut det det
 * trenger og coercer selv; det er den samme jobben inputSchema beskriver utad.
 */
type Verktoy = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

type Verktoyargumenter = Record<string, unknown>;

/**
 * Et verktøyargument som tekst.
 *
 * String(), ikke String(x ?? ""): encodeURIComponent og en templatestreng gjør
 * nøyaktig dette med en manglende verdi i dag, og gir "undefined". Å rette det
 * til tom streng ville vært en atferdsendring, ikke en typerettelse.
 */
function argTekst(verdi: unknown): string {
  return String(verdi);
}

/** Et heltallsargument, med fallback når det mangler eller ikke er et heltall. */
function argHeltall(verdi: unknown, fallback: number): number {
  return Number.isInteger(verdi) ? Number(verdi) : fallback;
}

// Formene tools-api leser strukturelt fra backend og matrikkel-mock. Løsere enn
// kildens egne typer: dette er en verktøyfasade, den videreformidler.
type Prosessinfo = { id: string; navn: string; beskrivelse?: string; steg?: unknown[] };
type Prosessliste = { prosesser?: Prosessinfo[]; maler?: Prosessinfo[] };
type Personinfo = { personId: string; visningsnavn: string; bostedsadresse?: { kommune?: string } };
/** En gate slik verktøyene svarer med den — fra mocken eller bygget fra Geonorge. */
type Gatetreff = {
  gateId: string;
  adressenavn: string;
  kommunenummer: string;
  kommune: string;
  postnummer: string;
  poststed: string;
  antallEiendommer?: number;
  antallBoligeiendommer?: number;
  eiendommer?: Matrikkeleiendom[];
};

type Matrikkeleiendom = {
  matrikkelId?: string;
  gnr?: number;
  bnr?: number;
  festenummer?: number;
  undernummer?: number | null;
  adressekode?: number;
  adresse?: string;
  husnummer?: number;
  husbokstav?: string | null;
  bruksenhetstype?: string;
  adressenavn?: string;
  kommunenummer?: string;
  kommune?: string;
  postnummer?: string;
  poststed?: string;
  objtype?: string;
  koordinater?: { lat: number; lon: number; epsg: string } | null;
  eiere?: string[];
  syntetisk?: boolean;
  kilde?: unknown;
};

/** Kroppen på POST /mcp/tools/invoke. */
type InvokeKropp = {
  name?: string;
  toolArgs?: Verktoyargumenter;
  args?: Verktoyargumenter;
  arguments?: Verktoyargumenter;
};

/**
 * En feil med en HTTP-status kallstedet skal se.
 *
 * Var en Error med `.status` limt på i etterkant. Som klasse holder status og
 * melding sammen, og `instanceof` erstatter et Number()-kall på et felt som
 * ikke fantes i typen.
 */
class ToolFeil extends Error {
  status: number;

  constructor(melding: string, status: number) {
    super(melding);
    this.name = "ToolFeil";
    this.status = status;
  }
}

const toolDefs: Verktoy[] = [
  {
    name: "list_processes",
    description: "List available process definitions.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_process_definition",
    description: "Get a full process definition, including all steps.",
    inputSchema: {
      type: "object",
      required: ["prosessId"],
      properties: { prosessId: { type: "string" } }
    }
  },
  {
    name: "list_people",
    description: "List demo people that can start a process.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "start_process_session",
    description: "Start a process session for a person and process id.",
    inputSchema: {
      type: "object",
      required: ["personId", "prosessId"],
      properties: {
        personId: { type: "string" },
        prosessId: { type: "string" },
        sporingsId: { type: "string" }
      }
    }
  },
  {
    name: "get_session",
    description: "Get current process session state and active step.",
    inputSchema: {
      type: "object",
      required: ["oektsId"],
      properties: { oektsId: { type: "string" } }
    }
  },
  {
    name: "answer_question",
    description: "Save answer for the current question step.",
    inputSchema: {
      type: "object",
      required: ["oektsId", "svar"],
      properties: {
        oektsId: { type: "string" },
        stegId: { type: "string" },
        svar: {}
      }
    }
  },
  {
    name: "consent_response",
    description: "Create consent request if needed and register approve/deny response.",
    inputSchema: {
      type: "object",
      required: ["oektsId", "approved"],
      properties: {
        oektsId: { type: "string" },
        approved: { type: "boolean" }
      }
    }
  },
  {
    name: "run_current_action",
    description: "Run action for current DATA_FETCH, SUMMARY, or SUBMIT step.",
    inputSchema: {
      type: "object",
      required: ["oektsId"],
      properties: { oektsId: { type: "string" } }
    }
  },
  {
    name: "next_step",
    description: "Move process session to next step.",
    inputSchema: {
      type: "object",
      required: ["oektsId"],
      properties: { oektsId: { type: "string" } }
    }
  },
  {
    name: "previous_step",
    description: "Move process session to previous step.",
    inputSchema: {
      type: "object",
      required: ["oektsId"],
      properties: { oektsId: { type: "string" } }
    }
  },
  {
    name: "interpret_reply",
    description: "Interpret a user reply into one of three intents.",
    inputSchema: {
      type: "object",
      required: ["tekst", "jaIntent", "neiIntent", "ukjentIntent"],
      properties: {
        tekst: { type: "string" },
        jaIntent: { type: "string" },
        neiIntent: { type: "string" },
        ukjentIntent: { type: "string" },
        kontekst: { type: "object" },
        sporingsId: { type: "string" }
      }
    }
  },
  {
    name: "get_household_income",
    description: "Get the household income basis for a person, calculated via the Fiks skatte- og inntektsopplysninger API. Shows which amounts count and which are excluded.",
    inputSchema: {
      type: "object",
      required: ["personId"],
      properties: { personId: { type: "string" } }
    }
  },
  {
    name: "check_eligibility",
    description: "Check whether a person's household qualifies for a reduced-payment scheme. Deterministic: compares the income basis against the thresholds in satser.json.",
    inputSchema: {
      type: "object",
      required: ["personId", "ordning"],
      properties: {
        personId: { type: "string" },
        ordning: { type: "string", description: "Scheme id, e.g. redusert-foreldrebetaling-barnehage. Use list_schemes to see all." }
      }
    }
  },
  {
    name: "list_schemes",
    description: "List the reduced-payment schemes with their income thresholds and rules.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "match_process_choice",
    description: "Match free-text user message to a process candidate list.",
    inputSchema: {
      type: "object",
      required: ["tekst", "prosesser"],
      properties: {
        tekst: { type: "string" },
        prosesser: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "navn"],
            properties: {
              id: { type: "string" },
              navn: { type: "string" },
              beskrivelse: { type: "string" }
            }
          }
        },
        history: {
          type: "array",
          items: {
            type: "object",
            properties: {
              role: { type: "string" },
              message: { type: "string" }
            }
          }
        },
        kontekst: { type: "object" },
        sporingsId: { type: "string" }
      }
    }
  },
  {
    name: "get_audit_log",
    description: "Get audit events by tracking id.",
    inputSchema: {
      type: "object",
      required: ["sporingsId"],
      properties: { sporingsId: { type: "string" } }
    }
  },
  {
    name: "matrikkel_finn_veger",
    description: "Find streets in matrikkel by partial street name. Can return either first match or all matches.",
    inputSchema: {
      type: "object",
      properties: {
        gate: { type: "string" },
        all: { type: "boolean", description: "Return all matches when true. Defaults to false for backward compatibility." },
        limit: { type: "integer", minimum: 1, description: "Optional page size when all=true." },
        offset: { type: "integer", minimum: 0, description: "Optional page offset when all=true." }
      }
    }
  },
  {
    name: "matrikkel_hent_eiendom",
    description: "Fetch one property from matrikkel by matrikkelId, by gnr+bnr, or by exact address text such as 'Storgata 5'. In live/hybrid mode, exact address lookups can use Geonorge.",
    inputSchema: {
      type: "object",
      properties: {
        matrikkelId: { type: "string" },
        adresse: { type: "string" },
        gnr: { type: "integer" },
        bnr: { type: "integer" }
      }
    }
  },
  {
    name: "matrikkel_hent_eiere",
    description: "Get owners for one property from matrikkel by matrikkelId, by gnr+bnr, or by exact address text. Live public address sources may return no owner information.",
    inputSchema: {
      type: "object",
      properties: {
        matrikkelId: { type: "string" },
        adresse: { type: "string" },
        gnr: { type: "integer" },
        bnr: { type: "integer" }
      }
    }
  },
  {
    name: "brreg_search_organisations",
    description: "Search BRREG Enhetsregisteret testdata for organisations by name/orgnr and optional filters.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free text search over orgnr, navn, and naering info." },
        kommune: { type: "string", description: "Optional municipality filter." },
        organisasjonsform: { type: "string", description: "Optional organisation form filter (for example AS)." },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        offset: { type: "integer", minimum: 0 }
      }
    }
  },
  {
    name: "brreg_get_organisation",
    description: "Get one organisation by organisasjonsnummer from BRREG Enhetsregisteret testdata.",
    inputSchema: {
      type: "object",
      required: ["organisasjonsnummer"],
      properties: {
        organisasjonsnummer: { type: "string" }
      }
    }
  },
  {
    name: "folkeregister_search_persons",
    description: "Search Folkeregisteret syntetiske testdata for persons by name, fødselsnummer, or municipality.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free text over name, fnr, personId, commune." },
        foedselsEllerDNummer: { type: "string" },
        fnr: { type: "string", description: "Alias for foedselsEllerDNummer." },
        kommune: { type: "string" },
        includeSkjermet: { type: "boolean", default: false },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        offset: { type: "integer", minimum: 0 }
      }
    }
  },
  {
    name: "folkeregister_get_person",
    description: "Get one person from Folkeregisteret by fødselsnummer or sandbox personId.",
    inputSchema: {
      type: "object",
      properties: {
        foedselsEllerDNummer: { type: "string" },
        fnr: { type: "string", description: "Alias for foedselsEllerDNummer." },
        personId: { type: "string", description: "Sandbox personId, e.g. person-001." },
        includeSkjermet: { type: "boolean", default: false }
      }
    }
  },
  {
    name: "answer_citizen_question",
    description: "Answer a free-standing question a citizen asks mid-flow (what the income threshold is, why tax data is needed, what happens to their data). Grounded only in the schemes, the process definition and what the session has already fetched — it looks nothing up and cannot reach consent-gated data. Guardrails run on the answer: no decisions, no invented amounts, no prompt injection.",
    inputSchema: {
      type: "object",
      required: ["tekst"],
      properties: {
        tekst: { type: "string", description: "The citizen's question, verbatim." },
        sporingsId: { type: "string" },
        kontekst: {
          type: "object",
          description: "Grounding. satser is fetched automatically when omitted.",
          properties: {
            tjeneste: { type: "string" },
            steg: { type: "object" },
            prosess: { type: "object" },
            satser: { type: "object" },
            samtykke: { type: "object" },
            resultater: { type: "object" },
            samtale: { type: "array", items: { type: "object" } }
          }
        }
      }
    }
  },
  {
    name: "suggest_step_tools",
    description: "Ask the AI gateway which MCP tools are relevant for a given process step. Returns tools to call proactively for context and/or to validate user answers.",
    inputSchema: {
      type: "object",
      required: ["steg"],
      properties: {
        steg: {
          type: "object",
          description: "The active process step definition (id, tittel, tekst, felter).",
          properties: {
            id: { type: "string" },
            tittel: { type: "string" },
            tekst: { type: "string" },
            felter: { type: "array" }
          }
        },
        tilgjengeligeVerktoy: {
          type: "array",
          description: "Subset of tool names (strings) to consider. Defaults to all Matrikkel tools if omitted.",
          items: { type: "string" }
        },
        sporingsId: { type: "string" }
      }
    }
  }
];

// Samme CORS på JSON og tekst: /docs og /openapi.yaml hører med, ellers dør et
// nettleserkall i preflight, og det er bare synlig i konsollet.
const { jsonResponse: json, textResponse: sendTekst } = svarhjelpere({
  cors: cors("GET,POST,OPTIONS")
});

// Standardtypen her er text/plain, ikke text/html som i de andre tjenestene.
function tekst(
  response: ServerResponse,
  statusCode: number,
  data: string,
  contentType = "text/plain; charset=utf-8"
): void {
  sendTekst(response, statusCode, data, contentType);
}

// A 400 from the backend is the caller's fault, not ours. Without the status code
// here, "Ukjent ordning: ... Gyldige: ..." was repackaged as a 500 "Intern feil i
// tools-api", and whoever called the tool — human or model — lost the message
// about what was wrong and could not correct itself.
function upstreamError(data: { feil?: string }, status: number, kilde: string): ToolFeil {
  return new ToolFeil(data.feil || `${kilde} feil ${status}`, status);
}

// Bad arguments to a tool. Same reasoning as above: the caller must be able to
// correct itself, which requires a 4xx and a precise message.
function clientError(melding: string, status = 400): ToolFeil {
  return new ToolFeil(melding, status);
}

async function api<T = unknown>(
  path: string,
  options: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {}
): Promise<T> {
  const res = await fetch(`${backendBaseUrl}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(await maskinportenHeader(TOKEN)),
      ...(options.headers || {})
    },
    ...options
  });
  const data = (await res.json()) as { feil?: string };
  if (!res.ok) {
    throw upstreamError(data, res.status, "Backend");
  }
  return data as T;
}

async function ai<T = unknown>(path: string, payload: unknown): Promise<T> {
  const res = await fetch(`${aiBaseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = (await res.json()) as { feil?: string };
  if (!res.ok) {
    throw upstreamError(data, res.status, "AI");
  }
  return data as T;
}

async function matrikkel<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${matrikkelBaseUrl}${path}`);
  const data = (await res.json()) as { feil?: string };
  if (!res.ok) {
    throw upstreamError(data, res.status, "Matrikkel");
  }
  return data as T;
}

function normalize(verdi: unknown): string {
  return String(verdi || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function safeInt(verdi: unknown, fallback = 0): number {
  const n = Number.parseInt(String(verdi ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(verdi: unknown, min: number, max: number): number {
  return Math.max(min, Math.min(max, safeInt(verdi, min)));
}

function parseEmbeddedMetadata(doc: TenorEnhet): TenorEnhet | null {
  const raw = doc?.tenorMetadata?.kildedata;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toBrregOrganisation(doc: TenorEnhet): Organisasjon {
  const embedded = parseEmbeddedMetadata(doc);
  const orgForm = embedded?.organisasjonsform || {};
  const addr = doc?.forretningsadresse || embedded?.forretningsadresse || null;
  const postAddr = doc?.postadresse || embedded?.postadresse || null;
  return {
    organisasjonsnummer: String(doc?.organisasjonsnummer || embedded?.organisasjonsnummer || ""),
    navn: String(doc?.navn || embedded?.navn || ""),
    organisasjonsform: {
      kode: orgForm?.kode ? String(orgForm.kode) : null,
      beskrivelse: orgForm?.beskrivelse ? String(orgForm.beskrivelse) : null
    },
    naeringKode: Array.isArray(doc?.naeringKode) ? doc.naeringKode.map(String) : [],
    naeringBeskrivelse: Array.isArray(doc?.naeringBeskrivelse) ? doc.naeringBeskrivelse.map(String) : [],
    registrertIForetaksregisteret: Boolean(doc?.registrertIForetaksregisteret),
    registrertIMvaregisteret: Boolean(doc?.registrertIMvaregisteret),
    antallUnderenheter: doc?.antallUnderenheter ?? null,
    forretningsadresse: addr,
    postadresse: postAddr,
    telefonnummer: doc?.telefonnummer ? String(doc.telefonnummer) : null,
    nettside: doc?.hjemmeside ? String(doc.hjemmeside) : null,
    _search: normalize([
      doc?.organisasjonsnummer,
      doc?.navn,
      orgForm?.kode,
      orgForm?.beskrivelse,
      addr?.kommune,
      addr?.poststed,
      postAddr?.kommune,
      postAddr?.poststed,
      ...(Array.isArray(doc?.naeringKode) ? doc.naeringKode : []),
      ...(Array.isArray(doc?.naeringBeskrivelse) ? doc.naeringBeskrivelse : [])
    ].filter(Boolean).join(" "))
  };
}

async function loadBrregRegister(): Promise<BrregRegister> {
  const raw = await readFile(brregDataFile, "utf8");
  const parsed = JSON.parse(raw) as { dokumentListe?: unknown };
  const list: TenorEnhet[] = Array.isArray(parsed?.dokumentListe) ? parsed.dokumentListe : [];
  const organisations = list
    .map(toBrregOrganisation)
    .filter((org) => org.organisasjonsnummer && org.navn);
  return {
    organisations,
    byOrgnr: new Map(organisations.map((org) => [org.organisasjonsnummer, org]))
  };
}

async function getBrregRegister(): Promise<BrregRegister> {
  if (!brregRegisterPromise) {
    brregRegisterPromise = loadBrregRegister();
  }
  return brregRegisterPromise;
}

function buildFrSearchIndex(person: FolkeregisterPerson): string {
  const navn = person.personnavn;
  return normalize([
    person.foedselsEllerDNummer,
    navn?.fornavn,
    navn?.mellomnavn,
    navn?.etternavn,
    navn?.fornavn && navn?.etternavn ? `${navn.fornavn} ${navn.etternavn}` : null,
    person.bostedsadresse?.kommune,
    person.bostedsadresse?.poststed,
    person._sandbox?.personId,
    person._sandbox?.husstandId,
    person._sandbox?.rolle
  ].filter(Boolean).join(" "));
}

async function loadFolkeregisterRegister(): Promise<FolkeregisterRegister> {
  const raw = await readFile(folkeregisterDataFile, "utf8");
  const parsed = JSON.parse(raw) as { personer?: unknown };
  const persons: FolkeregisterPerson[] = Array.isArray(parsed?.personer) ? parsed.personer : [];

  const sandboxIdToFnr = new Map<string, string>(
    persons
      .filter((p) => p._sandbox?.personId && p.foedselsEllerDNummer)
      .map((p) => [p._sandbox!.personId!, p.foedselsEllerDNummer!])
  );

  for (const person of persons) {
    person._searchIndex = buildFrSearchIndex(person);
    for (const rel of person.forelderbarnrelasjon || []) {
      if (!rel.relatertPersonsIdent && rel._sandboxRelatertPersonId) {
        rel.relatertPersonsIdent = sandboxIdToFnr.get(rel._sandboxRelatertPersonId) || null;
      }
    }
  }

  return {
    persons,
    byFnr: new Map<string, FolkeregisterPerson>(
      persons.filter((p) => p.foedselsEllerDNummer).map((p) => [p.foedselsEllerDNummer!, p])
    ),
    byPersonId: new Map<string, FolkeregisterPerson>(
      persons.filter((p) => p._sandbox?.personId).map((p) => [p._sandbox!.personId!, p])
    )
  };
}

async function getFolkeregisterRegister(): Promise<FolkeregisterRegister> {
  if (!folkeregisterRegisterPromise) {
    folkeregisterRegisterPromise = loadFolkeregisterRegister();
  }
  return folkeregisterRegisterPromise;
}

function geonorgeQueryVariants(query: string): string[] {
  const tekst = String(query || "").trim();
  if (!tekst) return [];
  const varianter = new Set([tekst]);
  // Handle common keyboard fallbacks for Norwegian letters.
  varianter.add(tekst.replaceAll("ae", "æ").replaceAll("oe", "ø").replaceAll("aa", "å"));
  varianter.add(tekst.replaceAll("Ae", "Æ").replaceAll("Oe", "Ø").replaceAll("Aa", "Å"));
  return [...varianter].filter(Boolean);
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), matrikkelHttpTimeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "workshop-ai-mcp/0.1 (+local sandbox)" }
    });
    const data = (await res.json()) as { feilmelding?: string; feil?: string };
    if (!res.ok) {
      throw new Error(data?.feilmelding || data?.feil || `HTTP ${res.status}`);
    }
    return data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Timeout mot matrikkel-kilde etter ${matrikkelHttpTimeoutMs} ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function geonorgeAdresseTilGate(adresse: GeonorgeAdresse): Gatetreff {
  return {
    gateId: `geo-${adresse.kommunenummer || ""}-${normalize(adresse.adressenavn)}`,
    adressenavn: String(adresse.adressenavn || ""),
    kommunenummer: String(adresse.kommunenummer || ""),
    kommune: String(adresse.kommunenavn || ""),
    postnummer: String(adresse.postnummer || ""),
    poststed: String(adresse.poststed || ""),
    antallEiendommer: 1
  };
}

function geonorgeAdresseTekst(adresse: GeonorgeAdresse): string {
  if (adresse?.adressetekst) return String(adresse.adressetekst).replace(/\s+/g, " ").trim();
  const navn = String(adresse?.adressenavn || "").trim();
  const nummer = safeInt(adresse?.nummer, 0);
  const bokstav = String(adresse?.bokstav || "").trim().toUpperCase();
  return [navn, nummer ? `${nummer}${bokstav}` : ""].filter(Boolean).join(" ").trim();
}

function normalizeAdresseText(verdi: unknown): string {
  return normalize(verdi).replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
}

function buildAdressekjerne(verdi: unknown): string {
  const tekst = normalizeAdresseText(verdi)
    .replace(/\b(norge|norway)\b/gu, " ")
    .replace(/\b\d{4}\s+[\p{L}\s-]+$/u, " ")
    .replace(/\b[\p{L}\s-]+\s+\d{4}$/u, " ")
    .replace(/\b[\p{L}\s-]+$/u, (match) => (/\d/.test(match) ? match : " "))
    .replace(/\s+/g, " ")
    .trim();

  const treff = tekst.match(/([\p{L}][\p{L}\s.-]*?(?:gata|gate|veien|vegen)\s+\d+[\p{L}]?)/iu);
  return treff?.[1] ? normalizeAdresseText(treff[1]) : tekst;
}

function geonorgeAdresseTilEiendom(adresse: GeonorgeAdresse): Matrikkeleiendom {
  const husnummer = safeInt(adresse?.nummer, 0);
  const husbokstav = String(adresse?.bokstav || "").trim().toUpperCase() || null;
  const adressetekst = geonorgeAdresseTekst(adresse);
  const kommunenummer = String(adresse?.kommunenummer || "");
  const adressekode = safeInt(adresse?.adressekode, 0);
  const gnr = safeInt(adresse?.gardsnummer, 0);
  const bnr = safeInt(adresse?.bruksnummer, 0);
  const fnr = safeInt(adresse?.festenummer, 0);
  const undernummer = safeInt(adresse?.undernummer, 0) || null;
  return {
    matrikkelId: `geo-${kommunenummer}-${adressekode}-${husnummer}${husbokstav || ""}-${gnr}-${bnr}`,
    gnr,
    bnr,
    festenummer: fnr,
    undernummer,
    adressekode,
    adresse: adressetekst,
    husnummer,
    husbokstav,
    bruksenhetstype: "ukjent",
    adressenavn: String(adresse?.adressenavn || ""),
    kommunenummer,
    kommune: String(adresse?.kommunenavn || ""),
    postnummer: String(adresse?.postnummer || ""),
    poststed: String(adresse?.poststed || ""),
    objtype: String(adresse?.objtype || "Vegadresse"),
    koordinater: adresse?.representasjonspunkt
      ? {
          lat: Number(adresse.representasjonspunkt.lat || 0),
          lon: Number(adresse.representasjonspunkt.lon || 0),
          epsg: String(adresse.representasjonspunkt.epsg || "EPSG:4258")
        }
      : null,
    eiere: [],
    syntetisk: false,
    kilde: {
      navn: "Geonorge adresser v1",
      type: "offentlig-adressegrunnlag"
    }
  };
}

function pickBestLiveAdresse(adresser: GeonorgeAdresse[], query: string): GeonorgeAdresse | null {
  if (!Array.isArray(adresser) || !adresser.length) return null;
  const soek = normalizeAdresseText(query);
  const searchCore = buildAdressekjerne(query);
  const eksakt = adresser.find((adresse) => normalizeAdresseText(geonorgeAdresseTekst(adresse)) === soek);
  if (eksakt) return eksakt;
  const eksaktKjerne = adresser.find((adresse) => buildAdressekjerne(geonorgeAdresseTekst(adresse)) === searchCore);
  if (eksaktKjerne) return eksaktKjerne;
  const starterMed = adresser.find((adresse) => normalizeAdresseText(geonorgeAdresseTekst(adresse)).startsWith(soek));
  if (starterMed) return starterMed;
  const starterMedKjerne = adresser.find((adresse) => buildAdressekjerne(geonorgeAdresseTekst(adresse)).startsWith(searchCore));
  if (starterMedKjerne) return starterMedKjerne;
  const inneholder = adresser.find((adresse) => normalizeAdresseText(geonorgeAdresseTekst(adresse)).includes(soek));
  if (inneholder) return inneholder;
  const inneholderKjerne = adresser.find((adresse) => buildAdressekjerne(geonorgeAdresseTekst(adresse)).includes(searchCore));
  return inneholderKjerne || adresser[0] || null;
}

function paginateList<T>(liste: T[], args: Verktoyargumenter = {}) {
  const offset = Math.max(0, safeInt(args.offset, 0));
  const limit = Number.isInteger(args.limit)
    ? clampInt(args.limit, 1, 1000)
    : Math.max(1, liste.length || 1);
  return liste.slice(offset, offset + limit);
}

async function findVegerLive(args: Verktoyargumenter = {}): Promise<Gatetreff[]> {
  const gate = String(args.gate || "").trim();
  if (!gate) return [];

  const offset = Math.max(0, safeInt(args.offset, 0));
  const requestedLimit = Number.isInteger(args.limit) ? args.limit : (args.all ? 20 : 1);
  const limit = clampInt(requestedLimit, 1, 200);
  const treffPerSide = clampInt(offset + limit, 10, 1000);

  const perGate = new Map();
  for (const variant of geonorgeQueryVariants(gate)) {
    const params = new URLSearchParams({
      sok: variant,
      treffPerSide: String(treffPerSide),
      side: "0"
    });
    const data = await fetchJson(`${geonorgeAdresseBaseUrl}/sok?${params.toString()}`) as { adresser?: GeonorgeAdresse[] };
    const adresser = Array.isArray(data?.adresser) ? data.adresser : [];
    for (const adresse of adresser) {
      if (!adresse?.adressenavn) continue;
      const key = `${adresse.kommunenummer || ""}|${normalize(adresse.adressenavn)}`;
      if (!perGate.has(key)) {
        perGate.set(key, geonorgeAdresseTilGate(adresse));
      } else {
        const eksisterende = perGate.get(key);
        eksisterende.antallEiendommer += 1;
      }
    }
  }

  const liste = [...perGate.values()].sort((a, b) => {
    const navn = a.adressenavn.localeCompare(b.adressenavn, "nb");
    return navn !== 0 ? navn : String(a.kommunenummer).localeCompare(String(b.kommunenummer), "nb");
  });
  return paginateList(liste, { offset, limit });
}

async function findEiendomLive(args: Verktoyargumenter = {}): Promise<Matrikkeleiendom | null> {
  const adresse = String(args.adresse || "").trim();
  if (!adresse) return null;

  const adresseKjerne = buildAdressekjerne(adresse);
  const searchTerms = new Set([
    adresse,
    adresseKjerne,
    adresseKjerne.replace(/\s*,\s*/g, " ").trim()
  ].filter(Boolean));

  const kandidater = [];
  for (const term of searchTerms) {
    for (const variant of geonorgeQueryVariants(term)) {
    const params = new URLSearchParams({
      sok: variant,
      treffPerSide: "20",
      side: "0"
    });
    const data = await fetchJson(`${geonorgeAdresseBaseUrl}/sok?${params.toString()}`) as { adresser?: GeonorgeAdresse[] };
    kandidater.push(...(Array.isArray(data?.adresser) ? data.adresser : []));
    }
  }

  const adresseTreff = pickBestLiveAdresse(kandidater, adresse);
  return adresseTreff ? geonorgeAdresseTilEiendom(adresseTreff) : null;
}

async function findVegerMock(args: Verktoyargumenter = {}): Promise<Gatetreff[]> {
  const params = new URLSearchParams();
  if (args.gate) params.set("gate", String(args.gate));
  if (Number.isInteger(args.limit)) params.set("limit", String(args.limit));
  if (Number.isInteger(args.offset)) params.set("offset", String(args.offset));
  const suffix = params.size ? `?${params.toString()}` : "";
  const result = await matrikkel<Gatetreff[] | { items?: Gatetreff[] } | null>(`/mock/matrikkel/gater${suffix}`);
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.items)) return result.items;
  return result ? [result as Gatetreff] : [];
}

function matrikkelVegerSvar(liste: Gatetreff[], args: Verktoyargumenter = {}): Gatetreff | Gatetreff[] {
  if (args.all) return liste;
  if (!liste.length) {
    throw new Error(`Fant ingen gater for soeket ${args.gate || ""}.`);
  }
  return liste[0];
}

function damerauLevenshtein(a: string, b: string): number {
  const s = String(a || "");
  const t = String(b || "");
  const d = Array.from({ length: s.length + 1 }, () => Array(t.length + 1).fill(0));
  for (let i = 0; i <= s.length; i += 1) d[i][0] = i;
  for (let j = 0; j <= t.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= s.length; i += 1) {
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
      }
    }
  }
  return d[s.length][t.length];
}

function fuzzyGateTreff(gater: Gatetreff[], gateSoek: string, limit = 10): Gatetreff[] {
  const soek = normalize(gateSoek);
  if (!soek) return [];
  return [...gater]
    .map((gate) => ({ gate, distanse: damerauLevenshtein(soek, normalize(gate.adressenavn)) }))
    .filter((entry) => entry.distanse <= 2)
    .sort((a, b) => a.distanse - b.distanse || a.gate.adressenavn.localeCompare(b.gate.adressenavn, "nb"))
    .slice(0, Math.max(1, limit))
    .map((entry) => entry.gate);
}

// Returtypen er unknown: hvert verktøy har sin egen svarform, og resultatet går
// rett ut som JSON. Kallstedet pakker det inn uten å lese i det.
async function invokeTool(name: string | undefined, args: Verktoyargumenter = {}): Promise<unknown> {
  if (name === "list_processes") {
    const prosessdata = await api<Prosessinfo[] | Prosessliste>("/api/prosesser");
    const prosesser: Prosessinfo[] = Array.isArray(prosessdata)
      ? prosessdata
      : (Array.isArray(prosessdata?.prosesser) ? prosessdata.prosesser : []);
    const maler: Prosessinfo[] = Array.isArray(prosessdata) ? [] : (prosessdata?.maler ?? []);

    const toProsessInfo = (p: Prosessinfo) => ({
      id: p.id,
      navn: p.navn,
      beskrivelse: p.beskrivelse,
      antallSteg: p.steg?.length || 0
    });

    return {
      count: prosesser.length,
      prosesser: prosesser.map(toProsessInfo),
      antallMaler: maler.length,
      maler: maler.map(toProsessInfo)
    };
  }

  if (name === "list_people") {
    const personer = await api<Personinfo[]>("/api/personer");
    return {
      count: personer.length,
      personer: personer.map((p) => ({
        personId: p.personId,
        navn: p.visningsnavn,
        kommune: p.bostedsadresse?.kommune
      }))
    };
  }

  if (name === "get_process_definition") {
    return api(`/api/prosesser/${encodeURIComponent(argTekst(args.prosessId))}`);
  }

  if (name === "start_process_session") {
    const sporingsId = args.sporingsId || `flyt-${Date.now()}`;
    return api("/api/prosessoekter", {
      method: "POST",
      body: JSON.stringify({
        personId: args.personId,
        prosessId: args.prosessId,
        sporingsId
      })
    });
  }

  if (name === "get_session") {
    return api(`/api/prosessoekter/${args.oektsId}`);
  }

  if (name === "answer_question") {
    return api(`/api/prosessoekter/${args.oektsId}/svar`, {
      method: "POST",
      body: JSON.stringify({
        stegId: args.stegId,
        svar: args.svar
      })
    });
  }

  if (name === "consent_response") {
    const session = await api<{ aktivtSamtykkeId?: string }>(`/api/prosessoekter/${args.oektsId}`);
    if (!session.aktivtSamtykkeId) {
      const opprett = await api<{ oekt?: { aktivtSamtykkeId?: string } }>(`/api/prosessoekter/${args.oektsId}/handling`, {
        method: "POST",
        body: JSON.stringify({ handling: "opprett-samtykke" })
      });
      if (!opprett?.oekt?.aktivtSamtykkeId) {
        throw new Error("Kunne ikke opprette aktivt samtykke.");
      }
    }

    return api(`/api/prosessoekter/${args.oektsId}/handling`, {
      method: "POST",
      body: JSON.stringify({
        handling: "samtykkesvar",
        status: args.approved ? "SAMTYKKET" : "IKKE_SAMTYKKET"
      })
    });
  }

  if (name === "run_current_action") {
    return api(`/api/prosessoekter/${args.oektsId}/handling`, {
      method: "POST",
      body: JSON.stringify({})
    });
  }

  if (name === "next_step") {
    return api(`/api/prosessoekter/${args.oektsId}/neste`, {
      method: "POST",
      body: JSON.stringify({})
    });
  }

  if (name === "previous_step") {
    return api(`/api/prosessoekter/${args.oektsId}/forrige`, {
      method: "POST",
      body: JSON.stringify({})
    });
  }

  if (name === "interpret_reply") {
    return ai("/ai/tolk-svar", {
      tekst: args.tekst,
      jaIntent: args.jaIntent,
      neiIntent: args.neiIntent,
      ukjentIntent: args.ukjentIntent,
      kontekst: args.kontekst || {},
      sporingsId: args.sporingsId
    });
  }

  if (name === "get_household_income") {
    return api(`/api/personer/${args.personId}/inntekt`);
  }

  if (name === "check_eligibility") {
    return api(`/api/regler/sjekk/foreldrebetaling?personId=${encodeURIComponent(argTekst(args.personId))}&ordning=${encodeURIComponent(argTekst(args.ordning))}`);
  }

  if (name === "list_schemes") {
    return api("/api/regler/satser");
  }

  if (name === "answer_citizen_question") {
    const kontekst: Record<string, unknown> = { ...(args.kontekst as Record<string, unknown> || {}) };
    // Fetched here rather than in ai-gateway on purpose: the gateway has no
    // data path to the backend, and that is what makes it structurally unable
    // to reach consent-gated data. Callers may still send their own satser.
    if (!kontekst.satser) {
      try {
        kontekst.satser = await api("/api/regler/satser");
      } catch {
        // An answer without satser is still useful; the coverage guard in
        // ai-gateway refuses threshold questions rather than guessing.
      }
    }
    return ai("/ai/sporsmaal", {
      tekst: args.tekst,
      sporingsId: args.sporingsId,
      kontekst,
      sprak: "nb"
    });
  }

  if (name === "match_process_choice") {
    return ai("/ai/velg-prosess", {
      tekst: args.tekst,
      prosesser: args.prosesser,
      history: args.history || [],
      kontekst: args.kontekst || {},
      sporingsId: args.sporingsId
    });
  }

  if (name === "get_audit_log") {
    return api(`/api/revisjonslogg/${args.sporingsId}`);
  }

  if (name === "matrikkel_finn_veger") {
    const kanBrukeLive = (matrikkelMode === "live" || matrikkelMode === "hybrid") && args.gate;
    if (kanBrukeLive) {
      try {
        const liveTreff = await findVegerLive(args);
        if (liveTreff.length || matrikkelMode === "live") {
          return matrikkelVegerSvar(liveTreff, args);
        }
      } catch (error) {
        if (matrikkelMode === "live") {
          throw error;
        }
      }
    }

    const mockTreff = await findVegerMock(args);
    if (mockTreff.length || !args.gate) {
      return matrikkelVegerSvar(mockTreff, args);
    }

    // Last fallback: typo-tolerant match over the full mock list.
    const alleMockTreff = await findVegerMock({ all: true, limit: 5000, offset: 0 });
    const fuzzyTreff = fuzzyGateTreff(alleMockTreff, argTekst(args.gate), argHeltall(args.limit, 10));
    return matrikkelVegerSvar(fuzzyTreff, args);
  }

  if (name === "matrikkel_hent_eiendom") {
    const kanBrukeLiveAdresse = (matrikkelMode === "live" || matrikkelMode === "hybrid") && args.adresse;
    if (kanBrukeLiveAdresse) {
      try {
        const liveEiendom = await findEiendomLive(args);
        if (liveEiendom || matrikkelMode === "live") {
          if (!liveEiendom) {
            throw new Error(`Fant ikke adressen ${args.adresse} i offentlig adressekilde.`);
          }
          return liveEiendom;
        }
      } catch (error) {
        if (matrikkelMode === "live") {
          throw error;
        }
      }
    }

    if (args.matrikkelId) {
      return matrikkel(`/mock/matrikkel/eiendom/${encodeURIComponent(argTekst(args.matrikkelId))}`);
    }
    if (args.adresse) {
      return matrikkel(`/mock/matrikkel/eiendom-oppslag?adresse=${encodeURIComponent(argTekst(args.adresse))}`);
    }
    if (Number.isInteger(args.gnr) && Number.isInteger(args.bnr)) {
      const eiendommer = await matrikkel<Matrikkeleiendom[]>("/mock/matrikkel/eiendommer");
      const funn = eiendommer.find((e) => Number(e.gnr) === args.gnr && Number(e.bnr) === args.bnr);
      if (!funn) throw clientError(`Fant ikke matrikkelenhet med gnr=${args.gnr} og bnr=${args.bnr}.`, 404);
      return funn;
    }
    throw clientError("Oppgi enten matrikkelId, adresse eller begge feltene gnr og bnr.");
  }

  if (name === "matrikkel_hent_eiere") {
    // invokeTool gir unknown fordi hvert verktøy har sin egen form. Her er det
    // matrikkel_hent_eiendom som svarer, og den formen er kjent.
    const eiendom = await invokeTool("matrikkel_hent_eiendom", args) as Matrikkeleiendom;
    const syntetisk = eiendom?.syntetisk !== false;
    const eiere = Array.isArray(eiendom.eiere) ? eiendom.eiere : [];
    return {
      matrikkelId: eiendom.matrikkelId,
      gnr: eiendom.gnr,
      bnr: eiendom.bnr,
      adresse: eiendom.adresse,
      eiere,
      antallEiere: eiere.length,
      syntetisk,
      kilde: eiendom.kilde,
      merknad: syntetisk ? undefined : "Offentlig adressekilde inneholder ikke eierinformasjon."
    };
  }

  if (name === "brreg_search_organisations") {
    const register = await getBrregRegister();
    const query = normalize(args.query || args.q || "");
    const kommune = normalize(args.kommune || "");
    const organisasjonsform = normalize(args.organisasjonsform || "");
    const offset = Math.max(0, safeInt(args.offset, 0));
    const limit = clampInt(args.limit ?? 10, 1, 100);

    const filtered = register.organisations.filter((org) => {
      if (query && !org._search.includes(query)) return false;
      if (kommune) {
        const kommuneValues = [org.forretningsadresse?.kommune, org.postadresse?.kommune]
          .filter(Boolean)
          .map((value) => normalize(String(value)));
        if (!kommuneValues.some((value) => value.includes(kommune))) return false;
      }
      if (organisasjonsform) {
        const formSearch = normalize(`${org.organisasjonsform?.kode || ""} ${org.organisasjonsform?.beskrivelse || ""}`);
        if (!formSearch.includes(organisasjonsform)) return false;
      }
      return true;
    });

    const organisasjoner = filtered.slice(offset, offset + limit).map((org) => ({
      organisasjonsnummer: org.organisasjonsnummer,
      navn: org.navn,
      organisasjonsform: org.organisasjonsform,
      naeringKode: org.naeringKode,
      registrertIForetaksregisteret: org.registrertIForetaksregisteret,
      registrertIMvaregisteret: org.registrertIMvaregisteret,
      forretningsadresse: org.forretningsadresse
    }));

    return {
      total: filtered.length,
      offset,
      limit,
      count: organisasjoner.length,
      organisasjoner
    };
  }

  if (name === "brreg_get_organisation") {
    const organisasjonsnummer = String(args.organisasjonsnummer || "").trim();
    if (!organisasjonsnummer) {
      throw clientError("Oppgi organisasjonsnummer.");
    }
    const register = await getBrregRegister();
    const org = register.byOrgnr.get(organisasjonsnummer);
    if (!org) {
      throw clientError(`Fant ikke organisasjon med organisasjonsnummer ${organisasjonsnummer}.`, 404);
    }
    const { _search, ...result } = org;
    return result;
  }

  if (name === "folkeregister_search_persons") {
    const register = await getFolkeregisterRegister();
    const query = normalize(args.query || args.q || "");
    const fnr = String(args.foedselsEllerDNummer || args.fnr || "").trim();
    const kommune = normalize(args.kommune || "");
    const offset = Math.max(0, safeInt(args.offset, 0));
    const limit = clampInt(args.limit ?? 10, 1, 100);
    const includeSkjermet = Boolean(args.includeSkjermet);

    if (fnr) {
      const person = register.byFnr.get(fnr);
      if (!person) return { total: 0, offset, limit, count: 0, personer: [] };
      if (person.skjermet && !includeSkjermet) {
        return { total: 0, offset, limit, count: 0, personer: [], merknad: "Skjermet person." };
      }
      const { _searchIndex, ...safe } = person;
      return { total: 1, offset: 0, limit, count: 1, personer: [safe] };
    }

    const filtered = register.persons.filter((person) => {
      if (person.skjermet && !includeSkjermet) return false;
      if (query && !person._searchIndex?.includes(query)) return false;
      if (kommune) {
        const komVal = normalize(String(person.bostedsadresse?.kommune || ""));
        if (!komVal.includes(kommune)) return false;
      }
      return true;
    });

    const personer = filtered.slice(offset, offset + limit).map((person) => ({
      foedselsEllerDNummer: person.foedselsEllerDNummer,
      personnavn: person.personnavn,
      foedselsdato: person.foedselsdato,
      kjoenn: person.kjoenn,
      sivilstand: person.sivilstand,
      bostedsadresse: person.bostedsadresse,
      skjermet: person.skjermet,
      _sandbox: person._sandbox
    }));

    return { total: filtered.length, offset, limit, count: personer.length, personer };
  }

  if (name === "folkeregister_get_person") {
    const fnr = String(args.foedselsEllerDNummer || args.fnr || "").trim();
    const personId = String(args.personId || "").trim();
    if (!fnr && !personId) {
      throw clientError("Oppgi foedselsEllerDNummer eller personId.");
    }
    const register = await getFolkeregisterRegister();
    const person = fnr ? register.byFnr.get(fnr) : register.byPersonId.get(personId);
    if (!person) {
      throw clientError(
        `Fant ikke person med ${fnr ? `foedselsEllerDNummer ${fnr}` : `personId ${personId}`}.`,
        404
      );
    }
    if (person.skjermet && !args.includeSkjermet) {
      throw clientError("Personen er skjermet.", 403);
    }
    const { _searchIndex, ...result } = person;
    return result;
  }

  if (name === "suggest_step_tools") {
    // Build the list of tool descriptors to send to ai-gateway.
    // If the caller supplies a subset, honour it; otherwise default to matrikkel tools.
    const verktoyNavn = Array.isArray(args.tilgjengeligeVerktoy) && args.tilgjengeligeVerktoy.length > 0
      ? args.tilgjengeligeVerktoy
      : [
          "matrikkel_finn_veger",
          "matrikkel_hent_eiendom",
          "matrikkel_hent_eiere",
          "brreg_search_organisations",
          "brreg_get_organisation",
          "folkeregister_search_persons",
          "folkeregister_get_person"
        ];

    const verktoyMedBeskrivelse = toolDefs
      .filter((t) => verktoyNavn.includes(t.name))
      .map((t) => ({ name: t.name, description: t.description }));

    const res = await fetch(`${aiBaseUrl}/ai/velg-verktoy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        steg: args.steg || {},
        verktoy: verktoyMedBeskrivelse,
        sporingsId: args.sporingsId
      })
    });
    const data = (await res.json()) as { feil?: string };
    if (!res.ok) throw new Error(data.feil || `AI feil ${res.status}`);
    return data;
  }

  throw clientError(`Ukjent tool: ${name}. Se GET /mcp/tools for gyldige navn.`, 404);
}

const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
  const url = new URL(request.url!, `http://${request.headers.host}`);

  if (request.method === "OPTIONS") {
    json(response, 204, {});
    return;
  }

  try {
    if (url.pathname === "/helse") {
      json(response, 200, { status: "ok", tjeneste: "tools-api", tidspunkt: new Date().toISOString() });
      return;
    }

    if (request.method === "GET" && url.pathname === "/docs") {
      tekst(response, 200, docsHtml(await routeOverview(openapiFile)), "text/html; charset=utf-8");
      return;
    }

    if (request.method === "GET" && url.pathname === "/openapi.yaml") {
      tekst(response, 200, await readFile(openapiFile, "utf8"), "text/yaml; charset=utf-8");
      return;
    }

    // Den samme spesifikasjonen, lest. En nettleser kan ikke lese YAML uten en
    // parser, og sandkassen har ingen — så tjenesten leser sin egen fil og svarer
    // med det API-utforskeren trenger.
    if (request.method === "GET" && url.pathname === "/openapi-ruter.json") {
      json(response, 200, await routeOverview(openapiFile));
      return;
    }

    /*
     * The paths keep the /mcp prefix. They are wire format — process-agent, the
     * cookbook and the spec all name them — and renaming a path is a different
     * decision from renaming a service. It is the one place left where the prefix
     * still claims a protocol this service does not speak.
     *
     * `protocol` is not a path, and it did describe the service. It said
     * "mcp-style-http", which is what the whole rename was for.
     */
    if (request.method === "GET" && url.pathname === "/mcp") {
      json(response, 200, {
        name: "innbyggerdialog-tools-api",
        protocol: "rest",
        version: "0.1.0"
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/mcp/tools") {
      json(response, 200, { tools: toolDefs });
      return;
    }

    if (request.method === "POST" && url.pathname === "/mcp/tools/invoke") {
      const body = await readRequestBody(request) as InvokeKropp;
      const toolArgs = body.toolArgs || body.args || body["arguments"] || {};
      const result = await invokeTool(body.name, toolArgs);
      json(response, 200, { ok: true, tool: body.name, result });
      return;
    }

    const byName = url.pathname.match(/^\/mcp\/tools\/([^/]+)\/invoke$/);
    if (request.method === "POST" && byName) {
      const body = await readRequestBody(request) as InvokeKropp;
      const toolArgs = body.toolArgs || body.args || body["arguments"] || {};
      const result = await invokeTool(byName[1], toolArgs);
      json(response, 200, { ok: true, tool: byName[1], result });
      return;
    }

    json(response, 404, { feil: "Fant ikke endepunkt." });
  } catch (error) {
    // Client errors pass through with their own status and message, so the caller
    // learns what was wrong. Only genuine server errors become 500.
    const status = error instanceof ToolFeil ? error.status : 0;
    if (status >= 400 && status < 500) {
      json(response, status, { feil: feilmelding(error) });
      return;
    }
    json(response, 500, { feil: "Intern feil i tools-api.", detalj: feilmelding(error) });
  }
});

server.listen(port, () => {
  console.log(`Tools-api kjører på http://localhost:${port}`);
});


