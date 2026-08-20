import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import type { JsonWebKey } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeJwt, signJwt, type SigneringsNokkel } from "./jwt.ts";

// MOCK AV MASKINPORTEN OG ID-PORTEN
//
// Two issuers in one process, with different `iss`. That is honest: they are two
// separate gates with separate purposes, and the sandbox exists to teach the
// difference.
//
//   Maskinporten  machine to machine. Proves which *organisation* is calling, and
//                 what it is allowed to do, via `scope`. No person involved.
//   ID-porten     a person logging in. Proves *who* the citizen is, via `pid`, and
//                 how strongly they were authenticated, via `acr`.
//
// WHY WE WRITE OUR OWN. The fiks-io stack ships an oidc-provider-mock, and it runs
// on Ørjan's machine. It is not usable here for two reasons: participants cannot
// pull the image from KS' Artifactory, and it only implements authorization_code
// and refresh_token — there is no jwt-bearer grant, so no Maskinporten in it at
// all. Its error bodies are unmodelled plain text and Tomcat HTML. So this is
// modelled on Digdir's published contract and RFC 6749/6750 instead, not on it.
//
// DELIBERATE SIMPLIFICATION, in one place so it is easy to find: the client
// assertion in the jwt-bearer grant is validated on *shape*, not on signature.
// Real Maskinporten holds a registered public key per client and checks it. We have
// no key registry, so any well-formed assertion is accepted and its `iss` is taken
// as the client_id. That is fine here because the lesson lives on the resource
// server — see the enforcement in sandbox-backend/src/autentisering.ts. It would
// not be fine anywhere else.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Same split as everywhere else: data/ is seed and read-only, state/ holds
// everything written at runtime and is gitignored.
const seedDir = path.resolve(__dirname, "../../../data");
const stateDir = process.env.STATE_DIR || path.resolve(__dirname, "../../../state");
// PORT lets test scripts run an isolated instance alongside docker compose.
const port = Number(process.env.PORT) || 8086;

// The *logical* issuer name, which goes into `iss` and must be identical for
// everyone who verifies a token. It is deliberately separate from the address a
// caller dials: inside docker the backend reaches this service at
// http://digdir-mock:8086, while the browser reaches it at http://localhost:8086.
// Real deployments split these the same way, and conflating them is a classic
// "issuer mismatch" afternoon.
const issuerBase = process.env.DIGDIR_ISSUER || `http://localhost:${port}`;
const maskinportenIssuer = issuerBase;
const idportenIssuer = `${issuerBase}/idporten`;

// Tokens are short-lived on purpose. Two minutes is long enough for a workshop
// exercise and short enough that "my token expired" is something participants
// actually see happen.
const tokenLevetidSekunder = Number(process.env.DIGDIR_TOKEN_TTL) || 120;
const codeLevetidSekunder = 300;

// --- keys -----------------------------------------------------------------

// Generated on first boot and kept in state/, not in data/. A private key must
// never be committed, not even a synthetic one — and persisting it means a restart
// does not invalidate every token a participant already pasted somewhere.
// ./start.sh --reset rotates it, which is the right semantics for a reset.
const nokkelFil = path.join(stateDir, "digdir-nokkel.json");

type Utstederkeys = SigneringsNokkel & { jwk: JsonWebKey };

async function lastEllerLagNokkel(): Promise<Utstederkeys> {
  try {
    const lagret = JSON.parse(await readFile(nokkelFil, "utf8"));
    return { kid: lagret.kid, privateKey: lagret.privateKeyPem, jwk: lagret.publicJwk };
  } catch (feil) {
    if ((feil as NodeJS.ErrnoException).code !== "ENOENT") throw feil;
  }

  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = randomUUID();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const publicJwk: JsonWebKey = {
    ...publicKey.export({ format: "jwk" }),
    kid,
    use: "sig",
    alg: "RS256"
  };

  await mkdir(stateDir, { recursive: true });
  await writeFile(nokkelFil, JSON.stringify({ kid, privateKeyPem, publicJwk }, null, 2) + "\n");
  console.log(`Ny signeringsnøkkel skrevet til ${nokkelFil} (kid ${kid})`);
  return { kid, privateKey: privateKeyPem, jwk: publicJwk };
}

const nokkel = await lastEllerLagNokkel();

// --- people ---------------------------------------------------------------

type Testbruker = {
  personId: string;
  pid: string;
  visningsnavn: string;
  kommune: string;
};

async function lesJson(filnavn: string): Promise<any> {
  for (const mappe of [stateDir, seedDir]) {
    try {
      return JSON.parse(await readFile(path.join(mappe, filnavn), "utf8"));
    } catch (feil) {
      if ((feil as NodeJS.ErrnoException).code !== "ENOENT") throw feil;
    }
  }
  throw new Error(`Fant ikke ${filnavn} i verken state/ eller data/.`);
}

// `pid` resolves against syntetiskFodselsnummer, not personId. The fødselsnummer
// is what real ID-porten puts in the claim, and Del A2 deliberately lets
// syntetiskFodselsnummer survive masking precisely so lookups like this work.
async function hentPersoner(): Promise<Testbruker[]> {
  const personer = await lesJson("personer.json");
  return personer.map((person: any): Testbruker => ({
    personId: person.personId,
    pid: person.syntetiskFodselsnummer,
    // The picker is a login screen, not a data surface: it shows the name so a
    // participant can find their test person. Protected people are listed by
    // personId only, so the picker does not become the way around Del A2.
    visningsnavn: person.adressebeskyttelse === "UGRADERT"
      ? [person.navn?.fornavn, person.navn?.mellomnavn, person.navn?.etternavn]
          .filter(Boolean).join(" ")
      : "Skjermet person",
    kommune: person.bostedsadresse?.kommune || ""
  }));
}

// --- http helpers ---------------------------------------------------------

// Authorization is in Allow-Headers because demo-gui calls this and the backend
// cross-origin from :3001. Without it every browser call dies in preflight, and
// only in the console.
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization"
};

function jsonResponse(
  response: ServerResponse,
  statusCode: number,
  data: unknown,
  headers: Record<string, string> = {}
): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    // RFC 6749 section 5.1: token responses must not be cached.
    "Cache-Control": "no-store",
    ...CORS,
    ...headers
  });
  response.end(JSON.stringify(data, null, 2));
}

function htmlResponse(response: ServerResponse, statusCode: number, body: string): void {
  response.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8", ...CORS });
  response.end(body);
}

/** RFC 6749 section 5.2. The shape every OAuth client already knows how to read. */
function oauthFeil(
  response: ServerResponse,
  statusCode: number,
  error: string,
  beskrivelse: string
): void {
  jsonResponse(response, statusCode, { error, error_description: beskrivelse, syntetisk: true });
}

async function lesForm(request: IncomingMessage): Promise<URLSearchParams> {
  const biter: Buffer[] = [];
  for await (const bit of request) biter.push(bit as Buffer);
  return new URLSearchParams(Buffer.concat(biter).toString("utf8"));
}

function escapeHtml(tekst: unknown): string {
  const tegnkart: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  };
  return String(tekst).replace(/[&<>"']/g, (tegn) => tegnkart[tegn]);
}

// --- token minting --------------------------------------------------------

function naa(): number {
  return Math.floor(Date.now() / 1000);
}

function felleClaims(issuer: string, audience: string) {
  const utstedt = naa();
  return {
    iss: issuer,
    aud: audience,
    iat: utstedt,
    exp: utstedt + tokenLevetidSekunder,
    jti: randomUUID(),
    // Marks the token as sandbox-issued, the same way every synthetic payload in
    // the repo carries it. A real token has no such field, which is the point.
    syntetisk: true
  };
}

type MaskinportenValg = {
  clientId: string;
  scope: string;
  audience: string;
  orgnr: string;
};

function maskinportenToken({ clientId, scope, audience, orgnr }: MaskinportenValg): string {
  return signJwt({
    ...felleClaims(maskinportenIssuer, audience),
    client_id: clientId,
    scope,
    // Maskinporten identifies the organisation behind the client, not just the
    // client. This is what makes "which municipality called" answerable.
    consumer: { authority: "iso6523-actorid-upis", ID: `0192:${orgnr}` },
    token_type: "Bearer"
  }, nokkel);
}

type IdportenValg = {
  clientId: string;
  audience: string;
  pid: string;
  nonce: string | null;
};

function idportenTokens({ clientId, audience, pid, nonce }: IdportenValg) {
  const felles = felleClaims(idportenIssuer, audience);
  const person = {
    // `sub` is a pairwise pseudonym in real ID-porten — stable per person per
    // client, and deliberately not the fødselsnummer. `pid` is where the
    // fødselsnummer lives. Conflating them is a common mistake, so they differ here.
    sub: createHash("sha256").update(`${clientId}:${pid}`).digest("base64url"),
    pid,
    // Level of assurance. idporten-loa-high is BankID-grade; substantial is MinID.
    // A resource server may require a level, not just a valid token.
    acr: "idporten-loa-high",
    amr: "BankID",
    locale: "nb",
    sid: randomUUID()
  };
  return {
    accessToken: signJwt({
      ...felles, ...person, client_id: clientId, scope: "openid profile", token_type: "Bearer"
    }, nokkel),
    idToken: signJwt({
      ...felles, ...person, auth_time: felles.iat, ...(nonce ? { nonce } : {})
    }, nokkel)
  };
}

// --- authorization code store --------------------------------------------

type LagretKode = {
  pid: string;
  clientId: string;
  redirectUri: string;
  nonce: string | null;
  audience: string;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
  utloper: number;
};

// In memory and single-use. Codes are not meant to survive a restart, and a code
// that can be redeemed twice is a replay hole even in a sandbox.
const koder = new Map<string, LagretKode>();

function lagreKode(data: Omit<LagretKode, "utloper">): string {
  const code = randomUUID();
  koder.set(code, { ...data, utloper: naa() + codeLevetidSekunder });
  return code;
}

function loesInnKode(code: string): LagretKode | null {
  const lagret = koder.get(code);
  if (!lagret) return null;
  koder.delete(code);
  return lagret.utloper < naa() ? null : lagret;
}

// --- the login screen -----------------------------------------------------

function velgerSide(personer: Testbruker[], parametere: URLSearchParams): string {
  const skjulte = ["client_id", "redirect_uri", "state", "nonce", "code_challenge",
    "code_challenge_method", "resource"]
    .filter((navn) => parametere.get(navn))
    .map((navn) => `<input type="hidden" name="${navn}" value="${escapeHtml(parametere.get(navn))}">`)
    .join("\n        ");

  const valg = personer
    .map((p) => `<option value="${escapeHtml(p.pid)}">${escapeHtml(p.visningsnavn)} — ${escapeHtml(p.personId)}${p.kommune ? ` (${escapeHtml(p.kommune)})` : ""}</option>`)
    .join("\n          ");

  return `<!doctype html>
<html lang="nb">
  <head>
    <meta charset="utf-8">
    <title>ID-porten (mock) — velg testbruker</title>
    <style>
      body { font-family: system-ui, Arial, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; }
      .merke { background: #fff3cd; border: 1px solid #e0c97f; padding: .6rem .8rem; border-radius: 6px; font-size: .9rem; }
      select, button { font-size: 1rem; padding: .5rem; margin-top: .5rem; }
      select { width: 100%; }
      button { background: #0b5cab; color: white; border: 0; border-radius: 6px; padding: .6rem 1.2rem; cursor: pointer; }
      dl { font-size: .85rem; color: #555; }
    </style>
  </head>
  <body>
    <h1>ID-porten</h1>
    <p class="merke">🧪 Dette er en mock. Ingen ekte innlogging, ingen ekte personer.
      Tokenet du får er signert av sandkassen og godtas bare her.</p>
    <form method="POST" action="/idporten/authorize">
      ${skjulte}
      <label for="pid">Velg testbruker</label>
      <select id="pid" name="pid">
          ${valg}
      </select>
      <p><button type="submit">Logg inn</button></p>
    </form>
    <dl>
      <dt>Klient</dt><dd>${escapeHtml(parametere.get("client_id") || "(ukjent)")}</dd>
      <dt>Tilbake til</dt><dd>${escapeHtml(parametere.get("redirect_uri") || "(ingen)")}</dd>
      <dt>Sikkerhetsnivå</dt><dd>idporten-loa-high</dd>
    </dl>
  </body>
</html>`;
}

function docsHtml(): string {
  return `<!doctype html>
<html lang="nb">
  <head><meta charset="utf-8"><title>Digdir Mock API</title></head>
  <body style="font-family: Arial, sans-serif; padding: 24px;">
    <h1>Digdir Mock — Maskinporten og ID-porten</h1>
    <h2>Maskinporten (maskin til maskin)</h2>
    <ul>
      <li><code>GET /.well-known/oauth-authorization-server</code></li>
      <li><code>POST /token</code> — grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer</li>
    </ul>
    <h2>ID-porten (innbygger)</h2>
    <ul>
      <li><code>GET /idporten/.well-known/openid-configuration</code></li>
      <li><code>GET /idporten/authorize</code> — testbrukervelger</li>
      <li><code>POST /idporten/token</code> — grant_type=authorization_code</li>
    </ul>
    <h2>Felles</h2>
    <ul>
      <li><code>GET /jwks</code> (alias <code>/jwk</code>)</li>
    </ul>
  </body>
</html>`;
}

// --- server ---------------------------------------------------------------

const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
  const url = new URL(request.url!, `http://${request.headers.host}`);
  const sti = url.pathname;

  if (request.method === "OPTIONS") {
    response.writeHead(204, CORS);
    response.end();
    return;
  }

  try {
    if (sti === "/helse" || sti === "/health") {
      jsonResponse(response, 200, {
        status: "ok",
        tjeneste: "digdir-mock",
        tidspunkt: new Date().toISOString()
      });
      return;
    }

    if (sti === "/docs") {
      htmlResponse(response, 200, docsHtml());
      return;
    }

    // Maskinporten's metadata. Real Maskinporten publishes this at
    // /.well-known/oauth-authorization-server — it is an OAuth server, not an
    // OpenID Provider, because no person is involved and there is no id_token.
    if (sti === "/.well-known/oauth-authorization-server") {
      jsonResponse(response, 200, {
        issuer: maskinportenIssuer,
        token_endpoint: `${maskinportenIssuer}/token`,
        jwks_uri: `${maskinportenIssuer}/jwks`,
        grant_types_supported: ["urn:ietf:params:oauth:grant-type:jwt-bearer"],
        token_endpoint_auth_methods_supported: ["private_key_jwt"],
        token_endpoint_auth_signing_alg_values_supported: ["RS256"],
        syntetisk: true
      });
      return;
    }

    // ID-porten's metadata. This one *is* an OpenID Provider: it authenticates a
    // person and issues an id_token about them.
    if (sti === "/idporten/.well-known/openid-configuration") {
      jsonResponse(response, 200, {
        issuer: idportenIssuer,
        authorization_endpoint: `${idportenIssuer}/authorize`,
        token_endpoint: `${idportenIssuer}/token`,
        jwks_uri: `${maskinportenIssuer}/jwks`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        subject_types_supported: ["pairwise"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
        scopes_supported: ["openid", "profile"],
        acr_values_supported: ["idporten-loa-substantial", "idporten-loa-high"],
        syntetisk: true
      });
      return;
    }

    // /jwk is the alias: that is the path the fiks-io oidc mock and real
    // Maskinporten use, and agreeing costs nothing.
    if (sti === "/jwks" || sti === "/jwk") {
      jsonResponse(response, 200, { keys: [nokkel.jwk] });
      return;
    }

    // --- Maskinporten: jwt-bearer -----------------------------------------
    if (request.method === "POST" && sti === "/token") {
      const form = await lesForm(request);
      const grantType = form.get("grant_type");
      if (grantType !== "urn:ietf:params:oauth:grant-type:jwt-bearer") {
        oauthFeil(response, 400, "unsupported_grant_type",
          `Maskinporten bruker urn:ietf:params:oauth:grant-type:jwt-bearer, fikk ${grantType || "ingenting"}.`);
        return;
      }
      const assertion = form.get("assertion");
      if (!assertion) {
        oauthFeil(response, 400, "invalid_request", "assertion mangler.");
        return;
      }

      let krav: Record<string, any>;
      try {
        krav = decodeJwt(assertion).payload;
      } catch (feil) {
        oauthFeil(response, 400, "invalid_grant",
          `assertion kunne ikke leses: ${(feil as Error).message}`);
        return;
      }

      // Shape, not signature — see the note at the top of this file. Every field
      // real Maskinporten requires is still required, so a client that works here
      // is built correctly.
      for (const felt of ["iss", "aud", "scope", "exp"]) {
        if (!krav[felt]) {
          oauthFeil(response, 400, "invalid_grant", `assertion mangler ${felt}.`);
          return;
        }
      }
      if (Number(krav.exp) < naa()) {
        oauthFeil(response, 400, "invalid_grant", "assertion er utløpt.");
        return;
      }
      if (krav.aud !== maskinportenIssuer) {
        oauthFeil(response, 400, "invalid_grant",
          `assertion har aud ${krav.aud}, forventet ${maskinportenIssuer}.`);
        return;
      }

      // `resource` is how Maskinporten scopes a token to one API. A token minted
      // for sandbox-backend is not valid at fiks-simulator, and that is the point:
      // audience restriction means a leaked token has a blast radius.
      const audience = form.get("resource") || krav.resource || "sandbox-backend";
      const scope = String(krav.scope);
      jsonResponse(response, 200, {
        access_token: maskinportenToken({
          clientId: String(krav.iss),
          scope,
          audience,
          orgnr: String(krav.orgnr || "991825827")
        }),
        token_type: "Bearer",
        expires_in: tokenLevetidSekunder,
        scope,
        syntetisk: true
      });
      return;
    }

    // --- ID-porten: the login screen --------------------------------------
    if (sti === "/idporten/authorize") {
      const parametere = request.method === "POST" ? await lesForm(request) : url.searchParams;

      const redirectUri = parametere.get("redirect_uri");
      const clientId = parametere.get("client_id");
      if (!redirectUri || !clientId) {
        oauthFeil(response, 400, "invalid_request", "client_id og redirect_uri er påkrevd.");
        return;
      }
      const responseType = parametere.get("response_type");
      if (request.method === "GET" && responseType && responseType !== "code") {
        oauthFeil(response, 400, "unsupported_response_type",
          `Bare response_type=code støttes, fikk ${responseType}.`);
        return;
      }

      // GET renders the picker; the POST back from it carries the chosen pid.
      const pid = parametere.get("pid");
      if (!pid) {
        htmlResponse(response, 200, velgerSide(await hentPersoner(), parametere));
        return;
      }

      const personer = await hentPersoner();
      if (!personer.some((person) => person.pid === pid)) {
        oauthFeil(response, 400, "invalid_request", `Ukjent testbruker: ${pid}.`);
        return;
      }

      const code = lagreKode({
        pid,
        clientId,
        redirectUri,
        nonce: parametere.get("nonce"),
        audience: parametere.get("resource") || "sandbox-backend",
        codeChallenge: parametere.get("code_challenge"),
        codeChallengeMethod: parametere.get("code_challenge_method")
      });

      const tilbake = new URL(redirectUri);
      tilbake.searchParams.set("code", code);
      const state = parametere.get("state");
      if (state) {
        tilbake.searchParams.set("state", state);
      }
      response.writeHead(302, { Location: tilbake.toString(), ...CORS });
      response.end();
      return;
    }

    // --- ID-porten: code -> tokens ----------------------------------------
    if (request.method === "POST" && sti === "/idporten/token") {
      const form = await lesForm(request);
      if (form.get("grant_type") !== "authorization_code") {
        oauthFeil(response, 400, "unsupported_grant_type",
          `ID-porten bruker authorization_code, fikk ${form.get("grant_type") || "ingenting"}.`);
        return;
      }
      const code = form.get("code");
      if (!code) {
        oauthFeil(response, 400, "invalid_request", "code mangler.");
        return;
      }
      const lagret = loesInnKode(code);
      if (!lagret) {
        oauthFeil(response, 400, "invalid_grant", "Ukjent, brukt eller utløpt code.");
        return;
      }
      if (form.get("redirect_uri") && form.get("redirect_uri") !== lagret.redirectUri) {
        oauthFeil(response, 400, "invalid_grant",
          "redirect_uri stemmer ikke med den fra /authorize.");
        return;
      }

      // PKCE. Required for public clients — demo-gui runs in a browser and cannot
      // keep a secret, so the code alone must not be enough to redeem.
      if (lagret.codeChallenge) {
        const verifier = form.get("code_verifier");
        if (!verifier) {
          oauthFeil(response, 400, "invalid_grant",
            "code_verifier mangler, men code_challenge ble brukt.");
          return;
        }
        if (lagret.codeChallengeMethod !== "S256") {
          oauthFeil(response, 400, "invalid_request",
            `Bare code_challenge_method=S256 støttes, fikk ${lagret.codeChallengeMethod}.`);
          return;
        }
        const beregnet = createHash("sha256").update(verifier).digest("base64url");
        if (beregnet !== lagret.codeChallenge) {
          oauthFeil(response, 400, "invalid_grant",
            "code_verifier stemmer ikke med code_challenge.");
          return;
        }
      }

      const { accessToken, idToken } = idportenTokens({
        clientId: lagret.clientId,
        audience: lagret.audience,
        pid: lagret.pid,
        nonce: lagret.nonce
      });
      jsonResponse(response, 200, {
        access_token: accessToken,
        id_token: idToken,
        token_type: "Bearer",
        expires_in: tokenLevetidSekunder,
        scope: "openid profile",
        syntetisk: true
      });
      return;
    }

    oauthFeil(response, 404, "invalid_request", `Fant ikke ${request.method} ${sti}. Se GET /docs.`);
  } catch (feil) {
    console.error(`digdir-mock: ${(feil as Error).stack || (feil as Error).message}`);
    jsonResponse(response, 500, {
      error: "server_error",
      error_description: `Intern feil i digdir-mock: ${(feil as Error).message}`,
      syntetisk: true
    });
  }
});

server.listen(port, () => {
  console.log(
    `Digdir-mock kjører på http://localhost:${port} (iss ${maskinportenIssuer}, ${idportenIssuer})`
  );
});
