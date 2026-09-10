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

export type MessageStatus = "ulest" | "lest";

export interface InboxMessage {
  id: string;
  kind: CredentialKind;
  title: string;
  createdAt: string;
  status: MessageStatus;
  issuance: IssuanceRecord;
}

// Kommunesakens egen tilstand - det saksbehandleren ser.
export type KommuneSaksstatus =
  | "ingen_sak"
  | "venter_paa_politiattest"
  | "politiattest_mottatt"
  | "avsluttet";

export interface CaseState {
  person: Person | null;
  soknadsdato: string | null;
  kommuneSaksstatus: KommuneSaksstatus;
  formalsbevis: {
    issuance: IssuanceRecord | null;
    verification: VerificationRecord | null;
  };
  politiattest: {
    issuance: IssuanceRecord | null;
    verification: VerificationRecord | null;
  };
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
