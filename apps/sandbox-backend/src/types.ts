// Domain types for the sandbox.
//
// Hand-written, not generated from openapi/. Those specs are currently too thin to
// generate anything usable - prosessoekt, sjekkresultat, satser, person, husstand
// and inntekt have no schema at all. The right direction is the opposite: this file
// is the source, and the gaps in OpenAPI get filled from it.
//
// Ambition is deliberately low where the data is synthetic and loosely shaped. The
// point is that step types and rule types are closed unions, so a new variant
// cannot be added without the compiler demanding a handler.

// The citizen datasets themselves live in the shared layer: fiks-simulator reads
// the same files off the same disk, so Person and Husstand belong to neither
// service. Re-exported nowhere - a caller that needs Person imports it from there.
import type { Husstand, MedFelter, Person, Plass, Samtykke } from "../../shared/innbyggerdata.ts";

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

// A plain string is both value and label. The object form separates them, so a
// kodeverk value can be stored while the citizen reads an ordinary word.
export type Alternativ = string | { verdi: string; label: string };

export type SpoersmaalsFelt = {
  id: string;
  label: string;
  type: Feltype;
  obligatorisk?: boolean;
  alternativer?: Alternativ[];
};

export function alternativVerdi(alternativ: Alternativ): string {
  return typeof alternativ === "string" ? alternativ : alternativ.verdi;
}

export function alternativLabel(alternativ: Alternativ): string {
  return typeof alternativ === "string" ? alternativ : alternativ.label;
}

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

// A closed union so the compiler demands a handler in regelHandlers (vilkaar.ts) the moment a
// new rule type appears. TJENESTEBEHOV is the first one that is not about money:
// støttekontakt is assessed on need and capacity, and must not drag an income
// lookup - and its consent - along with it.
export type Regeltype =
  | "INNTEKTSGRENSE"
  | "MAKS_ANDEL_AV_INNTEKT"
  | "TJENESTEBEHOV"
  | "TRANSPORTBEHOV";

export type Tjeneste = "barnehage" | "sfo" | "fritid" | "stottekontakt" | "transport";

export const KVOTEKATEGORIER = [
  "ordinaer",
  "saerskilde-behov",
  "blind-eller-rullestol",
  "elektrisk-rullestol"
] as const;
export type Kvotekategori = (typeof KVOTEKATEGORIER)[number];

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
  /**
   * TRANSPORTBEHOV. Kept apart from alderFraAar, which bounds a *child* with a
   * plass: here it is the applicant's own age that decides.
   */
  soekerAlderFraAar?: number;
  /** TRANSPORTBEHOV: how long the funksjonsnedsetting must last. */
  varighetMinstAar?: number;
  /** TRANSPORTBEHOV: the fylkesnummer the applicant must live in. */
  fylkesnummer?: string;
  /** TRANSPORTBEHOV: visus at or below this counts as blind or sterkt svaksynt. */
  visusgrense?: number;
  /** TRANSPORTBEHOV: reference amounts per kvotekategori. Reported, not computed. */
  kvoter?: Record<Kvotekategori, number>;
  /**
   * TRANSPORTBEHOV: the supplement for living more than 20 km from the nearest
   * post i butikk. Reference only - the rule does not add it, because the
   * process asks the citizen and the vedtak reads the legeerklæring.
   */
  kvotetilleggLangtTilPost?: number;
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

/**
 * prosessdefinisjoner.json, parsed - what a katalog write reads and hands back.
 *
 * The file's own shape is looser than this: an old version is a bare array, and
 * `meta` is whatever keys sat beside `prosesser` and `maler`. State carries the
 * same four fields flattened with a `prosess`-prefix, because a request reads
 * the whole state as one object.
 */
export type Prosesskatalog = {
  formatVersion: string;
  prosesser: ProsessDefinisjon[];
  maler: ProsessDefinisjon[];
  meta: Record<string, unknown>;
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
  informasjonsmodeller: unknown;
  samtykker: Samtykke[];
  revisjonslogg: MedFelter[];
  prosessoekter: Prosessoekt[];
  satser: Satser;
  fritidsdeltakelse: MedFelter[];
  fritidsaktiviteter: MedFelter[];
  tjenestetilbud: MedFelter[];
};

/*
 * The datasets a tjeneste or an ordning can name at *runtime* rather than in code:
 * tjenesteDatasett maps barnehage/sfo/fritid to one of these, and an ordning's
 * `tilbudsdatasett` names one directly.
 *
 * State deliberately has no `[key: string]: any` index signature - that one line
 * would make `tilstand.prosessokter` (a typo for prosessoekter) compile as `any`
 * and fail at runtime instead. The dynamic lookups go through datasettFor() in
 * state.ts, which narrows against this union once.
 */
export type Datasettnoekkel =
  | "barnehageplasser"
  | "sfoplasser"
  | "fritidsdeltakelse"
  | "fritidsaktiviteter"
  | "tjenestetilbud";
