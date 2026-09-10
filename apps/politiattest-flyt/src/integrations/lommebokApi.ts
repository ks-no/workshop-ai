// Eneste sted i denne appen som kjenner til apps/lommebok sitt API. Sidene kaller
// funksjonene her; de kjenner verken URL-er, request-formen eller feilhåndteringen.
// Vite proxyer utstedelse og data til lommebok, og verifisering direkte til den samme
// verifier-tjenesten som lommebok bruker. Feil vises fram; ingen av protokollstegene
// erstattes med simulerte QR-koder.

import type { CredentialKind, Person } from "../types";
import { extractVerifiedClaims } from "../../../shared/openid4vp";
import {
  CREDENTIAL_CONFIGURATION_IDS,
  byggFormalsbevisClaims,
  byggFormalsbevisDcqlQuery,
  byggPolitiattestClaims,
  byggPolitiattestDcqlQuery
} from "./credentialDefinitions";

const VERIFIER_CLIENT_APP = "bevisgenerator-login";

function claimsFor(kind: CredentialKind, person: Person): Record<string, unknown> {
  return kind === "formalsbekreftelse" ? byggFormalsbevisClaims(person) : byggPolitiattestClaims(person);
}

function dcqlQueryFor(kind: CredentialKind) {
  return kind === "formalsbekreftelse" ? byggFormalsbevisDcqlQuery() : byggPolitiattestDcqlQuery();
}

function credentialQueryIdFor(kind: CredentialKind): string {
  return kind === "formalsbekreftelse" ? "formalsbekreftelse-bevis" : "politiattest-bevis";
}

export async function hentPersoner(): Promise<Person[]> {
  const res = await fetch("/api/personer");
  if (!res.ok) {
    throw new Error(`Klarte ikke hente personer fra lommebok (HTTP ${res.status}).`);
  }
  return res.json();
}

export interface UtstedelseResultat {
  suksess: boolean;
  simulert: boolean;
  transactionId: string | null;
  credentialOfferUri: string | null;
  qrCodeDataUri: string | null;
  feilmelding?: string;
}

// POST /api/utsted - starter OpenID4VCI pre-authorized-flow mot testmiljøets
// bevisgenerator, via lommeboks eksisterende middleware.
export async function utstedBevis(kind: CredentialKind, person: Person): Promise<UtstedelseResultat> {
  const res = await fetch("/api/utsted", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      credentialConfigurationId: CREDENTIAL_CONFIGURATION_IDS[kind],
      personIdentifier: person.syntetiskFodselsnummer,
      credentialIssuer: "https://utsteder.test.eidas2sandkasse.net/bevisgenerator",
      credentialData: claimsFor(kind, person)
    })
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.detaljer || data.error || `HTTP ${res.status}`);
  }

  return {
    suksess: true,
    simulert: false,
    transactionId: data.issuanceTransactionId || null,
    credentialOfferUri: data.credentialOfferUri || null,
    qrCodeDataUri: data.qrCodeDataUri || null
  };
}

export interface VerifiseringStartResultat {
  simulert: boolean;
  transactionId: string;
  authorizationRequest: string;
}

// POST /api/v1/bevisgenerator-login/verify/start/ - starter OpenID4VP-presentasjon.
export async function startVerifisering(kind: CredentialKind): Promise<VerifiseringStartResultat> {
  const requestBody = {
    dcql_query: dcqlQueryFor(kind)
  };

  const res = await fetch(`/api/v1/${VERIFIER_CLIENT_APP}/verify/start/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": "KS-HACKATHON" },
    body: JSON.stringify(requestBody)
  });
  if (!res.ok) throw new Error(`Verifier-tjenesten svarte HTTP ${res.status}`);
  const data = await res.json();
  return {
    simulert: false,
    transactionId: data.verifier_transaction_id,
    authorizationRequest: data.authorization_request
  };
}

export type VerifiseringsstatusSvar = "WAIT" | "AVAILABLE" | "FAILED" | "EXPIRED";

// GET /api/v1/.../verify/status/:id - kalles jevnlig fra sidene selv (setInterval)
// slik at et avbrutt/stengt fane ikke etterlater en løpende poll her i adapteren.
export async function hentVerifiseringsstatus(transactionId: string): Promise<VerifiseringsstatusSvar | null> {
  try {
    const res = await fetch(`/api/v1/${VERIFIER_CLIENT_APP}/verify/status/${transactionId}`, {
      headers: { Accept: "application/json", "X-API-KEY": "KS-HACKATHON" }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.status ?? null;
  } catch {
    return null;
  }
}

// GET /api/v1/.../verify/result/:id
export async function hentVerifiseringsresultat(
  transactionId: string,
  kind: CredentialKind
): Promise<{ claims: Record<string, unknown>; raw: Record<string, unknown> } | null> {
  try {
    const res = await fetch(`/api/v1/${VERIFIER_CLIENT_APP}/verify/result/${transactionId}`, {
      headers: { Accept: "application/json", "X-API-KEY": "KS-HACKATHON" }
    });
    if (!res.ok) return null;
    const raw = await res.json() as Record<string, unknown>;
    const claims = extractVerifiedClaims(raw, credentialQueryIdFor(kind));
    return claims ? { claims, raw } : null;
  } catch {
    return null;
  }
}
