// Delt tilstandsmodell for politiattest-demoen. Sidene (Kommune, Politiet, Innboks)
// leser og skriver denne via reducer i state/caseReducer.ts - de kjenner ikke
// hverandre direkte, bare denne formen.

export interface Person {
  personId: string;
  syntetiskFodselsnummer: string;
  visningsnavn: string;
  navn: {
    fornavn: string;
    mellomnavn?: string | null;
    etternavn: string;
  };
  foedselsdato: string;
  bostedsadresse?: {
    kommune?: string;
  };
  politiattest?: {
    attestId: string;
    formaal: string;
    attesttype: string;
    hjemmel: string;
    utstedt: string;
    anmerkninger?: unknown[];
  } | null;
}

// Ett treff fra hjemmelsok (apps/hjemmelsok): en rad fra politiets formålsoversikt,
// ordrett. Feltnavnene er tjenestens egne - se openapi/hjemmelsok.yaml - og gjenbrukes
// her uten omdøping.
export interface HjemmelTreff {
  id: string;
  kategori: string;
  formaal: string;
  beskrivelse: string;
  hjemmel: string;
  attesttype: string;
  bekreftelse: string;
  /** Modellens ene setning om hvorfor raden passer. Tom når ordsøket svarte alene. */
  begrunnelse: string;
}

// Hjemmelen saksbehandleren fant og valgte i steg 0. Den er det rettslige grunnlaget
// formålsbekreftelsen utstedes på, og hvor den kom fra er en del av valget: en
// lovhenvisning ingen har slått opp er en lovhenvisning ingen har kontrollert.
export interface Hjemmelvalg {
  treff: HjemmelTreff;
  /** Ordene saksbehandleren søkte med. Tom når hjemmelen kom fra attesten i saken. */
  soketekst: string;
  /** «modell», «ordsøk» eller «attest» - hvem som pekte ut raden. */
  kilde: string;
}

// De to bevisene i flyten. Rekkefølgen er alltid formalsbekreftelse -> politiattest.
export type CredentialKind = "formalsbekreftelse" | "politiattest";

// Utstedelse har bare denne ene statusen: vi kan aldri bekrefte at lommeboken har
// hentet beviset, bare at tilbudet (QR-koden) ble opprettet. Se AGENTS-notatet i
// planen: "tilbud klart" er ikke det samme som "mottatt".
export type IssuanceStatus = "tilbud_klart" | "feilet";

export interface IssuanceRecord {
  status: IssuanceStatus;
  transactionId: string | null;
  credentialOfferUri: string | null;
  qrCodeDataUri: string | null;
  issuedAt: string;
  simulated: boolean;
  feilmelding?: string;
}

// Verifisering går gjennom flere steg fram til en eksplisitt akseptgate er passert.
export type VerificationStage =
  | "ikke_startet"
  | "venter_paa_presentasjon"
  | "mottatt_ikke_godkjent"
  | "godkjent"
  | "avvist"
  | "feilet";

export interface VerificationRecord {
  stage: VerificationStage;
  transactionId: string | null;
  authorizationRequest: string | null;
  claims: Record<string, unknown> | null;
  simulated: boolean;
  rejectionReason: string | null;
  verifiedAt: string | null;
}

export type Vandelutfall = "godkjent" | "krever_manuell_vurdering" | "avvist";
export type VandelvurderingStatus = "ikke_hentet" | "laster" | "hentet" | "feil";

export interface VandelFormaal {
  rolle: string;
  ordning: string;
  formaal: string;
  kilde: string;
  hjemmel: string;
  attesttype: string;
  maksAlderMaaneder: number;
  oppbevaring: string;
}

export interface Vandelvurdering {
  status: VandelvurderingStatus;
  utfall: Vandelutfall | null;
  regelutfall: string | null;
  godkjent: boolean | null;
  melding: string | null;
  formaal: VandelFormaal | null;
  feil: string | null;
}

export type MessageStatus = "ulest" | "lest";

interface BaseInboxMessage {
  id: string;
  title: string;
  createdAt: string;
  status: MessageStatus;
}

export interface IssuanceInboxMessage extends BaseInboxMessage {
  type: "utstedelse";
  kind: CredentialKind;
  issuance: IssuanceRecord;
}

export interface VerificationRequestInboxMessage extends BaseInboxMessage {
  type: "ettersporsel";
  kind: "politiattest";
}

export type InboxMessage = IssuanceInboxMessage | VerificationRequestInboxMessage;

// Kommunesakens egen tilstand - det saksbehandleren ser.
export type KommuneSaksstatus =
  | "ingen_sak"
  | "venter_paa_politiattest"
  | "politiattest_mottatt"
  | "avsluttet";

export interface CaseState {
  person: Person | null;
  soknadsdato: string | null;
  idPortenAccessToken: string | null;
  kommuneSaksstatus: KommuneSaksstatus;
  /** Steg 0. Null til saksbehandleren har slått opp hjemmelen formålet krever. */
  hjemmelvalg: Hjemmelvalg | null;
  formalsbevis: {
    issuance: IssuanceRecord | null;
    verification: VerificationRecord | null;
  };
  politiattest: {
    issuance: IssuanceRecord | null;
    verification: VerificationRecord | null;
  };
  vandelvurdering: Vandelvurdering;
  inboxMessages: InboxMessage[];
}

export interface ApiCallTrace {
  id: string;
  tittel: string;
  tidspunkt: string;
  metode: string;
  url: string;
  simulert: boolean;
  responseStatus?: number;
}
