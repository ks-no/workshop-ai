// Eneste sted i denne appen som kjenner til apps/lommebok sitt API. Sidene kaller
// funksjonene her; de kjenner verken URL-er, request-formen eller feilhåndteringen.
// Alt går gjennom /api/* som vite.config.ts proxyer videre til lommebok (se der).
//
// Utstedelse og verifisering har begge en simulert reserve: testmiljøet
// (bevisgenerator/verifier-service) er en ekstern tjeneste vi ikke kontrollerer, og
// denne demoen skal fungere også uten nett. Simulert resultat er alltid tydelig
// merket `simulert: true` i tilstanden - se komponentene som viser det fram.

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
const VERIFIER_BASE_URL = "https://verifier-service.test.eidas2sandkasse.net";
const FALLBACK_CLIENT_ID = "abr.vc.local";

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
    dcql_query: dcqlQueryFor(kind),
    redirect_uri: `${window.location.origin}/verifisering-fullfort`
  };

  try {
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
  } catch (err) {
    console.warn("Klarte ikke starte verifisering mot testmiljøet, simulerer i stedet:", err);
    const transactionId = `sim-verify-${kind}-${Date.now().toString(36)}`;
    const requestUri = `${VERIFIER_BASE_URL}/api/v1/${VERIFIER_CLIENT_APP}/openid4vp/${transactionId}`;
    return {
      simulert: true,
      transactionId,
      authorizationRequest:
        `eudi-openid4vp://${VERIFIER_BASE_URL.replace(/^https?:\/\//, "")}` +
        `?client_id=${encodeURIComponent(FALLBACK_CLIENT_ID)}` +
        `&request_uri=${encodeURIComponent(requestUri)}`
    };
  }
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

// «Simuler fullført skanning» - samme mekanisme som apps/lommebok/src/components/Verifiserer.tsx,
// men bygget på personen den faktiske saken gjelder, ikke en fast testperson.
export async function simulerVerifisering(
  kind: CredentialKind,
  person: Person,
  transactionId: string
): Promise<Record<string, unknown>> {
  const simulertResultat = {
    status: "SUCCESS",
    verifier_transaction_id: transactionId,
    verified_at: new Date().toISOString(),
    credential_configuration_id: CREDENTIAL_CONFIGURATION_IDS[kind],
    format: "dc+sd-jwt",
    claims: claimsFor(kind, person)
  };

  try {
    await fetch("/api/verifikasjon/lagre", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactionId, result: simulertResultat })
    });
  } catch {
    // Lagring i lommebokens minne-cache er best-effort - den simulerte visningen her
    // trenger den ikke for å fungere i denne appen.
  }

  return simulertResultat;
}
