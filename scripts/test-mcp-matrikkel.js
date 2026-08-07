import { spawn } from "node:child_process";
import { createServer } from "node:http";

const matrikkelPort = 18085;
const mcpMockPort = 18083;
const mcpLivePort = 18084;
const mcpHybridPort = 18087;
const geonorgePort = 18086;

function vent(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ventPaa(url, forsok = 40) {
  for (let i = 0; i < forsok; i += 1) {
    try {
      const svar = await fetch(url);
      if (svar.ok) return;
    } catch {
      // Ikke oppe enda.
    }
    await vent(250);
  }
  throw new Error(`Timeout: ${url}`);
}

function assert(ok, melding) {
  if (!ok) throw new Error(melding);
}

function json(response, statusCode, data) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data, null, 2));
}

function normalize(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function createFakeGeonorgeServer() {
  return createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/sok") {
      const sok = normalize(url.searchParams.get("sok"));
      if (sok.includes("bonesheien") || sok.includes("bønesheien")) {
        json(response, 200, {
          metadata: { totaltAntallTreff: 2 },
          adresser: [
            {
              adressenavn: "Bønesheien",
              adressetekst: "Bønesheien 10",
              adressekode: 33879,
              nummer: 10,
              bokstav: "",
              kommunenummer: "4601",
              kommunenavn: "BERGEN",
              gardsnummer: 20,
              bruksnummer: 843,
              festenummer: 0,
              undernummer: null,
              objtype: "Vegadresse",
              poststed: "BØNES",
              postnummer: "5154",
              representasjonspunkt: { epsg: "EPSG:4258", lat: 60.3338, lon: 5.3038 }
            },
            {
              adressenavn: "Bønesheien",
              adressetekst: "Bønesheien 12",
              adressekode: 33879,
              nummer: 12,
              bokstav: "",
              kommunenummer: "4601",
              kommunenavn: "BERGEN",
              gardsnummer: 20,
              bruksnummer: 844,
              festenummer: 0,
              undernummer: null,
              objtype: "Vegadresse",
              poststed: "BØNES",
              postnummer: "5154",
              representasjonspunkt: { epsg: "EPSG:4258", lat: 60.3339, lon: 5.304 }
            }
          ]
        });
        return;
      }
      json(response, 200, { metadata: { totaltAntallTreff: 0 }, adresser: [] });
      return;
    }

    json(response, 404, { feil: "Fant ikke endepunkt." });
  });
}

async function invoke(port, name, args = {}) {
  const svar = await fetch(`http://127.0.0.1:${port}/mcp/tools/invoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, arguments: args })
  });
  const data = await svar.json();
  if (!svar.ok || !data.ok) {
    throw new Error(data.detalj || data.feil || `Tool ${name} feilet`);
  }
  return data.result;
}

function startMcp(port, extraEnv = {}) {
  return spawn("node", ["apps/mcp-services/src/server.js"], {
    env: {
      ...process.env,
      PORT: String(port),
      MATRIKKEL_BASE_URL: `http://127.0.0.1:${matrikkelPort}`,
      BACKEND_BASE_URL: "http://127.0.0.1:65534",
      AI_BASE_URL: "http://127.0.0.1:65535",
      ...extraEnv
    },
    stdio: "inherit"
  });
}

async function kjor() {
  const matrikkel = spawn("node", ["apps/matrikkel-mock/src/server.js"], {
    env: { ...process.env, PORT: String(matrikkelPort) },
    stdio: "inherit"
  });
  const geonorge = createFakeGeonorgeServer();
  await new Promise((resolve) => geonorge.listen(geonorgePort, resolve));

  const mcpMock = startMcp(mcpMockPort);
  const mcpLive = startMcp(mcpLivePort, {
    MATRIKKEL_MODE: "live",
    GEONORGE_ADRESSE_API_BASE_URL: `http://127.0.0.1:${geonorgePort}`
  });
  const mcpHybrid = startMcp(mcpHybridPort, {
    MATRIKKEL_MODE: "hybrid",
    GEONORGE_ADRESSE_API_BASE_URL: `http://127.0.0.1:${geonorgePort}`
  });

  try {
    await ventPaa(`http://127.0.0.1:${matrikkelPort}/health`);
    await ventPaa(`http://127.0.0.1:${mcpMockPort}/health`);
    await ventPaa(`http://127.0.0.1:${mcpLivePort}/health`);
    await ventPaa(`http://127.0.0.1:${mcpHybridPort}/health`);

    const gate = await invoke(mcpMockPort, "matrikkel_finn_veger", { gate: "Storgata" });
    assert(gate.adressenavn === "Storgata", "matrikkel_finn_veger returnerte ikke Storgata");

    const eiendom = await invoke(mcpMockPort, "matrikkel_hent_eiendom", { matrikkelId: "matr-storg-003" });
    assert(eiendom.matrikkelId === "matr-storg-003", "matrikkel_hent_eiendom returnerte feil eiendom");

    const adresseEiendom = await invoke(mcpMockPort, "matrikkel_hent_eiendom", { adresse: "Storgata 5" });
    assert(adresseEiendom.adresse === "Storgata 5", "matrikkel_hent_eiendom fant ikke riktig adresse");

    const eiere = await invoke(mcpMockPort, "matrikkel_hent_eiere", { matrikkelId: "matr-storg-003" });
    assert(Array.isArray(eiere.eiere), "matrikkel_hent_eiere mangler eierliste");
    assert(eiere.eiere.includes("person-001"), "forventet eier person-001 mangler");

    const adresseEiere = await invoke(mcpMockPort, "matrikkel_hent_eiere", { adresse: "Storgata 5" });
    assert(Array.isArray(adresseEiere.eiere), "matrikkel_hent_eiere via adresse mangler eierliste");

    const liveGater = await invoke(mcpLivePort, "matrikkel_finn_veger", { gate: "Bønesheien", all: true, limit: 10 });
    assert(Array.isArray(liveGater) && liveGater.some((g) => g.adressenavn === "Bønesheien"), "Live gateoppslag fant ikke Bønesheien");

    const liveEiendom = await invoke(mcpLivePort, "matrikkel_hent_eiendom", { adresse: "Bønesheien 10" });
    assert(liveEiendom.adresse === "Bønesheien 10", "Live adresseoppslag returnerte feil adresse");
    assert(liveEiendom.gnr === 20 && liveEiendom.bnr === 843, "Live adresseoppslag returnerte feil gnr/bnr");
    assert(liveEiendom.syntetisk === false, "Live adresseoppslag skal markeres som ikke-syntetisk");

    const liveEiendomMedPoststed = await invoke(mcpLivePort, "matrikkel_hent_eiendom", { adresse: "Bønesheien 10, 5154 BØNES" });
    assert(liveEiendomMedPoststed.adresse === "Bønesheien 10", "Live adresseoppslag med poststed/postnummer traff ikke riktig adresse");

    const liveEiendomMedPostnummerFoerst = await invoke(mcpLivePort, "matrikkel_hent_eiendom", { adresse: "Bønesheien 10 5154 BØNES" });
    assert(liveEiendomMedPostnummerFoerst.adresse === "Bønesheien 10", "Live adresseoppslag med ekstra adresseformat traff ikke riktig adresse");

    const liveEiere = await invoke(mcpLivePort, "matrikkel_hent_eiere", { adresse: "Bønesheien 10" });
    assert(Array.isArray(liveEiere.eiere) && liveEiere.eiere.length === 0, "Live eieroppslag skal returnere tom eierliste");
    assert(liveEiere.syntetisk === false, "Live eieroppslag skal markeres som ikke-syntetisk");
    assert(String(liveEiere.merknad || "").includes("ikke eierinformasjon"), "Live eieroppslag mangler forklarende merknad");

    const hybridEiendom = await invoke(mcpHybridPort, "matrikkel_hent_eiendom", { adresse: "Storgata 5" });
    assert(hybridEiendom.matrikkelId === "matr-storg-005", "Hybrid adresseoppslag skulle falt tilbake til mock for Storgata 5");

    console.log("test:mcp-matrikkel OK");
  } finally {
    mcpHybrid.kill("SIGTERM");
    mcpLive.kill("SIGTERM");
    mcpMock.kill("SIGTERM");
    matrikkel.kill("SIGTERM");
    await new Promise((resolve) => geonorge.close(resolve));
  }
}

kjor().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

