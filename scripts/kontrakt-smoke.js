#!/usr/bin/env node

// Contract smoke test for sandbox-backend.
//
// Starts backend and fiks-simulator against a fresh, empty STATE_DIR, hits every
// endpoint with fixed test people, and writes a normalised JSON dump. Generated ids
// and timestamps are replaced with placeholders, so two runs of the same code give
// a byte-identical result.
//
// Usage:
//   node scripts/kontrakt-smoke.js --ut state/kontrakt-foer.json
//   ... refactor ...
//   node scripts/kontrakt-smoke.js --ut state/kontrakt-etter.json
//   diff state/kontrakt-foer.json state/kontrakt-etter.json
//
// matrikkel-mock is started too: the backend no longer reads the matrikkel seed
// off disk, so the street lookup and the ownership SJEKK go over HTTP. digdir-mock
// is started for the same reason: identity now comes from a token, and the dump has
// to be taken as a real caller rather than as nobody.
//
// Runs on its own ports against its own STATE_DIR, so it can run alongside docker
// compose without touching the shared runtime state in state/.
// ai-gateway is not needed: the flows deliberately stop before the SUMMARY step.

import { spawn } from "node:child_process";
import { hentInnbyggerToken, hentMaskinportenToken } from "../apps/digdir-mock/src/klient.ts";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendPort = Number(process.env.SMOKE_BACKEND_PORT) || 18080;
const fiksPort = Number(process.env.SMOKE_FIKS_PORT) || 18081;
const matrikkelPort = Number(process.env.SMOKE_MATRIKKEL_PORT) || 18086;
const digdirPort = Number(process.env.SMOKE_DIGDIR_PORT) || 18088;
const backendUrl = `http://127.0.0.1:${backendPort}`;
const fiksUrl = `http://127.0.0.1:${fiksPort}`;
const matrikkelUrl = `http://127.0.0.1:${matrikkelPort}`;
const digdirUrl = `http://127.0.0.1:${digdirPort}`;

const outFile = path.resolve(process.cwd(), argValue("--ut") || "state/kontrakt-dump.json");

function argValue(navn) {
  const index = process.argv.indexOf(navn);
  return index === -1 ? null : process.argv[index + 1];
}

// --- normalisation --------------------------------------------------------

// newId() produces "<prefix>-<milliseconds>-<six chars>". Backend and
// fiks-simulator use the same format, so one pattern covers both.
// Global, so ids are replaced inside URLs and messages too.
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

// --- process startup ------------------------------------------------------

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

// Without this, an occupied port would produce a dump against someone else's
// instance with shared state/ instead of a clear error.
async function krevLedigPort(portnummer) {
  await new Promise((klar, avvis) => {
    const proeve = createServer();
    proeve.once("error", (feil) => avvis(
      feil.code === "EADDRINUSE"
        ? new Error(`Port ${portnummer} er opptatt. Sett SMOKE_BACKEND_PORT/SMOKE_FIKS_PORT/SMOKE_MATRIKKEL_PORT/SMOKE_DIGDIR_PORT til ledige porter.`)
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
      // service is not up yet
    }
    await new Promise((klar) => setTimeout(klar, 150));
  }
  throw new Error(`${basisUrl} svarte ikke paa /helse innen ${tidsfrist} ms.`);
}

// --- calls ----------------------------------------------------------------

const dump = [];

// Long list endpoints are contract-checked by shape, not by volume. /api/personer
// returns 369 people and /api/matrikkel/gater 221 streets; dumping them whole made
// the file mostly data, so every added test person produced a huge diff and buried
// the contract change the diff exists to reveal.
function bareForm(kropp, antallViste) {
  if (!Array.isArray(kropp)) return kropp;
  return { antall: kropp.length, foerste: kropp.slice(0, antallViste) };
}

// The dump covers six different test people, so there is no single token that
// works: under the pid binding, a token for person-001 must not open person-031.
// `somPerson` picks whose token to send, and defaults to the person named in the
// path or query so most calls need no annotation at all.
//
// `somMaskin` is for the handful of calls that are not a citizen reading their own
// data — the audit log, and the resource catalogue.
// Which person a generated id belongs to, learned from the responses that create
// them. A prosessoekt and a soknad both carry `personId`, so after
// POST /api/prosessoekter every later call on that oektsId knows whose token to
// send — without annotating forty call sites.
//
// This mirrors the binding the backend enforces from B3: a session belongs to a
// person, and someone else's token must not drive it.
const eierAvId = new Map();

function lærEier(kropp) {
  if (!kropp || typeof kropp !== "object" || !kropp.personId) return;
  for (const felt of ["oektsId", "soknadId"]) {
    if (kropp[felt]) eierAvId.set(kropp[felt], kropp.personId);
  }
}

function personIdFor(sti) {
  const iStien = sti.match(/\/api\/personer\/(person-[0-9]+)/);
  if (iStien) return iStien[1];
  const iSoek = sti.match(/[?&]personId=(person-[0-9]+)/);
  if (iSoek) return iSoek[1];
  for (const [id, personId] of eierAvId) {
    if (sti.includes(id)) return personId;
  }
  return null;
}

async function autorisasjon(sti, valg) {
  if (valg.utenToken) return null;
  if (valg.somMaskin) {
    return `Bearer ${await hentMaskinportenToken({
      digdirBaseUrl: digdirUrl, issuer: digdirUrl, clientId: "kontrakt-smoke",
      scope: valg.somMaskin, resource: "sandbox-backend"
    })}`;
  }
  // A POST that creates something names its own owner in the body.
  const personId = valg.somPerson || valg.body?.personId || personIdFor(sti);
  if (!personId) return null;
  return `Bearer ${await hentInnbyggerToken({
    digdirBaseUrl: digdirUrl, personId, clientId: "kontrakt-smoke"
  })}`;
}

async function kall(navn, sti, valg = {}) {
  const token = await autorisasjon(sti, valg);
  const svar = await fetch(`${backendUrl}${sti}`, {
    method: valg.method || "GET",
    headers: {
      ...(valg.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: token } : {})
    },
    body: valg.body ? JSON.stringify(valg.body) : undefined
  });
  const rawText = await svar.text();
  let kropp;
  try {
    kropp = JSON.parse(rawText);
  } catch {
    // /docs and /openapi.yaml are not JSON. Length is enough of a regression guard.
    kropp = { ikkeJson: true, lengde: rawText.length };
  }
  lærEier(kropp);
  dump.push({
    navn,
    metode: valg.method || "GET",
    sti: normaliser(sti),
    status: svar.status,
    kropp: normaliser(valg.form ? bareForm(kropp, valg.form) : kropp)
  });
  return kropp;
}

// Static lookups. Covers every GET endpoint without side effects.
async function statiskeOppslag() {
  await kall("helse", "/helse");
  await kall("docs", "/docs");
  await kall("openapi", "/openapi.yaml");
  await kall("personer", "/api/personer", { form: 3, somMaskin: "ks:innbyggerdialog:les" });
  await kall("person", "/api/personer/person-001");
  // person-999 is not a testbruker, so no citizen token exists for them. A machine
  // with les-hjemmel asking about someone who does not exist is the honest caller here.
  await kall("person-ukjent", "/api/personer/person-999", { somMaskin: "ks:innbyggerdialog:les" });
  await kall("husstand", "/api/personer/person-001/husstand");
  // Address protection on the wire. Without these the dump never touches a
  // protected person: /api/personer is dumped with form: 3 and the first three are
  // all UGRADERT, so masking would not show up in a diff at all.
  //
  // person-031 is STRENGT_FORTROLIG (name and address masked), person-194 is
  // FORTROLIG (address masked, name kept) — the two levels must stay observably
  // different. household-093 holds only protected people so its adresse is masked;
  // household-013 has three unprotected residents and deliberately keeps its own.
  await kall("person-strengt-fortrolig", "/api/personer/person-031");
  await kall("person-fortrolig", "/api/personer/person-194");
  await kall("husstand-helt-skjermet", "/api/personer/person-218/husstand");
  await kall("husstand-delvis-skjermet", "/api/personer/person-030/husstand");
  await kall("barnehage", "/api/personer/person-001/barnehage");
  // person-008 is the guardian who actually has a child in SFO.
  await kall("sfo", "/api/personer/person-008/sfo");
  await kall("sfo-tom", "/api/personer/person-001/sfo");
  // Household routes resolve the applicant server-side, so the path names no person.
  await kall("inntektsgrunnlag-uten-samtykke", "/api/husstander/household-001/inntektsgrunnlag", { somPerson: "person-001" });
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
  await kall("gater", "/api/matrikkel/gater", { form: 3 });
  await kall("gate-treff", "/api/matrikkel/gater?gate=Storgata");
  await kall("gate-bom", "/api/matrikkel/gater?gate=Finnesikkegata");
  await kall("eierforhold-ja", "/api/matrikkel/sjekk/eierforhold?personId=person-001&gate=Storgata");
  await kall("eierforhold-nei", "/api/matrikkel/sjekk/eierforhold?personId=person-001&gate=Fj%C3%B8sangerveien");
  await kall("sjekk-mangler-parametere", "/api/regler/sjekk/foreldrebetaling");
  await kall("sjekk-ukjent-ordning", "/api/regler/sjekk/foreldrebetaling?personId=person-001&ordning=finnes-ikke");
  await kall("ukjent-endepunkt", "/api/finnes-ikke");
}

// Foreldrebetaling: INFO -> husstand -> samtykke -> inntekt -> SJEKK.
// Stops before SUMMARY, which would require ai-gateway.
async function foreldrebetalingsflyt(prosessId, merkelapp, hvem = {}) {
  const personId = hvem.personId || "person-001";
  const husstandId = hvem.husstandId || "household-001";
  const oekt = await kall(`${merkelapp}-opprett`, "/api/prosessoekter", {
    method: "POST",
    body: { personId, prosessId }
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

  // With the samtykke registered, the direct income route should now answer 200.
  await kall(`${merkelapp}-inntekt-med-samtykke`, `/api/personer/${personId}/inntekt`);
  await kall(`${merkelapp}-inntektsgrunnlag`, `/api/husstander/${husstandId}/inntektsgrunnlag`, { somPerson: personId });
}

// Fritidskort is the only ordning outside barnehage and SFO, and the only one that
// scopes by the child's age rather than by school year. Two people, so the dump
// carries both outcomes: person-028 is under the threshold, person-008 over it.
async function fritidskortflyt(personId, merkelapp) {
  const oekt = await kall(`${merkelapp}-opprett`, "/api/prosessoekter", {
    method: "POST",
    body: { personId, prosessId: "fritidskort-stotte" }
  });
  const id = oekt.oektsId;

  await kall(`${merkelapp}-neste-1`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await kall(`${merkelapp}-svar-behov`, `/api/prosessoekter/${id}/svar`, {
    method: "POST",
    body: { stegId: "behov", svar: { gjelderFor: "barnet mitt", aktivitet: "fotball" } }
  });
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
  await kall(`${merkelapp}-fritid`, `/api/personer/${personId}/fritid`);
}

// Støttekontakt is the only ordning assessed on need rather than money, and the
// only SJEKK that does not require income consent. The dump records that: the
// check answers before any samtykke for inntekt exists.
async function stottekontaktflyt(personId, merkelapp) {
  const oekt = await kall(`${merkelapp}-opprett`, "/api/prosessoekter", {
    method: "POST",
    body: { personId, prosessId: "stottekontakt-behov" }
  });
  const id = oekt.oektsId;

  await kall(`${merkelapp}-neste-1`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await kall(`${merkelapp}-svar-situasjon`, `/api/prosessoekter/${id}/svar`, {
    method: "POST",
    body: {
      stegId: "situasjon",
      svar: { beskrivelse: "Trenger noen å være sammen med i helgene", onskerKontakt: "ja", kontaktkanal: "Telefon" }
    }
  });
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
  await kall(`${merkelapp}-sjekk`, `/api/prosessoekter/${id}/handling`, { method: "POST", body: {} });
  await kall(`${merkelapp}-oekt`, `/api/prosessoekter/${id}`);
}

// Fartsdemping is the only case that exercises SJEKK, matrikkel and
// {svar.<stegId>} substitution at once.
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
  // With hjemmel, so the dump still records the 404 for an unknown id. Without a
  // token this is a 401 instead: authentication is settled before we say whether
  // something exists, so an anonymous caller cannot probe for valid ids.
  await kall("soknad-ukjent", "/api/soknader/finnes-ikke", { somMaskin: "ks:innbyggerdialog:les" });
  // And the 401 itself, pinned deliberately rather than arrived at by accident.
  await kall("uten-token", "/api/personer/person-001", { utenToken: true });
  await kall("revisjonslogg", "/api/revisjonslogg", { somMaskin: "ks:innbyggerdialog:les" });
}

// --- run ------------------------------------------------------------------

async function kjoer() {
  await krevLedigPort(backendPort);
  await krevLedigPort(fiksPort);
  await krevLedigPort(matrikkelPort);
  await krevLedigPort(digdirPort);

  const stateDir = await mkdtemp(path.join(tmpdir(), "kontrakt-smoke-"));
  const miljo = {
    STATE_DIR: stateDir,
    FIKS_BASE_URL: fiksUrl,
    BACKEND_BASE_URL: backendUrl,
    AI_BASE_URL: "http://127.0.0.1:8082",
    MATRIKKEL_BASE_URL: matrikkelUrl,
    // Dial address and logical issuer are the same here: everything runs on
    // 127.0.0.1, so there is no docker-network split to bridge.
    DIGDIR_BASE_URL: digdirUrl,
    DIGDIR_ISSUER: digdirUrl
  };

  const tjenester = [
    // digdir-mock first: it writes its signing key into the fresh STATE_DIR, and
    // the backend fetches that key over HTTP when it verifies the first token.
    start("digdir", "apps/digdir-mock/src/server.ts", { ...miljo, PORT: String(digdirPort) }),
    start("backend", "apps/sandbox-backend/src/server.ts", { ...miljo, PORT: String(backendPort) }),
    start("fiks", "apps/fiks-simulator/src/server.js", { ...miljo, PORT: String(fiksPort) }),
    start("matrikkel", "apps/matrikkel-mock/src/server.js", { ...miljo, PORT: String(matrikkelPort) })
  ];

  try {
    await Promise.all([
      ventPaaHelse(digdirUrl),
      ventPaaHelse(backendUrl),
      ventPaaHelse(fiksUrl),
      ventPaaHelse(matrikkelUrl)
    ]);

    await statiskeOppslag();
    await foreldrebetalingsflyt("reduced-kindergarten-payment", "barnehage");
    await foreldrebetalingsflyt("sfo-moderasjon", "sfo");
    // household-013 is the only household with both a protected guardian
    // (person-031, kode 6) and an unprotected one (person-030). It is therefore the
    // only case that reaches the infotekst in fiks-simulator's byggVisningsposter:
    // "Beløpet inkluderer et husstandsmedlem med skjermet identitet, som ikke kan
    // spesifiseres."
    //
    // That branch had no test anywhere before this. Note that the protected
    // person's amount still counts towards beregningsbeloep by design — only their
    // share is withheld. If the total ever drops here, something started masking
    // money instead of identity.
    await foreldrebetalingsflyt("sfo-moderasjon", "sfo-skjermet-medlem", {
      personId: "person-030",
      husstandId: "household-013"
    });
    await fritidskortflyt("person-028", "fritidskort-innvilget");
    await fritidskortflyt("person-008", "fritidskort-avslag");
    await stottekontaktflyt("person-001", "stottekontakt-innvilget");
    await stottekontaktflyt("person-003", "stottekontakt-fullt");
    await fartsdempingsflyt("Storgata", "fartsdemping-eier");
    await fartsdempingsflyt("Fjøsangerveien", "fartsdemping-ikke-eier");
    await soknadOgRevisjon();

    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, JSON.stringify(dump, null, 2) + "\n");
    console.log(`${dump.length} kall skrevet til ${path.relative(rot, outFile)}`);
  } finally {
    for (const tjeneste of tjenester) {
      tjeneste.kill("SIGTERM");
    }
    await rm(stateDir, { recursive: true, force: true });
  }
}

kjoer().catch((feil) => {
  console.error(`Kontrakt-royktest feilet: ${feil.message}`);
  process.exit(1);
});
