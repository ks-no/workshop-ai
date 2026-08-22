// HOW TO VERIFY A TOKEN
//
// The mirror of client.ts. That file says how to get a token; this one says how to
// check one. Both live next to the issuer because that is where the protocol is
// defined, and both are imported by every service that needs them.
//
// One verifier, not one per resource server. sandbox-backend and fiks-simulator
// both guard their own surfaces, and the repo already carries the scar of four
// separate masking implementations — repeating that with token verification, where
// the failure mode is "accepts a token it should have refused", would be worse.
//
// What lives here is the *mechanics*: signature, algorithm, expiry, issuer,
// audience. What does NOT live here is policy — which scope opens which route, and
// whether a pid matches a subject. That differs per service and belongs where the
// request is handled. See requireTilgang in sandbox-backend/src/autentisering.ts.

import { createPublicKey, createVerify } from "node:crypto";
import type { JsonWebKey } from "node:crypto";

export type VerifierOptions = {
  /** Where to fetch JWKS. Inside docker this is not the same as the issuer name. */
  digdirBaseUrl: string;
  /** Accepted `iss` for machine tokens. */
  maskinportenIssuer: string;
  /** Accepted `iss` for citizen tokens. */
  idportenIssuer: string;
  /** The audience this resource server answers to. */
  audience: string;
};

export type VerifiedToken = {
  krav: Record<string, any>;
  /** Which gate issued it. The issuer decides, not the presence of a claim. */
  utsteder: "maskinporten" | "idporten";
};

/**
 * Thrown for a token that is present but not acceptable. `status` lets the caller
 * map it without knowing this module: 401 for a bad token, 503 when the issuer
 * itself cannot be reached — that is not the caller's fault and must not read as
 * "your token is invalid".
 */
export class TokenError extends Error {
  status: number;

  constructor(melding: string, status = 401) {
    super(melding);
    this.name = "TokenError";
    this.status = status;
  }
}

/** Clock skew tolerance. Small on purpose — everything here runs on one machine. */
const slackSeconds = 10;

export function createVerifier(valg: VerifierOptions) {
  // Cached by kid. digdir-mock persists its key across restarts, but --reset
  // rotates it, so an unknown kid triggers exactly one refetch before we give up.
  // Refetching on every unknown kid would turn a bad token into a way to make this
  // service hammer the issuer.
  let jwks = new Map<string, JsonWebKey>();
  let fetchedAt = 0;

  async function getKey(kid: string): Promise<JsonWebKey> {
    const known = jwks.get(kid);
    if (known) return known;

    if (Date.now() - fetchedAt < 3000) {
      throw new TokenError(`Ukjent signeringsnøkkel (kid ${kid}).`);
    }
    fetchedAt = Date.now();

    let keys: any[];
    try {
      const svar = await fetch(`${valg.digdirBaseUrl}/jwks`, { signal: AbortSignal.timeout(3000) });
      if (!svar.ok) {
        throw new Error(`status ${svar.status}`);
      }
      keys = ((await svar.json()) as any).keys || [];
    } catch (feil) {
      throw new TokenError(
        `Fikk ikke kontakt med tokenutstederen på ${valg.digdirBaseUrl}. ` +
        `Kjører digdir-mock? (${(feil as Error).message})`,
        503
      );
    }

    jwks = new Map(keys.filter((n) => n.kid).map((n) => [n.kid, n]));
    const found = jwks.get(kid);
    if (!found) {
      throw new TokenError(
        `Tokenet er signert med en nøkkel utstederen ikke kjenner (kid ${kid}). ` +
        `Er tokenet fra før en ./start.sh --reset?`
      );
    }
    return found;
  }

  return async function verifiser(token: string): Promise<VerifiedToken> {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new TokenError("Tokenet er ikke en JWT med tre segmenter.");
    }

    let header: any;
    let krav: any;
    try {
      header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
      krav = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    } catch {
      throw new TokenError("Tokenet kunne ikke dekodes.");
    }

    // Never take the header's word for the algorithm. Accepting alg: "none", or an
    // HMAC alg verified against the public key as a shared secret, is the classic
    // JWT hole.
    if (header.alg !== "RS256") {
      throw new TokenError(`Forventet alg RS256, tokenet oppgir ${header.alg}.`);
    }
    if (!header.kid) {
      throw new TokenError("Tokenet mangler kid, så nøkkelen kan ikke velges.");
    }

    const jwk = await getKey(header.kid);
    const signatureValid = createVerify("RSA-SHA256")
      .update(`${parts[0]}.${parts[1]}`)
      .verify(createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url"));
    if (!signatureValid) {
      throw new TokenError("Signaturen stemmer ikke med utstederens nøkkel.");
    }

    const now = Math.floor(Date.now() / 1000);
    if (typeof krav.exp !== "number" || krav.exp + slackSeconds < now) {
      throw new TokenError("Tokenet er utløpt. Hent et nytt med scripts/token.ts.");
    }
    if (typeof krav.iat === "number" && krav.iat - slackSeconds > now) {
      throw new TokenError("Tokenet er utstedt fram i tid.");
    }
    if (krav.iss !== valg.maskinportenIssuer && krav.iss !== valg.idportenIssuer) {
      throw new TokenError(
        `Ukjent utsteder ${krav.iss}. Forventet ${valg.maskinportenIssuer} eller ${valg.idportenIssuer}.`
      );
    }

    // Audience restriction. A token minted for another API must not open doors
    // here, however valid its signature is.
    const audiences = Array.isArray(krav.aud) ? krav.aud : [krav.aud];
    if (!audiences.includes(valg.audience)) {
      throw new TokenError(
        `Tokenet er utstedt for ${audiences.join(", ")}, ikke for ${valg.audience}.`
      );
    }

    return {
      krav,
      utsteder: krav.iss === valg.idportenIssuer ? "idporten" : "maskinporten"
    };
  };
}
