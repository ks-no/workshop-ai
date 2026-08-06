#!/usr/bin/env node

// Kontrakt-royktest for sandbox-backend.
//
// Starter backend og fiks-simulator mot en fersk, tom STATE_DIR, treffer hvert
// endepunkt med faste testpersoner og skriver en normalisert JSON-dump. Genererte
// id-er og tidsstempler byttes ut med plassholdere, saa to kjoeringer av samme kode
// gir bit-identisk resultat.
//
// Bruk:
//   node scripts/kontrakt-smoke.js --ut state/kontrakt-foer.json
//   ... refaktorer ...
//   node scripts/kontrakt-smoke.js --ut state/kontrakt-etter.json
//   diff state/kontrakt-foer.json state/kontrakt-etter.json
//
// Kjoerer paa egne porter mot en egen STATE_DIR, saa den kan kjoere samtidig med
// docker compose uten aa roere den delte kjoeringstilstanden i state/.
// AI-gateway trengs ikke: flytene stopper foer SUMMARY-steget med vilje.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendPort = Number(process.env.SMOKE_BACKEND_PORT) || 18080;
const fiksPort = Number(process.env.SMOKE_FIKS_PORT) || 18081;
const backendUrl = `http://127.0.0.1:${backendPort}`;
const fiksUrl = `http://127.0.0.1:${fiksPort}`;

const utFil = path.resolve(process.cwd(), argVerdi("--ut") || "state/kontrakt-dump.json");

function argVerdi(navn) {
  const indeks = process.argv.indexOf(navn);
  return indeks === -1 ? null : process.argv[indeks + 1];
}

// --- normalisering -------------------------------------------------------

// nyttId() gir "<prefiks>-<millisekunder>-<seks tegn>". Bade backend og
// fiks-simulator bruker samme format, saa ett moenster daekker begge.
// Global, saa id-er byttes ut ogsaa naar de staar inne i en URL eller en melding.
const idMoenster = /([a-z]+)-\d{13}-[a-z0-9]{6}/g;
const tidsstempelMoenster = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function normaliser(verdi) {
  if (Array.isArray(verdi)) {
    return verdi.map(normaliser);
  }
  if (verdi && typeof verdi === "object") {
    return Object.fromEntries(
      Object.entries(verdi).map(([noekkel, indre]) => [noekkel, normaliser(indre)])
    );
  }
  if (typeof verdi === "string") {
    if (tidsstempelMoenster.test(verdi)) {
      return "<tidspunkt>";
    }
    return verdi.replace(idMoenster, "<$1-id>");
  }
  return verdi;
}

// --- prosessoppstart -----------------------------------------------------

function start(navn, relativSti, miljo) {
  const barn = spawn(process.execPath, [path.join(rot, relativSti)], {
    cwd: rot,
    env: { ...process.env, ...miljo },
    stdio: ["ignore", "pipe", "pipe"]
  });
  barn.stdout.on("data", () => {});
  barn.stderr.on("data", (bit) => process.stderr.write(`[${navn}] ${bit}`));
  return barn;
}

// Uten denne ville et opptatt portnummer gitt en dump mot en fremmed instans med
// delt state/ i stedet for en tydelig feil.
async function krevLedigPort(portnummer) {
  await new Promise((klar, avvis) => {
    const proeve = createServer();
    proeve.once("error", (feil) => avvis(
      feil.code === "EADDRINUSE"
        ? new Error(`Port ${portnummer} er opptatt. Sett SMOKE_BACKEND_PORT/SMOKE_FIKS_PORT til ledige porter.`)
        : feil
    ));
    proeve.listen(portnummer, "127.0.0.1", () => proeve.close(klar));
  });
}

async function ventPaaHelse(basisUrl, tidsfrist = 15000) {
  const innen = Date.now() + tidsfrist;
  while (Date.now() < innen) {
    try {
      const svar = await fetch(`${basisUrl}/helse`);
      if (svar.ok) return;
    } catch {
      // tjenesten er ikke oppe ennaa
    }
    await new Promise((klar) => setTimeout(klar, 150));
  }
  throw new Error(`${basisUrl} svarte ikke paa /helse innen ${tidsfrist} ms.`);
}

// --- kall ----------------------------------------------------------------

const dump = [];

async function kall(navn, sti, valg = {}) {
  const svar = await fetch(`${backendUrl}${sti}`, {
    method: valg.method || "GET",
    headers: valg.body ? { "Content-Type": "application/json" } : undefined,
    body: valg.body ? JSON.stringify(valg.body) : undefined
  });
  const raatekst = await svar.text();
  let kropp;
  try {
    kropp = JSON.parse(raatekst);
  } catch {
    // /docs og /openapi.yaml er ikke JSON. Lengden holder som regresjonsvakt.
    kropp = { ikkeJson: true, lengde: raatekst.length };
  }
  dump.push({
    navn,
    metode: valg.method || "GET",
    sti: normaliser(sti),
    status: svar.status,
    kropp: normaliser(kropp)
  });
  return kropp;
}

// Statiske oppslag. Daekker alle GET-endepunkter uten sideeffekter.
async function statiskeOppslag() {
  await kall("helse", "/helse");
  await kall("docs", "/docs");
  await kall("openapi", "/openapi.yaml");
  await kall("personer", "/api/personer");
  await kall("person", "/api/personer/person-001");
  await kall("person-ukjent", "/api/personer/person-999");
  await kall("husstand", "/api/personer/person-001/husstand");
  await kall("barnehage", "/api/personer/person-001/barnehage");
  // person-008 er den foresatte som faktisk har et barn i SFO.
  await kall("sfo", "/api/personer/person-008/sfo");
  await kall("sfo-tom", "/api/personer/person-001/sfo");
  await kall("inntektsgrunnlag-uten-samtykke", "/api/husstander/household-001/inntektsgrunnlag");
  await kall("soknader", "/api/personer/person-001/soknader");
  await kall("inntekt-uten-samtykke", "/api/personer/person-001/inntekt");
  await kall("satser", "/api/regler/satser");
  await kall("prosesser", "/api/prosesser");
  await kall("prosesser-med-maler", "/api/prosesser?inkluderMaler=true");
  await kall("prosess", "/api/prosesser/reduced-kindergarten-payment");
  await kall("prosess-ukjent", "/api/prosesser/finnes-ikke");
  await kall("datasett", "/api/katalog/datasett");
  await kall("informasjonsmodeller", "/api/katalog/informasjonsmodeller");
  await kall("ressurskatalog", "/api/katalog/ressurser");
  await kall("gater", "/api/matrikkel/gater");
  await kall("gate-treff", "/api/matrikkel/gater?gate=Storgata");
  await kall("gate-bom", "/api/matrikkel/gater?gate=Finnesikkegata");
  await kall("eierforhold-ja", "/api/matrikkel/sjekk/eierforhold?personId=person-001&gate=Storgata");
  await kall("eierforhold-nei", "/api/matrikkel/sjekk/eierforhold?personId=person-001&gate=Fj%C3%B8sangerveien");
  await kall("sjekk-mangler-parametere", "/api/regler/sjekk/foreldrebetaling");
  await kall("sjekk-ukjent-ordning", "/api/regler/sjekk/foreldrebetaling?personId=person-001&ordning=finnes-ikke");
  await kall("ukjent-endepunkt", "/api/finnes-ikke");
}

// Foreldrebetaling: INFO -> husstand -> samtykke -> inntekt -> SJEKK.
// Stopper foer SUMMARY, som ville krevd ai-gateway.
async function foreldrebetalingsflyt(prosessId, merkelapp) {
  const oekt = await kall(`${merkelapp}-opprett`, "/api/prosessoekter", {
    method: "POST",
    body: { personId: "person-001", prosessId }
  });
  const id = oekt.oektsId;

  await kall(`${merkelapp}-info`, `/api/prosessoekter/${id}/handling`, { method: "POST", body: {} });
  await kall(`${merkelapp}-neste-1`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await kall(`${merkelapp}-husstand`, `/api/prosessoekter/${id}/handling`, { method: "POST", body: {} });
  await kall(`${merkelapp}-neste-2`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await kall(`${merkelapp}-samtykke-opprett`, `/api/prosessoekter/${id}/handling`, {
    method: "POST",
    body: { handling: "opprett-samtykke" }
  });
  await kall(`${merkelapp}-samtykke-svar`, `/api/prosessoekter/${id}/handling`, {
    method: "POST",
    body: { handling: "samtykkesvar", status: "SAMTYKKET" }
  });
  await kall(`${merkelapp}-neste-3`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await kall(`${merkelapp}-inntekt`, `/api/prosessoekter/${id}/handling`, { method: "POST", body: {} });
  await kall(`${merkelapp}-neste-4`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await kall(`${merkelapp}-sjekk`, `/api/prosessoekter/${id}/handling`, { method: "POST", body: {} });
  await kall(`${merkelapp}-oekt`, `/api/prosessoekter/${id}`);

  // Naa som samtykket ligger inne skal den direkte inntektsruta svare 200.
  await kall(`${merkelapp}-inntekt-med-samtykke`, "/api/personer/person-001/inntekt");
  await kall(`${merkelapp}-inntektsgrunnlag`, "/api/husstander/household-001/inntektsgrunnlag");
}

// Fartsdemping er den eneste casen som treffer SJEKK, matrikkel og
// {svar.<stegId>}-substitusjon samtidig.
async function fartsdempingsflyt(gate, merkelapp) {
  const oekt = await kall(`${merkelapp}-opprett`, "/api/prosessoekter", {
    method: "POST",
    body: { personId: "person-001", prosessId: "fartsdempende-tiltak" }
  });
  const id = oekt.oektsId;

  await kall(`${merkelapp}-neste-1`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await kall(`${merkelapp}-svar-gate`, `/api/prosessoekter/${id}/svar`, {
    method: "POST",
    body: { stegId: "velg-gate", svar: gate }
  });
  await kall(`${merkelapp}-neste-2`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await kall(`${merkelapp}-hent-gate`, `/api/prosessoekter/${id}/handling`, { method: "POST", body: {} });
  await kall(`${merkelapp}-neste-3`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await kall(`${merkelapp}-sjekk-eier`, `/api/prosessoekter/${id}/handling`, { method: "POST", body: {} });
  await kall(`${merkelapp}-oekt`, `/api/prosessoekter/${id}`);
}

async function soknadOgRevisjon() {
  const soknad = await kall("soknad-opprett", "/api/soknader", {
    method: "POST",
    body: { personId: "person-001", prosessId: "reduced-kindergarten-payment", prosessNavn: "Royktest" }
  });
  await kall("soknad-hent", `/api/soknader/${soknad.soknadId}`);
  await kall("soknad-ukjent", "/api/soknader/finnes-ikke");
  await kall("revisjonslogg", "/api/revisjonslogg");
}

// --- kjoering ------------------------------------------------------------

async function kjoer() {
  await krevLedigPort(backendPort);
  await krevLedigPort(fiksPort);

  const stateMappe = await mkdtemp(path.join(tmpdir(), "kontrakt-smoke-"));
  const miljo = {
    STATE_DIR: stateMappe,
    FIKS_BASE_URL: fiksUrl,
    BACKEND_BASE_URL: backendUrl,
    AI_BASE_URL: "http://127.0.0.1:8082"
  };

  const tjenester = [
    start("backend", "apps/sandbox-backend/src/server.ts", { ...miljo, PORT: String(backendPort) }),
    start("fiks", "apps/fiks-simulator/src/server.js", { ...miljo, PORT: String(fiksPort) })
  ];

  try {
    await Promise.all([ventPaaHelse(backendUrl), ventPaaHelse(fiksUrl)]);

    await statiskeOppslag();
    await foreldrebetalingsflyt("reduced-kindergarten-payment", "barnehage");
    await foreldrebetalingsflyt("sfo-moderasjon", "sfo");
    await fartsdempingsflyt("Storgata", "fartsdemping-eier");
    await fartsdempingsflyt("Fjøsangerveien", "fartsdemping-ikke-eier");
    await soknadOgRevisjon();

    await mkdir(path.dirname(utFil), { recursive: true });
    await writeFile(utFil, JSON.stringify(dump, null, 2) + "\n");
    console.log(`${dump.length} kall skrevet til ${path.relative(rot, utFil)}`);
  } finally {
    for (const tjeneste of tjenester) {
      tjeneste.kill("SIGTERM");
    }
    await rm(stateMappe, { recursive: true, force: true });
  }
}

kjoer().catch((feil) => {
  console.error(`Kontrakt-royktest feilet: ${feil.message}`);
  process.exit(1);
});
