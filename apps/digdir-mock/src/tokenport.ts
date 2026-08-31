// The Maskinporten gate a resource server puts in front of a machine surface.
// verify.ts says whether a token is genuine; this says how a surface refuses one
// that is not. Scope, surface and realm are parameters, and each service maps
// TokenportError to its own error shape - the policy stays with the caller.

import type { IncomingMessage } from "node:http";
import { TokenError, type Verifiserer } from "./verify.ts";

/**
 * A rejected request, with everything the service needs to render it: `status`,
 * a machine-readable `kode`, and the WWW-Authenticate header where RFC 6750 asks
 * for one.
 */
export class TokenportError extends Error {
  status: number;
  kode: string;
  headers: Record<string, string>;

  constructor(melding: string, status: number, kode: string, headers: Record<string, string> = {}) {
    super(melding);
    this.name = "TokenportError";
    this.status = status;
    this.kode = kode;
    this.headers = headers;
  }
}

/** Who was let in. `consumer` is the organisation Maskinporten names, when it does. */
export type Klient = { clientId: string; consumer: string | null };

export type PortOptions = {
  verifiser: Verifiserer;
  /** Names the service in WWW-Authenticate, and in the --resource hint in the 401. */
  realm: string;
  /** Off only via AUTH_ENFORCE=false, which is a migration switch and not a setting. */
  authEnforce: boolean;
};

/** The surface being guarded. `flate` names it in the message, so a 401 says which door was locked. */
export type Rute = { scope: string; flate: string };

export function createMaskinportenPort(valg: PortOptions) {
  const challenge = {
    "WWW-Authenticate": `Bearer realm="${valg.realm}", error="invalid_token"`
  };

  return async function requireMaskinporten(
    request: IncomingMessage,
    rute: Rute
  ): Promise<Klient | null> {
    if (!valg.authEnforce) return null;

    const header = request.headers.authorization;
    if (!header) {
      throw new TokenportError(
        `${rute.flate} krever et Maskinporten-token. Hent et med ` +
        `scripts/token.ts --maskinporten ${rute.scope} --resource ${valg.realm}.`,
        401,
        "MANGLER_TOKEN",
        challenge
      );
    }
    const [ordning, token] = header.split(" ");
    if (!/^bearer$/i.test(ordning || "") || !token) {
      throw new TokenportError(
        "Authorization-headeren må være på formen «Bearer <token>».",
        401,
        "UGYLDIG_TOKEN",
        challenge
      );
    }

    let verified;
    try {
      verified = await valg.verifiser(token);
    } catch (feil) {
      if (feil instanceof TokenError) {
        // 503 keeps its own shape: an unreachable issuer is not a bad token, and a
        // challenge header would tell the client to retry an authentication that
        // was never the problem.
        throw new TokenportError(
          feil.message,
          feil.status,
          feil.status === 401 ? "UGYLDIG_TOKEN" : "UTSTEDER_NEDE",
          feil.status === 401 ? challenge : {}
        );
      }
      throw feil;
    }

    // A citizen's ID-porten token cannot open these. They are machine-to-machine
    // surfaces: the hjemmel belongs to the municipality, not to whoever happens to be
    // logged in. sandbox-backend holds the verified citizen token, decides, and then
    // acts here as a machine - which is exactly the hjemmel/aktør distinction the
    // sandbox exists to show.
    if (verified.utsteder !== "maskinporten") {
      throw new TokenportError(
        `${rute.flate} er en maskin-til-maskin-flate. Et personlig ID-porten-token ` +
        "gir ikke hjemmel her, uansett sikkerhetsnivå.",
        403,
        "KREVER_MASKINPORTEN"
      );
    }

    const scopes = String(verified.krav.scope || "").split(" ").filter(Boolean);
    if (!scopes.includes(rute.scope)) {
      throw new TokenportError(
        `Klienten ${verified.krav.client_id} mangler scope ${rute.scope} ` +
        `(har: ${scopes.join(" ") || "ingen"}).`,
        403,
        "MANGLER_SCOPE"
      );
    }

    return {
      clientId: verified.krav.client_id || "ukjent",
      consumer: verified.krav.consumer?.ID || null
    };
  };
}
