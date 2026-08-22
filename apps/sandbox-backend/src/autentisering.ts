// AUTENTISERING: WHO IS CALLING
//
// This module answers one question — who is on the other end of this request —
// and refuses to answer a second one. Whether that caller is *allowed* to do the
// thing is authorisation, and it lives where the request is handled: in
// runRessurs for data resources, and in handleRequest for the orchestration
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
import { createVerifier, TokenError } from "../../digdir-mock/src/verify.ts";
import {
  authEnforce,
  digdirBaseUrl,
  idportenIssuer,
  maskinportenIssuer,
  tokenAudience
} from "./config.ts";
import { HttpError } from "./errors.ts";

export type Caller =
  | { type: "innbygger"; pid: string; acr: string; clientId: string }
  | { type: "system"; clientId: string; scope: string[]; consumer: string | null }
  | { type: "anonym" };

/** Clock skew tolerance. Small on purpose — everything here runs on one machine. */
const slackSeconds = 10;

// --- verification ---------------------------------------------------------

// The mechanics live in digdir-mock/src/verify.ts, shared with fiks-simulator.
// What stays here is this service's policy: what a verified token *means*, and who
// may do what with it.
const verifiser = createVerifier({
  digdirBaseUrl,
  maskinportenIssuer,
  idportenIssuer,
  audience: tokenAudience
});

function fromTokenError(feil: TokenError): HttpError {
  // RFC 6750 section 3: a 401 tells the client *how* to authenticate, and the error
  // code is machine-readable.
  //
  // The Norwegian explanation stays in the response body and deliberately does not
  // go into error_description. Header values are ASCII — RFC 6750 defines
  // error_description over a restricted character set — and «Tokenet er utløpt»
  // puts raw non-ASCII bytes on the wire, which a conforming client is entitled to
  // mangle or reject. Clients read the code in the header; people read the prose in
  // the body.
  //
  // 503 keeps its own shape: an unreachable issuer is not an authentication
  // failure, and must not read as one.
  if (feil.status === 401) {
    return new HttpError(feil.message, 401, { syntetisk: true }, {
      "WWW-Authenticate": 'Bearer realm="sandbox-backend", error="invalid_token"'
    });
  }
  return new HttpError(feil.message, feil.status, { syntetisk: true });
}

/**
 * Reads the Authorization header and says who is calling. Never throws for a
 * *missing* token — that is `anonym`, and whether anonymous is acceptable is the
 * route's decision, not this function's. A token that is present but broken does
 * throw 401: someone tried to authenticate and failed, and silently downgrading
 * that to anonymous would hide the mistake.
 */
export async function classifyKaller(request: IncomingMessage): Promise<Caller> {
  const header = request.headers.authorization;
  if (!header) {
    return { type: "anonym" };
  }
  const [ordning, token] = header.split(" ");
  if (!/^bearer$/i.test(ordning || "") || !token) {
    throw new HttpError(
      "Authorization-headeren må være på formen «Bearer <token>».",
      401,
      { syntetisk: true },
      { "WWW-Authenticate": 'Bearer realm="sandbox-backend", error="invalid_token"' }
    );
  }

  let verifisert;
  try {
    verifisert = await verifiser(token);
  } catch (feil) {
    if (feil instanceof TokenError) throw fromTokenError(feil);
    throw feil;
  }
  const { krav, utsteder } = verifisert;

  // The issuer decides the kind of caller. `pid` alone would be a weaker test: a
  // machine token that happened to carry the claim would be read as a citizen.
  if (utsteder === "idporten") {
    if (!krav.pid) {
      throw fromTokenError(new TokenError("ID-porten-tokenet mangler pid."));
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
export function aktorFor(kaller: Caller, personId?: string | null): Record<string, unknown> {
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

// --- autorisasjon: may they? ----------------------------------------------

/**
 * Which authorisation a route or resource requires. The default everywhere is the
 * closed value, so a route added during the hackathon is protected unless someone
 * opens it deliberately.
 *
 *   "aapen"      No token. Health, docs, the catalogues, the rates, the street
 *                register — nothing about a person.
 *   "egne-data"  Your own data. An ID-porten token whose `pid` resolves to the
 *                subject, or a machine holding the scope.
 *
 *                When a route under this band has NO single subject, an ID-porten
 *                token is still accepted — and the handler is then responsible for
 *                narrowing the answer to the caller. /api/personer is the one such
 *                route: a citizen may look themselves up there, which is how
 *                demo-gui learns who it is logged in as, but may not list the
 *                population.
 *
 *   "bred"       Crosses people, so no citizen token can justify it. Machine with
 *                the scope only. The full revisjonslogg is the example.
 */
export type Tilgang = "aapen" | "egne-data" | "bred";

/** Default scope for a machine caller. Reading person data on someone's behalf. */
export const SCOPE_LES = "ks:innbyggerdialog:les";
/** Writing to the audit log. fiks-simulator and ai-gateway hold this one. */
export const SCOPE_REVISJON = "ks:innbyggerdialog:revisjon";

function manglerToken(hva: string): HttpError {
  // 401, not 403: we do not know who this is. The distinction is the whole point —
  // authentication is "who are you", hjemmel is "may you".
  return new HttpError(
    `Dette kallet krever innlogging. ${hva} er ikke åpent uten token. ` +
    `Hent et med scripts/token.ts.`,
    401,
    { syntetisk: true },
    { "WWW-Authenticate": 'Bearer realm="sandbox-backend", error="invalid_token"' }
  );
}

function manglerHjemmel(melding: string): HttpError {
  // 403: we know exactly who this is, and they still may not. Deliberately a
  // different message from the 403 for missing samtykke — see runRessurs.
  return new HttpError(melding, 403, { syntetisk: true, grunn: "mangler_hjemmel" });
}

/**
 * The one authorisation decision, shared by both boundaries: runRessurs for data
 * resources, and handleRequest for the orchestration routes.
 *
 * Throws, or returns having said nothing. Never returns a boolean — a caller that
 * forgets to check a boolean fails open, and this must fail closed.
 */
export function requireTilgang(valg: {
  kaller: Caller;
  tilgang: Tilgang;
  /** Scope a machine caller must hold. */
  scope: string;
  /** The subject's fødselsnummer, or null when the route has no single subject. */
  pid: string | null;
  /**
   * Fødselsnummer that may act *for* the subject: a parent with foreldreansvar, or
   * a verge. Empty for every route where the subject can act on their own behalf.
   * Computed by handleevne.ts, never guessed here.
   */
  representantPider?: string[];
  /** Named in the error message, so a 403 says what was refused. */
  hva: string;
}): void {
  const { kaller, tilgang, scope, pid, representantPider = [], hva } = valg;

  if (tilgang === "aapen") return;
  // The escape hatch. Off by default; it exists so the whole test tail can be
  // bisected during a migration, not as a setting anyone should leave flipped.
  if (!authEnforce) return;

  if (kaller.type === "anonym") {
    throw manglerToken(hva);
  }

  if (kaller.type === "system") {
    if (!kaller.scope.includes(scope)) {
      throw manglerHjemmel(
        `${kaller.clientId} har ikke hjemmel til ${hva}. ` +
        `Tokenet mangler scope ${scope} (har: ${kaller.scope.join(" ") || "ingen"}).`
      );
    }
    return;
  }

  // An ID-porten token proves who a person is. It cannot justify reading across
  // people, however high the acr.
  if (tilgang === "bred") {
    throw manglerHjemmel(
      `${hva} går på tvers av personer, og et personlig ID-porten-token gir ikke ` +
      `hjemmel til det. Dette krever en maskinklient med scope ${scope}.`
    );
  }

  // The pid binding. `pid` is null only where the route has no single subject, and
  // there the handler narrows the answer instead.
  // A minor is the party to their own case, but cannot be the sender. So the
  // binding admits a registered representative in addition to the subject - and
  // *only* those two. This is the narrowest widening that lets a parent drive a
  // child's flow without opening a general delegation mechanism.
  if (pid && kaller.pid !== pid && !representantPider.includes(kaller.pid)) {
    throw manglerHjemmel(
      `Du er innlogget som ${kaller.pid}, og ${hva} gjelder en annen person. ` +
      `Du har bare tilgang til dine egne data, og til data for noen du er registrert ` +
      `representant for.`
    );
  }
}

/** 403 for a subject who cannot be party to a case on their own behalf. */
export function manglerHandleevne(melding: string): HttpError {
  // A distinct `grunn` from mangler_hjemmel on purpose: the caller is who they say
  // they are and has the right to their own data. What is missing is the subject's
  // capacity to act, and the fix is a different sender, not a different token.
  return new HttpError(melding, 403, { syntetisk: true, grunn: "krever_representant" });
}

/** For log lines and error messages. Never for an access decision. */
export function describeKaller(kaller: Caller): string {
  if (kaller.type === "innbygger") return `innbygger ${kaller.pid} (${kaller.acr})`;
  if (kaller.type === "system") return `${kaller.clientId} [${kaller.scope.join(" ") || "uten scope"}]`;
  return "ukjent kaller";
}
