// HOW TO GET A TOKEN
//
// One implementation, imported by every client that needs one: sandbox-backend,
// mcp-services, fiks-simulator, ai-gateway, the test scripts and scripts/token.sh.
// It lives next to the issuer because this is where the protocol is defined —
// putting a copy in each service is how five slightly different token clients
// happen.
//
// Both functions cache until shortly before `exp`, so a service does not mint a
// token per request.

import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { decodeJwt, signJwt, type SigneringsNokkel } from "./jwt.ts";

// Each client signs its assertions with a keypair it generates at boot. That is
// what a real Maskinporten client does; the only difference is that real
// Maskinporten has the public key registered and checks the signature, while
// digdir-mock validates the assertion on shape. Generating it here rather than
// skipping the signature keeps the client code honest.
const klientNokkel: SigneringsNokkel = (() => {
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
const slakkSekunder = 15;

type Bufret = { token: string; utloper: number };

const cache = new Map<string, Bufret>();

function naa(): number {
  return Math.floor(Date.now() / 1000);
}

function fortsattGyldig(oppfoering: Bufret | undefined): oppfoering is Bufret {
  return oppfoering !== undefined && oppfoering.utloper - slakkSekunder > naa();
}

async function lesFeil(svar: Response): Promise<string> {
  const tekst = await svar.text();
  try {
    const kropp = JSON.parse(tekst);
    return kropp.error_description || kropp.error || tekst;
  } catch {
    return tekst || `status ${svar.status}`;
  }
}

type TokenSvar = { access_token: string; expires_in?: number };

function bufre(noekkel: string, data: TokenSvar): string {
  cache.set(noekkel, { token: data.access_token, utloper: naa() + (data.expires_in ?? 60) });
  return data.access_token;
}

export type MaskinportenValg = {
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
export async function hentMaskinportenToken({
  digdirBaseUrl,
  issuer,
  clientId,
  scope,
  resource = "sandbox-backend",
  orgnr = "991825827"
}: MaskinportenValg): Promise<string> {
  const noekkel = `m2m:${clientId}:${scope}:${resource}`;
  const bufret = cache.get(noekkel);
  if (fortsattGyldig(bufret)) return bufret.token;

  const utstedt = naa();
  const assertion = signJwt({
    iss: clientId,
    aud: issuer,
    scope,
    resource,
    orgnr,
    iat: utstedt,
    exp: utstedt + 30,
    jti: randomBytes(16).toString("hex")
  }, klientNokkel);

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
    throw new Error(`Maskinporten ga ${svar.status}: ${await lesFeil(svar)}`);
  }
  return bufre(noekkel, await svar.json() as TokenSvar);
}

export type InnbyggerValg = {
  digdirBaseUrl: string;
  /** Either personId, which is looked up, or the pid (fødselsnummer) directly. */
  personId?: string;
  pid?: string;
  clientId?: string;
  resource?: string;
};

/**
 * ID-porten, driven programmatically through the real authorization code flow with
 * PKCE — /authorize to get a code, then /token to redeem it.
 *
 * There is deliberately no shortcut that mints a citizen token directly. A machine
 * that can hand itself any citizen's identity teaches the opposite of what this
 * sandbox is for; a test script walking the same flow a browser walks is also
 * better coverage.
 */
export async function hentInnbyggerToken({
  digdirBaseUrl,
  personId,
  pid,
  clientId = "sandkasse-testskript",
  resource = "sandbox-backend"
}: InnbyggerValg): Promise<string> {
  const noekkel = `pid:${pid || personId}:${clientId}:${resource}`;
  const bufret = cache.get(noekkel);
  if (fortsattGyldig(bufret)) return bufret.token;

  const oppslag = pid || await slaaOppPid(digdirBaseUrl, personId);
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirectUri = "http://localhost/testskript-callback";

  // redirect: "manual" — the code is in the Location header, and there is nothing
  // at the other end of redirectUri to follow to.
  const autorisering = await fetch(`${digdirBaseUrl}/idporten/authorize`, {
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
      pid: oppslag
    })
  });
  const location = autorisering.headers.get("location");
  if (!location) {
    throw new Error(
      `ID-porten ga ingen redirect (${autorisering.status}): ${await lesFeil(autorisering)}`
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
    throw new Error(`ID-porten ga ${svar.status}: ${await lesFeil(svar)}`);
  }
  return bufre(noekkel, await svar.json() as TokenSvar);
}

// A test script knows people by personId; ID-porten knows them by fødselsnummer.
// The picker page carries both, so it doubles as the lookup — no second data path
// into personer.json, and no endpoint that exists only to map one to the other.
const pidCache = new Map<string, string>();

async function slaaOppPid(digdirBaseUrl: string, personId?: string): Promise<string> {
  if (!personId) {
    throw new Error("hentInnbyggerToken krever personId eller pid.");
  }
  const kjent = pidCache.get(personId);
  if (kjent) return kjent;

  const svar = await fetch(
    `${digdirBaseUrl}/idporten/authorize?client_id=oppslag&redirect_uri=http://localhost/x`
  );
  const side = await svar.text();
  for (const [, funnetPid, funnetPersonId] of side.matchAll(/value="(\d{11})">[^<]*— ([a-z0-9-]+)/g)) {
    pidCache.set(funnetPersonId, funnetPid);
  }
  const treff = pidCache.get(personId);
  if (!treff) {
    throw new Error(`Fant ikke ${personId} blant testbrukerne i digdir-mock.`);
  }
  return treff;
}

/** The pid in a token, without verifying it. For logging and test assertions only. */
export function pidI(token: string): string | null {
  try {
    return decodeJwt(token).payload.pid ?? null;
  } catch {
    return null;
  }
}
