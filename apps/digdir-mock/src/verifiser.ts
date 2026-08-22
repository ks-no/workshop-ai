// HOW TO VERIFY A TOKEN
//
// The mirror of klient.ts. That file says how to get a token; this one says how to
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
// request is handled. See krevTilgang in sandbox-backend/src/autentisering.ts.

import { createPublicKey, createVerify } from "node:crypto";
import type { JsonWebKey } from "node:crypto";

export type VerifikatorValg = {
  /** Where to fetch JWKS. Inside docker this is not the same as the issuer name. */
  digdirBaseUrl: string;
  /** Accepted `iss` for machine tokens. */
  maskinportenIssuer: string;
  /** Accepted `iss` for citizen tokens. */
  idportenIssuer: string;
  /** The audience this resource server answers to. */
  audience: string;
};

export type VerifisertToken = {
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
export class TokenFeil extends Error {
  status: number;

  constructor(melding: string, status = 401) {
    super(melding);
    this.name = "TokenFeil";
    this.status = status;
  }
}

/** Clock skew tolerance. Small on purpose — everything here runs on one machine. */
const slakkSekunder = 10;

export function lagVerifikator(valg: VerifikatorValg) {
  // Cached by kid. digdir-mock persists its key across restarts, but --reset
  // rotates it, so an unknown kid triggers exactly one refetch before we give up.
  // Refetching on every unknown kid would turn a bad token into a way to make this
  // service hammer the issuer.
  let jwks = new Map<string, JsonWebKey>();
  let hentetSist = 0;

  async function hentNokkel(kid: string): Promise<JsonWebKey> {
    const kjent = jwks.get(kid);
    if (kjent) return kjent;

    if (Date.now() - hentetSist < 3000) {
      throw new TokenFeil(`Ukjent signeringsnøkkel (kid ${kid}).`);
    }
    hentetSist = Date.now();

    let noekler: any[];
    try {
      const svar = await fetch(`${valg.digdirBaseUrl}/jwks`, { signal: AbortSignal.timeout(3000) });
      if (!svar.ok) {
        throw new Error(`status ${svar.status}`);
      }
      noekler = ((await svar.json()) as any).keys || [];
    } catch (feil) {
      throw new TokenFeil(
        `Fikk ikke kontakt med tokenutstederen på ${valg.digdirBaseUrl}. ` +
        `Kjører digdir-mock? (${(feil as Error).message})`,
        503
      );
    }

    jwks = new Map(noekler.filter((n) => n.kid).map((n) => [n.kid, n]));
    const funnet = jwks.get(kid);
    if (!funnet) {
      throw new TokenFeil(
        `Tokenet er signert med en nøkkel utstederen ikke kjenner (kid ${kid}). ` +
        `Er tokenet fra før en ./start.sh --reset?`
      );
    }
    return funnet;
  }

  return async function verifiser(token: string): Promise<VerifisertToken> {
    const deler = token.split(".");
    if (deler.length !== 3) {
      throw new TokenFeil("Tokenet er ikke en JWT med tre segmenter.");
    }

    let header: any;
    let krav: any;
    try {
      header = JSON.parse(Buffer.from(deler[0], "base64url").toString("utf8"));
      krav = JSON.parse(Buffer.from(deler[1], "base64url").toString("utf8"));
    } catch {
      throw new TokenFeil("Tokenet kunne ikke dekodes.");
    }

    // Never take the header's word for the algorithm. Accepting alg: "none", or an
    // HMAC alg verified against the public key as a shared secret, is the classic
    // JWT hole.
    if (header.alg !== "RS256") {
      throw new TokenFeil(`Forventet alg RS256, tokenet oppgir ${header.alg}.`);
    }
    if (!header.kid) {
      throw new TokenFeil("Tokenet mangler kid, så nøkkelen kan ikke velges.");
    }

    const jwk = await hentNokkel(header.kid);
    const signaturGyldig = createVerify("RSA-SHA256")
      .update(`${deler[0]}.${deler[1]}`)
      .verify(createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(deler[2], "base64url"));
    if (!signaturGyldig) {
      throw new TokenFeil("Signaturen stemmer ikke med utstederens nøkkel.");
    }

    const naa = Math.floor(Date.now() / 1000);
    if (typeof krav.exp !== "number" || krav.exp + slakkSekunder < naa) {
      throw new TokenFeil("Tokenet er utløpt. Hent et nytt med scripts/token.ts.");
    }
    if (typeof krav.iat === "number" && krav.iat - slakkSekunder > naa) {
      throw new TokenFeil("Tokenet er utstedt fram i tid.");
    }
    if (krav.iss !== valg.maskinportenIssuer && krav.iss !== valg.idportenIssuer) {
      throw new TokenFeil(
        `Ukjent utsteder ${krav.iss}. Forventet ${valg.maskinportenIssuer} eller ${valg.idportenIssuer}.`
      );
    }

    // Audience restriction. A token minted for another API must not open doors
    // here, however valid its signature is.
    const mottakere = Array.isArray(krav.aud) ? krav.aud : [krav.aud];
    if (!mottakere.includes(valg.audience)) {
      throw new TokenFeil(
        `Tokenet er utstedt for ${mottakere.join(", ")}, ikke for ${valg.audience}.`
      );
    }

    return {
      krav,
      utsteder: krav.iss === valg.idportenIssuer ? "idporten" : "maskinporten"
    };
  };
}
