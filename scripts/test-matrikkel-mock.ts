import { spawn } from "node:child_process";
import { feilmelding } from "../apps/shared-ui/errors.ts";

const port = 18085;
const baseUrl = `http://127.0.0.1:${port}`;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url: string, forsok = 30): Promise<void> {
  for (let i = 0; i < forsok; i += 1) {
    try {
      const svar = await fetch(url);
      if (svar.ok) return;
    } catch {
      // Server is not up yet.
    }
    await wait(250);
  }
  throw new Error(`Server svarte ikke paa ${url}`);
}

function assert(ok: unknown, melding: string): void {
  if (!ok) throw new Error(melding);
}

async function kjor() {
  const prosess = spawn("node", ["apps/matrikkel-mock/src/server.ts"], {
    env: { ...process.env, PORT: String(port) },
    stdio: "inherit"
  });

  try {
    await waitForServer(`${baseUrl}/helse`);

    const alleGaterSvar = await fetch(`${baseUrl}/mock/matrikkel/gater`);
    assert(alleGaterSvar.ok, "Kunne ikke hente gateoversikt");
    // Svarene fra endepunktene er `any` her med vilje: skriptet finnes for å påstå
    // noe om formen deres, og en type som lovet formen ville gjort påstanden sirkulær.
    const alleGater = (await alleGaterSvar.json()) as any;
    assert(Array.isArray(alleGater) && alleGater.length >= 5, `Forventet seed-basert gateoversikt, fikk ${alleGater.length} gater`);
    assert(alleGater.some((g: any) => g.adressenavn === "Bønesheien"), "Forventet Bønesheien i seed-basert gateoversikt");

    const gateSvar = await fetch(`${baseUrl}/mock/matrikkel/gater?gate=Storgata`);
    assert(gateSvar.ok, "Gate-oppslag feilet");
    const gateJson = (await gateSvar.json()) as any;
    const gateTreff = Array.isArray(gateJson) ? gateJson : gateJson.items;
    assert(Array.isArray(gateTreff) && gateTreff.some((g) => g.adressenavn === "Storgata"), "Feil gate returnert");

    const fjosSvar = await fetch(`${baseUrl}/mock/matrikkel/gater?gate=Fjøsanger`);
    assert(fjosSvar.ok, "Fjøsanger-oppslag feilet");
    const fjosJson = (await fjosSvar.json()) as any;
    const fjosTreff = Array.isArray(fjosJson) ? fjosJson : fjosJson.items;
    assert(Array.isArray(fjosTreff) && fjosTreff.some((g) => g.adressenavn.includes("Fj")), "Forventet Fjøsangerveien i oppslag");

    const adresseSvar = await fetch(`${baseUrl}/mock/matrikkel/eiendom-oppslag?adresse=${encodeURIComponent("Storgata 5")}`);
    assert(adresseSvar.ok, "Eksakt adresseoppslag feilet");
    const adresseJson = (await adresseSvar.json()) as any;
    assert(adresseJson.adresse === "Storgata 5", "Feil adresse returnert fra eiendom-oppslag");
    assert(typeof adresseJson.husnummer === "number", "Mangler husnummer i rik eiendomsrespons");
    assert(adresseJson.postnummer, "Mangler postnummer i rik eiendomsrespons");
    assert(adresseJson.koordinater && typeof adresseJson.koordinater.lat === "number", "Mangler koordinater i rik eiendomsrespons");

    const soapPayload = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:mat="http://rep.geointegrasjon.no/Matrikkel/Basis/xml.wsdl/2012.01.31">
  <soapenv:Body>
    <mat:HentMatrikkelenhet>
      <matrikkelId>matr-storg-003</matrikkelId>
    </mat:HentMatrikkelenhet>
  </soapenv:Body>
</soapenv:Envelope>`;

    const soapSvar = await fetch(`${baseUrl}/geointegrasjon/matrikkel/wsapi/v1/BasisService`, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8" },
      body: soapPayload
    });

    assert(soapSvar.ok, "SOAP-kall feilet");
    const soapTekst = await soapSvar.text();
    assert(soapTekst.includes("matr-storg-003"), "SOAP-respons mangler forventet matrikkelId");

    console.log("test:matrikkel-mock OK");
  } finally {
    prosess.kill("SIGTERM");
  }
}

kjor().catch((error) => {
  console.error(feilmelding(error));
  process.exitCode = 1;
});

