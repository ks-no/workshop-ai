import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { feilmelding } from "../apps/shared/errors.ts";
import { adressekjerne, adresseSoek, matchesAdresse, matchesAdresseFields, parseAdresse } from "../apps/shared/adresse.ts";
import type { GeonorgeAdresse } from "../apps/shared/registerdata.ts";

const portBase = Number(process.env.TOOLS_MATRIKKEL_TEST_PORT_BASE || 18080);
const matrikkelPort = portBase + 5;
const toolsMockPort = portBase + 3;
const toolsLivePort = portBase + 4;
const toolsHybridPort = portBase + 7;
const geonorgePort = portBase + 6;
const matrikkelSeedPort = portBase + 8;
const toolsSeedPort = portBase + 9;
const geonorgeBaseUrl = `http://127.0.0.1:${geonorgePort}`;
let geonorgeScenario = "normal";
let geonorgeRequests = 0;
const geonorgeQueries: string[] = [];
const seedGater = JSON.parse(readFileSync("data/matrikkel.json", "utf8")).gater as {
  adressenavn: string; postnummer: string; poststed: string;
  eiendommer: {
    matrikkelId: string; adresse: string; husnummer: number; husbokstav: string | null;
    adressetilleggsnavn?: string; postnummer?: string; poststed?: string;
  }[];
}[];
const seedEiendommer = seedGater.flatMap((gate) => gate.eiendommer.map((eiendom) => ({
  ...eiendom, adressenavn: gate.adressenavn,
  postnummer: eiendom.postnummer || gate.postnummer, poststed: eiendom.poststed || gate.poststed
})));

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(url: string, forsok = 40): Promise<void> {
  for (let i = 0; i < forsok; i += 1) {
    try {
      const svar = await fetch(url);
      if (svar.ok) return;
    } catch {
      // Ikke oppe enda.
    }
    await wait(250);
  }
  throw new Error(`Timeout: ${url}`);
}

function assert(ok: unknown, melding: string): void {
  if (!ok) throw new Error(melding);
}

function json(response: import("node:http").ServerResponse, statusCode: number, data: unknown): void {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data, null, 2));
}

function normalize(text: unknown): string {
  return String(text || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function createFakeGeonorgeServer() {
  return createServer((request, response) => {
    const url = new URL(request.url!, `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/sok") {
      geonorgeRequests += 1;
      const sok = normalize(url.searchParams.get("sok"));
      geonorgeQueries.push(url.searchParams.get("sok") || "");
      if (sok.includes("haugsbygda")) {
        json(response, 200, {
          metadata: { totaltAntallTreff: 1 },
          adresser: [{
            adressenavn: "Haugsbygda", nummer: 98, bokstav: "", adressetekst: "Aardal, Haugsbygda 98",
            adressetilleggsnavn: "Aardal", postnummer: "6082", poststed: "GURSKEN",
            kommunenummer: "1514", kommunenavn: "SANDE", adressekode: 14029,
            gardsnummer: 1, bruksnummer: 98
          }]
        });
        return;
      }
      const base = {
        adressenavn: "Bokstavgata", adressetekst: "Bokstavgata 10A",
        nummer: 10, bokstav: "A", adressekode: 42, kommunenummer: "4601",
        kommunenavn: "BERGEN", gardsnummer: 20, bruksnummer: 42,
        postnummer: "5003", poststed: "BERGEN"
      };
      if (sok.includes("bokstavgata")) {
        let adresser: GeonorgeAdresse[] = geonorgeScenario === "missing"
          ? [{ adressenavn: "Bokstavgata" }, { nummer: 10, bokstav: "A" },
            { adressetekst: "Bokstavgata 10A" }, { ...base, nummer: 11 }]
          : [base, { ...base, adressetekst: "Bokstavgata 10B", bokstav: "B", bruksnummer: 43 }];
        if (geonorgeScenario === "ambiguous") {
          adresser.push({ ...base, kommunenummer: "0301", postnummer: "0150", poststed: "OSLO" });
        }
        if (geonorgeScenario === "paged") {
          adresser = url.searchParams.get("side") === "1"
            ? [{ ...base, kommunenummer: "0301", postnummer: "0150", poststed: "OSLO" }]
            : Array.from({ length: 1000 }, () => base);
          json(response, 200, { metadata: { totaltAntallTreff: 1001 }, adresser });
          return;
        }
        json(response, 200, { metadata: { totaltAntallTreff: adresser.length }, adresser });
        return;
      }
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

async function invoke(port: number, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const svar = await fetch(`http://127.0.0.1:${port}/verktoy/invoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, arguments: args })
  });
  // Svarene er any med vilje - se scripts/test-agent-natural-language.ts for begrunnelsen.
  const data = (await svar.json()) as any;
  if (!svar.ok || !data.ok) {
    throw new Error(data.detalj || data.feil || `Tool ${name} feilet`);
  }
  return data.result;
}

async function assertRejected(port: number, name: string, args: Record<string, unknown>, status: number) {
  for (const route of ["/verktoy/invoke", `/verktoy/${name}/invoke`]) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(route === "/verktoy/invoke" ? { name, arguments: args } : { arguments: args })
    });
    const data = await response.json() as { ok?: boolean; result?: unknown };
    assert(response.status === status, `${name} ${JSON.stringify(args)}: forventet ${status}, fikk ${response.status}`);
    assert(data.ok !== true && data.result === undefined, "Et avvist adresseoppslag må ikke gi eiendom eller eiere");
  }
}

function testAdresse() {
  for (const value of [undefined, null, {}, [], 10, "", "Bønesheien", "Bønesheien -1", "Bønesheien 0",
    "Bønesheien 10AB", "Bønesheien 10A5154", "Bønesheien 10 tilfeldig tekst", "10", "Bønesheien 99999999999999999999"]) {
    assert(parseAdresse(value) === null, `Ugyldig adresse ble godtatt: ${JSON.stringify(value)}`);
  }
  for (const value of [" Bønesheien   10 a ", "Bønesheien 10A, 5154 BØNES",
    "Bønesheien 10 A 5154 BØNES", "Bønesheien 10A, 5154 BØNES, Norge"]) {
    const query = parseAdresse(value)!;
    assert(query !== null, `Gyldig adresse ble avvist: ${value}`);
    assert(adressekjerne(query) === "Bønesheien 10A", "Husbokstaven må beholdes");
    assert(matchesAdresse(query, "bønesheien 10a", "5154", "Bønes"), "Eksakt normalisert adresse skal treffe");
    for (const candidate of [undefined, "", "Bønesheien", "Bønesheien 1", "Bønesheien 10",
      "Bønesheien 10B", "Bønesheien 100A", "Øvre Bønesheien 10A"]) {
      assert(!matchesAdresse(query, candidate, "5154", "BØNES"), "Adresseprefiks eller manglende felt må ikke treffe");
    }
  }
  assert(parseAdresse("7. juni gate 5")?.adressenavn === "7. juni gate", "Gatenavn kan inneholde tall");
  assert(parseAdresse("7.\tjuni  gate 5")?.adressenavn === "7. juni gate", "Mellomrom i gatenavnet normaliseres");
  const query = parseAdresse("Bønesheien 10, 5154 BØNES")!;
  assert(!matchesAdresse(query, "Bønesheien 10", "5003", "BERGEN"), "Postnummer og poststed må ikke ignoreres");
  for (const eiendom of seedEiendommer) {
    const full = parseAdresse(eiendom.adresse);
    assert(full, `Seed-adressen kunne ikke leses: ${eiendom.adresse}`);
    assert(matchesAdresseFields(full!, eiendom), `Adressefelt og visning stemmer ikke: ${eiendom.adresse}`);
    const core = parseAdresse(`${eiendom.adressenavn} ${eiendom.husnummer}${eiendom.husbokstav || ""}`)!;
    assert(matchesAdresseFields(core, eiendom), `Adressetillegg må ikke skjule grunndata: ${eiendom.adresse}`);
  }
  const supplemented = parseAdresse("Aardal, Haugsbygda 98, 6082 Gursken")!;
  assert(supplemented.adressenavn === "Haugsbygda" && supplemented.adressetilleggsnavn === "Aardal",
    "Adressetillegget skal være separat fra gatenavnet");
  assert(adresseSoek(supplemented) === "Aardal, Haugsbygda 98, 6082 Gursken",
    "Søk må beholde adressetillegg og poststed");
}

function startTools(port: number, extraEnv: Record<string, string> = {}) {
  return spawn("node", ["apps/tools-api/src/server.ts"], {
    env: {
      ...process.env,
      PORT: String(port),
      MATRIKKEL_BASE_URL: `http://127.0.0.1:${matrikkelPort}`,
      BACKEND_BASE_URL: "http://127.0.0.1:65534",
      AI_BASE_URL: "http://127.0.0.1:65535",
      GEONORGE_ADRESSE_API_BASE_URL: geonorgeBaseUrl,
      ...extraEnv
    },
    stdio: "inherit"
  });
}

async function kjor() {
  testAdresse();
  const matrikkel = spawn("node", ["apps/matrikkel-mock/src/server.ts"], {
    env: {
      ...process.env, PORT: String(matrikkelPort),
      MATRIKKEL_DATA_FILE: "data/matrikkel.seed.json",
      GEONORGE_ADRESSE_API_BASE_URL: geonorgeBaseUrl
    },
    stdio: "inherit"
  });
  const matrikkelSeed = spawn("node", ["apps/matrikkel-mock/src/server.ts"], {
    env: {
      ...process.env, PORT: String(matrikkelSeedPort),
      MATRIKKEL_DATA_FILE: "data/matrikkel.json",
      GEONORGE_ADRESSE_API_BASE_URL: geonorgeBaseUrl
    },
    stdio: "inherit"
  });
  const geonorge = createFakeGeonorgeServer();
  await new Promise<void>((resolve) => { geonorge.listen(geonorgePort, () => resolve()); });

  const toolsMock = startTools(toolsMockPort, { MATRIKKEL_MODE: "mock" });
  const toolsSeed = startTools(toolsSeedPort, {
    MATRIKKEL_MODE: "mock", MATRIKKEL_BASE_URL: `http://127.0.0.1:${matrikkelSeedPort}`
  });
  const toolsLive = startTools(toolsLivePort, {
    MATRIKKEL_MODE: "live",
    GEONORGE_ADRESSE_API_BASE_URL: `http://127.0.0.1:${geonorgePort}`
  });
  const toolsHybrid = startTools(toolsHybridPort, {
    MATRIKKEL_MODE: "hybrid",
    GEONORGE_ADRESSE_API_BASE_URL: `http://127.0.0.1:${geonorgePort}`
  });

  try {
    await waitFor(`http://127.0.0.1:${matrikkelPort}/helse`);
    await waitFor(`http://127.0.0.1:${toolsMockPort}/helse`);
    await waitFor(`http://127.0.0.1:${toolsLivePort}/helse`);
    await waitFor(`http://127.0.0.1:${toolsHybridPort}/helse`);
    await waitFor(`http://127.0.0.1:${matrikkelSeedPort}/helse`);
    await waitFor(`http://127.0.0.1:${toolsSeedPort}/helse`);

    const gate = await invoke(toolsMockPort, "matrikkel_finn_veger", { gate: "Storgata" });
    assert(gate.adressenavn === "Storgata", "matrikkel_finn_veger returnerte ikke Storgata");

    const eiendom = await invoke(toolsMockPort, "matrikkel_hent_eiendom", { matrikkelId: "matr-storg-003" });
    assert(eiendom.matrikkelId === "matr-storg-003", "matrikkel_hent_eiendom returnerte feil eiendom");

    const adresseEiendom = await invoke(toolsMockPort, "matrikkel_hent_eiendom", { adresse: "Storgata 5" });
    assert(adresseEiendom.adresse === "Storgata 5", "matrikkel_hent_eiendom fant ikke riktig adresse");

    const eiere = await invoke(toolsMockPort, "matrikkel_hent_eiere", { matrikkelId: "matr-storg-003" });
    assert(Array.isArray(eiere.eiere), "matrikkel_hent_eiere mangler eierliste");
    assert(eiere.eiere.includes("person-001"), "forventet eier person-001 mangler");

    const adresseEiere = await invoke(toolsMockPort, "matrikkel_hent_eiere", { adresse: "Storgata 5" });
    assert(Array.isArray(adresseEiere.eiere), "matrikkel_hent_eiere via adresse mangler eierliste");

    const liveGater = await invoke(toolsLivePort, "matrikkel_finn_veger", { gate: "Bønesheien", all: true, limit: 10 });
    assert(Array.isArray(liveGater) && liveGater.some((g) => g.adressenavn === "Bønesheien"), "Live gateoppslag fant ikke Bønesheien");

    const liveEiendom = await invoke(toolsLivePort, "matrikkel_hent_eiendom", { adresse: "Bønesheien 10" });
    assert(liveEiendom.adresse === "Bønesheien 10", "Live adresseoppslag returnerte feil adresse");
    assert(liveEiendom.gnr === 20 && liveEiendom.bnr === 843, "Live adresseoppslag returnerte feil gnr/bnr");
    assert(liveEiendom.syntetisk === false, "Live adresseoppslag skal markeres som ikke-syntetisk");

    const liveEiendomMedPoststed = await invoke(toolsLivePort, "matrikkel_hent_eiendom", { adresse: "Bønesheien 10, 5154 BØNES" });
    assert(liveEiendomMedPoststed.adresse === "Bønesheien 10", "Live adresseoppslag med poststed/postnummer traff ikke riktig adresse");

    const liveEiendomMedPostnummerFoerst = await invoke(toolsLivePort, "matrikkel_hent_eiendom", { adresse: "Bønesheien 10 5154 BØNES" });
    assert(liveEiendomMedPostnummerFoerst.adresse === "Bønesheien 10", "Live adresseoppslag med ekstra adresseformat traff ikke riktig adresse");

    const liveEiere = await invoke(toolsLivePort, "matrikkel_hent_eiere", { adresse: "Bønesheien 10" });
    assert(Array.isArray(liveEiere.eiere) && liveEiere.eiere.length === 0, "Live eieroppslag skal returnere tom eierliste");
    assert(liveEiere.syntetisk === false, "Live eieroppslag skal markeres som ikke-syntetisk");
    assert(String(liveEiere.merknad || "").includes("ikke eierinformasjon"), "Live eieroppslag mangler forklarende merknad");

    const hybridEiendom = await invoke(toolsHybridPort, "matrikkel_hent_eiendom", { adresse: "Storgata 5" });
    assert(hybridEiendom.matrikkelId === "matr-storg-005", "Hybrid adresseoppslag skulle falt tilbake til mock for Storgata 5");

    const catalogue = await (await fetch(`http://127.0.0.1:${toolsMockPort}/verktoy`)).json() as any;
    assert(catalogue.tools.find((tool: any) => tool.name === "run_current_action").description.includes("SJEKK"),
      "run_current_action må beskrive SJEKK");

    for (const port of [toolsMockPort, toolsLivePort, toolsHybridPort]) {
      for (const name of ["matrikkel_hent_eiendom", "matrikkel_hent_eiere"]) {
        const before = geonorgeRequests;
        for (const adresse of ["", null, {}, [], 10, "Bønesheien", "Bønesheien 10AB", "Bønesheien -1"]) {
          await assertRejected(port, name, { adresse }, 400);
        }
        await assertRejected(port, name, {}, 400);
        assert(geonorgeRequests === before, "Ugyldig adresse skal avvises før eksternt oppslag");
        for (const adresse of ["Bønesheien 1", "Bønesheien 999", "Bønesheien 10A"]) {
          await assertRejected(port, name, { adresse }, 404);
        }
      }
    }
    for (const port of [toolsMockPort, toolsHybridPort]) {
      const normalized = await invoke(port, "matrikkel_hent_eiendom", { adresse: "  storgata   5, 5003 Bergen " });
      assert(normalized.matrikkelId === "matr-storg-005", "Mock-oppslag må tåle mellomrom og poststed");
      const first = await invoke(port, "matrikkel_hent_eiendom", { adresse: "Storgata 1" });
      assert(first.matrikkelId === "matr-storg-001", "Storgata 10 må ikke gjøre Storgata 1 tvetydig");
      for (const name of ["matrikkel_hent_eiendom", "matrikkel_hent_eiere"]) {
        await assertRejected(port, name, { adresse: "Storgata 11" }, 404);
      }
      await assertRejected(port, "matrikkel_hent_eiendom", { adresse: "Storgata 5, 9999 OSLO" }, 404);
    }
    for (const port of [toolsMockPort, toolsLivePort, toolsHybridPort]) {
      const letter = await invoke(port, "matrikkel_hent_eiendom", { adresse: "bokstavgata 10 b, 5003 Bergen" });
      assert(letter.husbokstav === "B" && letter.bnr === 43, "Husbokstav B må ikke treffe A");
      await assertRejected(port, "matrikkel_hent_eiere", { adresse: "Bokstavgata 10" }, 404);
      geonorgeScenario = "ambiguous";
      for (const name of ["matrikkel_hent_eiendom", "matrikkel_hent_eiere"]) {
        await assertRejected(port, name, { adresse: "Bokstavgata 10A" }, 409);
      }
      const queryStart = geonorgeQueries.length;
      const disambiguated = await invoke(port, "matrikkel_hent_eiendom", { adresse: "Bokstavgata 10A, 0150 OSLO" });
      assert(disambiguated.kommunenummer === "0301", "Postnummer skal skille ellers like adresser");
      const disambiguatedOwners = await invoke(port, "matrikkel_hent_eiere", { adresse: "Bokstavgata 10A, 0150 OSLO" });
      assert(disambiguatedOwners.matrikkelId === disambiguated.matrikkelId, "Eieroppslaget må velge samme entydige adresse");
      assert(geonorgeQueries.slice(queryStart).some((query) => query.includes("0150")), "Postnummeret skal sendes til Geonorge");
      geonorgeScenario = "missing";
      await assertRejected(port, "matrikkel_hent_eiendom", { adresse: "Bokstavgata 10A" }, 404);
      geonorgeScenario = "normal";
      for (const name of ["matrikkel_hent_eiendom", "matrikkel_hent_eiere"]) {
        for (const adresse of ["Aardal, Haugsbygda 98", "Haugsbygda 98", "Aardal, Haugsbygda 98, 6082 Gursken"]) {
          const property = await invoke(port, name, { adresse });
          assert(property.adresse === "Aardal, Haugsbygda 98", "Adressetillegg må ikke gi feil hus eller falskt 404");
        }
        for (const adresse of ["Haugsbygda 9", "Haugsbygda 98A", "Annet navn, Haugsbygda 98", "Haugsbygda 98, 0150 OSLO"]) {
          await assertRejected(port, name, { adresse }, 404);
        }
      }
    }

    geonorgeScenario = "paged";
    for (const name of ["matrikkel_hent_eiendom", "matrikkel_hent_eiere"]) {
      await assertRejected(toolsMockPort, name, { adresse: "Bokstavgata 10A" }, 409);
      const result = await invoke(toolsMockPort, name, { adresse: "Bokstavgata 10A, 0150 OSLO" });
      assert(result.matrikkelId.includes("0301"), "Mockens live-fallback må også lese neste side");
    }
    const listResponse = await fetch(`http://127.0.0.1:${matrikkelPort}/mock/matrikkel/eiendommer?adresse=Bokstavgata%2010A&limit=1`);
    const list = await listResponse.json() as { total: number; items: unknown[] };
    assert(listResponse.ok && list.total === 2 && list.items.length === 1,
      "Kandidatlisten skal beholde begge adressene og fjerne duplikate kildetreff før paginering");
    geonorgeScenario = "normal";

    const supplementedSeed = seedEiendommer.filter((eiendom) => eiendom.adressetilleggsnavn);
    assert(supplementedSeed.length > 0, "Seeden må dekke adressetillegg");
    for (const eiendom of supplementedSeed) {
      for (const name of ["matrikkel_hent_eiendom", "matrikkel_hent_eiere"]) {
        for (const adresse of [eiendom.adresse, `${eiendom.adressenavn} ${eiendom.husnummer}${eiendom.husbokstav || ""}`]) {
          const result = await invoke(toolsSeedPort, name, { adresse: `${adresse}, ${eiendom.postnummer} ${eiendom.poststed}` });
          assert(result.matrikkelId === eiendom.matrikkelId, `Feil eiendom for seed-adresse ${adresse}`);
        }
      }
    }
    console.log("test:tools-matrikkel OK");
  } finally {
    toolsSeed.kill("SIGTERM");
    matrikkelSeed.kill("SIGTERM");
    toolsHybrid.kill("SIGTERM");
    toolsLive.kill("SIGTERM");
    toolsMock.kill("SIGTERM");
    matrikkel.kill("SIGTERM");
    await new Promise((resolve) => geonorge.close(resolve));
  }
}

kjor().catch((error) => {
  console.error(feilmelding(error));
  process.exitCode = 1;
});
