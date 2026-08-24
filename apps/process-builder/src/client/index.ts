// Sidescript for index. Lastes som <script type="module">, så alt her har sitt
// eget scope — to sider kan bruke samme navn på hver sin `backendBase` uten å
// kollidere. felles.ts lastes som klassisk script foran denne, så funksjonene og
// typene derfra er globale og trenger ingen import.
export {};

const prosessListe = krevEl("prosesser");
const detaljer = krevEl("detaljer");
const status = krevEl("status");
const prosessId = krevEl<HTMLInputElement>("prosessId");
const prosessNavn = krevEl<HTMLInputElement>("prosessNavn");
const prosessVersjon = krevEl<HTMLInputElement>("prosessVersjon");
const prosessBeskrivelse = krevEl<HTMLTextAreaElement>("prosessBeskrivelse");
const prosessSteg = krevEl<HTMLTextAreaElement>("prosessSteg");
const prosesser: Prosess[] = [];

const eksempelSteg: ProsessSteg[] = [
  {
    id: "intro",
    type: "INFO",
    tittel: "Velkommen",
    tekst: "Vi hjelper deg gjennom denne dialogen steg for steg."
  },
  {
    id: "behov",
    type: "QUESTION",
    tittel: "Hva trenger du hjelp til?",
    tekst: "Beskriv behovet ditt kort.",
    felter: [
      {
        id: "beskrivelse",
        label: "Beskrivelse",
        type: "tekst",
        placeholder: "Skriv kort hva du trenger hjelp til",
        obligatorisk: true
      },
      {
        id: "onskerKontakt",
        label: "Ønsker du kontakt?",
        type: "ja-nei",
        obligatorisk: true
      },
      {
        id: "kontaktkanal",
        label: "Foretrukket kontaktkanal",
        type: "valg",
        alternativer: ["Telefon", "E-post", "Digital melding"],
        obligatorisk: false
      }
    ]
  },
  {
    id: "oppsummering",
    type: "SUMMARY",
    tittel: "Oppsummering"
  },
  {
    id: "send-inn",
    type: "SUBMIT",
    tittel: "Send inn"
  }
];

function setStatus(tekst: string): void {
  status.textContent = tekst;
}

async function getProsesser(): Promise<void> {
  const svar = await fetch("http://localhost:8080/api/prosesser");
  const data = (await svar.json()) as Prosess[];
  prosesser.length = 0;
  prosesser.push(...data);
  prosessListe.innerHTML = "";

  for (const prosess of prosesser) {
    const li = document.createElement("li");
    const knapp = document.createElement("button");
    knapp.textContent = prosess.navn;
    knapp.onclick = () => {
      showProsess(prosess);
      fyllSkjema(prosess);
    };
    li.appendChild(knapp);
    prosessListe.appendChild(li);
  }
}

function fyllSkjema(prosess: Prosess): void {
  prosessId.value = prosess.id || "";
  prosessNavn.value = prosess.navn || "";
  prosessVersjon.value = prosess.versjon || "0.1.0";
  prosessBeskrivelse.value = prosess.beskrivelse || "";
  prosessSteg.value = JSON.stringify(prosess.steg || [], null, 2);
}

function showProsess(prosess: Prosess): void {
  const stegHtml = (prosess.steg || [])
    .map((steg, indeks) => {
      const feltInfo = steg.felter?.length ? ` (${steg.felter.length} felt)` : "";
      return `<li><strong>${indeks + 1}. ${steg.tittel}</strong> — ${steg.type}${feltInfo}</li>`;
    })
    .join("");

  detaljer.innerHTML = `
    <h3>${prosess.navn}</h3>
    <p>${prosess.beskrivelse}</p>
    <h4>Steg</h4>
    <ul>${stegHtml}</ul>
    <h4>Rådata</h4>
    <pre>${JSON.stringify(prosess, null, 2)}</pre>
  `;
}

function nullstillSkjema(): void {
  prosessId.value = "";
  prosessNavn.value = "";
  prosessVersjon.value = "0.1.0";
  prosessBeskrivelse.value = "";
  prosessSteg.value = JSON.stringify(eksempelSteg, null, 2);
}

async function saveProsess(): Promise<void> {
  let steg: ProsessSteg[];
  try {
    // Fritekst fra en textarea. ProsessSteg[] navngir det brukeren skal ha skrevet.
    steg = JSON.parse(prosessSteg.value || "[]") as ProsessSteg[];
  } catch (error) {
    setStatus(`Kunne ikke tolke steg-JSON: ${feilmelding(error)}`);
    return;
  }

  const payload = {
    id: prosessId.value.trim(),
    navn: prosessNavn.value.trim(),
    beskrivelse: prosessBeskrivelse.value.trim(),
    versjon: prosessVersjon.value.trim(),
    steg
  };

  if (!payload.id || !payload.navn) {
    setStatus("Prosess må ha både ID og navn.");
    return;
  }

  const finnes = prosesser.some((prosess) => prosess.id === payload.id);
  const metode = finnes ? "PUT" : "POST";
  const url = finnes
    ? `http://localhost:8080/api/prosesser/${payload.id}`
    : "http://localhost:8080/api/prosesser";

  const svar = await fetch(url, {
    method: metode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = (await svar.json()) as Prosess & { feil?: string };
  if (!svar.ok) {
    setStatus(`Lagring feilet: ${data.feil || svar.status}`);
    return;
  }

  setStatus(finnes ? "Prosess oppdatert." : "Ny prosess opprettet.");
  await getProsesser();
  fyllSkjema(data);
  showProsess(data);
}

krevEl("oppdater").onclick = () => {
  getProsesser().then(() => setStatus("Prosessliste oppdatert."));
};

krevEl("nyProsess").onclick = () => {
  nullstillSkjema();
  detaljer.textContent = "Ny prosess er klar til redigering.";
  setStatus("Ny prosess opprettet i skjemaet. Fyll inn ID og navn før lagring.");
};

krevEl("lagreProsess").onclick = saveProsess;

krevEl("lastInnEksempel").onclick = () => {
  prosessSteg.value = JSON.stringify(eksempelSteg, null, 2);
  setStatus("Eksempelsteg lagt inn i skjemaet.");
};

getProsesser()
  .then(() => {
    nullstillSkjema();
    setStatus("Prosesser hentet.");
  })
  .catch((error: unknown) => {
    detaljer.textContent = `Kunne ikke hente prosesser: ${feilmelding(error)}`;
    setStatus(`Kunne ikke hente prosesser: ${feilmelding(error)}`);
  });
