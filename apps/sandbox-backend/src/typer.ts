// Domenetypene for sandboxen.
//
// Skrevet for hånd, ikke generert fra openapi/. Spesifikasjonene der er i dag
// for tynne til å generere noe brukbart — prosessøkt, sjekkresultat, satser,
// person, husstand og inntekt har ingen schema i det hele tatt. Riktig retning
// er derfor motsatt: denne fila er kilden, og hullene i OpenAPI fylles fra den.
//
// Ambisjonsnivået er bevisst lavt der dataene er syntetiske og løst formede.
// Poenget er at stegtyper og regeltyper er lukkede unioner, slik at en ny
// variant ikke kan legges til uten at kompilatoren krever en håndterer.

// --- prosessmodell --------------------------------------------------------

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

// --- regler og satser -----------------------------------------------------

export type Regeltype = "INNTEKTSGRENSE" | "MAKS_ANDEL_AV_INNTEKT";

export type Tjeneste = "barnehage" | "sfo";

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
 * Kontrakten et SJEKK-steg må oppfylle. Er `godkjent` false, settes økten til
 * AVVIST og `melding` blir `avvistMelding`. Se docs/prosessmodell.md.
 */
export type SjekkResultat = {
  godkjent: boolean;
  melding: string;
  grunnlag?: Record<string, unknown>;
};

// --- data og tilstand -----------------------------------------------------

// Datasettene er syntetiske og løst formede. Vi modellerer feltene koden
// faktisk leser, og lar resten være åpen.
type MedFelter = { [key: string]: any };

export type Person = MedFelter & {
  personId: string;
  husstandId: string;
  syntetiskFodselsnummer: string;
  foedselsdato?: string;
  navn: { fornavn: string; mellomnavn?: string; etternavn: string };
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

export type Gate = MedFelter & {
  gateId: string;
  adressenavn: string;
  eiendommer: Array<{ eiere?: string[] } & MedFelter>;
};

export type Tilstand = {
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
  matrikkel: { gater: Gate[] } & MedFelter;
  satser: Satser;
  [datasett: string]: any;
};
