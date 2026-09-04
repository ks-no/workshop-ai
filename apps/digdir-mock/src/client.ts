// HOW TO GET A TOKEN
//
// One implementation, imported by every client that needs one: sandbox-backend,
// tools-api, fiks-simulator, ai-gateway, the test scripts and scripts/token.sh.
// It lives next to the issuer because this is where the protocol is defined -
// putting a copy in each service is how five slightly different token clients
// happen.
//
// Both functions cache until shortly before `exp`, so a service does not mint a
// token per request.

import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { decodeJwt, signJwt, type SigningKey } from "./jwt.ts";

// Each client signs its assertions with a keypair it generates at boot. That is
// what a real Maskinporten client does; the only difference is that real
// Maskinporten has the public key registered and checks the signature, while
// digdir-mock validates the assertion on shape. Generating it here rather than
// skipping the signature keeps the client code honest.
const clientKey: SigningKey = (() => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    kid: createHash("sha256")
      .update(publicKey.export({ type: "spki", format: "der" }))
      .digest("hex")
      .slice(0, 16),
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }) as string
  };
})();

/** Refresh this many seconds before expiry, so a token never expires in flight. */
const slackSeconds = 15;

type Cached = { token: string; utloper: number };

const cache = new Map<string, Cached>();

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function stillValid(oppfoering: Cached | undefined): oppfoering is Cached {
  return oppfoering !== undefined && oppfoering.utloper - slackSeconds > now();
}

async function readError(svar: Response): Promise<string> {
  const tekst = await svar.text();
  try {
    const kropp = JSON.parse(tekst);
    return kropp.error_description || kropp.error || tekst;
  } catch {
    return tekst || `status ${svar.status}`;
  }
}

type TokenResponse = { access_token: string; expires_in?: number };

function cacheIt(noekkel: string, data: TokenResponse): string {
  cache.set(noekkel, { token: data.access_token, utloper: now() + (data.expires_in ?? 60) });
  return data.access_token;
}

export type MaskinportenOptions = {
  /** Where to dial the issuer. Inside docker that is not the same as `issuer`. */
  digdirBaseUrl: string;
  /** The logical issuer name, which must match the `aud` the issuer expects. */
  issuer: string;
  clientId: string;
  scope: string;
  /** Which API the token is for. A token for one is rejected by the other. */
  resource?: string;
  orgnr?: string;
};

/**
 * Maskinporten. Machine to machine: proves which client is calling and what it may
 * do, via scope. No person involved.
 */
export async function getMaskinportenToken({
  digdirBaseUrl,
  issuer,
  clientId,
  scope,
  resource = "sandbox-backend",
  orgnr = "991825827"
}: MaskinportenOptions): Promise<string> {
  const noekkel = `m2m:${clientId}:${scope}:${resource}`;
  const cached = cache.get(noekkel);
  if (stillValid(cached)) return cached.token;

  const issuedAt = now();
  const assertion = signJwt({
    iss: clientId,
    aud: issuer,
    scope,
    resource,
    orgnr,
    iat: issuedAt,
    exp: issuedAt + 30,
    jti: randomBytes(16).toString("hex")
  }, clientKey);

  const svar = await fetch(`${digdirBaseUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
      resource
    })
  });
  if (!svar.ok) {
    throw new Error(`Maskinporten ga ${svar.status}: ${await readError(svar)}`);
  }
  return cacheIt(noekkel, await svar.json() as TokenResponse);
}

export type InnbyggerOptions = {
  digdirBaseUrl: string;
  /** Either personId, which is looked up, or the pid (fødselsnummer) directly. */
  personId?: string;
  pid?: string;
  clientId?: string;
  resource?: string;
};

/**
 * ID-porten, driven programmatically through the real authorization code flow with
 * PKCE - /authorize to get a code, then /token to redeem it.
 *
 * There is deliberately no shortcut that mints a citizen token directly. A machine
 * that can hand itself any citizen's identity teaches the opposite of what this
 * sandbox is for; a test script walking the same flow a browser walks is also
 * better coverage.
 */
export async function getInnbyggerToken({
  digdirBaseUrl,
  personId,
  pid,
  clientId = "sandkasse-testskript",
  resource = "sandbox-backend"
}: InnbyggerOptions): Promise<string> {
  const noekkel = `pid:${pid || personId}:${clientId}:${resource}`;
  const cached = cache.get(noekkel);
  if (stillValid(cached)) return cached.token;

  const lookup = pid || await lookupPid(digdirBaseUrl, personId);
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirectUri = "http://localhost/testskript-callback";

  // redirect: "manual" - the code is in the Location header, and there is nothing
  // at the other end of redirectUri to follow to.
  const authorization = await fetch(`${digdirBaseUrl}/idporten/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    redirect: "manual",
    body: new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "openid profile",
      resource,
      code_challenge: challenge,
      code_challenge_method: "S256",
      pid: lookup
    })
  });
  const location = authorization.headers.get("location");
  if (!location) {
    throw new Error(
      `ID-porten ga ingen redirect (${authorization.status}): ${await readError(authorization)}`
    );
  }
  const code = new URL(location).searchParams.get("code");
  if (!code) {
    throw new Error(`ID-porten ga ingen code i ${location}`);
  }

  const svar = await fetch(`${digdirBaseUrl}/idporten/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: verifier
    })
  });
  if (!svar.ok) {
    throw new Error(`ID-porten ga ${svar.status}: ${await readError(svar)}`);
  }
  return cacheIt(noekkel, await svar.json() as TokenResponse);
}

// A test script knows people by personId; ID-porten knows them by fødselsnummer.
// The mapping comes from GET /idporten/testbrukere, which is a contract; scraping
// the picker page for it is not - HTML breaks with every restyling.
const pidCache = new Map<string, string>();

async function lookupPid(digdirBaseUrl: string, personId?: string): Promise<string> {
  if (!personId) {
    throw new Error("getInnbyggerToken krever personId eller pid.");
  }
  const known = pidCache.get(personId);
  if (known) return known;

  const svar = await fetch(`${digdirBaseUrl}/idporten/testbrukere`);
  if (!svar.ok) {
    throw new Error(`Fikk ikke testbrukerlisten fra digdir-mock: ${await readError(svar)}`);
  }
  for (const bruker of await svar.json() as Array<{ personId: string; pid: string }>) {
    pidCache.set(bruker.personId, bruker.pid);
  }
  const treff = pidCache.get(personId);
  if (!treff) {
    throw new Error(`Fant ikke ${personId} blant testbrukerne i digdir-mock.`);
  }
  return treff;
}

// Warned about once per process per client, so a missing issuer is visible without
// a line per request.
const warned = new Set<string>();

/**
 * The Authorization header for a machine client - or an empty object if the issuer
 * cannot be reached.
 *
 * Degrading rather than throwing is deliberate, and the policy lives here so all
 * four machine clients share it. Two reasons:
 *
 *  - The resource server is where the decision belongs. Without a token the backend
 *    answers 401 saying exactly that, which is a far better error than "fetch
 *    failed" from a token endpoint three services away - the failure mode Del A
 *    already paid for once, when a matrikkel problem surfaced as a 500 in an
 *    unrelated LLM step.
 *  - It mirrors leggTilRevisjon: infrastructure being down must not turn into a
 *    different, more confusing error somewhere else.
 *
 * The warning is what keeps this from being silent.
 */
export async function maskinportenHeader(valg: MaskinportenOptions): Promise<Record<string, string>> {
  try {
    return { Authorization: `Bearer ${await getMaskinportenToken(valg)}` };
  } catch (feil) {
    const noekkel = `${valg.clientId}:${valg.scope}`;
    if (!warned.has(noekkel)) {
      warned.add(noekkel);
      console.warn(
        `Kunne ikke hente Maskinporten-token for ${valg.clientId} ` +
        `(${(feil as Error).message}). Kaller videre uten token - ` +
        `ressursserveren svarer 401 hvis den håndhever.`
      );
    }
    return {};
  }
}

/** The pid in a token, without verifying it. For logging and test assertions only. */
export function pidIn(token: string): string | null {
  try {
    return decodeJwt(token).payload.pid ?? null;
  } catch {
    return null;
  }
}
