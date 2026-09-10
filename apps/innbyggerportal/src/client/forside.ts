/*
 * Forsiden. Eneste jobb: sende innbyggeren til ID-porten, og fortelle hvem som
 * kan logge inn i sandkassen.
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

async function loggInn(knapp: HTMLButtonElement): Promise<void> {
  knapp.disabled = true;
  const opprinnelig = knapp.textContent;
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

/**
 * Hvem som kan logge inn her. Listen kommer fra ID-porten-mocken, ikke herfra:
 * aldersgrensene bor i apps/shared/handleevne.ts, og en kopi i denne filen ville
 * bare gått ut av takt.
 *
 * Alle som kan ha en elektronisk ID kan logge inn, og det er noen hundre. Ruten
 * svarer derfor med et utvalg og et antall - en fullstendig liste på en forside
 * er ikke til å lese, og velgeren i ID-porten har allerede et søkefelt.
 */
async function listTestbrukere(): Promise<void> {
  const liste = element("testbrukere");
  try {
    const svar = await fetch("/api/testbrukere");
    const data = await svar.json();
    if (!svar.ok) throw new Error(data.feil || `status ${svar.status}`);

    const brukere: { pid: string; personId: string; navn: string }[] = data.testbrukere ?? [];
    const antall: number = data.antall ?? brukere.length;
    liste.replaceChildren();
    if (brukere.length === 0) {
      const rad = document.createElement("li");
      rad.textContent = "Ingen. Står ID-porten-mocken på localhost:8086?";
      liste.append(rad);
      return;
    }
    for (const bruker of brukere) {
      const rad = document.createElement("li");
      rad.textContent = `${bruker.navn} (${bruker.personId})`;
      liste.append(rad);
    }
    element("testbrukere-antall").textContent =
      `${antall} testpersoner kan logge inn. Søk opp den du vil ha i ID-porten.`;
  } catch (feil) {
    liste.replaceChildren();
    const rad = document.createElement("li");
    rad.textContent = `Fikk ikke listen: ${feilmelding(feil)}`;
    liste.append(rad);
  }
}

// Kommer man tilbake hit med et gyldig token, er runden gjennom ID-porten
// ferdig - returveien i `state` er «/», siden det var her den startet. Da skal
// innbyggeren videre, ikke måtte trykke «Logg inn» en gang til.
if (tokenValid()) {
  location.replace("/minside");
}

for (const id of ["logg-inn", "logg-inn-topp"]) {
  const knapp = element<HTMLButtonElement>(id);
  knapp.addEventListener("click", () => {
    void loggInn(knapp);
  });
}

void listTestbrukere();
