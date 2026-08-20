// AUTENTISERING: WHO IS CALLING
//
// This module answers one question — who is on the other end of this request —
// and refuses to answer a second one. Whether that caller is *allowed* to do the
// thing is authorisation, and it lives where the request is handled: in
// utforRessurs for data resources, and in handleRequest for the orchestration
// routes. Keeping the two apart is the whole pedagogical point of Del B:
//
//   401  we do not know who you are          (autentisering)
//   403  we know, and you still may not      (hjemmel)
//
// Two token types arrive here, from the two gates in digdir-mock:
//
//   ID-porten     a citizen. Carries `pid` (fødselsnummer) and `acr` (how strongly
//                 they were authenticated). Their hjemmel is that the data is
//                 theirs — so `pid` must resolve to the person being asked about.
//   Maskinporten  a machine. Carries `scope` and `client_id`, and no person at all.
//                 Its hjemmel is the scope its organisation was granted.
//
// A machine is never treated as the citizen. mcp-services reading a person's data
// is logged as a system with `paaVegneAv`, not as the citizen — a service that can
// hand itself any citizen's identity is exactly the wrong lesson.

import type { IncomingMessage } from "node:http";
import { createPublicKey, createVerify } from "node:crypto";
import {
  digdirBaseUrl,
  idportenIssuer,
  maskinportenIssuer,
  tokenAudience
} from "./config.ts";
import { HttpError } from "./errors.ts";

export type Kaller =
  | { type: "innbygger"; pid: string; acr: string; clientId: string }
  | { type: "system"; clientId: string; scope: string[]; consumer: string | null }
  | { type: "anonym" };

/** Clock skew tolerance. Small on purpose — everything here runs on one machine. */
const slakkSekunder = 10;

// --- JWKS -----------------------------------------------------------------

// Cached by kid. digdir-mock persists its key across restarts, but --reset rotates
// it, so an unknown kid triggers exactly one refetch before we give up. Refetching
// on every unknown kid without that guard turns a bad token into a way to make
// this service hammer the issuer.
let jwksCache = new Map<string, any>();
let hentetSist = 0;

async function hentNokkel(kid: string): Promise<any> {
  const kjent = jwksCache.get(kid);
  if (kjent) return kjent;

  // Do not refetch more than once every few seconds for the same miss.
  if (Date.now() - hentetSist < 3000) {
    throw ugyldig(`Ukjent signeringsnøkkel (kid ${kid}).`);
  }
  hentetSist = Date.now();

  let noekler: any[];
  try {
    const svar = await fetch(`${digdirBaseUrl}/jwks`, { signal: AbortSignal.timeout(3000) });
    if (!svar.ok) {
      throw new Error(`status ${svar.status}`);
    }
    noekler = ((await svar.json()) as any).keys || [];
  } catch (feil: any) {
    // The issuer being unreachable is not the caller's fault, and it must not read
    // as "your token is invalid". 503 says whose problem it is.
    throw new HttpError(
      `Fikk ikke kontakt med tokenutstederen på ${digdirBaseUrl}. Kjører digdir-mock?`,
      503,
      { detalj: feil.message, syntetisk: true }
    );
  }

  jwksCache = new Map(noekler.filter((n) => n.kid).map((n) => [n.kid, n]));
  const funnet = jwksCache.get(kid);
  if (!funnet) {
    throw ugyldig(
      `Tokenet er signert med en nøkkel utstederen ikke kjenner (kid ${kid}). ` +
      `Er tokenet fra før en ./start.sh --reset?`
    );
  }
  return funnet;
}

// --- verification ---------------------------------------------------------

function ugyldig(melding: string): HttpError {
  // RFC 6750 section 3: a 401 tells the client *how* to authenticate, and the
  // error code is machine-readable.
  //
  // The Norwegian explanation stays in the response body and deliberately does not
  // go into error_description. Header values are ASCII — RFC 6750 defines
  // error_description over a restricted character set — and «Tokenet er utløpt»
  // puts raw non-ASCII bytes on the wire, which a conforming client is entitled to
  // mangle or reject. Clients read the code in the header; people read the prose in
  // the body.
  return new HttpError(melding, 401, { syntetisk: true }, {
    "WWW-Authenticate": 'Bearer realm="sandbox-backend", error="invalid_token"'
  });
}

function b64url(segment: string): string {
  return Buffer.from(segment, "base64url").toString("utf8");
}

async function verifiser(token: string): Promise<any> {
  const deler = token.split(".");
  if (deler.length !== 3) {
    throw ugyldig("Tokenet er ikke en JWT med tre segmenter.");
  }

  let header: any;
  let krav: any;
  try {
    header = JSON.parse(b64url(deler[0]));
    krav = JSON.parse(b64url(deler[1]));
  } catch {
    throw ugyldig("Tokenet kunne ikke dekodes.");
  }

  // Never take the header's word for the algorithm. Accepting alg: "none", or an
  // HMAC alg verified against the public key as a secret, is the classic JWT hole.
  if (header.alg !== "RS256") {
    throw ugyldig(`Forventet alg RS256, tokenet oppgir ${header.alg}.`);
  }
  if (!header.kid) {
    throw ugyldig("Tokenet mangler kid, så nøkkelen kan ikke velges.");
  }

  const jwk = await hentNokkel(header.kid);
  const signaturGyldig = createVerify("RSA-SHA256")
    .update(`${deler[0]}.${deler[1]}`)
    .verify(createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(deler[2], "base64url"));
  if (!signaturGyldig) {
    throw ugyldig("Signaturen stemmer ikke med utstederens nøkkel.");
  }

  const naa = Math.floor(Date.now() / 1000);
  if (typeof krav.exp !== "number" || krav.exp + slakkSekunder < naa) {
    throw ugyldig("Tokenet er utløpt. Hent et nytt med scripts/token.sh.");
  }
  if (typeof krav.iat === "number" && krav.iat - slakkSekunder > naa) {
    throw ugyldig("Tokenet er utstedt fram i tid.");
  }
  if (krav.iss !== maskinportenIssuer && krav.iss !== idportenIssuer) {
    throw ugyldig(
      `Ukjent utsteder ${krav.iss}. Forventet ${maskinportenIssuer} eller ${idportenIssuer}.`
    );
  }

  // Audience restriction. A token minted for fiks-simulator must not open doors
  // here, however valid its signature is.
  const mottakere = Array.isArray(krav.aud) ? krav.aud : [krav.aud];
  if (!mottakere.includes(tokenAudience)) {
    throw ugyldig(
      `Tokenet er utstedt for ${mottakere.join(", ")}, ikke for ${tokenAudience}.`
    );
  }

  return krav;
}

/**
 * Reads the Authorization header and says who is calling. Never throws for a
 * *missing* token — that is `anonym`, and whether anonymous is acceptable is the
 * route's decision, not this function's. A token that is present but broken does
 * throw 401: someone tried to authenticate and failed, and silently downgrading
 * that to anonymous would hide the mistake.
 */
export async function klassifiserKaller(request: IncomingMessage): Promise<Kaller> {
  const header = request.headers.authorization;
  if (!header) {
    return { type: "anonym" };
  }
  const [ordning, token] = header.split(" ");
  if (!/^bearer$/i.test(ordning || "") || !token) {
    throw ugyldig("Authorization-headeren må være på formen «Bearer <token>».");
  }

  const krav = await verifiser(token);

  // The issuer decides the kind of caller. `pid` alone would be a weaker test: a
  // machine token that happened to carry the claim would be read as a citizen.
  if (krav.iss === idportenIssuer) {
    if (!krav.pid) {
      throw ugyldig("ID-porten-tokenet mangler pid.");
    }
    return {
      type: "innbygger",
      pid: String(krav.pid),
      acr: String(krav.acr || "ukjent"),
      clientId: String(krav.client_id || "ukjent")
    };
  }

  return {
    type: "system",
    clientId: String(krav.client_id || "ukjent"),
    scope: String(krav.scope || "").split(" ").filter(Boolean),
    consumer: krav.consumer?.ID ? String(krav.consumer.ID) : null
  };
}

/**
 * The revisjonslogg's `aktor`, derived from the token rather than guessed.
 *
 * Before Del B this was hardcoded as `{ type: "testbruker", id: personId }` in six
 * places, which logged who was asked *about* and called it who asked. That is the
 * one thing an audit log must not do.
 *
 * `personId` is who the request concerns. For a citizen it is redundant — they are
 * the subject — so it is only recorded for a machine, as `paaVegneAv`.
 */
export function aktorFor(kaller: Kaller, personId?: string | null): Record<string, unknown> {
  if (kaller.type === "innbygger") {
    return { type: "innbygger", id: kaller.pid, acr: kaller.acr };
  }
  if (kaller.type === "system") {
    return {
      type: "system",
      id: kaller.clientId,
      ...(personId ? { paaVegneAv: personId } : {})
    };
  }
  // Honest about not knowing. This appears only with AUTH_ENFORCE=false, and it is
  // meant to look wrong in the log — an unauthenticated read has no actor.
  return { type: "ukjent", id: null };
}

/** For log lines and error messages. Never for an access decision. */
export function beskrivKaller(kaller: Kaller): string {
  if (kaller.type === "innbygger") return `innbygger ${kaller.pid} (${kaller.acr})`;
  if (kaller.type === "system") return `${kaller.clientId} [${kaller.scope.join(" ") || "uten scope"}]`;
  return "ukjent kaller";
}
