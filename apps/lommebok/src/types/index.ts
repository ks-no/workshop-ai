export interface KrrData {
  fnr: string;
  epost?: {
    adresse: string;
    sistOppdatert?: string;
    sistVerifisert?: string;
  };
  tlf?: {
    nummer: string;
    sistOppdatert?: string;
    sistVerifisert?: string;
  };
  status: string;
  reservert: boolean;
  kanVarsles?: boolean;
  spraak?: string;
}

export interface BarnehageplassData {
  personId: string;
  barnehageId: string;
  barnehagenavn: string;
  kommune: string;
  plassprosent: number;
  manedspris: number;
  barnFnr?: string;
  barnNavn?: string;
}

export interface PolitiattestData {
  attestId: string;
  dokumenttype: string;
  fnr: string;
  formaal: string;
  hjemmel: string;
  attesttype: string;
  utstedt: string;
  utsteder?: {
    navn: string;
    enhet: string;
    organisasjonsnummer: string;
  };
  anmerkninger?: any[];
}

export interface InntektPost {
  tekniskNavn: string;
  visningstekst: string;
  beloep: number;
  kilde: string;
  medregnes: boolean;
}

export interface InntektData {
  personId: string;
  identifikator: string;
  inntektsaar: number;
  stadie: string;
  skatteoppgjoersdato: string;
  poster: InntektPost[];
}

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
    adressenavn?: string;
    husnummer?: number;
    postnummer?: string;
    poststed?: string;
    kommunenummer?: string;
    kommune?: string;
  };
  kontakt?: {
    epost?: string;
    telefon?: string;
  };
  krr?: KrrData | null;
  barnehageplass?: BarnehageplassData | null;
  politiattest?: PolitiattestData | null;
  inntekt?: InntektData | null;
  husstand?: any | null;
}

export type CredentialId = "pid" | "krr" | "barnehage" | "politiattest" | "ledsagerbevis" | "inntekt";

export interface ClaimDefinition {
  path: string;
  label: string;
  required?: boolean;
}

export interface CredentialDefinition {
  id: CredentialId;
  tittel: string;
  beskrivelse: string;
  utstederNavn: string;
  format: "dc+sd-jwt" | "mso_mdoc";
  vct: string;
  credentialConfigurationId: string;
  defaultIssuerUrl?: string;
  claims: ClaimDefinition[];
  lagEksempelData: (person: Person) => Record<string, any>;
  lagDcqlQuery: () => Record<string, any>;
}

export interface ApiCallTrace {
  id: string;
  tittel: string;
  tidspunkt: string;
  metode: string;
  url: string;
  headers: Record<string, string>;
  requestBody?: any;
  responseStatus?: number;
  responseBody?: any;
  curl: string;
}

export interface VerificationStartResponse {
  verifier_transaction_id: string;
  authorization_request?: string;
  authorization_request_qr_code?: string;
}

export interface VerificationStatusResponse {
  status: "WAIT" | "AVAILABLE" | "EXPIRED" | "FAILED" | "UNKNOWN";
  transaction_id?: string;
}
