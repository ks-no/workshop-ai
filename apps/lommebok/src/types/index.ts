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
    kommune?: string;
  };
  kontakt?: {
    epost?: string;
    telefon?: string;
  };
}

export type CredentialId = "pid" | "krr" | "barnehage" | "politiattest";

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
