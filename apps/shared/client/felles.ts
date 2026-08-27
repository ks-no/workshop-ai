/*
 * Shared frontend helpers for demo-gui and process-builder.
 *
 * Plain globals, no module system: the pages are static HTML that load this and
 * one page script, and keeping it that way is the point - a participant can read
 * the whole client without a build step.
 *
 * Because there is no module system, the types declared here are global too, and
 * the page scripts under each app's src/client/ use them without importing anything.
 * That only works because the client tsconfigs set moduleDetection: "legacy",
 * and because hver app sin client/tsconfig.json også inkluderer denne filen.
 *
 * Served by both frontends at /assets/felles.ts, type-stripped on the way out -
 * see apps/shared/assets.ts.
 */

// --- Delte former, synlige for alle sidescript ------------------------------

type Person = {
  personId: string;
  visningsnavn: string;
  syntetiskFodselsnummer: string;
};

/** Hva et svar ble bygget av. ai-gateway legger den ved. */
type Grunnlag = {
  kilder?: string[];
  verdier?: unknown;
};

/** GET /helse på ai-gateway. */
type ModellHelse = {
  modellNaaBar?: boolean;
  modell?: string;
  provider?: string;
  feil?: string;
};

/**
 * Prosessdefinisjonen slik nettleseren ser den.
 *
 * Fasiten er ProsessDefinisjon i apps/sandbox-backend/src/types.ts. Denne kopien
 * finnes fordi nettleseren ikke har noe modulsystem å importere gjennom - men den
 * er med vilje løsere: siden viser hva serveren sender, den håndhever ingenting.
 */
type SpoersmaalsFelt = {
  id: string;
  label: string;
  type: string;
  obligatorisk?: boolean;
  alternativer?: string[];
  placeholder?: string;
};

type ProsessSteg = {
  id: string;
  type: string;
  tittel?: string;
  tekst?: string;
  felter?: SpoersmaalsFelt[];
  /** Bare på CONSENT_REQUEST. */
  formaal?: string;
  dataKilder?: string[];
};

/** En pågående kjøring av en prosess. Se Prosessoekt i sandbox-backend/types.ts. */
type Prosessoekt = {
  oektsId: string;
  prosessId: string;
  sporingsId: string;
  stegIndex: number;
  totaltAntallSteg?: number;
  aktivtSteg?: ProsessSteg | null;
  aktivtSamtykkeId?: string | null;
  status?: string;
  avvistMelding?: string;
  svar?: Record<string, unknown>;
  personId?: string;
  /** Resultatet av hvert utført steg, nøklet på stegId. */
  resultater?: Record<string, { melding?: string } | undefined>;
};

type Prosess = {
  id: string;
  navn: string;
  versjon?: string;
  beskrivelse?: string;
  steg?: ProsessSteg[];
};

/** En rad i /assets/tjenester.json - tjenesteregisteret dashboard og utforsker deler. */
type Tjeneste = {
  navn: string;
  port: number;
  rolle: string;
  spesifikasjon: boolean;
};

/** Claims i et ID-porten-token. Usignert lest, så alt er valgfritt. */
type TokenKrav = {
  exp?: number;
  pid?: string;
  aud?: string;
  [felt: string]: unknown;
};

/* eslint-disable no-unused-vars */

// --- Små hjelpere sidescriptene trenger ------------------------------------

/**
 * getElementById for et element siden ikke kan virke uten.
 *
 * document.getElementById gir HTMLElement | null, og null-sjekk på hver eneste
 * oppslag drukner koden. Denne kaster i stedet - med id-en i meldingen, som er en
 * god del mer nyttig enn «Cannot read properties of null» én linje senere.
 * Bruk document.getElementById direkte der elementet faktisk kan mangle.
 */
function krevEl<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Fant ikke elementet #${id} på siden.`);
  return element as T;
}

/** `catch (feil)` gir unknown. Denne svarer på det kallstedet faktisk spør om. */
function feilmelding(feil: unknown): string {
  return feil instanceof Error ? feil.message : String(feil);
}

let chatTarget: HTMLElement | null = null;

function initChat(element: HTMLElement): void {
  chatTarget = element;
}

function htmlEscape(tekst: unknown): string {
  return String(tekst ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatNumber(value: unknown): string {
  return new Intl.NumberFormat("nb-NO").format(Number(value || 0));
}

function addMsg(role: string, text: string): HTMLDivElement | null {
  if (!chatTarget) return null;
  const row = document.createElement("div");
  row.className = `msg ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  row.appendChild(bubble);
  chatTarget.appendChild(row);
  chatTarget.scrollTop = chatTarget.scrollHeight;
  return row;
}

function addTyping(tekst = "Tenker…"): void {
  if (!chatTarget || document.getElementById("typing")) return;
  const row = document.createElement("div");
  row.className = "msg assistant";
  row.id = "typing";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  const spinner = document.createElement("span");
  spinner.className = "spinner";
  bubble.appendChild(spinner);
  bubble.appendChild(document.createTextNode(tekst));
  row.appendChild(bubble);
  chatTarget.appendChild(row);
  chatTarget.scrollTop = chatTarget.scrollHeight;
}

function removeTyping(): void {
  document.getElementById("typing")?.remove();
}

/*
 * Which sources an answer was built from. Without this the citizen has no way
 * to tell a grounded answer from an invented one.
 */
function addGrunnlagsfot(grunnlag: Grunnlag | null | undefined): void {
  if (!chatTarget || !grunnlag) return;
  const kilder = Array.isArray(grunnlag.kilder) ? grunnlag.kilder : [];
  if (kilder.length === 0) return;

  const foot = document.createElement("div");
  foot.className = "grunnlag";
  foot.appendChild(document.createTextNode(`Basert på: ${kilder.join(" · ")}`));

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.textContent = "Vis grunnlag";
  const detaljer = document.createElement("pre");
  detaljer.hidden = true;
  detaljer.textContent = JSON.stringify(grunnlag.verdier ?? {}, null, 2);

  toggle.onclick = () => {
    detaljer.hidden = !detaljer.hidden;
    toggle.textContent = detaljer.hidden ? "Vis grunnlag" : "Skjul grunnlag";
  };

  foot.appendChild(toggle);
  foot.appendChild(detaljer);
  chatTarget.appendChild(foot);
  chatTarget.scrollTop = chatTarget.scrollHeight;
}

/* ── Toppmenyen ────────────────────────────────────────────────────────────
 *
 * One list here, so a new page cannot be forgotten by the four others.
 *
 * /ds-eksempel is deliberately absent: it loads neither felles.css nor felles.ts,
 * so a .top-links block there would be unstyled. It is reached from the README and
 * docs/deltakerstart.md.
 */

const PAGES = [
  { sti: "/", tekst: "Oversikt" },
  { sti: "/chat", tekst: "Chat" },
  { sti: "/agent", tekst: "AI-agent" },
  { sti: "/stegvis", tekst: "Stegvis" },
  { sti: "/utforsker", tekst: "API-utforsker" }
];

/**
 * Fills <div class="top-links" id="toppmeny"> with the site's pages.
 *
 * `activePath` is rendered as plain text rather than a link - a link to the page
 * you are already on is a dead end, and aria-current says the same thing to a
 * screen reader.
 */
function renderTopNav(activePath: string): void {
  const element = document.getElementById("toppmeny");
  if (!element) return;
  element.replaceChildren();
  for (const side of PAGES) {
    if (side.sti === activePath) {
      const her = document.createElement("span");
      her.textContent = side.tekst;
      her.setAttribute("aria-current", "page");
      element.appendChild(her);
      continue;
    }
    const lenke = document.createElement("a");
    lenke.href = side.sti;
    lenke.textContent = side.tekst;
    element.appendChild(lenke);
  }
}

/* ── Er modellen faktisk koblet på? ────────────────────────────────────────
 *
 * ai-gateway answers with template text when the model is down and sets an
 * advarsel field. Without this banner a broken setup looks exactly like a
 * working one - well-formed Norwegian prose, just from a template.
 */

type ModellValg = { konsekvens?: string; elementId?: string };

function showModellBanner(tekst: string | null, elementId = "modellBanner"): void {
  const element = document.getElementById(elementId);
  if (!element) return;
  if (!tekst) {
    element.hidden = true;
    return;
  }
  element.hidden = false;
  element.className = "banner";
  element.textContent = tekst;
}

async function checkModell(aiBase: string, valg: ModellValg = {}): Promise<ModellHelse | null> {
  const konsekvens = valg.konsekvens || "Svarene under kommer fra maler, ikke fra en modell.";
  try {
    const res = await fetch(`${aiBase}/helse`);
    const data = await res.json();
    if (data.modellNaaBar) {
      showModellBanner(null, valg.elementId);
      return data;
    }
    showModellBanner(
      `⚠️ Modellen er ikke koblet på (${data.modell || data.provider}). ${konsekvens} ${data.feil || ""}`.trim(),
      valg.elementId
    );
    return data;
  } catch {
    showModellBanner(`⚠️ Får ikke kontakt med ai-gateway. ${konsekvens}`, valg.elementId);
    return null;
  }
}

/*
 * A single reply can fall back even when the gateway looked healthy at load,
 * so advarsel is surfaced where it happens too. Kept quiet by default: a
 * warning shown on every turn teaches the user to ignore it.
 */
function warnAboutFallback(result: { advarsel?: unknown } | null | undefined): void {
  if (result && typeof result.advarsel === "string" && result.advarsel.trim()) {
    addMsg("system", `⚠️ ${result.advarsel}`);
  }
}

/* --- ID-porten i nettleseren -------------------------------------------------
 *
 * The redirect flow, once, for all three demo-gui pages. Each page's fetch helper
 * then needs one line: `...withToken()` in its headers.
 *
 * The token lives in sessionStorage, not localStorage: it should not outlive the
 * tab. It is a bearer token, and a workshop machine is shared.
 *
 * There is no person picker here: under ID-porten you do not choose who you are
 * in the application - you prove it at the identity provider. The dropdown holds
 * only the person you logged in as, and switching person means logging in again.
 * digdir-mock's /idporten/authorize is the picker.
 */

const IDPORTEN_BASE = "http://localhost:8086";
const TOKEN_KEY = "sandkasse-idporten-token";
const VERIFIER_KEY = "sandkasse-pkce-verifier";

/*
 * ET TOKEN PER AUDIENCE.
 *
 * `resource` på /authorize blir tokenets `aud`, og en tjeneste avviser et token
 * som er issuedAt for en annen - det er hele poenget med audience-begrensning. De
 * tre prosessidene snakker bare med sandbox-backend, så de holder seg til
 * standarden og merker ingenting; API-utforskeren kan kalle sju tjenester og
 * trenger å holde ett token per audience samtidig.
 *
 * sandbox-backend beholder den gamle nøkkelen uendret, så et token som allerede
 * ligger i fanen overlever denne endringen.
 */
const STANDARD_AUDIENCE = "sandbox-backend";

function tokenKey(audience = STANDARD_AUDIENCE): string {
  return audience === STANDARD_AUDIENCE ? TOKEN_KEY : `${TOKEN_KEY}:${audience}`;
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function storedToken(audience?: string): string | null {
  return sessionStorage.getItem(tokenKey(audience));
}

/** Claims without verifying the signature. The backend verifies; this is for display. */
function claimsIn(token: string | null | undefined): TokenKrav | null {
  if (!token) return null;
  try {
    const del = token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
    return JSON.parse(decodeURIComponent(escape(atob(del))));
  } catch {
    return null;
  }
}

function tokenClaims(audience?: string): TokenKrav | null {
  return claimsIn(storedToken(audience));
}

function claimsValid(krav: TokenKrav | null): boolean {
  // Treat a token expiring within 30 s as already gone, so a flow does not die
  // halfway through on an expiry it could have seen coming.
  return Boolean(krav && krav.exp && krav.exp - 30 > Math.floor(Date.now() / 1000));
}

function tokenValid(audience?: string): boolean {
  return claimsValid(tokenClaims(audience));
}

function loggedInPid(audience?: string): string | null {
  return tokenClaims(audience)?.pid || null;
}

/** Headers for a call to the backend. Spread into an existing headers object. */
function withToken(ekstra: Record<string, string> = {}, audience?: string): Record<string, string> {
  const token = storedToken(audience);
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...ekstra };
}

function logOut(): void {
  for (const noekkel of Object.keys(sessionStorage)) {
    if (noekkel === TOKEN_KEY || noekkel.startsWith(`${TOKEN_KEY}:`)) {
      sessionStorage.removeItem(noekkel);
    }
  }
  sessionStorage.removeItem(VERIFIER_KEY);
}

/**
 * Redirects to ID-porten unless a valid token is already held. Returns true when
 * the caller may carry on; when it returns false the browser is already navigating
 * away and the caller must stop.
 *
 * PKCE uses crypto.subtle, which browsers only expose in a secure context. That
 * covers localhost, which is where the sandbox runs.
 */
type LoginValg = { resource?: string };

async function requireLogin(valg: LoginValg = {}): Promise<boolean> {
  const audience = valg.resource || STANDARD_AUDIENCE;
  if (tokenValid(audience)) return true;
  sessionStorage.removeItem(tokenKey(audience));

  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  const challenge = base64url(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  );

  const parametere = new URLSearchParams({
    response_type: "code",
    client_id: "demo-gui",
    redirect_uri: `${location.origin}/callback`,
    scope: "openid profile",
    // resource blir tokenets aud. Uten den får man alltid sandbox-backend, og et
    // kall til en annen tjeneste svarer 401 uten at noe sier hvorfor.
    resource: audience,
    // state carries where to return to, so a deep link survives the round trip.
    state: location.pathname + location.search,
    code_challenge: challenge,
    code_challenge_method: "S256"
  });
  location.assign(`${IDPORTEN_BASE}/idporten/authorize?${parametere}`);
  return false;
}

/** Called by /callback only: swaps the code for a token and returns where to go. */
async function completeLogin(): Promise<string> {
  const parametere = new URLSearchParams(location.search);
  const feil = parametere.get("error");
  if (feil) {
    throw new Error(`${feil}: ${parametere.get("error_description") || "ingen forklaring"}`);
  }
  const code = parametere.get("code");
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!code) throw new Error("ID-porten sendte ingen code back.");
  if (!verifier) throw new Error("Fant ingen PKCE-verifier. Start innloggingen på nytt.");

  const svar = await fetch(`${IDPORTEN_BASE}/idporten/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: "demo-gui",
      redirect_uri: `${location.origin}/callback`,
      code_verifier: verifier
    })
  });
  const data = await svar.json();
  if (!svar.ok) {
    throw new Error(data.error_description || data.error || `status ${svar.status}`);
  }
  // Lagres på tokenets egen aud, ikke på den vi trodde vi ba om. Utstederen er
  // fasiten, og da kan ingen audience-forveksling gjemme seg her.
  sessionStorage.setItem(tokenKey(claimsIn(data.access_token)?.aud), data.access_token);
  sessionStorage.removeItem(VERIFIER_KEY);
  return parametere.get("state") || "/";
}

/**
 * Logs out and starts a fresh login. Exposed on its own so a page can put "logg
 * ut" wherever it likes; showLoggedInPerson wires up the common case.
 *
 * Reloading is what triggers requireLogin() again, which sends the browser to
 * ID-porten's picker - so "log out" and "switch user" are the same action. There is
 * no session at the issuer to end: it hands out a code per authorize request and
 * remembers nothing.
 */
function switchUser(): void {
  logOut();
  // Back to the page's own path, without a stale ?code= from an earlier round trip.
  location.assign(location.pathname);
}

/**
 * Fills a <select> with the single person the token belongs to, and returns them.
 *
 * The element stays a <select> so every downstream caller of valgtPersonId() keeps
 * working unchanged - but it now shows who you are rather than offering a choice.
 *
 * A "bytt bruker" link is inserted right after it. That lives here rather than in
 * each page because this is the one place that knows the selector has stopped being
 * a choice - and a disabled dropdown with no way out is a dead end.
 */
function showLoggedInPerson(velgerElement: HTMLSelectElement, personer: Person[]): Person {
  const pid = loggedInPid();
  const meg = personer.find((person) => person.syntetiskFodselsnummer === pid);
  if (!meg) {
    throw new Error(`Innlogget som ${pid}, men fant ingen slik person i datasettet.`);
  }
  velgerElement.innerHTML =
    `<option value="${htmlEscape(meg.personId)}">${htmlEscape(meg.visningsnavn)}</option>`;
  velgerElement.disabled = true;
  velgerElement.title =
    `Innlogget via ID-porten som ${meg.visningsnavn} (${pid}). Bruk «bytt bruker» for å endre.`;

  // Idempotent: renderStep and friends may call this more than once per page load.
  if (!velgerElement.parentNode?.querySelector(".switchUser")) {
    const bytt = document.createElement("a");
    bytt.className = "switchUser";
    bytt.href = "#";
    bytt.textContent = "logg ut / bytt bruker";
    bytt.style.cssText = "display:inline-block; margin-top:.35rem; font-size:.85rem;";
    bytt.onclick = (hendelse) => {
      hendelse.preventDefault();
      switchUser();
    };
    velgerElement.insertAdjacentElement("afterend", bytt);
  }
  return meg;
}

/** An extra "logged in as …" detail line, for pages with somewhere to put it. */
function showLoginBanner(container: HTMLElement | null, meg: Person): void {
  if (!container) return;
  const rad = document.createElement("div");
  rad.className = "line";
  rad.innerHTML =
    `🔓 Innlogget som <strong>${htmlEscape(meg.visningsnavn)}</strong> ` +
    `(${htmlEscape(loggedInPid())}, idporten-loa-high)`;
  container.prepend(rad);
}
