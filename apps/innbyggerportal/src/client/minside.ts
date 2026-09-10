/*
 * Min side, tegnet i nettleseren fra /api/minside/{personId}.
 *
 * DOM-en bygges med createElement og textContent, aldri innerHTML: innholdet
 * kommer fra et API-svar, og det er konvensjonen i resten av sandkassen.
 *
 * Ingen klassenavn er funnet på. Alt som begynner med ds- står i
 * apps/shared/ds-base.css, resten er sidens eget oppsett i minside.html.
 *
 * `export {}` gjør filen til en modul, slik demo-guis sidescript gjør. Navnene
 * her bor da lokalt, mens de globale fra felles.ts - ID-porten-flyten - fortsatt
 * er synlige.
 */
export {};


type Stegstatus = "fullfoert" | "godkjent" | "paagaar" | "venter";

type Saksteg = { nummer: number; tittel: string; status: Stegstatus; statustekst: string };

type Sak = {
  saksId: string;
  prosessId: string;
  navn: string;
  enhet: string;
  status: string;
  statustekst: string;
  sistOppdatert: string;
  steg: Saksteg[];
  kilde: string;
};

type Tjeneste = {
  id: string;
  tittel: string;
  beskrivelse: string;
  merke: string | null;
  detaljer: string[];
  kilde: string;
};

type Hendelse = {
  dato: string;
  kategori: string;
  farge: string;
  tittel: string;
  detalj: string;
  kilde: string;
};

type Handling = { tekst: string; url: string | null; maal: string | null };

type Paaminnelse = {
  id: string;
  kategori: string;
  farge: string;
  tittel: string;
  dato: string | null;
  tekst: string;
  handling: Handling | null;
  lesMer: string[];
  kilde: string;
};

type Minside = {
  kommune: { nummer: string; navn: string; vaapen: string };
  person: {
    personId: string;
    navn: string;
    fornavn: string;
    foedselsnummerMaskert: string;
    foedselsdato: string | null;
    alder: number | null;
    adresse: string;
    kommune: string;
    kommunenummer: string;
    skjermet: boolean;
    adressebeskyttelse: string;
  };
  kontakt: {
    epost: string | null;
    telefon: string | null;
    reservert: boolean;
    kanVarsles: boolean;
    sistVerifisert: string | null;
  } | null;
  husstand: {
    husstandId: string;
    type: string;
    medlemmer: { personId: string; navn: string; rolle: string; alder: number | null }[];
  } | null;
  eiendom: {
    matrikkelId: string;
    gnr: number;
    bnr: number;
    adresse: string;
    bruksenhetstype: string | null;
    eierform: string | null;
    andel: number | null;
    koordinater: { lat: number; lon: number } | null;
    kilde: string;
  } | null;
  samtykker: {
    samtykkeId: string;
    formaal: string;
    dataKilder: string[];
    status: string;
    utloper: string | null;
  }[];
  paaminnelser: Paaminnelse[];
  saker: Sak[];
  tjenester: Tjeneste[];
  hendelser: Hendelse[];
};

function krevEl<T extends HTMLElement>(id: string): T {
  const funnet = document.getElementById(id);
  if (!funnet) throw new Error(`Fant ikke elementet #${id} i minside.html.`);
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

/** Et dekorativt ikon. Maskene ligger i minside.html, én per data-ikon. */
function ikon(navn: string): HTMLElement {
  const element = lag("span", "ikon");
  element.setAttribute("data-ikon", navn);
  element.setAttribute("aria-hidden", "true");
  return element;
}

function kortblokk(...barn: (Node | null)[]): HTMLElement {
  const blokk = lag("div", "ds-card__block");
  for (const node of barn) if (node) blokk.append(node);
  return blokk;
}

function avsnitt(tekst: string, storrelse = "md", variant?: string): HTMLElement {
  const element = lag("p", "ds-paragraph", tekst);
  element.setAttribute("data-size", storrelse);
  if (variant) element.setAttribute("data-variant", variant);
  return element;
}

function overskrift(tekst: string, storrelse: string, niva: "h2" | "h3" | "h4" = "h2"): HTMLElement {
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

function kildelinje(tekst: string): HTMLElement {
  return avsnitt(`Kilde: ${tekst}`, "xs");
}

// Datoene er ISO uten klokkeslett, og Date leser dem som UTC-midnatt. Uten
// timeZone her ville en formatering vest for Greenwich vise dagen før.
const ukedagsformat = new Intl.DateTimeFormat("nb-NO", { weekday: "short", timeZone: "UTC" });
const dagsformat = new Intl.DateTimeFormat("nb-NO", { day: "numeric", timeZone: "UTC" });
const maanedsformat = new Intl.DateTimeFormat("nb-NO", {
  month: "long",
  year: "numeric",
  timeZone: "UTC"
});
const datoformat = new Intl.DateTimeFormat("nb-NO", { dateStyle: "long", timeZone: "UTC" });

function storForbokstav(tekst: string): string {
  return tekst.charAt(0).toUpperCase() + tekst.slice(1);
}

function ukedag(isodato: string): string {
  return ukedagsformat.format(new Date(`${isodato}T00:00:00Z`)).replace(".", "").toUpperCase();
}

function dagIMaaneden(isodato: string): string {
  // nb-NO skriver ordenstall med punktum. Datoboksen har bare plass til tallet.
  return dagsformat.format(new Date(`${isodato}T00:00:00Z`)).replace(".", "");
}

function langDato(isodato: string): string {
  return datoformat.format(new Date(`${isodato}T00:00:00Z`));
}

function maaned(isodato: string): string {
  return storForbokstav(maanedsformat.format(new Date(`${isodato}T00:00:00Z`)));
}

function opplysning(etikett: string, verdi: string): HTMLElement {
  const rad = lag("div", "opplysning");
  rad.append(avsnitt(etikett, "sm"));
  const sterk = lag("strong", undefined, verdi);
  const boks = avsnitt("", "sm");
  boks.textContent = "";
  boks.append(sterk);
  rad.append(boks);
  return rad;
}

/* Toppfelt og bunnfelt */

function tegnKommune(minside: Minside): void {
  const vaapen = krevEl<HTMLImageElement>("kommunevaapen");
  vaapen.src = minside.kommune.vaapen;
  vaapen.alt = `${minside.kommune.navn} kommunes våpen`;
  krevEl("kommunenavn").textContent = `${minside.kommune.navn} kommune`;
  krevEl("bunntekst").textContent = `${minside.kommune.navn} kommune, syntetisk demo`;
}

/* Aktuelt for deg */

/**
 * Karusellen øverst. Én påminnelse om gangen, med teller og piler, slik skissen
 * viser den. Bare den synlige ligger i DOM-en, så en skjermleser leser ikke opp
 * tre påminnelser når det står «1 av 3»; bytte annonseres av aria-live.
 */
function tegnAktuelt(minside: Minside): void {
  const seksjon = krevEl("aktuelt");
  seksjon.replaceChildren();

  if (minside.paaminnelser.length === 0) {
    seksjon.hidden = true;
    return;
  }
  seksjon.hidden = false;

  let indeks = 0;
  let visLesMer = false;

  const topp = lag("div", "aktuelt__topp");
  const merke = lag("span", "aktuelt__merke");
  merke.append(ikon("varsel"));
  merke.append(document.createTextNode("Aktuelt for deg"));
  const kategori = lag("p", "ds-paragraph aktuelt__kategori");
  kategori.setAttribute("data-size", "sm");
  const lukk = attributter(lag("button", "aktuelt__lukk"), {
    type: "button",
    "aria-label": "Lukk påminnelsene"
  });
  lukk.append(ikon("lukk"));
  lukk.addEventListener("click", () => {
    seksjon.hidden = true;
  });
  topp.append(merke, kategori, lukk);

  const innhold = attributter(lag("div", "stablet"), { "aria-live": "polite" });
  const tittel = overskrift("", "sm");
  tittel.id = "aktuelt-tittel";
  const tekst = avsnitt("", "md", "long");
  const lesMerListe = lag("ul", "ds-list");
  lesMerListe.hidden = true;
  const kilde = kildelinje("");
  kilde.hidden = true;
  innhold.append(tittel, tekst, lesMerListe, kilde);

  const bunn = lag("div", "aktuelt__bunn");
  const handlinger = lag("div", "aktuelt__handlinger");
  const teller = lag("div", "aktuelt__teller");
  const tellertekst = lag("span", undefined, "");
  const blaing = lag("div", "aktuelt__blaing");
  const forrige = attributter(lag("button"), {
    type: "button",
    "aria-label": "Forrige påminnelse"
  });
  forrige.append(ikon("forrige"));
  const neste = attributter(lag("button"), { type: "button", "aria-label": "Neste påminnelse" });
  neste.append(ikon("neste"));
  blaing.append(forrige, neste);
  teller.append(tellertekst, blaing);
  bunn.append(handlinger, teller);

  seksjon.append(topp, innhold, bunn);

  const tegn = () => {
    const paaminnelse = minside.paaminnelser[indeks];
    if (!paaminnelse) return;

    seksjon.setAttribute("data-farge", paaminnelse.farge);
    kategori.textContent = paaminnelse.kategori;
    tittel.textContent = paaminnelse.dato
      ? `${paaminnelse.tittel} ${langDato(paaminnelse.dato)}`
      : paaminnelse.tittel;
    tekst.textContent = paaminnelse.tekst;

    handlinger.replaceChildren();
    if (paaminnelse.handling) handlinger.append(tegnHandling(paaminnelse.handling));
    if (paaminnelse.lesMer.length > 0) {
      const knapp = attributter(lag("button", "ds-link", visLesMer ? "Vis mindre" : "Les mer"), {
        type: "button",
        "aria-expanded": String(visLesMer),
        "aria-controls": "aktuelt-les-mer"
      });
      knapp.addEventListener("click", () => {
        visLesMer = !visLesMer;
        tegn();
      });
      handlinger.append(knapp);
    }

    lesMerListe.id = "aktuelt-les-mer";
    lesMerListe.replaceChildren();
    lesMerListe.hidden = !visLesMer || paaminnelse.lesMer.length === 0;
    if (!lesMerListe.hidden) {
      for (const linje of paaminnelse.lesMer) lesMerListe.append(lag("li", undefined, linje));
    }
    kilde.textContent = `Kilde: ${paaminnelse.kilde}`;
    kilde.hidden = lesMerListe.hidden;

    tellertekst.textContent = `${indeks + 1} av ${minside.paaminnelser.length}`;
    blaing.hidden = minside.paaminnelser.length < 2;
    (forrige as HTMLButtonElement).disabled = indeks === 0;
    (neste as HTMLButtonElement).disabled = indeks === minside.paaminnelser.length - 1;
  };

  for (const [knapp, retning] of [
    [forrige, -1],
    [neste, 1]
  ] as const) {
    knapp.addEventListener("click", () => {
      indeks = Math.min(Math.max(indeks + retning, 0), minside.paaminnelser.length - 1);
      visLesMer = false;
      tegn();
    });
  }

  tegn();
}

function tegnHandling(handling: Handling): HTMLElement {
  if (handling.url) {
    const lenke = lag("a", "ds-button", handling.tekst) as HTMLAnchorElement;
    lenke.href = handling.url;
    lenke.rel = "noopener";
    lenke.append(ikon("pil"));
    return lenke;
  }
  const knapp = attributter(lag("button", "ds-button", handling.tekst), { type: "button" });
  knapp.append(ikon("pil"));
  knapp.addEventListener("click", () => gaaTil(handling.maal));
  return knapp;
}

/** Hopper til kortet lenger nede som svarer på påminnelsen, og åpner det. */
function gaaTil(maal: string | null): void {
  if (maal === "samtykker") {
    const knapp = document.getElementById("knapp-samtykker");
    const panel = document.getElementById("panel-samtykker");
    if (knapp && panel?.hidden) knapp.click();
    panel?.scrollIntoView({ block: "center" });
    return;
  }
  if (maal === "postkasse") {
    const rad = document.getElementById("tjeneste-postkasse");
    if (rad instanceof HTMLDetailsElement) rad.open = true;
    rad?.scrollIntoView({ block: "center" });
    return;
  }
  document.getElementById(maal || "")?.scrollIntoView({ block: "start" });
}

/* Profilkortet */

function tegnProfil(minside: Minside): void {
  const kort = krevEl("profil");
  kort.replaceChildren();

  const person = minside.person;

  const topp = kortblokk();
  topp.append(merkelapp("Innlogget via ID-porten", "neutral"));
  const tittel = overskrift(`Hei, ${person.fornavn}!`, "lg");
  tittel.id = "profil-tittel";
  topp.append(tittel);
  topp.append(overskrift("Min profil", "2xs", "h3"));
  kort.append(topp);

  const opplysninger = kortblokk();
  opplysninger.append(opplysning("Folkeregistrert adresse", person.adresse));
  opplysninger.append(opplysning("Kommune", `${person.kommune} (${person.kommunenummer})`));
  opplysninger.append(opplysning("Fødselsnummer", person.foedselsnummerMaskert));
  if (person.alder !== null) {
    opplysninger.append(opplysning("Alder", `${person.alder} år`));
  }
  if (minside.husstand) {
    const barn = minside.husstand.medlemmer.filter((medlem) => medlem.rolle === "barn");
    opplysninger.append(
      opplysning(
        "Husstand",
        barn.length === 0
          ? "Ingen barn registrert"
          : barn.map((medlem) => `${medlem.navn} (${medlem.alder} år)`).join(", ")
      )
    );
  }
  if (person.skjermet) {
    const varsel = attributter(lag("div", "ds-alert"), { "data-color": "warning" });
    varsel.append(
      avsnitt(
        `Adressen er beskyttet (${person.adressebeskyttelse}). Feltene over er maskert av apps/shared/skjerming.ts.`,
        "sm"
      )
    );
    opplysninger.append(varsel);
  }
  kort.append(opplysninger);

  if (minside.eiendom) {
    const eiendom = minside.eiendom;
    const boks = lag("div", "eiendomsboks");
    const flate = lag("span", "ikonflate");
    flate.append(ikon("eiendomsboks"));
    boks.append(flate);

    const innhold = lag("div", "eiendomsboks__innhold");
    const rad = lag("div", "eiendomsboks__topp");
    rad.append(merkelapp("Fast eiendom", "support1"));
    if (eiendom.koordinater) {
      const lenke = lag(
        "a",
        "ds-link",
        "Se i kart"
      ) as HTMLAnchorElement;
      lenke.href = `https://www.openstreetmap.org/?mlat=${eiendom.koordinater.lat}&mlon=${eiendom.koordinater.lon}#map=18/${eiendom.koordinater.lat}/${eiendom.koordinater.lon}`;
      lenke.rel = "noopener";
      lenke.target = "_blank";
      lenke.setAttribute("data-size", "sm");
      rad.append(lenke);
    }
    innhold.append(rad);
    innhold.append(
      overskrift(
        `Gnr ${eiendom.gnr}, bnr ${eiendom.bnr} - ${eiendom.bruksenhetstype ?? "ukjent type"}`,
        "xs",
        "h3"
      )
    );
    innhold.append(
      avsnitt(
        `${eiendom.adresse}. ${eiendom.eierform ? `Tinglyst som ${eiendom.eierform.toLowerCase()}, andel ${eiendom.andel}.` : "Ingen tinglyst eier i sandkassen."}`,
        "sm",
        "long"
      )
    );
    innhold.append(avsnitt(`Matrikkel-id ${eiendom.matrikkelId}`, "xs"));
    boks.append(innhold);
    kort.append(kortblokk(boks));
  }

  kort.append(kortblokk(tegnProfilknapper(minside)));
  kort.append(kortblokk(kildelinje("data/personer.json, data/husstander.json og data/matrikkel.json")));
}

function tegnProfilknapper(minside: Minside): HTMLElement {
  const beholder = lag("div", "stablet");

  const rad = lag("div", "knapperad");
  const endre = attributter(lag("button", "ds-button", "Endre opplysninger"), {
    type: "button",
    "data-variant": "secondary",
    "aria-expanded": "false",
    "aria-controls": "panel-endre"
  });
  const samtykker = attributter(lag("button", "ds-button", "Samtykker og varsler"), {
    type: "button",
    id: "knapp-samtykker",
    "aria-expanded": "false",
    "aria-controls": "panel-samtykker"
  });
  rad.append(endre, samtykker);
  beholder.append(rad);

  const panelEndre = lag("div", "stablet");
  panelEndre.id = "panel-endre";
  panelEndre.hidden = true;
  panelEndre.append(
    avsnitt(
      "Kommunen eier ingen av disse opplysningene. Hver av dem endres hos registeret som fører den, og oppdateringen slår inn her når registeret svarer.",
      "sm",
      "long"
    )
  );
  const registerliste = lag("ul", "ds-list");
  for (const linje of [
    "Navn, adresse og familie: Folkeregisteret hos Skatteetaten",
    "E-post og telefon: Kontakt- og reservasjonsregisteret",
    "Eiendom og eierforhold: Matrikkelen og grunnboken hos Kartverket"
  ]) {
    registerliste.append(lag("li", undefined, linje));
  }
  panelEndre.append(registerliste);
  beholder.append(panelEndre);

  const panelSamtykker = lag("div", "stablet");
  panelSamtykker.id = "panel-samtykker";
  panelSamtykker.hidden = true;
  const kontakt = minside.kontakt;
  panelSamtykker.append(
    avsnitt(
      kontakt
        ? kontakt.reservert
          ? "Du er reservert mot digital kommunikasjon. Kommunen sender på papir."
          : `Kommunen varsler deg på ${[kontakt.epost, kontakt.telefon].filter(Boolean).join(" og ")}.`
        : "Ingen kontaktopplysninger er registrert.",
      "sm",
      "long"
    )
  );
  if (minside.samtykker.length === 0) {
    panelSamtykker.append(avsnitt("Du har ingen aktive samtykker.", "sm"));
  } else {
    const liste = lag("ul", "ds-list");
    for (const samtykke of minside.samtykker) {
      liste.append(
        lag(
          "li",
          undefined,
          `${samtykke.formaal} (${samtykke.dataKilder.join(", ")}) - ${samtykke.status.toLowerCase()}${samtykke.utloper ? `, utløper ${langDato(samtykke.utloper)}` : ""}`
        )
      );
    }
    panelSamtykker.append(liste);
  }
  panelSamtykker.append(kildelinje("data/krr.json og state/samtykker.json"));
  beholder.append(panelSamtykker);

  for (const [knapp, panel] of [
    [endre, panelEndre],
    [samtykker, panelSamtykker]
  ] as const) {
    knapp.addEventListener("click", () => {
      const skalVises = panel.hidden;
      panel.hidden = !skalVises;
      knapp.setAttribute("aria-expanded", String(skalVises));
    });
  }

  return beholder;
}

/* Sakskortene */

function tegnSaker(minside: Minside): void {
  const beholder = krevEl("saker");
  beholder.replaceChildren();

  if (minside.saker.length === 0) {
    const kort = lag("section", "ds-card");
    kort.append(kortblokk(merkelapp("Ingen pågående sak", "neutral"), overskrift("Status", "sm")));
    kort.append(
      kortblokk(
        avsnitt(
          `${minside.person.fornavn} har ingen påbegynte eller innsendte søknader i sandkassen. Kjør en prosess i demo-GUI-et, så dukker saken opp her.`,
          "sm",
          "long"
        )
      )
    );
    kort.append(kortblokk(kildelinje("state/soknader.json og state/prosessoekter.json")));
    beholder.append(kort);
    return;
  }

  for (const sak of minside.saker) {
    beholder.append(tegnSak(sak));
  }
}

function tegnSak(sak: Sak): HTMLElement {
  const kort = lag("section", "ds-card");

  const topp = kortblokk();
  const rad = lag("div", "korttittel");
  const tekst = lag("div", "korttittel__tekst");
  tekst.append(merkelapp("Pågående sak", "neutral"));
  tekst.append(overskrift(sak.navn, "sm"));
  rad.append(tekst);
  rad.append(merkelapp(sak.statustekst, sak.status === "AKTIV" ? "success" : "neutral"));
  topp.append(rad);
  kort.append(topp);

  const detaljer = kortblokk();
  detaljer.append(avsnitt(`Sak ${sak.saksId}`, "sm"));
  detaljer.append(avsnitt(`${sak.enhet}. Sist oppdatert ${langDato(sak.sistOppdatert.slice(0, 10))}.`, "xs"));
  kort.append(detaljer);

  const stigen = kortblokk();
  const liste = lag("ol", "stablet");
  liste.style.listStyle = "none";
  liste.style.margin = "0";
  liste.style.padding = "0";
  for (const steg of sak.steg) {
    const rad = lag("li", "steg");
    rad.setAttribute("data-status", steg.status);

    const merke = lag("span", "steg__merke");
    merke.setAttribute("data-status", steg.status);
    if (steg.status === "fullfoert" || steg.status === "godkjent") {
      merke.append(ikon("sjekk"));
    } else {
      merke.append(document.createTextNode(String(steg.nummer)));
    }
    rad.append(merke);

    const stegtittel = avsnitt(`${steg.nummer}. ${steg.tittel}`, "sm");
    stegtittel.classList.add("steg__tittel");
    rad.append(stegtittel);
    rad.append(merkelapp(steg.statustekst, statusfarge(steg.status)));
    liste.append(rad);
  }
  stigen.append(liste);
  kort.append(stigen);

  const ferdige = sak.steg.filter((steg) => steg.status !== "venter" && steg.status !== "paagaar").length;
  kort.append(
    kortblokk(
      avsnitt(`${ferdige} av ${sak.steg.length} steg er ferdige.`, "sm"),
      kildelinje(sak.kilde)
    )
  );
  return kort;
}

function statusfarge(status: Stegstatus): string {
  if (status === "godkjent" || status === "fullfoert") return "success";
  if (status === "paagaar") return "info";
  return "neutral";
}

/* Tjenestelisten */

function tegnTjenester(minside: Minside): void {
  const kort = krevEl("tjenester");
  kort.replaceChildren();

  const topp = kortblokk();
  const rad = lag("div", "korttittel");
  const tekst = lag("div", "korttittel__tekst");
  const tittel = overskrift("Tjenester", "sm");
  tittel.id = "tjenester-tittel";
  tekst.append(tittel);
  tekst.append(avsnitt("Dine snarveier til kommunale skjema og selvbetjening", "sm"));
  rad.append(tekst);
  const antallMedInnhold = minside.tjenester.filter((tjeneste) => tjeneste.detaljer.length > 0).length;
  rad.append(lag("span", "ds-chip", `${antallMedInnhold} av ${minside.tjenester.length} har innhold`));
  topp.append(rad);
  kort.append(topp);

  const blokk = kortblokk();
  for (const tjeneste of minside.tjenester) {
    blokk.append(tegnTjeneste(tjeneste));
  }
  kort.append(blokk);
  kort.append(kortblokk(kildelinje("state/ og data/, se hver rad")));
}

function tegnTjeneste(tjeneste: Tjeneste): HTMLElement {
  const detaljer = lag("details", "ds-details tjeneste");
  detaljer.id = `tjeneste-${tjeneste.id}`;
  detaljer.setAttribute("data-variant", "default");

  const sammendrag = lag("summary");
  const flate = lag("span", "ikonflate");
  flate.append(ikon(tjeneste.id));
  sammendrag.append(flate);

  const tekst = lag("div", "tjeneste__tekst");
  const topp = lag("div", "tjeneste__topp");
  topp.append(overskrift(tjeneste.tittel, "2xs", "h3"));
  if (tjeneste.merke) topp.append(merkelapp(tjeneste.merke, "info"));
  tekst.append(topp);
  tekst.append(avsnitt(tjeneste.beskrivelse, "sm"));
  sammendrag.append(tekst);
  detaljer.append(sammendrag);

  if (tjeneste.detaljer.length === 0) {
    detaljer.append(avsnitt("Ingenting registrert på deg her.", "sm"));
  } else {
    const liste = lag("ul", "ds-list");
    for (const linje of tjeneste.detaljer) liste.append(lag("li", undefined, linje));
    detaljer.append(liste);
  }
  detaljer.append(kildelinje(tjeneste.kilde));
  return detaljer;
}

/* Kalenderen */

const SYNLIGE_HENDELSER = 4;

function tegnKalender(minside: Minside): void {
  const kort = krevEl("kalender");
  kort.replaceChildren();

  const topp = kortblokk();
  const rad = lag("div", "korttittel");
  const venstre = lag("div", "tjeneste__topp");
  const flate = lag("span", "ikonflate");
  flate.append(ikon("kalender"));
  venstre.append(flate);
  const tekst = lag("div", "korttittel__tekst");
  const tittel = overskrift("Kalender og viktige hendelser", "sm");
  tittel.id = "kalender-tittel";
  tekst.append(tittel);
  tekst.append(avsnitt("Frister og datoer som allerede står i dine data", "sm"));
  venstre.append(tekst);
  rad.append(venstre);
  const foerste = minside.hendelser[0];
  if (foerste) rad.append(merkelapp(maaned(foerste.dato), "neutral"));
  topp.append(rad);
  kort.append(topp);

  const blokk = kortblokk();
  const rutenett = lag("div", "hendelser");
  blokk.append(rutenett);
  kort.append(blokk);

  const idag = new Date().toISOString().slice(0, 10);
  let visAlle = false;

  const tegnRutene = () => {
    rutenett.replaceChildren();
    const synlige = visAlle ? minside.hendelser : minside.hendelser.slice(0, SYNLIGE_HENDELSER);
    for (const hendelse of synlige) {
      rutenett.append(tegnHendelse(hendelse, hendelse.dato < idag));
    }
  };
  tegnRutene();

  const bunn = kortblokk();
  const bunnrad = lag("div", "korttittel");
  bunnrad.append(
    avsnitt(
      "Sandkassen har ingen datoer for renovasjon, feiing eller eiendomsskatt, så de står ikke her.",
      "xs"
    )
  );
  if (minside.hendelser.length > SYNLIGE_HENDELSER) {
    const knapp = attributter(
      lag("button", "ds-button", `Vis alle ${minside.hendelser.length} hendelser`),
      { type: "button", "data-variant": "tertiary", "data-size": "sm" }
    );
    knapp.addEventListener("click", () => {
      visAlle = !visAlle;
      knapp.textContent = visAlle
        ? "Vis færre hendelser"
        : `Vis alle ${minside.hendelser.length} hendelser`;
      tegnRutene();
    });
    bunnrad.append(knapp);
  }
  bunn.append(bunnrad);
  kort.append(bunn);
}

function tegnHendelse(hendelse: Hendelse, passert: boolean): HTMLElement {
  const rute = lag("div", "hendelse");
  rute.setAttribute("data-passert", passert ? "ja" : "nei");

  const dato = lag("div", "datoboks");
  dato.append(avsnitt(ukedag(hendelse.dato), "xs"));
  dato.append(overskrift(dagIMaaneden(hendelse.dato), "xs", "h4"));
  rute.append(dato);

  const tekst = lag("div", "hendelse__tekst");
  const topp = lag("div", "tjeneste__topp");
  topp.append(merkelapp(hendelse.kategori, hendelse.farge === "neutral" ? "neutral" : hendelse.farge));
  if (passert) topp.append(merkelapp("Passert", "neutral"));
  tekst.append(topp);
  tekst.append(overskrift(hendelse.tittel, "2xs", "h3"));
  tekst.append(avsnitt(`${langDato(hendelse.dato)}. ${hendelse.detalj}`, "xs", "long"));
  rute.append(tekst);
  return rute;
}

/* Oppstart */

const KLIENT_ID = "innbyggerportal";

function visFeil(melding: string): void {
  const boks = krevEl("feil");
  krevEl("feiltekst").textContent = melding;
  boks.hidden = false;
}

function skjulFeil(): void {
  krevEl("feil").hidden = true;
}

/**
 * Siden er stengt for denne innloggede. Kortene skjules, og i stedet står det
 * hvorfor, med veien videre. Brukes både når personen bor i en annen kommune og
 * når fødselsnummeret ikke finnes i befolkningen.
 */
function visSperre(tittel: string, forklaring: string): void {
  krevEl("kolonner").hidden = true;
  const kort = krevEl("sperre");
  kort.hidden = false;
  kort.replaceChildren();
  kort.append(kortblokk(overskrift(tittel, "sm")));
  kort.append(kortblokk(avsnitt(forklaring, "md", "long")));

  const rad = lag("div", "knapperad");
  const bytt = attributter(lag("button", "ds-button", "Logg inn som en annen"), { type: "button" });
  bytt.addEventListener("click", () => {
    logOut();
    location.assign("/");
  });
  const forside = lag("a", "ds-button", "Til forsiden") as HTMLAnchorElement;
  forside.href = "/";
  forside.setAttribute("data-variant", "secondary");
  rad.append(bytt, forside);
  kort.append(kortblokk(rad));
}

/** Feilen bærer med seg både status og svarkroppen: en 403 herfra sier hvem den
 * innloggede er, og det skal fram i toppfeltet framfor å gå tapt i en streng. */
type Svarfeil = Error & { status?: number; kropp?: any };

async function hentJson(url: string): Promise<any> {
  const svar = await fetch(url);
  const kropp = await svar.json().catch(() => null);
  if (!svar.ok) {
    const feil: Svarfeil = new Error(kropp?.feil || `${svar.status} ${svar.statusText}`);
    feil.status = svar.status;
    feil.kropp = kropp;
    throw feil;
  }
  return kropp;
}

function tegnInnlogget(minside: Minside): void {
  krevEl("innlogget-navn").textContent = minside.person.navn;
}

async function visInnbygger(pid: string): Promise<void> {
  const hoved = krevEl("hovedinnhold");
  hoved.setAttribute("aria-busy", "true");
  try {
    const minside: Minside = await hentJson(`/api/minside/pid/${encodeURIComponent(pid)}`);
    skjulFeil();
    tegnKommune(minside);
    tegnInnlogget(minside);
    tegnAktuelt(minside);
    tegnProfil(minside);
    tegnSaker(minside);
    tegnTjenester(minside);
    tegnKalender(minside);
    document.title = `Min side for ${minside.person.navn} | ${minside.kommune.navn} kommune`;
  } catch (feil) {
    const svarfeil = feil as Svarfeil;
    const melding = feil instanceof Error ? feil.message : String(feil);
    if (svarfeil.status === 403 || svarfeil.status === 404) {
      krevEl("innlogget-navn").textContent = svarfeil.kropp?.navn || "ukjent person";
      visSperre(
        svarfeil.status === 403
          ? "Du hører til en annen kommune"
          : "Vi fant deg ikke i folkeregisteret",
        `${melding} Min side her viser bare opplysninger for innbyggere i denne kommunen.`
      );
      return;
    }
    visFeil(`Klarte ikke å hente Min side: ${melding}`);
  } finally {
    hoved.setAttribute("aria-busy", "false");
  }
}

async function start(): Promise<void> {
  // Kobles opp før innloggingen, ikke etter: knappen skal virke også når siden
  // ender på sperren og aldri tegner et profilkort.
  krevEl<HTMLButtonElement>("logg-ut").addEventListener("click", () => {
    logOut();
    location.assign("/");
  });

  // Ingen personvelger å falle tilbake på: uten gyldig token vet siden ikke hvem
  // den er for, og da hører innbyggeren hjemme på forsiden.
  if (!(await requireLogin({ clientId: KLIENT_ID }))) return;

  const pid = loggedInPid();
  if (!pid) {
    visFeil("Tokenet fra ID-porten bar ingen pid. Logg inn på nytt fra forsiden.");
    return;
  }
  await visInnbygger(pid);
}

void start();
