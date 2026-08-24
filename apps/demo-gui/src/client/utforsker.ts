// Sidescript for utforsker. Lastes som <script type="module">, så alt her har sitt
// eget scope — to sider kan bruke samme navn på hver sin `backendBase` uten å
// kollidere. felles.ts lastes som klassisk script foran denne, så funksjonene og
// typene derfra er globale og trenger ingen import.
export {};

renderTopNav("/utforsker");

// De tjenestene som serverer en spesifikasjon, fra det delte registeret
// /assets/tjenester.json. Adressen står i spesifikasjonen selv (servers:),
// men porten må være kjent for å hente den første gangen. Navnet er samtidig
// den audience tjenesten godtar et token for; se autentisering.ts.
//
// Lista sto her og på dashboardet, i to kopier. Dashboardets manglet
// digdir-mock. Nå står den ett sted, og pnpm test:openapi krever at den er
// enig med tjenestelista i scripts/sjekk-openapi-dekning.ts.
// Formene tjenestene faktisk sender på GET /openapi-ruter.json. Fasiten er
// Route, Parameter og RouteOverview i apps/shared-ui/openapi.ts — dette er den
// samme kontrakten sett fra nettleseren, som ikke kan importere den.
type RuteParameter = {
  navn: string;
  /** `in:` fra OpenAPI — path, query, header eller cookie. */
  plassering: string;
  paakrevd: boolean;
  eksempel?: string;
  beskrivelse?: string;
};

type Rute = {
  metode: string;
  sti: string;
  /** null = ruta har ingen dokumentert hjemmel. */
  security: string[] | null;
  scopes: string[];
  sammendrag?: string;
  beskrivelse?: string;
  parametere: RuteParameter[];
};

type RuteOversikt = {
  tjeneste: string;
  beskrivelse?: string;
  ruter: Rute[];
};

/** En tjeneste i velgeren: navnet er også audience-en den godtar token for. */
type UtforskerTjeneste = { navn: string; base: string };

/** En rad fra GET /idporten/testbrukere. */
type Testbruker = { pid: string; personId?: string; visningsnavn?: string };

/**
 * Legitimasjonen for ett kall. Enten `mangler` — og da er det ingenting å sende
 * — eller resten av feltene.
 */
type Legitimasjon = {
  header?: Record<string, string>;
  hva?: string;
  curlHent?: string | null;
  token?: string | null;
  nettleserbygget?: boolean;
  mangler?: string;
};

let TJENESTER: UtforskerTjeneste[] = [];

async function loadTjenesteregister(): Promise<void> {
  const svar = await fetch("/assets/tjenester.json");
  if (!svar.ok) throw new Error(`tjenester.json svarte ${svar.status}`);
  TJENESTER = ((await svar.json()) as Tjeneste[])
    .filter((oppforing) => oppforing.spesifikasjon)
    .map((oppforing) => ({ navn: oppforing.navn, base: `http://localhost:${oppforing.port}` }));
}

const DIGDIR = "http://localhost:8086";

const hentet = new Map<string, RuteOversikt>();
let tjeneste: UtforskerTjeneste | null = null;
let ruter: Rute[] = [];
let valgtRute: Rute | null = null;
/** pid -> { personId, visningsnavn }. Fylles fra GET /idporten/testbrukere. */
const testbrukere = new Map<string, Testbruker>();

function showBanner(tekst: string | null): void {
  const element = krevEl("banner");
  element.hidden = !tekst;
  element.textContent = tekst || "";
}

/* ── Legitimasjon ──────────────────────────────────────────────────────
 *
 * Utforskeren velger token ut fra `security:` i spesifikasjonen. Det er
 * utbetalingen for at hver rute fikk en hjemmel som er avledet av koden: en
 * side som gjetter ville lært bort feil ting, en side som spør hver gang
 * ville ingen orket.
 *
 * Bare sandbox-backend godtar ID-porten, så én innlogging dekker alt.
 * Maskinporten-tokenene hentes uten at deltakeren trenger å gjøre noe.
 */

const maskinportenBuffer = new Map<string, string>();
/** Satt av «bruk mitt eget token» i identitetskortet. Overstyrer alt. */
let manueltToken: string | null = null;
/** Ordningen deltakeren har valgt for den valgte ruta, når den godtar flere. */
let valgtOrdning: string | null = null;

function ordningerFor(rute: Rute): string[] {
  return rute.security === null ? [] : rute.security;
}

function hjemmelFor(rute: Rute): { tekst: string; lukket: boolean } {
  if (rute.security === null) return { tekst: "udokumentert hjemmel", lukket: true };
  if (rute.security.length === 0) return { tekst: "åpen", lukket: false };
  const scopes = rute.scopes.length ? ` (${rute.scopes.join(", ")})` : "";
  return { tekst: rute.security.join(" eller ") + scopes, lukket: true };
}

function base64urlText(tekst: string): string {
  return btoa(unescape(encodeURIComponent(tekst)))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/*
 * MASKINPORTEN, BYGGET I NETTLESEREN.
 *
 * digdir-mock validerer assertionen på form og ikke på signatur, så siden kan
 * lage den selv. Hvert felt ekte Maskinporten krever er fortsatt påkrevd, så
 * formen man lærer her er riktig.
 *
 * MEN: ekte Maskinporten krever en assertion signert med en privat nøkkel som
 * er registrert på klienten — en nøkkel en nettleser aldri skal holde. Derfor
 * står merkelappen i UI-et ved siden av tokenet, ikke bare her.
 */
async function getMaskinportenToken(audience: string, scope: string): Promise<string> {
  const noekkel = `${audience}|${scope}`;
  const bufret = maskinportenBuffer.get(noekkel);
  if (bufret && claimsValid(claimsIn(bufret))) return bufret;

  const naa = Math.floor(Date.now() / 1000);
  const assertion = [
    base64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" })),
    base64urlText(JSON.stringify({
      iss: "api-utforsker",
      aud: DIGDIR,
      scope,
      resource: audience,
      orgnr: "991825827",
      iat: naa,
      exp: naa + 30
    })),
    "signaturen-sjekkes-ikke-i-sandkassen"
  ].join(".");

  const svar = await fetch(`${DIGDIR}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
      resource: audience
    })
  });
  const data = (await svar.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!svar.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `status ${svar.status}`);
  }
  maskinportenBuffer.set(noekkel, data.access_token);
  return data.access_token;
}

/**
 * Hvilken ordning som brukes for en rute. Godtar ruta flere, kan deltakeren
 * velge — det er der forskjellen på «egne data» og «maskin med scope» blir
 * synlig, og der en 403 er verdt å framkalle med vilje.
 */
function chosenOrdningFor(rute: Rute): string | null {
  const ordninger = ordningerFor(rute);
  if (ordninger.length <= 1) return ordninger[0] || null;
  // Valget må ligge her og ikke i DOM-en: tegnDetaljer bygger panelet på nytt
  // for hvert bytte, og en velger som leses av seg selv nullstilles i samme
  // slengen — knappen så ut som den ikke virket.
  if (valgtOrdning && ordninger.includes(valgtOrdning)) return valgtOrdning;
  // tjeneste er alltid satt her: rutene tegnes først etter loadTjeneste().
  return tokenValid(tjeneste!.navn) ? "idporten" : ordninger[0];
}

/**
 * Legitimasjonen for ett kall: headeren som sendes, hva den er, og hvordan
 * den samme legitimasjonen skaffes fra et terminalvindu.
 */
async function getCredentials(rute: Rute): Promise<Legitimasjon> {
  if (manueltToken) {
    return {
      header: { Authorization: `Bearer ${manueltToken}` },
      hva: "et token du limte inn selv",
      curlHent: null,
      token: manueltToken
    };
  }

  const ordning = chosenOrdningFor(rute);
  if (!ordning) return { header: {}, hva: "ingen legitimasjon — ruta er åpen", curlHent: null };

  const audience = tjeneste!.navn;

  if (ordning === "idporten") {
    const token = storedToken(audience);
    if (!tokenValid(audience)) {
      return {
        mangler: token
          ? `ID-porten-tokenet for ${audience} er utløpt. Logg inn på nytt.`
          : `Ruta krever et ID-porten-token for ${audience}. Logg inn øverst på siden.`
      };
    }
    const pid = loggedInPid(audience) ?? "";
    const personId = testbrukere.get(pid)?.personId;
    return {
      header: { Authorization: `Bearer ${token}` },
      hva: `ID-porten-token for ${testbrukere.get(pid)?.visningsnavn || pid}, aud ${audience}`,
      curlHent: personId ? `TOKEN=$(node scripts/token.ts --innbygger ${personId})` : null,
      token
    };
  }

  if (ordning === "maskinporten") {
    const scope: string | undefined = rute.scopes[0];
    if (!scope) return { mangler: "Spesifikasjonen oppgir maskinporten uten scope." };
    try {
      const token = await getMaskinportenToken(audience, scope);
      return {
        header: { Authorization: `Bearer ${token}` },
        hva: `Maskinporten-token, scope ${scope}, aud ${audience}`,
        curlHent: `TOKEN=$(node scripts/token.ts --maskinporten ${scope} --resource ${audience})`,
        token,
        nettleserbygget: true
      };
    } catch (feil) {
      return { mangler: `Fikk ikke Maskinporten-token: ${feilmelding(feil)}` };
    }
  }

  return { mangler: `Kjenner ikke ordningen «${ordning}».` };
}

/* ── Identitetskortet ──────────────────────────────────────────────── */

async function loadTestbrukere(): Promise<void> {
  try {
    const svar = await fetch(`${DIGDIR}/idporten/testbrukere`);
    if (!svar.ok) return;
    for (const bruker of (await svar.json()) as Testbruker[]) {
      testbrukere.set(bruker.pid, bruker);
    }
  } catch {
    // Uten lista viser identitetslinja fødselsnummeret i stedet for navnet.
    // Det er en dårligere opplevelse, ikke en ødelagt side.
  }
}

function renderIdentitet(): void {
  const kort = krevEl("identitet");
  kort.replaceChildren();

  const hovedlinje = document.createElement("div");
  hovedlinje.className = "hovedlinje";
  const hvem = document.createElement("div");
  hvem.className = "hvem";
  hovedlinje.appendChild(hvem);

  const innlogget = tokenValid("sandbox-backend");
  if (innlogget) {
    const pid = loggedInPid("sandbox-backend") ?? "";
    const bruker = testbrukere.get(pid);
    hvem.innerHTML =
      `🔓 Innlogget som <strong>${htmlEscape(bruker?.visningsnavn || pid)}</strong> ` +
      `<span class="muted small">(${htmlEscape(bruker?.personId || pid)}, idporten-loa-high)</span>`;

    const bytt = document.createElement("button");
    bytt.type = "button";
    bytt.className = "secondary";
    bytt.textContent = "Logg ut / bytt person";
    bytt.onclick = () => {
      logOut();
      maskinportenBuffer.clear();
      renderIdentitet();
      if (valgtRute) renderDetaljer(valgtRute);
    };
    hovedlinje.appendChild(bytt);
  } else {
    hvem.innerHTML = "🔒 <strong>Ikke innlogget.</strong> " +
      "<span class=\"muted small\">Åpne ruter og Maskinporten-ruter virker uansett.</span>";
    const loggInn = document.createElement("button");
    loggInn.type = "button";
    loggInn.textContent = "Logg inn med ID-porten";
    // Går til testbrukervelgeren i digdir-mock og kommer tilbake hit, til
    // samme rute: den ligger i adressen, og adressen rir med i `state`.
    loggInn.onclick = () => requireLogin({ resource: "sandbox-backend" });
    hovedlinje.appendChild(loggInn);
  }
  kort.appendChild(hovedlinje);

  const tokenliste = document.createElement("div");
  tokenliste.className = "tokenliste";
  const linjer: string[] = [];
  for (const kandidat of TJENESTER) {
    if (tokenValid(kandidat.navn)) {
      const utloper = Math.round(((tokenClaims(kandidat.navn)?.exp ?? 0) - Date.now() / 1000) / 60);
      linjer.push(`ID-porten → ${kandidat.navn} (utløper om ${utloper} min)`);
    }
  }
  for (const noekkel of maskinportenBuffer.keys()) {
    const [audience, scope] = noekkel.split("|");
    linjer.push(`Maskinporten → ${audience}, scope ${scope}`);
  }
  tokenliste.textContent = linjer.length
    ? `Token i fanen: ${linjer.join(" · ")}`
    : "Ingen token i fanen. Maskinporten-token hentes automatisk når en rute krever det.";
  kort.appendChild(tokenliste);

  const eget = document.createElement("details");
  const sammendrag = document.createElement("summary");
  sammendrag.textContent = manueltToken
    ? "Bruker et token du limte inn — klikk for å fjerne det"
    : "Har du allerede et token fra scripts/token.ts? Lim det inn her";
  eget.appendChild(sammendrag);

  const felt = document.createElement("div");
  felt.className = "felt";
  felt.style.marginTop = "10px";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "eyJhbGciOiJSUzI1NiIs…";
  input.value = manueltToken || "";
  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent =
    "Overstyrer valget for alle kall, også de åpne. Tøm feltet for å gå tilbake til " +
    "automatisk valg.";
  input.oninput = () => {
    manueltToken = input.value.trim() || null;
    if (valgtRute) renderDetaljer(valgtRute);
  };
  felt.appendChild(input);
  felt.appendChild(hint);
  eget.appendChild(felt);
  if (manueltToken) eget.open = true;
  kort.appendChild(eget);
}

/* ── Rutelista ─────────────────────────────────────────────────────── */

function renderRuteliste(): void {
  const sok = krevEl<HTMLInputElement>("sok").value.trim().toLowerCase();
  const liste = krevEl("ruteliste");
  liste.replaceChildren();

  const treff = ruter.filter((rute) =>
    !sok ||
    rute.sti.toLowerCase().includes(sok) ||
    (rute.sammendrag || "").toLowerCase().includes(sok)
  );

  if (treff.length === 0) {
    const tom = document.createElement("p");
    tom.className = "muted small";
    tom.textContent = "Ingen ruter matcher søket.";
    liste.appendChild(tom);
    return;
  }

  for (const rute of treff) {
    const knapp = document.createElement("button");
    knapp.type = "button";
    knapp.className = "rute" + (rute === valgtRute ? " valgt" : "");

    const metode = document.createElement("span");
    metode.className = "metode" + (rute.metode === "GET" ? "" : " skriver");
    metode.textContent = rute.metode;

    const sti = document.createElement("span");
    sti.className = "sti";
    sti.textContent = rute.sti;

    const rad = document.createElement("div");
    rad.appendChild(metode);
    rad.appendChild(sti);
    knapp.appendChild(rad);

    if (rute.sammendrag) {
      const sammendrag = document.createElement("div");
      sammendrag.className = "sammendrag";
      sammendrag.textContent = rute.sammendrag;
      knapp.appendChild(sammendrag);
    }

    knapp.onclick = () => selectRute(rute);
    liste.appendChild(knapp);
  }
}

/*
 * Valgt rute ligger i adressen. Da overlever den rundturen til ID-porten:
 * requireLogin legger location.pathname + location.search i `state`, og
 * /callback sender nettleseren tilbake hit.
 */
function selectRute(rute: Rute): void {
  valgtRute = rute;
  valgtOrdning = null;
  const parametere = new URLSearchParams({
    tjeneste: tjeneste!.navn,
    metode: rute.metode,
    sti: rute.sti
  });
  history.replaceState(null, "", `${location.pathname}?${parametere}`);
  renderRuteliste();
  renderDetaljer(rute);
}

/* ── Detaljruta ────────────────────────────────────────────────────── */

async function renderDetaljer(rute: Rute): Promise<void> {
  const panel = krevEl("detaljer");
  panel.replaceChildren();

  const tittel = document.createElement("h2");
  tittel.innerHTML =
    `<span class="metode${rute.metode === "GET" ? "" : " skriver"}">${htmlEscape(rute.metode)}</span>` +
    `<code>${htmlEscape(rute.sti)}</code>`;
  panel.appendChild(tittel);

  const hjemmel = hjemmelFor(rute);
  const merke = document.createElement("p");
  const chip = document.createElement("span");
  chip.className = "hjemmel" + (hjemmel.lukket ? " lukket" : "");
  chip.textContent = "Hjemmel: " + hjemmel.tekst;
  merke.appendChild(chip);
  panel.appendChild(merke);

  if (rute.beskrivelse) {
    const beskrivelse = document.createElement("p");
    beskrivelse.className = "muted small";
    beskrivelse.textContent = rute.beskrivelse;
    panel.appendChild(beskrivelse);
  }

  // Ordningsvelgeren må stå i DOM-en før skaffLegitimasjon leser den.
  const boks = document.createElement("div");
  boks.className = "legitimasjon";
  panel.appendChild(boks);

  const ordninger = ordningerFor(rute);
  if (ordninger.length > 1 && !manueltToken) {
    const label = document.createElement("label");
    label.htmlFor = "ordningvelger";
    label.textContent = "Ruta godtar to ordninger — send som";
    const velger = document.createElement("select");
    velger.id = "ordningvelger";
    for (const ordning of ordninger) {
      const valg = document.createElement("option");
      valg.value = ordning;
      valg.textContent = ordning === "idporten"
        ? "ID-porten (innbygger — ser bare seg selv)"
        : `Maskinporten (${rute.scopes.join(", ") || "uten scope"})`;
      velger.appendChild(valg);
    }
    velger.value = chosenOrdningFor(rute) ?? "";
    velger.onchange = () => {
      valgtOrdning = velger.value;
      renderDetaljer(rute);
    };
    boks.appendChild(label);
    boks.appendChild(velger);
  }

  const legitimasjon = await getCredentials(rute);
  const tittelrad = document.createElement("div");
  tittelrad.className = "tittel";
  tittelrad.textContent = legitimasjon.mangler ? "Sendes uten token" : "Sendes med";
  boks.insertBefore(tittelrad, boks.firstChild);

  const hva = document.createElement("div");
  hva.textContent = legitimasjon.mangler || legitimasjon.hva || "";
  boks.insertBefore(hva, tittelrad.nextSibling);

  if (legitimasjon.mangler && ordninger.includes("idporten")) {
    const loggInn = document.createElement("button");
    loggInn.type = "button";
    loggInn.style.marginTop = "10px";
    loggInn.textContent = "Logg inn med ID-porten";
    loggInn.onclick = () => requireLogin({ resource: tjeneste!.navn });
    boks.appendChild(loggInn);
  }

  if (legitimasjon.nettleserbygget) {
    const merknad = document.createElement("div");
    merknad.className = "merknad";
    merknad.textContent =
      "Assertionen er bygget her i nettleseren. Det virker fordi digdir-mock " +
      "validerer den på form, ikke på signatur. Ekte Maskinporten krever en " +
      "assertion signert med en privat nøkkel som er registrert på klienten — " +
      "og en privat nøkkel skal aldri ligge i en nettleser.";
    boks.appendChild(merknad);
  }

  const skjema = document.createElement("div");
  const felter = new Map<RuteParameter, HTMLInputElement>();
  for (const parameter of rute.parametere) {
    if (parameter.plassering !== "path" && parameter.plassering !== "query") continue;
    const felt = document.createElement("div");
    felt.className = "felt";

    const merkelapp = document.createElement("label");
    merkelapp.textContent =
      `${parameter.navn} (${parameter.plassering}${parameter.paakrevd ? ", påkrevd" : ""})`;
    const id = `felt-${parameter.plassering}-${parameter.navn}`;
    merkelapp.htmlFor = id;

    const input = document.createElement("input");
    input.id = id;
    input.value = parameter.eksempel || "";
    input.placeholder = parameter.eksempel || "";

    felt.appendChild(merkelapp);
    felt.appendChild(input);
    if (parameter.beskrivelse) {
      const hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = parameter.beskrivelse;
      felt.appendChild(hint);
    }
    skjema.appendChild(felt);
    felter.set(parameter, input);
  }
  panel.appendChild(skjema);

  const handlinger = document.createElement("div");
  handlinger.className = "actions";
  const send = document.createElement("button");
  send.type = "button";
  send.textContent = `Send ${rute.metode}`;
  handlinger.appendChild(send);
  panel.appendChild(handlinger);

  // Skriving hører til neste steg. En knapp som later som den virker er verre
  // enn en knapp som sier hvorfor den ikke gjør det.
  if (rute.metode !== "GET") {
    send.disabled = true;
    const merknad = document.createElement("p");
    merknad.className = "muted small";
    merknad.textContent =
      "Utforskeren sender bare GET foreløpig. Kall som skriver til sandkassen kommer, " +
      "sammen med et synlig varsel om at de endrer delt tilstand.";
    panel.appendChild(merknad);
  }

  const svarrute = document.createElement("div");
  svarrute.id = "svarrute";
  panel.appendChild(svarrute);

  send.onclick = () => sendRequest(rute, felter, svarrute);
}

/* ── Kallet ────────────────────────────────────────────────────────── */

function buildUrl(rute: Rute, felter: Map<RuteParameter, HTMLInputElement>): string {
  let sti = rute.sti;
  const spoerring = new URLSearchParams();
  for (const [parameter, input] of felter) {
    const verdi = input.value.trim();
    if (parameter.plassering === "path") {
      sti = sti.replace(`{${parameter.navn}}`, encodeURIComponent(verdi));
    } else if (verdi !== "") {
      spoerring.set(parameter.navn, verdi);
    }
  }
  const hale = spoerring.toString();
  return tjeneste!.base + sti + (hale ? `?${hale}` : "");
}

/*
 * encodeURIComponent slipper apostrofen gjennom, og en apostrof inne i
 * enkeltfnutter avslutter dem. Uten skjermingen her blir kommandoen ukjørbar
 * — og «en curl som virker når den limes inn» er det siden lover.
 */
function shellQuote(verdi: unknown): string {
  return `'${String(verdi).replaceAll("'", `'\\''`)}'`;
}

/*
 * Kommandoen som skrives ut er den som ble kjørt, ikke en mal — med de samme
 * headerne. To former: én som viser hvordan tokenet skaffes, og én med
 * tokenet skrevet inn, som virker umiddelbart. Dataene er syntetiske.
 */
function curlFor(rute: Rute, url: string, legitimasjon: Legitimasjon): { laert: string | null; direkte: string | null } {
  const kall = (tokenUttrykk: string | null): string => {
    const deler = ["curl -i"];
    if (rute.metode !== "GET") deler.push(`-X ${rute.metode}`);
    if (tokenUttrykk) deler.push(`-H "Authorization: Bearer ${tokenUttrykk}"`);
    deler.push(shellQuote(url));
    return deler.join(" ");
  };
  if (!legitimasjon.token) return { laert: kall(null), direkte: null };
  return {
    laert: legitimasjon.curlHent ? `${legitimasjon.curlHent}\n${kall("$TOKEN")}` : null,
    direkte: kall(legitimasjon.token)
  };
}

async function sendRequest(
  rute: Rute,
  felter: Map<RuteParameter, HTMLInputElement>,
  svarrute: HTMLElement
): Promise<void> {
  svarrute.replaceChildren();

  const overskrift = document.createElement("h3");
  overskrift.textContent = "Svar";
  svarrute.appendChild(overskrift);

  // En tom path-parameter gir «/api/personer//dialoger» og en 404 som ikke
  // sier hva som mangler. Si det her i stedet.
  const tomme = [...felter]
    .filter(([parameter, input]) =>
      input.value.trim() === "" && (parameter.plassering === "path" || parameter.paakrevd))
    .map(([parameter]) => parameter.navn);
  if (tomme.length) {
    const mangler = document.createElement("p");
    mangler.className = "statuslinje feil";
    mangler.textContent = `Fyll inn ${tomme.join(", ")} først — ${tomme.length === 1 ? "den er" : "de er"} påkrevd.`;
    svarrute.appendChild(mangler);
    return;
  }

  const url = buildUrl(rute, felter);
  const status = document.createElement("p");
  status.className = "statuslinje";
  status.textContent = "Sender …";
  svarrute.appendChild(status);

  const legitimasjon = await getCredentials(rute);
  if (legitimasjon.mangler) {
    status.className = "statuslinje feil";
    status.textContent = legitimasjon.mangler;
    return;
  }

  let svar: Response;
  try {
    svar = await fetch(url, { method: rute.metode, headers: legitimasjon.header });
  } catch (feil) {
    status.className = "statuslinje feil";
    status.textContent = `Kallet nådde ikke fram: ${feilmelding(feil)}`;
    const forklaring = document.createElement("p");
    forklaring.className = "muted small";
    forklaring.textContent =
      "Er tjenesten oppe? En preflight som dør er bare synlig i nettleserkonsollet.";
    svarrute.appendChild(forklaring);
    return;
  }

  status.className =
    "statuslinje " + (svar.ok ? "ok" : svar.status === 401 || svar.status === 403 ? "avvist" : "feil");
  status.textContent = `${svar.status} ${svar.statusText}`;

  if (svar.status === 401 || svar.status === 403) {
    const forklaring = document.createElement("p");
    forklaring.className = "muted small";
    forklaring.textContent = explainRejection(rute, svar.status, legitimasjon);
    svarrute.appendChild(forklaring);
  }

  const headere = document.createElement("pre");
  headere.textContent = [...svar.headers].map(([navn, verdi]) => `${navn}: ${verdi}`).join("\n");
  svarrute.appendChild(labelled("Headere", headere));

  // Et kall på tvers av origin ser bare de trygge headerne med mindre
  // tjenesten lister resten i Access-Control-Expose-Headers. curl ser alle,
  // og det er verdt å si framfor å la lista se tom ut.
  const headerNote = document.createElement("p");
  headerNote.className = "muted small";
  headerNote.textContent =
    "Nettleseren viser bare de trygge headerne på et kall over origin-grensen. " +
    "curl-en under viser alle.";
  svarrute.appendChild(headerNote);

  const raa = await svar.text();
  const kropp = document.createElement("pre");
  try {
    kropp.textContent = JSON.stringify(JSON.parse(raa), null, 2);
  } catch {
    kropp.textContent = raa;
  }
  svarrute.appendChild(labelled("Kropp", kropp));

  const curl = curlFor(rute, url, legitimasjon);
  if (curl.laert) {
    const kommando = document.createElement("pre");
    kommando.textContent = curl.laert;
    svarrute.appendChild(labelled("Samme kall som curl", kommando));
  }
  if (curl.direkte) {
    const detaljer = document.createElement("details");
    const sammendrag = document.createElement("summary");
    sammendrag.className = "muted small";
    sammendrag.textContent = curl.laert
      ? "… eller med tokenet skrevet inn, så den virker umiddelbart"
      : "Samme kall som curl";
    const kommando = document.createElement("pre");
    kommando.textContent = curl.direkte;
    detaljer.appendChild(sammendrag);
    detaljer.appendChild(kommando);
    detaljer.open = !curl.laert;
    svarrute.appendChild(detaljer);
  }

  renderIdentitet();
}

/*
 * 401 og 403 er ikke det samme, og forskjellen er hele poenget med Del B.
 * Å skrive ut statuskoden uten å si hvilken av de to sperrene som slo til,
 * lærer bort at sandkassen er ustabil.
 */
function explainRejection(rute: Rute, status: number, legitimasjon: Legitimasjon): string {
  const hjemmel = hjemmelFor(rute);
  if (status === 401) {
    return `401 betyr «vi vet ikke hvem du er» — tokenet mangler, er utløpt, eller er ` +
      `utstedt for en annen audience enn ${tjeneste!.navn}. Ruta krever ${hjemmel.tekst}.`;
  }
  return "403 betyr «vi vet hvem du er, og du har ikke lov». Legitimasjonen holdt, " +
    "men den gjelder ikke denne ressursen — se grunnen i kroppen under. Et " +
    "ID-porten-token er bundet til én person, og et Maskinporten-token til ett scope.";
}

function labelled(tekst: string, element: HTMLElement): HTMLDivElement {
  const bolk = document.createElement("div");
  const merkelapp = document.createElement("div");
  merkelapp.className = "label";
  merkelapp.style.marginTop = "14px";
  merkelapp.textContent = tekst;
  bolk.appendChild(merkelapp);
  bolk.appendChild(element);
  return bolk;
}

/* ── Oppstart ──────────────────────────────────────────────────────── */

async function loadTjeneste(
  valgt: UtforskerTjeneste,
  gjenopprett?: { metode: string; sti: string } | null
): Promise<void> {
  tjeneste = valgt;
  // Hvilket valg denne kjøringen gjelder. Bytter man tjeneste igjen før
  // hentingen er ferdig, skal det trege svaret forkastes — ellers rendres
  // én tjenestes ruter mens kallene går til en annens adresse.
  const gjelder = valgt;
  valgtRute = null;
  valgtOrdning = null;
  // Et søk fra forrige tjeneste som ikke matcher noe her, ser ut som en
  // tjeneste uten ruter. Tøm det ved bytte.
  krevEl<HTMLInputElement>("sok").value = "";
  krevEl("detaljer").replaceChildren();
  krevEl("ruteliste").replaceChildren();
  showBanner(null);

  if (!hentet.has(valgt.base)) {
    try {
      const svar = await fetch(`${valgt.base}/openapi-ruter.json`);
      if (!svar.ok) throw new Error(`status ${svar.status}`);
      hentet.set(valgt.base, (await svar.json()) as RuteOversikt);
    } catch (feil) {
      if (tjeneste !== gjelder) return;
      krevEl("tjenestenavn").textContent = valgt.navn;
      krevEl("tjenestebeskrivelse").textContent = "";
      showBanner(
        `⚠️ Klarte ikke å hente ${valgt.base}/openapi-ruter.json: ${feilmelding(feil)}. ` +
        "Kjører tjenesten? Se docker compose ps."
      );
      ruter = [];
      return;
    }
  }

  if (tjeneste !== gjelder) return;

  const oversikt = hentet.get(valgt.base)!;
  ruter = oversikt.ruter;
  krevEl("tjenestenavn").textContent = oversikt.tjeneste;
  krevEl("tjenestebeskrivelse").textContent = oversikt.beskrivelse || "";
  renderRuteliste();

  if (gjenopprett) {
    const treff = ruter.find(
      (rute) => rute.metode === gjenopprett.metode && rute.sti === gjenopprett.sti
    );
    if (treff) selectRute(treff);
  }
}

async function start(): Promise<void> {
  await loadTjenesteregister();
  const velger = krevEl<HTMLSelectElement>("tjenestevelger");
  for (const kandidat of TJENESTER) {
    const valg = document.createElement("option");
    valg.value = kandidat.base;
    valg.textContent = `${kandidat.navn} (${kandidat.base.replace("http://localhost:", "")})`;
    velger.appendChild(valg);
  }
  velger.onchange = () => {
    const valgt = TJENESTER.find((kandidat) => kandidat.base === velger.value);
    if (valgt) loadTjeneste(valgt);
  };

  krevEl("sok").oninput = renderRuteliste;

  await loadTestbrukere();
  renderIdentitet();

  // Ruta fra adressen, slik den ser ut etter en rundtur til ID-porten.
  const parametere = new URLSearchParams(location.search);
  const oenskt = TJENESTER.find((kandidat) => kandidat.navn === parametere.get("tjeneste"));
  velger.value = (oenskt || TJENESTER[0]).base;
  const sti = parametere.get("sti");
  await loadTjeneste(oenskt || TJENESTER[0], sti
    ? { metode: parametere.get("metode") ?? "GET", sti }
    : null);
}

start();
