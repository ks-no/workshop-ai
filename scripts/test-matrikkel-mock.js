import { spawn } from "node:child_process";

const port = 18085;
const baseUrl = `http://127.0.0.1:${port}`;

function vent(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ventPaaServer(url, forsok = 30) {
  for (let i = 0; i < forsok; i += 1) {
    try {
      const svar = await fetch(url);
      if (svar.ok) return;
    } catch {
      // Server is not up yet.
    }
    await vent(250);
  }
  throw new Error(`Server svarte ikke paa ${url}`);
}

function assert(ok, melding) {
  if (!ok) throw new Error(melding);
}

async function kjor() {
  const prosess = spawn("node", ["apps/matrikkel-mock/src/server.js"], {
    env: { ...process.env, PORT: String(port) },
    stdio: "inherit"
  });

  try {
    await ventPaaServer(`${baseUrl}/health`);

    const alleGaterSvar = await fetch(`${baseUrl}/mock/matrikkel/gater`);
    assert(alleGaterSvar.ok, "Kunne ikke hente gateoversikt");
    const alleGater = await alleGaterSvar.json();
    assert(Array.isArray(alleGater) && alleGater.length >= 5, `Forventet seed-basert gateoversikt, fikk ${alleGater.length} gater`);
    assert(alleGater.some((g) => g.adressenavn === "Bønesheien"), "Forventet Bønesheien i seed-basert gateoversikt");

    const gateSvar = await fetch(`${baseUrl}/mock/matrikkel/gater?gate=Storgata`);
    assert(gateSvar.ok, "Gate-oppslag feilet");
    const gateJson = await gateSvar.json();
    const gateTreff = Array.isArray(gateJson) ? gateJson : gateJson.items;
    assert(Array.isArray(gateTreff) && gateTreff.some((g) => g.adressenavn === "Storgata"), "Feil gate returnert");

    const fjosSvar = await fetch(`${baseUrl}/mock/matrikkel/gater?gate=Fjøsanger`);
    assert(fjosSvar.ok, "Fjøsanger-oppslag feilet");
    const fjosJson = await fjosSvar.json();
    const fjosTreff = Array.isArray(fjosJson) ? fjosJson : fjosJson.items;
    assert(Array.isArray(fjosTreff) && fjosTreff.some((g) => g.adressenavn.includes("Fj")), "Forventet Fjøsangerveien i oppslag");

    const adresseSvar = await fetch(`${baseUrl}/mock/matrikkel/eiendom-oppslag?adresse=${encodeURIComponent("Storgata 5")}`);
    assert(adresseSvar.ok, "Eksakt adresseoppslag feilet");
    const adresseJson = await adresseSvar.json();
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
  console.error(error.message);
  process.exitCode = 1;
});

