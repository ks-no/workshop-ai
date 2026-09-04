// Sidescript for dashboard. Lastes som <script type="module">, så alt her har sitt
// eget scope - to sider kan bruke samme navn på hver sin `backendBase` uten å
// kollidere. felles.ts lastes som klassisk script foran denne, så funksjonene og
// typene derfra er globale og trenger ingen import.
export {};

renderTopNav("/");

const aiBase = "http://localhost:8082";

/*
 * Tjenestelista sto her, håndholdt, ved siden av en identisk liste i
 * utforsker.html. Denne kopien manglet digdir-mock og oppga feil docs-sti for
 * to tjenester. Nå leses begge fra /assets/tjenester.json, og
 * pnpm test:openapi krever at registeret er enig med CI-portens egen liste.
 *
 * Alt som ikke er navn, port og rolle utledes: en tjeneste med spesifikasjon
 * har /docs, /openapi.yaml og en plass i utforskeren. Da kan kolonnen ikke
 * drive fra virkeligheten igjen.
 */
function dot(klasse: string, tekst: string): DocumentFragment {
  const celle = document.createDocumentFragment();
  const flekk = document.createElement("span");
  flekk.className = klasse;
  celle.append(flekk, document.createTextNode(tekst));
  return celle;
}

function renderTjenesterad(tjeneste: Tjeneste, tabell: HTMLElement): HTMLTableCellElement {
  const base = `http://localhost:${tjeneste.port}`;
  const rad = document.createElement("tr");

  const navn = document.createElement("td");
  const kode = document.createElement("code");
  kode.textContent = tjeneste.navn;
  const rolle = document.createElement("span");
  rolle.className = "muted small";
  rolle.textContent = tjeneste.rolle;
  navn.append(kode, document.createElement("br"), rolle);

  const port = document.createElement("td");
  port.textContent = String(tjeneste.port);

  const status = document.createElement("td");
  status.append(dot("dot", "sjekker…"));

  const api = document.createElement("td");
  if (tjeneste.spesifikasjon) {
    const docs = document.createElement("a");
    docs.href = `${base}/docs`;
    docs.textContent = "/docs";
    const spek = document.createElement("a");
    spek.href = `${base}/openapi.yaml`;
    spek.textContent = "openapi.yaml";
    const utforsk = document.createElement("a");
    utforsk.href = `/utforsker?tjeneste=${encodeURIComponent(tjeneste.navn)}`;
    utforsk.textContent = "Utforsk →";
    api.append(docs, document.createTextNode(" · "), spek, document.createTextNode(" · "), utforsk);
  } else {
    const strek = document.createElement("span");
    strek.className = "muted";
    strek.textContent = "–";
    api.appendChild(strek);
  }

  rad.append(navn, port, status, api);
  tabell.appendChild(rad);
  return status;
}

async function checkTjeneste(tjeneste: Tjeneste, statusCelle: HTMLElement): Promise<void> {
  try {
    const res = await fetch(`http://localhost:${tjeneste.port}/helse`, {
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    statusCelle.replaceChildren(dot("dot opp", "oppe"));
  } catch {
    statusCelle.replaceChildren(dot("dot ned", "svarer ikke"));
  }
}

async function renderTjenester(): Promise<void> {
  const tabell = krevEl("tjenestetabell");
  // Registeret er lest fra disk og validert av pnpm test:openapi, ikke av oss.
  let tjenester: Tjeneste[];
  try {
    const svar = await fetch("/assets/tjenester.json");
    if (!svar.ok) throw new Error(`status ${svar.status}`);
    tjenester = (await svar.json()) as Tjeneste[];
  } catch (feil) {
    const rad = document.createElement("tr");
    const celle = document.createElement("td");
    celle.colSpan = 4;
    celle.append(dot("dot ned", `Klarte ikke å lese tjenesteregisteret: ${feilmelding(feil)}`));
    rad.appendChild(celle);
    tabell.appendChild(rad);
    return;
  }
  for (const tjeneste of tjenester) {
    checkTjeneste(tjeneste, renderTjenesterad(tjeneste, tabell));
  }
}

renderTjenester();

async function renderModellstatus(): Promise<void> {
  const tabell = krevEl("modellTabell");
  const data = await checkModell(aiBase, {
    konsekvens: "KI-svar i demoene blir maltekst, ikke modellgenerert."
  });

  if (!data) {
    const rad = document.createElement("tr");
    const celle = document.createElement("td");
    celle.append(dot("dot ned", "Får ikke kontakt med ai-gateway."));
    rad.appendChild(celle);
    tabell.replaceChildren(rad);
    return;
  }

  const rader = [
    ["Modell tilgjengelig", data.modellNaaBar ? "ja" : "nei"],
    ["Provider", data.provider || "ukjent"],
    ["Modell", data.modell || "–"]
  ];
  if (data.feil) {
    rader.push(["Forklaring", data.feil]);
  }

  tabell.replaceChildren();
  for (const [navn, verdi] of rader) {
    const rad = document.createElement("tr");
    const nokkel = document.createElement("th");
    nokkel.textContent = navn;
    const celle = document.createElement("td");
    if (navn === "Modell tilgjengelig") {
      celle.append(dot(`dot ${data.modellNaaBar ? "opp" : "ned"}`, verdi));
    } else {
      celle.textContent = verdi;
    }
    rad.append(nokkel, celle);
    tabell.appendChild(rad);
  }
}

renderModellstatus();
