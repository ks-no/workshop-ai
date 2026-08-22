// Domain types for the sandbox.
//
// Hand-written, not generated from openapi/. Those specs are currently too thin to
// generate anything usable — prosessoekt, sjekkresultat, satser, person, husstand
// and inntekt have no schema at all. The right direction is the opposite: this file
// is the source, and the gaps in OpenAPI get filled from it.
//
// Ambition is deliberately low where the data is synthetic and loosely shaped. The
// point is that step types and rule types are closed unions, so a new variant
// cannot be added without the compiler demanding a handler.

// --- process model --------------------------------------------------------

export type Stegtype =
  | "INFO"
  | "QUESTION"
  | "CONSENT_REQUEST"
  | "DATA_FETCH"
  | "SJEKK"
  | "SUMMARY"
  | "SUBMIT";

export type Feltype = "tekst" | "ja-nei" | "valg";

export type SpoersmaalsFelt = {
  id: string;
  label: string;
  type: Feltype;
  obligatorisk?: boolean;
  alternativer?: string[];
};

export type ApiKall = {
  method?: string;
  url: string;
};

type StegFelles = {
  id: string;
  tittel?: string;
  tekst?: string;
};

export type ProsessSteg = StegFelles & (
  | { type: "INFO" }
  | { type: "QUESTION"; felter?: SpoersmaalsFelt[] }
  | { type: "CONSENT_REQUEST"; formaal?: string; dataKilder?: string[] }
  | { type: "DATA_FETCH"; api: ApiKall; kreverSamtykke?: string }
  | { type: "SJEKK"; api: ApiKall; feilmelding?: string }
  | { type: "SUMMARY" }
  | { type: "SUBMIT" }
);

export type Redigering = {
  status?: string;
  mal?: boolean;
  [key: string]: unknown;
};

export type ProsessDefinisjon = {
  id: string;
  navn: string;
  beskrivelse?: string;
  versjon?: string;
  steg: ProsessSteg[];
  redigering: Redigering;
  syntetisk?: boolean;
};

export type OektStatus = "AKTIV" | "AVVIST" | "FULLFORT";

export type Prosessoekt = {
  oektsId: string;
  prosessId: string;
  personId: string;
  sporingsId: string;
  status: OektStatus;
  stegIndex: number;
  svar: Record<string, unknown>;
  resultater: Record<string, unknown>;
  aktivtSamtykkeId: string | null;
  avvistMelding?: string;
  opprettet: string;
  oppdatert: string;
  syntetisk?: boolean;
};

// --- rules and rates ------------------------------------------------------

// A closed union so the compiler demands a handler in regelHandtere (vilkaar.ts) the moment a
// new rule type appears. TJENESTEBEHOV is the first one that is not about money:
// støttekontakt is assessed on need and capacity, and must not drag an income
// lookup — and its consent — along with it.
export type Regeltype = "INNTEKTSGRENSE" | "MAKS_ANDEL_AV_INNTEKT" | "TJENESTEBEHOV";

export type Tjeneste = "barnehage" | "sfo" | "fritid" | "stottekontakt";

export type Ordning = {
  id: string;
  navn: string;
  tjeneste: Tjeneste;
  regel: Regeltype;
  beskrivelse?: string;
  inntektsgrense?: number;
  alderFraAar?: number;
  alderTilAar?: number;
  trinnFra?: number;
  trinnTil?: number;
  /** TJENESTEBEHOV: which dataset of tjenestetilbud the ordning is assessed against. */
  tilbudsdatasett?: string;
};

export type Satser = {
  gjelderFra: string;
  kilde: string;
  maksAndelAvInntekt: number;
  maanederMedBetaling: number;
  ordninger: Ordning[];
  [key: string]: unknown;
};

/**
 * The contract a SJEKK step must satisfy. If `godkjent` is false the oekt becomes
 * AVVIST and `melding` becomes `avvistMelding`. See docs/prosessmodell.md.
 */
export type SjekkResultat = {
  godkjent: boolean;
  melding: string;
  grunnlag?: Record<string, unknown>;
};

// --- data and state -------------------------------------------------------

// The datasets are synthetic and loosely shaped. We model the fields the code
// actually reads and leave the rest open.
type MedFelter = { [key: string]: any };

// FREG grades address protection: kode 7 (FORTROLIG) and kode 6
// (STRENGT_FORTROLIG), plus the ungraded majority. Closed, so the masking rules in
// skjerming.ts must cover every grade the compiler knows about. The boolean
// `skjermet` is derived from this field and never the other way round — the same
// invariant scripts/valider-data.js enforces on the seed.
export type Adressegradering = "UGRADERT" | "FORTROLIG" | "STRENGT_FORTROLIG";

// mellomnavn is null rather than absent throughout the seed, and masking writes
// null too. Typing it as string only would reject both.
export type Personnavn = { fornavn: string; mellomnavn?: string | null; etternavn: string };

export type Person = MedFelter & {
  personId: string;
  husstandId: string;
  syntetiskFodselsnummer: string;
  foedselsdato?: string;
  navn: Personnavn;
  adressebeskyttelse: Adressegradering;
  skjermet: boolean;
};

export type Husstandsmedlem = { personId: string; rolle: "foresatt" | "barn" | string };

export type Husstand = MedFelter & {
  husstandId: string;
  medlemmer: Husstandsmedlem[];
};

export type Plass = MedFelter & {
  personId: string;
  manedspris: number;
  trinn?: number;
};

export type Samtykke = MedFelter & {
  samtykkeId: string;
  personId: string;
  status: string;
  dataKilder: string[];
};

export type State = {
  personer: Person[];
  husstander: Husstand[];
  inntekter: MedFelter[];
  barnehageplasser: Plass[];
  sfoplasser: Plass[];
  soknader: MedFelter[];
  prosesser: ProsessDefinisjon[];
  prosessMaler: ProsessDefinisjon[];
  prosessFormatVersion: string;
  prosessKatalogMeta: Record<string, unknown>;
  informasjonsmodeller: unknown;
  samtykker: Samtykke[];
  revisjonslogg: MedFelter[];
  prosessoekter: Prosessoekt[];
  satser: Satser;
  [datasett: string]: any;
};
