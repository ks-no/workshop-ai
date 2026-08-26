import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import type { JsonWebKey } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeJwt, signJwt, type SigningKey } from "./jwt.ts";
import { routeOverview } from "../../shared/openapi.ts";
import { cors, svarhjelpere } from "../../shared/http.ts";
// The one place the two age thresholds live. digdir-mock decides who gets a token
// and sandbox-backend decides who may be party to a case; they must agree, so
// neither carries its own copy of the rule.
import { kanHaEid, kanOpptreSelv } from "../../shared/handleevne.ts";

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
// The one simplification, kept in a single place so it is easy to find: the client
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
const tokenLifetimeSeconds = Number(process.env.DIGDIR_TOKEN_TTL) || 120;
const codeLifetimeSeconds = 300;

// --- keys -----------------------------------------------------------------

// Generated on first boot and kept in state/, not in data/. A private key must
// never be committed, not even a synthetic one — and persisting it means a restart
// does not invalidate every token a participant already pasted somewhere.
// ./start.sh --reset rotates it, which is the right semantics for a reset.
const keyFile = path.join(stateDir, "digdir-nokkel.json");
const openapiFile = path.resolve(__dirname, "../../../openapi/digdir-mock.yaml");

type IssuerKeys = SigningKey & { jwk: JsonWebKey };

async function loadOrCreateKey(): Promise<IssuerKeys> {
  try {
    const stored = JSON.parse(await readFile(keyFile, "utf8"));
    return { kid: stored.kid, privateKey: stored.privateKeyPem, jwk: stored.publicJwk };
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
  await writeFile(keyFile, JSON.stringify({ kid, privateKeyPem, publicJwk }, null, 2) + "\n");
  console.log(`Ny signeringsnøkkel skrevet til ${keyFile} (kid ${kid})`);
  return { kid, privateKey: privateKeyPem, jwk: publicJwk };
}

const nokkel = await loadOrCreateKey();

// --- people ---------------------------------------------------------------

type Testbruker = {
  personId: string;
  pid: string;
  visningsnavn: string;
  kommune: string;
  /** False for 13-17: an eID exists, rettslig handleevne does not. */
  kanOpptreSelv: boolean;
};

async function readJson(fileName: string): Promise<any> {
  for (const mappe of [stateDir, seedDir]) {
    try {
      return JSON.parse(await readFile(path.join(mappe, fileName), "utf8"));
    } catch (feil) {
      if ((feil as NodeJS.ErrnoException).code !== "ENOENT") throw feil;
    }
  }
  throw new Error(`Fant ikke ${fileName} i verken state/ eller data/.`);
}

// `pid` resolves against syntetiskFodselsnummer, not personId. The fødselsnummer
// is what real ID-porten puts in the claim, and Del A2 deliberately lets
// syntetiskFodselsnummer survive masking precisely so lookups like this work.
async function getPersoner(): Promise<Testbruker[]> {
  const personer = await readJson("personer.json");
  // Age is measured at satser.gjelderFra, like every other age in the sandbox, so
  // the picker cannot drift out of step with the rules over time.
  const referansedato = (await readJson("satser.json")).gjelderFra;
  return personer
    // No eID exists below 13 - MinID can be ordered from the year you turn 13 -
    // and someone who is dead, emigrated or holds a D-number has nothing to log in
    // with either. Listing all 394 meant 65 people under 13, eleven of them under
    // three, appeared as ID-porten users. That is not a rounding error: it is a
    // login screen offering credentials that cannot exist.
    .filter((person: any) => kanHaEid(person, referansedato))
    .map((person: any): Testbruker => ({
      personId: person.personId,
      pid: person.syntetiskFodselsnummer,
      // The picker is a login screen, not a data surface: it shows the name so a
      // participant can find their test person. Protected people are listed by
      // personId only, so the picker does not become the way around Del A2.
      visningsnavn: person.adressebeskyttelse === "UGRADERT"
        ? [person.navn?.fornavn, person.navn?.mellomnavn, person.navn?.etternavn]
            .filter(Boolean).join(" ")
        : "Skjermet person",
      kommune: person.bostedsadresse?.kommune || "",
      // 13-17 can log in but cannot be party to a case on their own. Shown here so
      // the picker says so before the flow refuses it.
      kanOpptreSelv: kanOpptreSelv(person, referansedato)
    }));
}

// --- http helpers ---------------------------------------------------------

// Authorization is in Allow-Headers because demo-gui calls this and the backend
// cross-origin from :3001. Without it every browser call dies in preflight, and
// only in the console.
// Named, because the preflight 204 and the ID-porten 302 write the headers
// directly rather than going through a response helper.
const CORS = cors("GET,POST,OPTIONS");

const { jsonResponse, textResponse } = svarhjelpere({
  cors: CORS,
  // RFC 6749 section 5.1: token responses must not be cached. Only this service
  // mints tokens, so only this service sets it.
  jsonHeaders: { "Cache-Control": "no-store" }
});

// /docs and the person picker are HTML, which is textResponse's default type.
function htmlResponse(response: ServerResponse, statusCode: number, body: string): void {
  textResponse(response, statusCode, body);
}

/** RFC 6749 section 5.2. The shape every OAuth client already knows how to read. */
function oauthError(
  response: ServerResponse,
  statusCode: number,
  error: string,
  beskrivelse: string
): void {
  jsonResponse(response, statusCode, { error, error_description: beskrivelse, syntetisk: true });
}

async function readForm(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function escapeHtml(tekst: unknown): string {
  const charMap: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  };
  return String(tekst).replace(/[&<>"']/g, (tegn) => charMap[tegn]);
}

// --- token minting --------------------------------------------------------

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function commonClaims(issuer: string, audience: string) {
  const issuedAt = now();
  return {
    iss: issuer,
    aud: audience,
    iat: issuedAt,
    exp: issuedAt + tokenLifetimeSeconds,
    jti: randomUUID(),
    // Marks the token as sandbox-issued, the same way every synthetic payload in
    // the repo carries it. A real token has no such field, which is the point.
    syntetisk: true
  };
}

type MaskinportenOptions = {
  clientId: string;
  scope: string;
  audience: string;
  orgnr: string;
};

function maskinportenToken({ clientId, scope, audience, orgnr }: MaskinportenOptions): string {
  return signJwt({
    ...commonClaims(maskinportenIssuer, audience),
    client_id: clientId,
    scope,
    // Maskinporten identifies the organisation behind the client, not just the
    // client. This is what makes "which municipality called" answerable.
    consumer: { authority: "iso6523-actorid-upis", ID: `0192:${orgnr}` },
    token_type: "Bearer"
  }, nokkel);
}

type IdportenOptions = {
  clientId: string;
  audience: string;
  pid: string;
  nonce: string | null;
};

function idportenTokens({ clientId, audience, pid, nonce }: IdportenOptions) {
  const felles = commonClaims(idportenIssuer, audience);
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

type StoredCode = {
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
const codes = new Map<string, StoredCode>();

function storeCode(data: Omit<StoredCode, "utloper">): string {
  const code = randomUUID();
  codes.set(code, { ...data, utloper: now() + codeLifetimeSeconds });
  return code;
}

function redeemCode(code: string): StoredCode | null {
  const stored = codes.get(code);
  if (!stored) return null;
  codes.delete(code);
  return stored.utloper < now() ? null : stored;
}

// --- the login screen -----------------------------------------------------

function pickerPage(personer: Testbruker[], parametere: URLSearchParams): string {
  const hidden = ["client_id", "redirect_uri", "state", "nonce", "code_challenge",
    "code_challenge_method", "resource"]
    .filter((navn) => parametere.get(navn))
    .map((navn) => `<input type="hidden" name="${navn}" value="${escapeHtml(parametere.get(navn))}">`)
    .join("\n        ");

  // data-sok carries a lowercased haystack so the filter below never touches the
  // DOM text. 369 options is too many to scroll, and a participant arrives knowing
  // either a name or a personId.
  const valg = personer
    .map((p) => {
      const label = p.visningsnavn === "Skjermet person" ? " \u00b7 skjermet" : "";
      return `<option value="${escapeHtml(p.pid)}" data-sok="${escapeHtml(`${p.visningsnavn} ${p.personId} ${p.pid} ${p.kommune}`.toLowerCase())}">`
        + `${escapeHtml(p.visningsnavn)} \u2014 ${escapeHtml(p.personId)}`
        + `${p.kommune ? ` (${escapeHtml(p.kommune)})` : ""}${label}</option>`;
    })
    .join("\n            ");

  const klient = parametere.get("client_id") || "ukjent klient";
  const back = parametere.get("redirect_uri") || "";

  return `<!doctype html>
<html lang="nb">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Logg inn \u2014 ID-porten (sandkasse)</title>
    <style>
      :root {
        --blue: #1a4a7a;
        --blue-dark: #12395e;
        --border: #cdd7e0;
        --background: #f1f4f7;
        --text: #1d2b36;
        --dempet: #5b6b7a;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem 1rem;
        background: var(--background);
        color: var(--text);
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
        line-height: 1.5;
      }
      .kort {
        width: 100%;
        max-width: 30rem;
        background: #fff;
        border: 1px solid var(--border);
        border-radius: 10px;
        overflow: hidden;
        box-shadow: 0 1px 3px rgba(29, 43, 54, .08), 0 8px 24px rgba(29, 43, 54, .06);
      }
      .topp {
        background: var(--blue);
        color: #fff;
        padding: 1.1rem 1.5rem;
        display: flex;
        align-items: baseline;
        gap: .6rem;
      }
      .topp strong { font-size: 1.15rem; letter-spacing: .01em; }
      .topp span { font-size: .8rem; opacity: .85; }
      .sandkasse {
        margin: 0;
        background: #fdf6e3;
        border-bottom: 1px solid #e8d9a8;
        padding: .7rem 1.5rem;
        font-size: .82rem;
        color: #6b5518;
      }
      .kropp { padding: 1.5rem; }
      h1 { font-size: 1.15rem; margin: 0 0 .3rem; }
      .under { margin: 0 0 1.4rem; color: var(--dempet); font-size: .9rem; }
      label { display: block; font-weight: 600; font-size: .85rem; margin-bottom: .35rem; }
      input[type="search"], select {
        width: 100%;
        font: inherit;
        font-size: .95rem;
        padding: .55rem .7rem;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: #fff;
        color: inherit;
      }
      input[type="search"]:focus, select:focus {
        outline: 3px solid rgba(26, 74, 122, .35);
        outline-offset: 1px;
        border-color: var(--blue);
      }
      input[type="search"] { margin-bottom: .6rem; }
      /* No explicit height: let size="8" decide, so the last row is whole rather
         than sliced in half. */
      select { padding: .35rem; }
      select option { padding: .15rem .35rem; }
      .antall { font-size: .78rem; color: var(--dempet); margin: .45rem 0 1.2rem; }
      button {
        width: 100%;
        font: inherit;
        font-size: 1rem;
        font-weight: 600;
        padding: .7rem 1rem;
        border: 0;
        border-radius: 6px;
        background: var(--blue);
        color: #fff;
        cursor: pointer;
      }
      button:hover { background: var(--blue-dark); }
      button:focus-visible { outline: 3px solid rgba(26, 74, 122, .45); outline-offset: 2px; }
      .detaljer {
        margin: 1.4rem 0 0;
        padding-top: 1.1rem;
        border-top: 1px solid var(--border);
        font-size: .8rem;
        color: var(--dempet);
        display: grid;
        grid-template-columns: auto 1fr;
        gap: .3rem .9rem;
      }
      .detaljer dt { font-weight: 600; }
      .detaljer dd { margin: 0; overflow-wrap: anywhere; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .95em; }
    </style>
  </head>
  <body>
    <main class="kort">
      <div class="topp"><strong>ID-porten</strong><span>sandkasse</span></div>
      <p class="sandkasse">
        \ud83e\uddea <strong>Dette er en etterlikning.</strong> Ingen ekte innlogging, ingen ekte
        personer. Tokenet du f\u00e5r er signert av sandkassen og godtas bare her.
      </p>
      <div class="kropp">
        <h1>Velg testbruker</h1>
        <p class="under"><code>${escapeHtml(klient)}</code> ber om \u00e5 f\u00e5 vite hvem du er.</p>
        <form method="POST" action="/idporten/authorize">
          ${hidden}
          <label for="sok">S\u00f8k etter navn, personId eller f\u00f8dselsnummer</label>
          <input type="search" id="sok" placeholder="Maja, person-031, 0301 \u2026" autocomplete="off">
          <label for="pid">Testbruker</label>
          <select id="pid" name="pid" size="8" required>
            ${valg}
          </select>
          <p class="antall" id="antall">${personer.length} testbrukere</p>
          <button type="submit">Logg inn</button>
        </form>
        <dl class="detaljer">
          <dt>Sikkerhetsniv\u00e5</dt><dd>idporten-loa-high (BankID)</dd>
          <dt>Sendes til</dt><dd>${escapeHtml(back) || "\u2014"}</dd>
        </dl>
      </div>
    </main>
    <script>
      // Filtering happens on data-sok, so a search never depends on how the option
      // happens to be rendered. Options are hidden rather than removed, so the
      // form still posts a valid pid if the filter is cleared mid-selection.
      const sok = document.getElementById("sok");
      const picker = document.getElementById("pid");
      const antall = document.getElementById("antall");
      const alle = [...picker.options];

      // A <select size=n> is a listbox, and a listbox starts with nothing selected —
      // unlike a dropdown, which auto-selects its first option. Without this the
      // form cannot be submitted until the user clicks a row, which reads as a
      // broken button rather than as a missing choice.
      function safeChoice() {
        if (picker.selectedIndex >= 0 && !picker.options[picker.selectedIndex].hidden) {
          return;
        }
        const first = alle.find((valg) => !valg.hidden);
        if (first) {
          first.selected = true;
        }
      }

      sok.addEventListener("input", () => {
        const needle = sok.value.trim().toLowerCase();
        let visible = 0;
        for (const valg of alle) {
          const treff = !needle || valg.dataset.sok.includes(needle);
          valg.hidden = !treff;
          if (treff) visible += 1;
        }
        antall.textContent = needle
          ? visible + " av " + alle.length + " testbrukere"
          : alle.length + " testbrukere";
        safeChoice();
      });

      safeChoice();
    </script>
  </body>
</html>`;
}

function docsHtml(): string {
  return `<!doctype html>
<html lang="nb">
  <head><meta charset="utf-8"><title>Digdir Mock API</title></head>
  <body style="font-family: Arial, sans-serif; padding: 24px;">
    <h1>Digdir Mock — Maskinporten og ID-porten</h1>
    <p><a href="/openapi.yaml">Spesifikasjonen</a> · <a href="/openapi-ruter.json">Samme, lest, som JSON</a> · <a href="http://localhost:3001/utforsker">Prøv rutene i API-utforskeren</a></p>
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
    if (sti === "/helse") {
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

    if (request.method === "GET" && sti === "/openapi.yaml") {
      textResponse(response, 200, await readFile(openapiFile, "utf8"), "text/yaml; charset=utf-8");
      return;
    }

    // Den samme spesifikasjonen, lest. Se kommentaren i tools-api.
    if (request.method === "GET" && sti === "/openapi-ruter.json") {
      jsonResponse(response, 200, await routeOverview(openapiFile));
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

    // The testbrukere, machine-readable.
    //
    // This exists because the alternative was worse: client.ts used to scrape the
    // picker page for personId -> pid, and restyling that page broke every test
    // script at once. The information is the same either way — the picker already
    // publishes it — but a listing is a contract and HTML is not.
    //
    // Real ID-porten has nothing like this, and could not: there is no endpoint
    // that lists the population. It is here because a test script needs to say
    // "log in as person-031" without knowing a fødselsnummer by heart.
    if (sti === "/idporten/testbrukere") {
      // Protected people are listed by personId only, exactly as in the picker, so
      // this does not become the way around Del A2.
      jsonResponse(response, 200, await getPersoner());
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
      const form = await readForm(request);
      const grantType = form.get("grant_type");
      if (grantType !== "urn:ietf:params:oauth:grant-type:jwt-bearer") {
        oauthError(response, 400, "unsupported_grant_type",
          `Maskinporten bruker urn:ietf:params:oauth:grant-type:jwt-bearer, fikk ${grantType || "ingenting"}.`);
        return;
      }
      const assertion = form.get("assertion");
      if (!assertion) {
        oauthError(response, 400, "invalid_request", "assertion mangler.");
        return;
      }

      let krav: Record<string, any>;
      try {
        krav = decodeJwt(assertion).payload;
      } catch (feil) {
        oauthError(response, 400, "invalid_grant",
          `assertion kunne ikke leses: ${(feil as Error).message}`);
        return;
      }

      // Shape, not signature — see the note at the top of this file. Every field
      // real Maskinporten requires is still required, so a client that works here
      // is built correctly.
      for (const felt of ["iss", "aud", "scope", "exp"]) {
        if (!krav[felt]) {
          oauthError(response, 400, "invalid_grant", `assertion mangler ${felt}.`);
          return;
        }
      }
      if (Number(krav.exp) < now()) {
        oauthError(response, 400, "invalid_grant", "assertion er utløpt.");
        return;
      }
      if (krav.aud !== maskinportenIssuer) {
        oauthError(response, 400, "invalid_grant",
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
        expires_in: tokenLifetimeSeconds,
        scope,
        syntetisk: true
      });
      return;
    }

    // --- ID-porten: the login screen --------------------------------------
    //
    // GET renders the picker, POST is the form on it coming back with a pid. Both
    // methods are named here rather than left open: without the guard the branch
    // also answered PUT and DELETE, which nobody meant, and the spec had no honest
    // way to say which methods the route has.
    if ((request.method === "GET" || request.method === "POST") && sti === "/idporten/authorize") {
      const parametere = request.method === "POST" ? await readForm(request) : url.searchParams;

      const redirectUri = parametere.get("redirect_uri");
      const clientId = parametere.get("client_id");
      if (!redirectUri || !clientId) {
        oauthError(response, 400, "invalid_request", "client_id og redirect_uri er påkrevd.");
        return;
      }
      const responseType = parametere.get("response_type");
      if (request.method === "GET" && responseType && responseType !== "code") {
        oauthError(response, 400, "unsupported_response_type",
          `Bare response_type=code støttes, fikk ${responseType}.`);
        return;
      }

      // GET renders the picker; the POST back from it carries the chosen pid.
      const pid = parametere.get("pid");
      if (!pid) {
        htmlResponse(response, 200, pickerPage(await getPersoner(), parametere));
        return;
      }

      const personer = await getPersoner();
      if (!personer.some((person) => person.pid === pid)) {
        oauthError(response, 400, "invalid_request", `Ukjent testbruker: ${pid}.`);
        return;
      }

      const code = storeCode({
        pid,
        clientId,
        redirectUri,
        nonce: parametere.get("nonce"),
        audience: parametere.get("resource") || "sandbox-backend",
        codeChallenge: parametere.get("code_challenge"),
        codeChallengeMethod: parametere.get("code_challenge_method")
      });

      const back = new URL(redirectUri);
      back.searchParams.set("code", code);
      const state = parametere.get("state");
      if (state) {
        back.searchParams.set("state", state);
      }
      response.writeHead(302, { Location: back.toString(), ...CORS });
      response.end();
      return;
    }

    // --- ID-porten: code -> tokens ----------------------------------------
    if (request.method === "POST" && sti === "/idporten/token") {
      const form = await readForm(request);
      if (form.get("grant_type") !== "authorization_code") {
        oauthError(response, 400, "unsupported_grant_type",
          `ID-porten bruker authorization_code, fikk ${form.get("grant_type") || "ingenting"}.`);
        return;
      }
      const code = form.get("code");
      if (!code) {
        oauthError(response, 400, "invalid_request", "code mangler.");
        return;
      }
      const stored = redeemCode(code);
      if (!stored) {
        oauthError(response, 400, "invalid_grant", "Ukjent, brukt eller utløpt code.");
        return;
      }
      if (form.get("redirect_uri") && form.get("redirect_uri") !== stored.redirectUri) {
        oauthError(response, 400, "invalid_grant",
          "redirect_uri stemmer ikke med den fra /authorize.");
        return;
      }

      // PKCE. Required for public clients — demo-gui runs in a browser and cannot
      // keep a secret, so the code alone must not be enough to redeem.
      if (stored.codeChallenge) {
        const verifier = form.get("code_verifier");
        if (!verifier) {
          oauthError(response, 400, "invalid_grant",
            "code_verifier mangler, men code_challenge ble brukt.");
          return;
        }
        if (stored.codeChallengeMethod !== "S256") {
          oauthError(response, 400, "invalid_request",
            `Bare code_challenge_method=S256 støttes, fikk ${stored.codeChallengeMethod}.`);
          return;
        }
        const computed = createHash("sha256").update(verifier).digest("base64url");
        if (computed !== stored.codeChallenge) {
          oauthError(response, 400, "invalid_grant",
            "code_verifier stemmer ikke med code_challenge.");
          return;
        }
      }

      const { accessToken, idToken } = idportenTokens({
        clientId: stored.clientId,
        audience: stored.audience,
        pid: stored.pid,
        nonce: stored.nonce
      });
      jsonResponse(response, 200, {
        access_token: accessToken,
        id_token: idToken,
        token_type: "Bearer",
        expires_in: tokenLifetimeSeconds,
        scope: "openid profile",
        syntetisk: true
      });
      return;
    }

    oauthError(response, 404, "invalid_request", `Fant ikke ${request.method} ${sti}. Se GET /docs.`);
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
