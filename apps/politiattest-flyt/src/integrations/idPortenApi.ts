import type { Person } from "../types";

const IDPORTEN_API = "/idporten-api";
const CLIENT_ID = "politiattest-flyt";

function redirectUri(): string {
  return `${window.location.origin}/idporten-callback`;
}

function base64Url(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function challengeFor(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  return base64Url(await crypto.subtle.digest("SHA-256", data));
}

async function readError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const data = JSON.parse(text) as { error_description?: string; error?: string };
    return data.error_description || data.error || text;
  } catch {
    return text || `HTTP ${response.status}`;
  }
}

/**
 * Runs the same authorization-code + PKCE exchange as the sandbox's browser
 * clients. The ID-porten service is synthetic, but the access token is still
 * verified by sandbox-backend before it can start the vandel process.
 */
export async function loggInnIdPorten(person: Person): Promise<string> {
  const verifier = randomVerifier();
  const challenge = await challengeFor(verifier);
  const callbackUri = redirectUri();
  const authorization = await fetch(`${IDPORTEN_API}/idporten/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: callbackUri,
      scope: "openid profile",
      resource: "sandbox-backend",
      code_challenge: challenge,
      code_challenge_method: "S256",
      pid: person.syntetiskFodselsnummer
    })
  });

  if (!authorization.ok) {
    throw new Error(`ID-porten svarte ikke med innlogging: ${await readError(authorization)}`);
  }
  const code = new URL(authorization.url).searchParams.get("code");
  if (!code) {
    throw new Error("ID-porten svarte uten en authorization code.");
  }

  const token = await fetch(`${IDPORTEN_API}/idporten/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: CLIENT_ID,
      redirect_uri: callbackUri,
      code_verifier: verifier
    })
  });
  if (!token.ok) {
    throw new Error(`ID-porten kunne ikke utstede token: ${await readError(token)}`);
  }

  const data = await token.json() as { access_token?: string };
  if (!data.access_token) {
    throw new Error("ID-porten svarte uten access token.");
  }
  return data.access_token;
}
