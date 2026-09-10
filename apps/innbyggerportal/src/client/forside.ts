/*
 * Forsiden. Tre jobber: sende innbyggeren til ID-porten, vise hvem som kan logge
 * inn i sandkassen, og holde de to visningsvalgene i toppfeltet.
 *
 * `export {}` gjør filen til en modul, slik demo-guis sidescript gjør. Da bor
 * navnene her lokalt, mens de globale funksjonene fra felles.ts - requireLogin
 * og resten av ID-porten-flyten - fortsatt er synlige. Innloggingen finnes ett
 * sted, i apps/shared/client/felles.ts, og denne siden er den andre kalleren.
 */
export {};

const KLIENT_ID = "innbyggerportal";

function element<T extends HTMLElement>(id: string): T {
  const funnet = document.getElementById(id);
  if (!funnet) throw new Error(`Fant ikke elementet #${id} i forside.html.`);
  return funnet as T;
}

function visFeil(melding: string): void {
  const boks = element("feil");
  boks.textContent = melding;
  boks.hidden = false;
}

/* --- Visningsvalg -----------------------------------------------------------
 *
 * Begge lagres i sessionStorage og leses av det korte skriptet i <head> på hver
 * side, før første maling. Fargemodusen er designsystemets eget attributt, så
 * valget slår gjennom på Min side også, uten en linje ekstra der.
 */

type Visningsvalg = {
  knappId: string;
  attributt: string;
  noekkel: string;
  paa: string;
  merkelapper: { paa: string; av: string };
};

const VISNINGSVALG: Visningsvalg[] = [
  {
    knappId: "tema",
    attributt: "data-color-scheme",
    noekkel: "sk-tema",
    paa: "dark",
    merkelapper: { paa: "Skru av mørk modus", av: "Skru på mørk modus" }
  },
  {
    knappId: "tekst",
    attributt: "data-tekst",
    noekkel: "sk-tekst",
    paa: "stor",
    merkelapper: { paa: "Vanlig tekststørrelse", av: "Større tekst" }
  }
];

function lagre(noekkel: string, verdi: string | null): void {
  try {
    if (verdi === null) sessionStorage.removeItem(noekkel);
    else sessionStorage.setItem(noekkel, verdi);
  } catch (feil) {
    /* Privat vindu uten sessionStorage. Valget gjelder da bare denne siden. */
  }
}

function koblePaaVisningsvalg(): void {
  for (const valg of VISNINGSVALG) {
    const knapp = element<HTMLButtonElement>(valg.knappId);
    const tegn = () => {
      const aktiv = document.documentElement.getAttribute(valg.attributt) === valg.paa;
      knapp.setAttribute("aria-pressed", String(aktiv));
      knapp.setAttribute("aria-label", aktiv ? valg.merkelapper.paa : valg.merkelapper.av);
    };
    tegn();
    knapp.addEventListener("click", () => {
      const aktiv = document.documentElement.getAttribute(valg.attributt) === valg.paa;
      if (aktiv) {
        document.documentElement.removeAttribute(valg.attributt);
        lagre(valg.noekkel, null);
      } else {
        document.documentElement.setAttribute(valg.attributt, valg.paa);
        lagre(valg.noekkel, valg.paa);
      }
      tegn();
    });
  }
}

/* --- Innlogging ------------------------------------------------------------- */

async function loggInn(knapp: HTMLButtonElement): Promise<void> {
  const opprinnelig = knapp.textContent;
  knapp.disabled = true;
  knapp.textContent = "Sender deg til ID-porten …";
  try {
    // requireLogin navigerer selv. Kommer vi tilbake hit, er det fordi et
    // gyldig token alt lå i fanen - da er innbyggeren logget inn fra før.
    if (await requireLogin({ clientId: KLIENT_ID })) {
      location.assign("/minside");
    }
  } catch (feil) {
    knapp.disabled = false;
    knapp.textContent = opprinnelig;
    visFeil(
      `Fikk ikke startet innloggingen: ${feilmelding(feil)}. Kjører ID-porten-mocken på localhost:8086?`
    );
  }
}

/* --- Testpersonene ----------------------------------------------------------
 *
 * Listen kommer fra ID-porten-mocken, ikke herfra: aldersgrensene bor i
 * apps/shared/handleevne.ts, og en kopi i denne filen ville bare gått ut av takt.
 */

function tegnKort(tittel: string, tekst: string): HTMLElement {
  const kort = document.createElement("div");
  kort.className = "kort";
  const overskrift = document.createElement("h3");
  overskrift.textContent = tittel;
  const avsnitt = document.createElement("p");
  avsnitt.textContent = tekst;
  kort.append(overskrift, avsnitt);
  return kort;
}

async function listTestbrukere(): Promise<void> {
  const rad = element("testbrukere");
  try {
    const svar = await fetch("/api/testbrukere");
    const data = await svar.json();
    if (!svar.ok) throw new Error(data.feil || `status ${svar.status}`);

    const brukere: { pid: string; personId: string; navn: string }[] = data.testbrukere ?? [];
    rad.replaceChildren();
    if (brukere.length === 0) {
      rad.append(
        tegnKort("Ingen testpersoner", "Står ID-porten-mocken på localhost:8086?")
      );
      return;
    }
    for (const bruker of brukere) {
      rad.append(tegnKort(bruker.navn, `${bruker.personId} · fødselsnummer ${bruker.pid}`));
    }
  } catch (feil) {
    rad.replaceChildren();
    rad.append(tegnKort("Fikk ikke listen", feilmelding(feil)));
  }
}

/* --- Oppstart --------------------------------------------------------------- */

koblePaaVisningsvalg();

for (const id of ["logg-inn", "logg-inn-topp"]) {
  const knapp = element<HTMLButtonElement>(id);
  knapp.addEventListener("click", () => {
    void loggInn(knapp);
  });
}

element("melding-fot").textContent = `Sist oppdatert ${new Intl.DateTimeFormat("nb-NO", {
  dateStyle: "long"
}).format(new Date())}.`;

void listTestbrukere();
