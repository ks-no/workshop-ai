/*
 * Søknadsskjemaet.
 *
 * Skjemaet er prosessdefinisjonen tegnet ut som ett skjema framfor sju steg.
 * QUESTION-stegene blir feltene innbyggeren fyller, DATA_FETCH-stegene blir
 * opplysningene kommunen fyller ut selv - og det er der samtykket avgjør: uten
 * det svarer ressursen 403, og blokken står låst med bryteren i seg. Skrus den
 * på, hentes opplysningene med én gang og feltene står ferdig utfylt.
 *
 * Ingenting av dette er en ny motor. Forhåndsvisningen kaller de samme
 * ressursene som DATA_FETCH-steget ville kalt, og innsendingen kjører en ekte
 * prosessøkt fra første steg til SUBMIT. Søknaden som kommer ut er den samme som
 * den stegvise flyten på :3001 lager, og revisjonsloggen ser likedan ut.
 *
 * `export {}` gjør filen til en modul, slik demo-guis sidescript gjør. Navnene
 * her bor da lokalt, mens de globale fra felles.ts - ID-porten-flyten og
 * withToken - fortsatt er synlige.
 */
export {};

const KLIENT_ID = "innbyggerportal";
const BACKEND_BASE = "http://localhost:8080";

/* --- Formene fra sandbox-backend ------------------------------------------
 *
 * Se Prosess i openapi/sandbox-backend.yaml. Wire-formatet er frosset, så
 * nøklene her er de samme som i data/prosessdefinisjoner.json.
 */

type Felttype = "tekst" | "ja-nei" | "valg";

type Alternativ = string | { verdi: string; label?: string };

type Felt = {
  id: string;
  label: string;
  type: Felttype;
  placeholder?: string;
  alternativer?: Alternativ[];
  obligatorisk?: boolean;
};

type Steg = {
  id: string;
  type: "INFO" | "QUESTION" | "CONSENT_REQUEST" | "DATA_FETCH" | "SJEKK" | "SUMMARY" | "SUBMIT";
  tittel: string;
  tekst?: string;
  felter?: Felt[];
  formaal?: string;
  dataKilder?: string[];
  kreverSamtykke?: string;
  api?: { method: string; url: string };
};

type Prosess = { id: string; navn: string; beskrivelse?: string; versjon?: string; steg: Steg[] };

type Person = {
  personId: string;
  navn: string;
  fornavn: string;
  foedselsnummerMaskert: string;
  adresse: string;
  kommune: string;
  kommunenummer: string;
};

type Hentetilstand =
  | { status: "laster" }
  | { status: "ok"; rader: Rad[]; url: string }
  | { status: "laast"; kilde: string; melding: string }
  | { status: "avhengig"; mangler: string }
  | { status: "feil"; melding: string };

type Rad = { etikett: string; verdi: string };

/* --- Småting --------------------------------------------------------------- */

function krevEl<T extends HTMLElement>(id: string): T {
  const funnet = document.getElementById(id);
  if (!funnet) throw new Error(`Fant ikke elementet #${id} i soknad.html.`);
  return funnet as T;
}

function lag<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  klasse?: string,
  tekst?: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (klasse) element.className = klasse;
  if (tekst !== undefined) element.textContent = tekst;
  return element;
}

function attributter(element: HTMLElement, verdier: Record<string, string>): HTMLElement {
  for (const [navn, verdi] of Object.entries(verdier)) element.setAttribute(navn, verdi);
  return element;
}

function avsnitt(tekst: string, storrelse = "md", variant?: string): HTMLElement {
  const element = lag("p", "ds-paragraph", tekst);
  element.setAttribute("data-size", storrelse);
  if (variant) element.setAttribute("data-variant", variant);
  return element;
}

function overskrift(tekst: string, storrelse: string, niva: "h1" | "h2" | "h3" = "h2"): HTMLElement {
  const element = lag(niva, "ds-heading", tekst);
  element.setAttribute("data-size", storrelse);
  return element;
}

function merkelapp(tekst: string, farge?: string): HTMLElement {
  const element = lag("span", "ds-tag", tekst);
  element.setAttribute("data-size", "sm");
  if (farge) element.setAttribute("data-color", farge);
  return element;
}

function kortblokk(...barn: (Node | null)[]): HTMLElement {
  const blokk = lag("div", "ds-card__block");
  for (const node of barn) if (node) blokk.append(node);
  return blokk;
}

function kroner(beloep: number): string {
  return `${beloep.toLocaleString("nb-NO")} kr`;
}

const datoformat = new Intl.DateTimeFormat("nb-NO", { dateStyle: "long", timeZone: "UTC" });

function langDato(isodato: string): string {
  return datoformat.format(new Date(`${isodato.slice(0, 10)}T00:00:00Z`));
}

function jaNei(verdi: unknown): string {
  return verdi ? "Ja" : "Nei";
}

function alternativVerdi(alternativ: Alternativ): string {
  return typeof alternativ === "string" ? alternativ : alternativ.verdi;
}

function alternativLabel(alternativ: Alternativ): string {
  return typeof alternativ === "string" ? alternativ : (alternativ.label ?? alternativ.verdi);
}

async function hentJson(url: string, init?: RequestInit): Promise<any> {
  const svar = await fetch(url, init);
  const kropp = await svar.json().catch(() => null);
  if (!svar.ok) {
    const feil: Error & { status?: number; kropp?: any } =
      new Error(kropp?.feil || `${svar.status} ${svar.statusText}`);
    feil.status = svar.status;
    feil.kropp = kropp;
    throw feil;
  }
  return kropp;
}

/* --- Opplysningene kommunen henter ------------------------------------------
 *
 * Én oppsummering per ressurs, fordi et skjema viser felter og ikke JSON. De
 * står her og ikke i backend: hvilke av opplysningene et skjema trenger å vise
 * er en beslutning om denne flaten. Ukjente ressurser faller til en generisk
 * utflating, så en ny DATA_FETCH viser noe framfor ingenting.
 */

function radeneFor(url: string, data: any): Rad[] {
  if (url.includes("/inntekt")) return inntektsrader(data);
  if (url.includes("/husstand")) return husstandsrader(data);
  if (url.includes("/kontaktinfo")) return kontaktrader(data);
  if (url.includes("/legeerklaering")) return legeerklaeringsrader(data);
  if (url.includes("/politiattest")) return politiattestrader(data);
  if (url.includes("/matrikkel/gater")) return gaterader(data);
  return generiskeRader(data);
}

function inntektsrader(data: any): Rad[] {
  const rader: Rad[] = [{ etikett: "Inntektsår", verdi: String(data.inntektsaar ?? "ukjent") }];
  for (const gruppe of data.visningsposter ?? []) {
    for (const post of gruppe.poster ?? []) {
      rader.push({ etikett: post.visningstekst ?? post.tekniskNavn, verdi: kroner(post.beloep ?? 0) });
    }
  }
  if (typeof data.beregningsbeloep === "number") {
    rader.push({ etikett: "Grunnlaget kommunen regner med", verdi: kroner(data.beregningsbeloep) });
  }
  const oppgjoer = (data.personer ?? []).find((post: any) => post.skatteoppgjoersdato);
  if (oppgjoer) {
    rader.push({ etikett: "Skatteoppgjør lagt til grunn", verdi: langDato(oppgjoer.skatteoppgjoersdato) });
  }
  return rader;
}

function husstandsrader(data: any): Rad[] {
  const medlemmer: any[] = data.medlemmer ?? [];
  return [
    { etikett: "Husstandstype", verdi: String(data.type ?? "ukjent").toLowerCase().replace(/_/g, " ") },
    { etikett: "Adresse", verdi: [data.adresse, data.kommune].filter(Boolean).join(", ") },
    { etikett: "Personer i husstanden", verdi: String(medlemmer.length) },
    {
      etikett: "Barn i husstanden",
      verdi: String(medlemmer.filter((post) => post.rolle === "barn").length)
    }
  ];
}

function kontaktrader(data: any): Rad[] {
  return [
    { etikett: "E-post", verdi: data.epost?.adresse ?? "ikke registrert" },
    { etikett: "Telefon", verdi: data.tlf?.nummer ?? "ikke registrert" },
    { etikett: "Digital post", verdi: data.reservert ? "reservert" : "aktiv" },
    { etikett: "Språk", verdi: data.spraak ?? "ikke registrert" },
    {
      etikett: "Sist bekreftet",
      verdi: data.epost?.sistVerifisert ? langDato(data.epost.sistVerifisert) : "ukjent"
    }
  ];
}

function legeerklaeringsrader(data: any): Rad[] {
  const erklaering = data.legeerklaering;
  if (!erklaering) return [{ etikett: "Legeerklæring", verdi: "ingen registrert på deg" }];
  return [
    { etikett: "Dokumenttype", verdi: erklaering.dokumenttype ?? "Legeerklæring" },
    { etikett: "Utstedt", verdi: langDato(erklaering.utstedt) },
    { etikett: "Gyldig til", verdi: langDato(erklaering.gyldigTil) },
    { etikett: "Funksjonsnedsettelse", verdi: erklaering.funksjonsnedsetting ?? "ikke oppgitt" },
    { etikett: "Varighet", verdi: erklaering.varighetAar ? `${erklaering.varighetAar} år` : "ikke oppgitt" }
  ];
}

function politiattestrader(data: any): Rad[] {
  const attest = data.politiattest;
  if (!attest) return [{ etikett: "Politiattest", verdi: "ingen registrert for dette formålet" }];
  return [
    { etikett: "Attesttype", verdi: attest.attesttype ?? "ukjent" },
    { etikett: "Formål", verdi: attest.formaal ?? "ukjent" },
    { etikett: "Utstedt", verdi: langDato(attest.utstedt) },
    { etikett: "Antall anmerkninger", verdi: String(attest.antallAnmerkninger ?? 0) }
  ];
}

function gaterader(data: any): Rad[] {
  // Ruten svarer med en liste når den treffer flere gater, og med gaten selv
  // når den treffer én. Skjemaet viser den ene, og sier fra når det er flere.
  const gater: any[] = Array.isArray(data) ? data : (data.gater ?? [data]);
  const gate = gater[0];
  if (!gate) return [{ etikett: "Gate", verdi: "ingen treff i matrikkelen" }];
  const rader: Rad[] = [
    { etikett: "Gate", verdi: gate.adressenavn ?? "ukjent" },
    { etikett: "Poststed", verdi: [gate.postnummer, gate.poststed].filter(Boolean).join(" ") },
    { etikett: "Eiendommer i gaten", verdi: String(gate.antallEiendommer ?? "ukjent") },
    { etikett: "Av dem boliger", verdi: String(gate.antallBoligeiendommer ?? "ukjent") }
  ];
  if (gater.length > 1) rader.push({ etikett: "Andre treff", verdi: `${gater.length - 1} til` });
  return rader;
}

/** Toppnivåfeltene som lar seg skrive ut. Sisteutvei for en ukjent ressurs. */
function generiskeRader(data: any): Rad[] {
  const hopp = new Set(["syntetisk", "scenario", "personId", "fnr", "identifikator"]);
  const rader: Rad[] = [];
  for (const [navn, verdi] of Object.entries(data ?? {})) {
    if (hopp.has(navn) || verdi === null || typeof verdi === "object") continue;
    rader.push({ etikett: navn, verdi: typeof verdi === "boolean" ? jaNei(verdi) : String(verdi) });
  }
  return rader.length > 0 ? rader : [{ etikett: "Svar", verdi: "hentet, men uten felter å vise" }];
}

/* --- Tilstand --------------------------------------------------------------- */

let prosess: Prosess;
let person: Person;
/** Svarene per QUESTION-steg, på formen prosessøkten vil ha dem. */
const svar: Record<string, Record<string, string>> = {};
const hentet: Record<string, Hentetilstand> = {};
/** Datakildene personen har gyldig samtykke for nå, fra tilgangsoversikten. */
let harSamtykke: string[] = [];
let sender = false;

/**
 * Samme substitusjon som replaceParametere i sandbox-backend. Den korte formen
 * `{svar.<stegId>}` gjelder bare når steget har nøyaktig ett felt, slik den gjør
 * der - med flere er den genuint tvetydig og skal stå igjen usubstituert.
 */
function fyllInnParametere(url: string): string {
  let resultat = url.replace(/\{personId\}/g, encodeURIComponent(person.personId));
  for (const [stegId, felter] of Object.entries(svar)) {
    const oppforinger = Object.entries(felter).filter(([, verdi]) => verdi !== "");
    for (const [feltId, verdi] of oppforinger) {
      resultat = resultat.replace(
        new RegExp(`\\{svar\\.${stegId}\\.${feltId}\\}`, "g"),
        encodeURIComponent(verdi)
      );
    }
    const stegdefinisjon = prosess.steg.find((post) => post.id === stegId);
    if (stegdefinisjon?.felter?.length === 1 && oppforinger.length === 1) {
      resultat = resultat.replace(
        new RegExp(`\\{svar\\.${stegId}\\}`, "g"),
        encodeURIComponent(oppforinger[0]![1])
      );
    }
  }
  return resultat;
}

const datastegene = () => prosess.steg.filter((steg) => steg.type === "DATA_FETCH" && steg.api);
const sporsmaalstegene = () => prosess.steg.filter((steg) => steg.type === "QUESTION" && steg.felter?.length);

/** Datakildene prosessen ber om samtykke til, fra dens egne CONSENT_REQUEST-steg. */
function kildenePProsessenTrenger(): string[] {
  const kilder = new Set<string>();
  for (const steg of prosess.steg) {
    if (steg.type === "CONSENT_REQUEST") for (const kilde of steg.dataKilder ?? []) kilder.add(kilde);
  }
  return [...kilder];
}

/* --- Henting ---------------------------------------------------------------- */

async function hentDatasteg(steg: Steg): Promise<void> {
  const url = fyllInnParametere(steg.api!.url);
  if (url.includes("{svar.")) {
    const mangler = prosess.steg.find(
      (post) => post.type === "QUESTION" && url.includes(`{svar.${post.id}`)
    );
    hentet[steg.id] = { status: "avhengig", mangler: mangler?.tittel ?? "et svar lenger nede" };
    return;
  }
  hentet[steg.id] = { status: "laster" };
  try {
    const data = await hentJson(`${BACKEND_BASE}${url}`, { headers: withToken() });
    hentet[steg.id] = { status: "ok", rader: radeneFor(url, data), url };
  } catch (feil) {
    const svarfeil = feil as Error & { status?: number; kropp?: any };
    if (svarfeil.status === 403 && svarfeil.kropp?.grunn === "mangler_samtykke") {
      hentet[steg.id] = {
        status: "laast",
        kilde: steg.kreverSamtykke ?? "opplysningene",
        melding: svarfeil.message
      };
      return;
    }
    hentet[steg.id] = { status: "feil", melding: svarfeil.message };
  }
}

async function hentAlleDatasteg(): Promise<void> {
  await Promise.all(datastegene().map((steg) => hentDatasteg(steg)));
}

async function lesSamtykker(): Promise<void> {
  try {
    const oversikt = await hentJson(
      `${BACKEND_BASE}/api/personer/${encodeURIComponent(person.personId)}/tilganger`,
      { headers: withToken() }
    );
    harSamtykke = oversikt.harSamtykke ?? [];
  } catch (feil) {
    harSamtykke = [];
  }
}

/* --- Tegning ---------------------------------------------------------------- */

function seksjon(nummer: number, tittel: string, undertittel?: string): HTMLElement {
  const kort = lag("section", "ds-card");
  const topp = kortblokk();
  const rad = lag("div", "seksjonstopp");
  rad.append(lag("span", "seksjonsnummer", String(nummer)));
  const tekst = lag("div", "korttittel__tekst");
  tekst.append(overskrift(tittel, "sm"));
  if (undertittel) tekst.append(avsnitt(undertittel, "sm"));
  rad.append(tekst);
  topp.append(rad);
  kort.append(topp);
  return kort;
}

function opplysningsliste(rader: Rad[]): HTMLElement {
  const liste = lag("div", "opplysninger");
  for (const rad of rader) {
    const boks = lag("div", "opplysning");
    boks.append(avsnitt(rad.etikett, "xs"));
    boks.append(lag("p", "ds-paragraph opplysning__verdi", rad.verdi));
    liste.append(boks);
  }
  return liste;
}

/**
 * Bryteren som låser opp en blokk. Den gir samtykket til datakilden, ikke til
 * søknaden, og går samme vei som bryteren på Min side: prosessen navngis, og
 * formålet hentes fra prosessens eget CONSENT_REQUEST-steg. Et samtykke gitt her
 * gjelder derfor alle saker som leser den kilden, og teksten sier det.
 */
function samtykkebryter(steg: Steg): HTMLElement {
  const kilde = steg.kreverSamtykke ?? "";
  const bryterId = `samtykke-${steg.id}`;
  const beholder = lag("div", "stablet");

  const felt = lag("div", "ds-field");
  const bryter = lag("input", "ds-input");
  attributter(bryter, { type: "checkbox", role: "switch", id: bryterId });
  bryter.checked = harSamtykke.includes(kilde);
  const etikett = lag("label", "ds-label", `Kommunen kan hente ${kilde} om meg`);
  attributter(etikett, { for: bryterId, "data-weight": "regular", "data-size": "sm" });
  felt.append(bryter, etikett);

  const feil = lag("p", "ds-validation-message");
  attributter(feil, { "data-size": "sm", "aria-live": "polite" });
  feil.hidden = true;

  bryter.addEventListener("change", async () => {
    const skalPaa = bryter.checked;
    bryter.disabled = true;
    feil.hidden = true;
    const base = `${BACKEND_BASE}/api/personer/${encodeURIComponent(person.personId)}/samtykker`;
    try {
      if (skalPaa) {
        await hentJson(base, {
          method: "POST",
          headers: withToken({ "Content-Type": "application/json" }),
          body: JSON.stringify({ prosessId: prosess.id })
        });
      } else {
        await hentJson(`${base}/${encodeURIComponent(kilde)}/trekk`, {
          method: "PUT",
          headers: withToken()
        });
      }
    } catch (svarfeil) {
      bryter.checked = !skalPaa;
      bryter.disabled = false;
      feil.textContent = `Klarte ikke å endre samtykket: ${feilmelding(svarfeil)}`;
      feil.hidden = false;
      return;
    }
    await lesSamtykker();
    await hentAlleDatasteg();
    tegnSkjema(bryterId);
  });

  beholder.append(felt, feil);
  return beholder;
}

function tegnDatasteg(steg: Steg): HTMLElement {
  const blokk = kortblokk();
  const topp = lag("div", "korttittel");
  const tilstand = hentet[steg.id] ?? { status: "laster" as const };

  const tekst = lag("div", "korttittel__tekst");
  tekst.append(overskrift(steg.tittel, "2xs", "h3"));
  // Den løste adressen når den finnes, ellers malen med plassholderen i: da er
  // det nettopp den ubesvarte plassholderen som er forklaringen.
  const vist = tilstand.status === "ok"
    ? tilstand.url
    : fyllInnParametere(steg.api!.url);
  tekst.append(avsnitt(`Hentes fra ${decodeURIComponent(vist)}`, "xs"));
  topp.append(tekst);
  const merker: Record<Hentetilstand["status"], { tekst: string; farge: string }> = {
    laster: { tekst: "Henter …", farge: "neutral" },
    ok: { tekst: "Fylt ut automatisk", farge: "success" },
    laast: { tekst: "Krever samtykke", farge: "warning" },
    avhengig: { tekst: "Venter på svar", farge: "neutral" },
    feil: { tekst: "Kunne ikke hentes", farge: "danger" }
  };
  topp.append(merkelapp(merker[tilstand.status].tekst, merker[tilstand.status].farge));
  blokk.append(topp);

  if (tilstand.status === "ok") {
    blokk.append(opplysningsliste(tilstand.rader));
  } else if (tilstand.status === "laast") {
    const laast = lag("div", "laast");
    laast.append(
      avsnitt(
        `${tilstand.melding} Skru på bryteren, så fyller kommunen ut feltene her med én gang.`,
        "sm",
        "long"
      )
    );
    laast.append(samtykkebryter(steg));
    blokk.append(laast);
  } else if (tilstand.status === "avhengig") {
    blokk.append(avsnitt(`Fylles ut når du har svart på «${tilstand.mangler}».`, "sm"));
  } else if (tilstand.status === "feil") {
    blokk.append(avsnitt(tilstand.melding, "sm", "long"));
  } else {
    blokk.append(avsnitt("Henter opplysningene …", "sm"));
  }
  return blokk;
}

function tegnFelt(steg: Steg, felt: Felt): HTMLElement {
  const feltId = `${steg.id}--${felt.id}`;
  const verdi = svar[steg.id]?.[felt.id] ?? "";
  const settVerdi = (ny: string) => {
    svar[steg.id] = { ...(svar[steg.id] ?? {}), [felt.id]: ny };
  };

  // Et endret svar kan gjøre en DATA_FETCH mulig eller ugyldig, så blokkene over
  // hentes på nytt. Bare når URL-en faktisk peker på dette steget.
  const kanskjeHentPaaNytt = async () => {
    const beroerte = datastegene().filter((post) => post.api!.url.includes(`{svar.${steg.id}`));
    if (beroerte.length === 0) return;
    await Promise.all(beroerte.map((post) => hentDatasteg(post)));
    tegnSkjema(feltId);
  };

  if (felt.type === "ja-nei" || felt.type === "valg") {
    const alternativer: Alternativ[] =
      felt.type === "ja-nei" ? ["Ja", "Nei"] : (felt.alternativer ?? []);
    const gruppe = lag("fieldset", "ds-fieldset");
    const legende = lag("legend", "ds-label", felt.label + (felt.obligatorisk ? " *" : ""));
    legende.setAttribute("data-size", "sm");
    gruppe.append(legende);
    gruppe.id = feltId;
    for (const alternativ of alternativer) {
      const radioId = `${feltId}--${alternativVerdi(alternativ)}`.replace(/\s+/g, "-");
      const rad = lag("div", "ds-field");
      const knapp = lag("input", "ds-input");
      attributter(knapp, { type: "radio", name: feltId, id: radioId, value: alternativVerdi(alternativ) });
      knapp.checked = verdi === alternativVerdi(alternativ);
      knapp.addEventListener("change", () => {
        settVerdi(alternativVerdi(alternativ));
        void kanskjeHentPaaNytt();
      });
      const etikett = lag("label", "ds-label", alternativLabel(alternativ));
      attributter(etikett, { for: radioId, "data-weight": "regular", "data-size": "sm" });
      rad.append(knapp, etikett);
      gruppe.append(rad);
    }
    return gruppe;
  }

  const felttboks = lag("div", "ds-field");
  const etikett = lag("label", "ds-label", felt.label + (felt.obligatorisk ? " *" : ""));
  attributter(etikett, { for: feltId, "data-size": "sm" });
  const inndata = lag("textarea", "ds-input");
  attributter(inndata, { id: feltId, rows: "3" });
  if (felt.placeholder) inndata.placeholder = felt.placeholder;
  inndata.value = verdi;
  inndata.addEventListener("input", () => settVerdi(inndata.value.trim()));
  inndata.addEventListener("change", () => void kanskjeHentPaaNytt());
  felttboks.append(etikett, inndata);
  return felttboks;
}

function manglendeFelter(): { feltId: string; label: string }[] {
  const mangler: { feltId: string; label: string }[] = [];
  for (const steg of sporsmaalstegene()) {
    for (const felt of steg.felter ?? []) {
      if (!felt.obligatorisk) continue;
      if (!svar[steg.id]?.[felt.id]) mangler.push({ feltId: `${steg.id}--${felt.id}`, label: felt.label });
    }
  }
  return mangler;
}

function tegnSkjema(fokusId?: string): void {
  const beholder = krevEl("skjema");
  beholder.replaceChildren();

  const intro = prosess.steg.find((steg) => steg.type === "INFO");
  const topp = lag("div", "stablet");
  // Prosessnavnet står som det er. Å sette «Søknad om» foran og senke
  // forbokstaven gjorde «SFO» til «sfo», og noen av navnene begynner alt med
  // «Søknad om». Kickeren over sier hva siden er, tittelen sier hvilken.
  topp.append(avsnitt("Søknad", "sm"));
  topp.append(overskrift(prosess.navn, "lg", "h1"));
  if (intro?.tekst) topp.append(avsnitt(intro.tekst, "md", "long"));
  topp.append(avsnitt("Felt merket med * må fylles ut.", "sm"));
  beholder.append(topp);

  let nummer = 0;

  // 1. Om deg. Folkeregisteret, ikke et felt noen fyller ut her.
  const omDeg = seksjon(++nummer, "Om deg", "Hentet fra Folkeregisteret. Endres hos Skatteetaten.");
  omDeg.append(kortblokk(opplysningsliste([
    { etikett: "Navn", verdi: person.navn },
    { etikett: "Fødselsnummer", verdi: person.foedselsnummerMaskert },
    { etikett: "Folkeregistrert adresse", verdi: person.adresse },
    { etikett: "Kommune", verdi: `${person.kommune} (${person.kommunenummer})` }
  ])));
  beholder.append(omDeg);

  // 2. Det kommunen fyller ut selv.
  const steg = datastegene();
  if (steg.length > 0) {
    const antallFylt = steg.filter((post) => hentet[post.id]?.status === "ok").length;
    const kort = seksjon(
      ++nummer,
      "Opplysninger kommunen fyller ut",
      `${antallFylt} av ${steg.length} er fylt ut. Resten krever at du sier ja under.`
    );
    for (const post of steg) kort.append(tegnDatasteg(post));
    kort.append(kortblokk(avsnitt(
      "Et samtykke gjelder datakilden, ikke søknaden. Skrur du det av igjen, gjelder det " +
      "alle saker som leser den kilden, og du kan skru det på når du vil.",
      "xs",
      "long"
    )));
    beholder.append(kort);
  }

  // 3. Det innbyggeren fyller ut.
  const sporsmaal = sporsmaalstegene();
  if (sporsmaal.length > 0) {
    const kort = seksjon(++nummer, "Det vi trenger fra deg", "Disse feltene kan bare du svare på.");
    for (const post of sporsmaal) {
      const blokk = kortblokk();
      blokk.append(overskrift(post.tittel, "2xs", "h3"));
      if (post.tekst) blokk.append(avsnitt(post.tekst, "sm"));
      const felter = lag("div", "stablet");
      for (const felt of post.felter ?? []) felter.append(tegnFelt(post, felt));
      blokk.append(felter);
      kort.append(blokk);
    }
    beholder.append(kort);
  }

  // 4. Innsending.
  beholder.append(tegnInnsending(++nummer));

  if (fokusId) document.getElementById(fokusId)?.focus();
}

function tegnInnsending(nummer: number): HTMLElement {
  const kilder = kildenePProsessenTrenger();
  const kort = seksjon(nummer, "Send søknaden", "Du får kvittering med saksnummer med én gang.");

  if (kilder.length > 0) {
    const varsel = attributter(lag("div", "ds-alert"), { "data-color": "info" });
    varsel.append(avsnitt(
      `Når du sender inn, samtykker du til at kommunen henter ${kilder.join(" og ")} for å ` +
      "behandle søknaden. Det er den samme forespørselen som står i skjemaet over.",
      "sm",
      "long"
    ));
    kort.append(kortblokk(varsel));
  }

  const feilliste = attributter(lag("div", "ds-error-summary"), { "data-color": "danger" });
  feilliste.id = "mangler";
  feilliste.hidden = true;
  kort.append(kortblokk(feilliste));

  const status = avsnitt("", "sm");
  attributter(status, { "aria-live": "polite" });
  status.id = "innsendingsstatus";

  const knapp = lag("button", "ds-button", "Send søknaden");
  attributter(knapp, { type: "button", id: "send" });
  knapp.addEventListener("click", () => void sendInn(knapp, status, feilliste));

  const avbryt = lag("a", "ds-button", "Avbryt") as HTMLAnchorElement;
  avbryt.href = "/minside";
  avbryt.setAttribute("data-variant", "secondary");

  const rad = lag("div", "knapperad");
  rad.append(knapp, avbryt);
  kort.append(kortblokk(rad, status));
  return kort;
}

/* --- Innsending -------------------------------------------------------------
 *
 * Kjører en ekte prosessøkt fra første steg til SUBMIT, med de samme kallene den
 * stegvise flyten gjør. Skjemaet er en annen inngang til den samme motoren, ikke
 * en motor til.
 */

async function sendInn(
  knapp: HTMLButtonElement,
  status: HTMLElement,
  feilliste: HTMLElement
): Promise<void> {
  if (sender) return;
  const mangler = manglendeFelter();
  feilliste.replaceChildren();
  if (mangler.length > 0) {
    feilliste.hidden = false;
    feilliste.append(overskrift("Skjemaet mangler noe", "xs", "h3"));
    const liste = lag("ul", "ds-list");
    for (const post of mangler) {
      const punkt = lag("li");
      const lenke = lag("a", "ds-link", post.label) as HTMLAnchorElement;
      lenke.href = `#${post.feltId}`;
      lenke.addEventListener("click", (hendelse) => {
        hendelse.preventDefault();
        document.getElementById(post.feltId)?.scrollIntoView({ block: "center" });
        document.getElementById(post.feltId)?.focus();
      });
      punkt.append(lenke);
      liste.append(punkt);
    }
    feilliste.append(liste);
    feilliste.focus();
    return;
  }
  feilliste.hidden = true;

  sender = true;
  knapp.disabled = true;
  const meld = (tekst: string) => {
    status.textContent = tekst;
  };
  meld("Oppretter prosessøkt …");

  try {
    const soknadId = await kjorProsessoekt(meld);
    visKvittering(soknadId);
  } catch (feil) {
    sender = false;
    knapp.disabled = false;
    meld(`Innsendingen stoppet: ${feilmelding(feil)}`);
  }
}

async function kjorProsessoekt(meld: (tekst: string) => void): Promise<string> {
  const post = (sti: string, kropp?: unknown) =>
    hentJson(`${BACKEND_BASE}${sti}`, {
      method: "POST",
      headers: withToken({ "Content-Type": "application/json" }),
      body: kropp === undefined ? undefined : JSON.stringify(kropp)
    });

  let oekt = await post("/api/prosessoekter", {
    personId: person.personId,
    prosessId: prosess.id,
    sporingsId: `skjema-${Date.now()}`
  });

  // Én runde per steg, med en øvre grense: en økt som ikke kommer videre skal
  // stoppe med en melding framfor å snurre.
  for (let runde = 0; runde < prosess.steg.length * 3; runde++) {
    const aktivt: Steg | undefined = oekt.aktivtSteg;
    if (!aktivt) break;
    meld(`${aktivt.tittel} …`);

    if (!oekt.aktivtStegFullfort) {
      if (aktivt.type === "QUESTION") {
        await post(`/api/prosessoekter/${oekt.oektsId}/svar`, {
          stegId: aktivt.id,
          svar: svar[aktivt.id] ?? {}
        });
      } else if (aktivt.type === "CONSENT_REQUEST") {
        await post(`/api/prosessoekter/${oekt.oektsId}/handling`, { handling: "opprett-samtykke" });
        await post(`/api/prosessoekter/${oekt.oektsId}/handling`, {
          handling: "samtykkesvar",
          status: "SAMTYKKET"
        });
      } else if (aktivt.type !== "INFO") {
        await post(`/api/prosessoekter/${oekt.oektsId}/handling`, {});
      }
    }

    oekt = await hentJson(`${BACKEND_BASE}/api/prosessoekter/${oekt.oektsId}`, {
      headers: withToken()
    });

    if (aktivt.type === "SUBMIT" && oekt.aktivtStegFullfort) {
      const resultat = oekt.resultater?.[aktivt.id] ?? oekt.resultaterRaa?.[aktivt.id];
      const soknadId = resultat?.soknadId;
      if (!soknadId) throw new Error("Søknaden ble sendt, men svaret bar ingen soknadId.");
      return soknadId;
    }
    if (oekt.aktivtStegFullfort) await post(`/api/prosessoekter/${oekt.oektsId}/neste`);
  }
  throw new Error("Prosessøkten kom ikke fram til innsending.");
}

function visKvittering(soknadId: string): void {
  const beholder = krevEl("skjema");
  beholder.replaceChildren();

  const kort = lag("section", "ds-card");
  kort.append(kortblokk(
    merkelapp("Sendt inn", "success"),
    overskrift("Takk, søknaden er sendt", "lg", "h1")
  ));
  kort.append(kortblokk(
    avsnitt(
      `Søknaden «${prosess.navn}» er registrert. Du finner den igjen under ` +
      "«Pågående sak» på Min side, og kvitteringen kommer i postkassen din.",
      "md",
      "long"
    ),
    opplysningsliste([
      { etikett: "Saksnummer", verdi: soknadId },
      { etikett: "Søker", verdi: person.navn },
      { etikett: "Mottatt", verdi: langDato(new Date().toISOString()) }
    ])
  ));
  const rad = lag("div", "knapperad");
  const tilMinSide = lag("a", "ds-button", "Til Min side") as HTMLAnchorElement;
  tilMinSide.href = "/minside";
  rad.append(tilMinSide);
  kort.append(kortblokk(rad));
  beholder.append(kort);
  window.scrollTo({ top: 0 });
}

/* --- Oppstart --------------------------------------------------------------- */

function visFeil(melding: string): void {
  krevEl("feiltekst").textContent = melding;
  krevEl("feil").hidden = false;
}

/*
 * Hvem er vi logget inn som? Tokenet bærer et fødselsnummer i `pid`, ikke en
 * personId, så oppslaget går via sandbox-backend på samme vis som Min side gjør
 * det: GET /api/personer svarer med nøyaktig én rad for et innbyggertoken.
 */
async function finnPersonId(pid: string): Promise<string> {
  const personer: { personId: string; syntetiskFodselsnummer: string }[] = await hentJson(
    `${BACKEND_BASE}/api/personer`,
    { headers: withToken() }
  );
  const meg = personer.find((post) => post.syntetiskFodselsnummer === pid);
  if (!meg) throw new Error(`Innlogget som ${pid}, men sandkassen kjenner ingen slik person.`);
  return meg.personId;
}

async function start(): Promise<void> {
  // Logg ut og bytt bruker er samme handling: utstederen har ingen sesjon å
  // avslutte, så veien tilbake er en ny runde gjennom velgeren på :8086.
  krevEl<HTMLButtonElement>("logg-ut").addEventListener("click", () => switchUser());

  const prosessId = new URL(window.location.href).searchParams.get("prosess");
  if (!prosessId) {
    visFeil("Adressen mangler ?prosess=<prosessId>. Gå til Min side og velg en søknad derfra.");
    return;
  }

  if (!(await requireLogin({ clientId: KLIENT_ID }))) return;
  const pid = loggedInPid();
  if (!pid) {
    visFeil("Tokenet fra ID-porten bar ingen pid. Logg inn på nytt fra forsiden.");
    return;
  }

  try {
    // Portalens egen rute, ikke en ny formatering her: den maskerer
    // fødselsnummeret og setter sammen adressen på samme måte som Min side.
    const minside = await hentJson(`/api/minside/${encodeURIComponent(await finnPersonId(pid))}`);
    person = minside.person;
    krevEl("innlogget-navn").textContent = person.navn;
    krevEl("kommunenavn").textContent = `${minside.kommune.navn} kommune`;
    krevEl<HTMLImageElement>("kommunevaapen").src = minside.kommune.vaapen;
    krevEl("bunntekst").textContent = `${minside.kommune.navn} kommune`;
  } catch (feil) {
    visFeil(`Fikk ikke tak i opplysningene dine: ${feilmelding(feil)}`);
    return;
  }

  try {
    prosess = await hentJson(`${BACKEND_BASE}/api/prosesser/${encodeURIComponent(prosessId)}`);
  } catch (feil) {
    visFeil(
      `Fant ikke søknaden «${prosessId}» i sandbox-backend: ${feilmelding(feil)}. Kjører den på :8080?`
    );
    return;
  }

  document.title = `${prosess.navn} | Stavanger kommune`;
  tegnSkjema();
  await lesSamtykker();
  await hentAlleDatasteg();
  tegnSkjema();
}

void start();
