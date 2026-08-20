/*
 * Shared frontend helpers for demo-gui and process-builder.
 *
 * Plain globals, no module system: the pages are static HTML with inline
 * <script>, and keeping it that way is the point — a participant can read the
 * whole client in one file without a build step.
 *
 * Served by both frontends at /assets/felles.js.
 */

/* eslint-disable no-unused-vars */

let chatTarget = null;

function initChat(element) {
  chatTarget = element;
}

function htmlEscape(tekst) {
  return String(tekst ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatNumber(value) {
  return new Intl.NumberFormat("nb-NO").format(Number(value || 0));
}

function addMsg(role, text) {
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

function addTyping(tekst = "Tenker…") {
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

function removeTyping() {
  document.getElementById("typing")?.remove();
}

/*
 * Which sources an answer was built from. Without this the citizen has no way
 * to tell a grounded answer from an invented one.
 */
function addGrunnlagsfot(grunnlag) {
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

/* ── Er modellen faktisk koblet på? ────────────────────────────────────────
 *
 * ai-gateway answers with template text when the model is down and sets an
 * advarsel field. Without this banner a broken setup looks exactly like a
 * working one — well-formed Norwegian prose, just from a template.
 */

function visModellBanner(tekst, elementId = "modellBanner") {
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

async function sjekkModell(aiBase, valg = {}) {
  const konsekvens = valg.konsekvens || "Svarene under kommer fra maler, ikke fra en modell.";
  try {
    const res = await fetch(`${aiBase}/helse`);
    const data = await res.json();
    if (data.modellNaaBar) {
      visModellBanner(null, valg.elementId);
      return data;
    }
    visModellBanner(
      `⚠️ Modellen er ikke koblet på (${data.modell || data.provider}). ${konsekvens} ${data.feil || ""}`.trim(),
      valg.elementId
    );
    return data;
  } catch {
    visModellBanner(`⚠️ Får ikke kontakt med ai-gateway. ${konsekvens}`, valg.elementId);
    return null;
  }
}

/*
 * A single reply can fall back even when the gateway looked healthy at load,
 * so advarsel is surfaced where it happens too. Kept quiet by default: a
 * warning shown on every turn teaches the user to ignore it.
 */
function varsleOmFallback(result) {
  if (result && typeof result.advarsel === "string" && result.advarsel.trim()) {
    addMsg("system", `⚠️ ${result.advarsel}`);
  }
}

/* --- ID-porten i nettleseren -------------------------------------------------
 *
 * The redirect flow, once, for all three demo-gui pages. Each page's fetch helper
 * then needs one line: `...medToken()` in its headers.
 *
 * This file stays .js while the rest of Del B is TypeScript, because a browser
 * loads it directly — there is no build step to strip types in. That is a platform
 * constraint, not a style choice.
 *
 * The token lives in sessionStorage, not localStorage: it should not outlive the
 * tab. It is a bearer token, and a workshop machine is shared.
 *
 * WHY THE PERSON PICKER MOVED. demo-gui used to let you choose a test person from a
 * dropdown and then act as them. Under ID-porten you do not choose who you are in
 * the application — you prove it at the identity provider. So the dropdown is now
 * filled with the single person you logged in as, and switching person means
 * logging in again. digdir-mock's /idporten/authorize is the picker now.
 */

const IDPORTEN_BASE = "http://localhost:8086";
const TOKEN_NOKKEL = "sandkasse-idporten-token";
const VERIFIER_NOKKEL = "sandkasse-pkce-verifier";

function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function lagretToken() {
  return sessionStorage.getItem(TOKEN_NOKKEL);
}

/** Claims without verifying the signature. The backend verifies; this is for display. */
function tokenKrav() {
  const token = lagretToken();
  if (!token) return null;
  try {
    const del = token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
    return JSON.parse(decodeURIComponent(escape(atob(del))));
  } catch {
    return null;
  }
}

function tokenGyldig() {
  const krav = tokenKrav();
  // Treat a token expiring within 30 s as already gone, so a flow does not die
  // halfway through on an expiry it could have seen coming.
  return Boolean(krav && krav.exp && krav.exp - 30 > Math.floor(Date.now() / 1000));
}

function innloggetPid() {
  return tokenKrav()?.pid || null;
}

/** Headers for a call to the backend. Spread into an existing headers object. */
function medToken(ekstra = {}) {
  const token = lagretToken();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...ekstra };
}

function loggUt() {
  sessionStorage.removeItem(TOKEN_NOKKEL);
  sessionStorage.removeItem(VERIFIER_NOKKEL);
}

/**
 * Redirects to ID-porten unless a valid token is already held. Returns true when
 * the caller may carry on; when it returns false the browser is already navigating
 * away and the caller must stop.
 *
 * PKCE uses crypto.subtle, which browsers only expose in a secure context. That
 * covers localhost, which is where the sandbox runs.
 */
async function krevInnlogging() {
  if (tokenGyldig()) return true;
  loggUt();

  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  sessionStorage.setItem(VERIFIER_NOKKEL, verifier);
  const challenge = base64url(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  );

  const parametere = new URLSearchParams({
    response_type: "code",
    client_id: "demo-gui",
    redirect_uri: `${location.origin}/callback`,
    scope: "openid profile",
    // state carries where to return to, so a deep link survives the round trip.
    state: location.pathname + location.search,
    code_challenge: challenge,
    code_challenge_method: "S256"
  });
  location.assign(`${IDPORTEN_BASE}/idporten/authorize?${parametere}`);
  return false;
}

/** Called by /callback only: swaps the code for a token and returns where to go. */
async function fullfoerInnlogging() {
  const parametere = new URLSearchParams(location.search);
  const feil = parametere.get("error");
  if (feil) {
    throw new Error(`${feil}: ${parametere.get("error_description") || "ingen forklaring"}`);
  }
  const code = parametere.get("code");
  const verifier = sessionStorage.getItem(VERIFIER_NOKKEL);
  if (!code) throw new Error("ID-porten sendte ingen code tilbake.");
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
  sessionStorage.setItem(TOKEN_NOKKEL, data.access_token);
  sessionStorage.removeItem(VERIFIER_NOKKEL);
  return parametere.get("state") || "/";
}

/**
 * Logs out and starts a fresh login. Exposed on its own so a page can put "logg
 * ut" wherever it likes; visInnloggetPerson wires up the common case.
 *
 * Reloading is what triggers krevInnlogging() again, which sends the browser to
 * ID-porten's picker — so "log out" and "switch user" are the same action. There is
 * no session at the issuer to end: it hands out a code per authorize request and
 * remembers nothing.
 */
function byttBruker() {
  loggUt();
  // Back to the page's own path, without a stale ?code= from an earlier round trip.
  location.assign(location.pathname);
}

/**
 * Fills a <select> with the single person the token belongs to, and returns them.
 *
 * The element stays a <select> so every downstream caller of valgtPersonId() keeps
 * working unchanged — but it now shows who you are rather than offering a choice.
 *
 * A "bytt bruker" link is inserted right after it. That lives here rather than in
 * each page because this is the one place that knows the selector has stopped being
 * a choice — and a disabled dropdown with no way out is a dead end.
 */
function visInnloggetPerson(velgerElement, personer) {
  const pid = innloggetPid();
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
  if (!velgerElement.parentNode?.querySelector(".byttBruker")) {
    const bytt = document.createElement("a");
    bytt.className = "byttBruker";
    bytt.href = "#";
    bytt.textContent = "logg ut / bytt bruker";
    bytt.style.cssText = "display:inline-block; margin-top:.35rem; font-size:.85rem;";
    bytt.onclick = (hendelse) => {
      hendelse.preventDefault();
      byttBruker();
    };
    velgerElement.insertAdjacentElement("afterend", bytt);
  }
  return meg;
}

/** An extra "logged in as …" detail line, for pages with somewhere to put it. */
function visInnloggingsbanner(container, meg) {
  if (!container) return;
  const rad = document.createElement("div");
  rad.className = "line";
  rad.innerHTML =
    `🔓 Innlogget som <strong>${htmlEscape(meg.visningsnavn)}</strong> ` +
    `(${htmlEscape(innloggetPid())}, idporten-loa-high)`;
  container.prepend(rad);
}
