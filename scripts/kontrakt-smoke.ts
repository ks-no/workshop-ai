#!/usr/bin/env node

// Contract smoke test for sandbox-backend.
//
// Starts backend and fiks-simulator against a fresh, empty STATE_DIR, hits every
// endpoint with fixed test people, and writes a normalised JSON dump. Generated ids
// and timestamps are replaced with placeholders, so two runs of the same code give
// a byte-identical result.
//
// Usage:
//   node scripts/kontrakt-smoke.ts --ut state/kontrakt-foer.json
//   ... refactor ...
//   node scripts/kontrakt-smoke.ts --ut state/kontrakt-etter.json
//   diff state/kontrakt-foer.json state/kontrakt-etter.json
//
// matrikkel-mock is started too: the street lookup and the ownership SJEKK go over
// HTTP, not off a seed the backend reads itself. digdir-mock likewise: identity
// comes from a token, and the dump has to be taken as a real caller, not as nobody.
// pasientjournal-mock likewise: the legeerklæring the TT-kort vedtak rests on goes
// over HTTP, behind the samtykke gate.
//
// Runs on its own ports against its own STATE_DIR, so it can run alongside docker
// compose without touching the shared runtime state in state/.
// ai-gateway is started too, so stottekontaktflyt's innvilget case can reach
// SUMMARY and SUBMIT. It runs with no AI_PROVIDER set, so /ai/oppsummering
// answers with the deterministic mock template - no network call, no flakiness.

import { spawn } from "node:child_process";
import { getInnbyggerToken, getMaskinportenToken } from "../apps/digdir-mock/src/client.ts";
import { FOLKEREGISTERROLLER } from "../apps/fiks-simulator/src/folkeregister.ts";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { feilkode, feilmelding } from "../apps/shared/errors.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendPort = Number(process.env.SMOKE_BACKEND_PORT) || 18080;
const fiksPort = Number(process.env.SMOKE_FIKS_PORT) || 18081;
const matrikkelPort = Number(process.env.SMOKE_MATRIKKEL_PORT) || 18086;
const digdirPort = Number(process.env.SMOKE_DIGDIR_PORT) || 18088;
const pasientjournalPort = Number(process.env.SMOKE_PASIENTJOURNAL_PORT) || 18090;
const politiattestPort = Number(process.env.SMOKE_POLITIATTEST_PORT) || 18091;
const aiPort = Number(process.env.SMOKE_AI_PORT) || 18089;
const backendUrl = `http://127.0.0.1:${backendPort}`;
const fiksUrl = `http://127.0.0.1:${fiksPort}`;
const matrikkelUrl = `http://127.0.0.1:${matrikkelPort}`;
const digdirUrl = `http://127.0.0.1:${digdirPort}`;
const pasientjournalUrl = `http://127.0.0.1:${pasientjournalPort}`;
const politiattestUrl = `http://127.0.0.1:${politiattestPort}`;
const aiUrl = `http://127.0.0.1:${aiPort}`;
const STOTTEKONTAKT_KILDE =
  "Helse- og omsorgstjenesteloven § 5-4, jf. politiregisterloven § 41 nr. 1 og § 40.";

const outFile = path.resolve(process.cwd(), argValue("--ut") || "state/kontrakt-dump.json");

function argValue(navn: string) {
  const index = process.argv.indexOf(navn);
  return index === -1 ? null : process.argv[index + 1];
}

// --- normalisation --------------------------------------------------------

// newId() produces "<prefix>-<milliseconds>-<six chars>". Backend and
// fiks-simulator use the same format, so one pattern covers both.
// Global, so ids are replaced inside URLs and messages too.
const idMoenster = /([a-z]+)-\d{13}-[a-z0-9]{6}/g;
const tidsstempelMoenster = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function normalize(verdi: unknown): unknown {
  if (Array.isArray(verdi)) {
    return verdi.map(normalize);
  }
  if (verdi && typeof verdi === "object") {
    return Object.fromEntries(
      Object.entries(verdi).map(([noekkel, indre]) => [noekkel, normalize(indre)])
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

function start(navn: string, relativSti: string, miljo: any) {
  const barn = spawn(process.execPath, [path.join(repoRoot, relativSti)], {
    cwd: repoRoot,
    env: { ...process.env, ...miljo },
    stdio: ["ignore", "pipe", "pipe"]
  });
  barn.stdout.on("data", () => {});
  barn.stderr.on("data", (chunk) => process.stderr.write(`[${navn}] ${chunk}`));
  return barn;
}

// Without this, an occupied port would produce a dump against someone else's
// instance with shared state/ instead of a clear error.
async function requireFreePort(portnummer: number) {
  await new Promise((klar, avvis) => {
    const proeve = createServer();
    proeve.once("error", (feil) => avvis(
      feilkode(feil) === "EADDRINUSE"
        ? new Error(`Port ${portnummer} er opptatt. Sett SMOKE_BACKEND_PORT/SMOKE_FIKS_PORT/SMOKE_MATRIKKEL_PORT/SMOKE_DIGDIR_PORT/SMOKE_PASIENTJOURNAL_PORT/SMOKE_POLITIATTEST_PORT/SMOKE_AI_PORT til ledige porter.`)
        : feil
    ));
    proeve.listen(portnummer, "127.0.0.1", () => proeve.close(klar));
  });
}

async function waitForHealth(basisUrl: string, tidsfrist = 15000) {
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
  throw new Error(`${basisUrl} svarte ikke på /helse innen ${tidsfrist} ms.`);
}

// --- calls ----------------------------------------------------------------

const dump: Record<string, unknown>[] = [];

// Long list endpoints are contract-checked by shape, not by volume. /api/personer
// returns 369 people and /api/matrikkel/gater 221 streets; dumping them whole made
// the file mostly data, so every added test person produced a huge diff and buried
// the contract change the diff exists to reveal.
// `antall` og `first` er dumpens egne nøkler, ikke en tjenestes. Endres de,
// endres hver linje i dumpen - og da er en før/etter-sammenlikning verdiløs
// til en ny baseline er tatt.
function shapeOnly(kropp: any, antallViste: number) {
  if (!Array.isArray(kropp)) return kropp;
  return { antall: kropp.length, first: kropp.slice(0, antallViste) };
}

// The dump covers six different test people, so there is no single token that
// works: under the pid binding, a token for person-001 must not open person-031.
// `somPerson` picks whose token to send, and defaults to the person named in the
// path or query so most calls need no annotation at all.
//
// `somMaskin` is for the handful of calls that are not a citizen reading their own
// data - the audit log, and the resource catalogue.
// Which person a generated id belongs to, learned from the responses that create
// them. A prosessoekt and a soknad both carry `personId`, so after
// POST /api/prosessoekter every later call on that oektsId knows whose token to
// send - without annotating forty call sites.
//
// This mirrors the binding the backend enforces from B3: a session belongs to a
// person, and someone else's token must not drive it.
const eierAvId = new Map();

function learnOwner(kropp: any) {
  if (!kropp || typeof kropp !== "object" || !kropp.personId) return;
  for (const felt of ["oektsId", "soknadId"]) {
    if (kropp[felt]) eierAvId.set(kropp[felt], kropp.personId);
  }
}

function personIdFor(sti: string) {
  const iStien = sti.match(/\/api\/personer\/(person-[0-9]+)/);
  if (iStien) return iStien[1];
  const iSoek = sti.match(/[?&]personId=(person-[0-9]+)/);
  if (iSoek) return iSoek[1];
  for (const [id, personId] of eierAvId) {
    if (sti.includes(id)) return personId;
  }
  return null;
}

async function autorisasjon(sti: string, valg: any) {
  if (valg.utenToken) return null;
  if (valg.somMaskin) {
    return `Bearer ${await getMaskinportenToken({
      digdirBaseUrl: digdirUrl, issuer: digdirUrl, clientId: "kontrakt-smoke",
      scope: valg.somMaskin, resource: "sandbox-backend"
    })}`;
  }
  // A POST that creates something names its own owner in the body.
  const personId = valg.somPerson || valg.body?.personId || personIdFor(sti);
  if (!personId) return null;
  return `Bearer ${await getInnbyggerToken({
    digdirBaseUrl: digdirUrl, personId, clientId: "kontrakt-smoke"
  })}`;
}

/** Hva ett kall i dumpen kan overstyre. `form` viser bare formen, ikke verdiene. */
type Kallvalg = {
  method?: string;
  body?: unknown;
  form?: number;
  somPerson?: string;
  somMaskin?: string;
  /** Framkaller 401 med vilje. */
  utenToken?: boolean;
};

async function call(navn: string, sti: string, valg: Kallvalg = {}) {
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
  learnOwner(kropp);
  dump.push({
    navn,
    metode: valg.method || "GET",
    sti: normalize(sti),
    status: svar.status,
    kropp: normalize(valg.form ? shapeOnly(kropp, valg.form) : kropp)
  });
  return kropp;
}

// A call straight at fiks-simulator, as the machine the backend would be. The
// register surfaces need a Maskinporten token with audience fiks-simulator - a
// backend token is refused there, which is the point of audience restriction.
// Scope per call, because the surfaces have one each: the folkeregister lookups
// need ks:fiks:folkeregister, and a register token must not open them.
async function callFiks(
  navn: string,
  sti: string,
  body?: unknown,
  valg: { metode?: string; scope?: string } = {}
) {
  const token = await getMaskinportenToken({
    digdirBaseUrl: digdirUrl, issuer: digdirUrl, clientId: "kontrakt-smoke",
    scope: valg.scope || "ks:fiks:register", resource: "fiks-simulator"
  });
  const svar = await fetch(`${fiksUrl}${sti}`, {
    method: valg.metode || "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      Authorization: `Bearer ${token}`
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const kropp = await svar.json();
  dump.push({
    navn,
    metode: valg.metode || "POST",
    sti: normalize(sti),
    status: svar.status,
    kropp: normalize(kropp)
  });
  return kropp;
}

// Static lookups. Covers every GET endpoint without side effects.
async function staticLookups() {
  await call("helse", "/helse");
  await call("docs", "/docs");
  await call("openapi", "/openapi.yaml");
  await call("personer", "/api/personer", { form: 3, somMaskin: "ks:innbyggerdialog:les" });
  await call("person", "/api/personer/person-001");
  // person-999 is not a testbruker, so no citizen token exists for them. A machine
  // with les-hjemmel asking about someone who does not exist is the honest caller here.
  await call("person-ukjent", "/api/personer/person-999", { somMaskin: "ks:innbyggerdialog:les" });
  await call("husstand", "/api/personer/person-001/husstand");
  // Address protection on the wire. Without these the dump never touches a
  // protected person: /api/personer is dumped with form: 3 and the first three are
  // all UGRADERT, so masking would not show up in a diff at all.
  //
  // person-031 is STRENGT_FORTROLIG (name and address masked), person-194 is
  // FORTROLIG (address masked, name kept) - the two levels must stay observably
  // different. household-093 holds only protected people so its adresse is masked;
  // household-013 has three unprotected residents and deliberately keeps its own.
  await call("person-strengt-fortrolig", "/api/personer/person-031");
  await call("person-fortrolig", "/api/personer/person-194");
  await call("husstand-helt-skjermet", "/api/personer/person-218/husstand");
  await call("husstand-delvis-skjermet", "/api/personer/person-030/husstand");
  await call("barnehage", "/api/personer/person-001/barnehage");
  // person-008 is the guardian who actually has a child in SFO.
  await call("sfo", "/api/personer/person-008/sfo");
  await call("sfo-tom", "/api/personer/person-001/sfo");
  // Household routes resolve the applicant server-side, so the path names no person.
  await call("inntektsgrunnlag-uten-samtykke", "/api/husstander/household-001/inntektsgrunnlag", { somPerson: "person-001" });
  await call("soknader", "/api/personer/person-001/soknader");
  await call("inntekt-uten-samtykke", "/api/personer/person-001/inntekt");
  const satser = await call("satser", "/api/regler/satser") as { kilde?: unknown };
  if (typeof satser.kilde !== "string" || satser.kilde.length === 0) {
    throw new Error("GET /api/regler/satser mangler det eksisterende feltet kilde.");
  }
  await call("prosesser", "/api/prosesser");
  await call("prosesser-med-maler", "/api/prosesser?inkluderMaler=true");
  await call("prosess", "/api/prosesser/redusert-foreldrebetaling-barnehage");
  await call("prosess-ukjent", "/api/prosesser/finnes-ikke");
  await call("datasett", "/api/katalog/datasett");
  await call("informasjonsmodeller", "/api/katalog/informasjonsmodeller");
  await call("ressurskatalog", "/api/katalog/ressurser");
  await call("gater", "/api/matrikkel/gater", { form: 3 });
  await call("gate-treff", "/api/matrikkel/gater?gate=Storgata");
  await call("gate-bom", "/api/matrikkel/gater?gate=Finnesikkegata");
  await call("eierforhold-ja", "/api/matrikkel/sjekk/eierforhold?personId=person-001&gate=Storgata");
  await call("eierforhold-nei", "/api/matrikkel/sjekk/eierforhold?personId=person-001&gate=Fj%C3%B8sangerveien");
  await call("sjekk-mangler-parametere", "/api/regler/sjekk/foreldrebetaling");
  await call("sjekk-ukjent-ordning", "/api/regler/sjekk/foreldrebetaling?personId=person-001&ordning=finnes-ikke");
  await call("ukjent-endepunkt", "/api/finnes-ikke");
}

// Foreldrebetaling: INFO -> husstand -> samtykke -> inntekt -> SJEKK.
// Stops before SUMMARY, which would require ai-gateway.
async function foreldrebetalingsflyt(
  prosessId: string,
  merkelapp: string,
  hvem: { personId?: string; husstandId?: string } = {}
) {
  const personId = hvem.personId || "person-001";
  const husstandId = hvem.husstandId || "household-001";
  const oekt = await call(`${merkelapp}-opprett`, "/api/prosessoekter", {
    method: "POST",
    body: { personId, prosessId }
  });
  const id = oekt.oektsId;

  await call(`${merkelapp}-info`, `/api/prosessoekter/${id}/handling`, { method: "POST", body: {} });
  await call(`${merkelapp}-neste-1`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await call(`${merkelapp}-husstand`, `/api/prosessoekter/${id}/handling`, { method: "POST", body: {} });
  await call(`${merkelapp}-neste-2`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await call(`${merkelapp}-samtykke-opprett`, `/api/prosessoekter/${id}/handling`, {
    method: "POST",
    body: { handling: "opprett-samtykke" }
  });
  await call(`${merkelapp}-samtykke-svar`, `/api/prosessoekter/${id}/handling`, {
    method: "POST",
    body: { handling: "samtykkesvar", status: "SAMTYKKET" }
  });
  await call(`${merkelapp}-neste-3`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await call(`${merkelapp}-inntekt`, `/api/prosessoekter/${id}/handling`, { method: "POST", body: {} });
  await call(`${merkelapp}-neste-4`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await call(`${merkelapp}-sjekk`, `/api/prosessoekter/${id}/handling`, { method: "POST", body: {} });
  await call(`${merkelapp}-oekt`, `/api/prosessoekter/${id}`);

  // With the samtykke registered, the direct income route should now answer 200.
  await call(`${merkelapp}-inntekt-med-samtykke`, `/api/personer/${personId}/inntekt`);
  await call(`${merkelapp}-inntektsgrunnlag`, `/api/husstander/${husstandId}/inntektsgrunnlag`, { somPerson: personId });
}

// Fritidskort is the only ordning outside barnehage and SFO, and the only one that
// scopes by the child's age rather than by school year. Two people, so the dump
// carries both outcomes: person-028 is under the threshold, person-008 over it.
async function fritidskortflyt(personId: string, merkelapp: string) {
  const oekt = await call(`${merkelapp}-opprett`, "/api/prosessoekter", {
    method: "POST",
    body: { personId, prosessId: "fritidskort-stotte" }
  });
  const id = oekt.oektsId;

  await call(`${merkelapp}-neste-1`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await call(`${merkelapp}-svar-behov`, `/api/prosessoekter/${id}/svar`, {
    method: "POST",
    body: { stegId: "behov", svar: { gjelderFor: "barnet mitt", aktivitet: "fotball" } }
  });
  await call(`${merkelapp}-neste-2`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await call(`${merkelapp}-samtykke-opprett`, `/api/prosessoekter/${id}/handling`, {
    method: "POST",
    body: { handling: "opprett-samtykke" }
  });
  await call(`${merkelapp}-samtykke-svar`, `/api/prosessoekter/${id}/handling`, {
    method: "POST",
    body: { handling: "samtykkesvar", status: "SAMTYKKET" }
  });
  await call(`${merkelapp}-neste-3`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await call(`${merkelapp}-inntekt`, `/api/prosessoekter/${id}/handling`, { method: "POST", body: {} });
  await call(`${merkelapp}-neste-4`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await call(`${merkelapp}-sjekk`, `/api/prosessoekter/${id}/handling`, { method: "POST", body: {} });
  await call(`${merkelapp}-oekt`, `/api/prosessoekter/${id}`);
  await call(`${merkelapp}-fritid`, `/api/personer/${personId}/fritid`);
}

// Støttekontakt is the only ordning assessed on need rather than money, and the
// only SJEKK that does not require income consent. The dump records that: the
// check answers before any samtykke for inntekt exists.
//
// It is also the only case that consents to something other than inntekt: the
// hent-kontaktinfo step between the samtykke and the SJEKK spends that consent on
// KRR. stottekontaktUtenSamtykke below pins the other half - what that step
// answers when nobody consented.
//
// `tilSubmit` only makes sense for the innvilget case: the avvist case would
// still reach SUBMIT (SJEKK rejecting does not stop stegIndex from advancing),
// but sending in a rejected søknad is not a flow worth pinning here.
async function stottekontaktflyt(personId: string, merkelapp: string, tilSubmit = false) {
  const oekt = await call(`${merkelapp}-opprett`, "/api/prosessoekter", {
    method: "POST",
    body: { personId, prosessId: "stottekontakt-behov" }
  });
  const id = oekt.oektsId;

  await call(`${merkelapp}-neste-1`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await call(`${merkelapp}-svar-situasjon`, `/api/prosessoekter/${id}/svar`, {
    method: "POST",
    body: {
      stegId: "situasjon",
      svar: { beskrivelse: "Trenger noen å være sammen med i helgene", onskerKontakt: "ja", kontaktkanal: "Telefon" }
    }
  });
  await call(`${merkelapp}-neste-2`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await call(`${merkelapp}-samtykke-opprett`, `/api/prosessoekter/${id}/handling`, {
    method: "POST",
    body: { handling: "opprett-samtykke" }
  });
  await call(`${merkelapp}-samtykke-svar`, `/api/prosessoekter/${id}/handling`, {
    method: "POST",
    body: { handling: "samtykkesvar", status: "SAMTYKKET" }
  });
  await call(`${merkelapp}-neste-3`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await call(`${merkelapp}-kontaktinfo`, `/api/prosessoekter/${id}/handling`, { method: "POST", body: {} });
  await call(`${merkelapp}-neste-4`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await call(`${merkelapp}-sjekk`, `/api/prosessoekter/${id}/handling`, { method: "POST", body: {} });
  await call(`${merkelapp}-oekt`, `/api/prosessoekter/${id}`);

  if (!tilSubmit) return;

  // The only flow in this script reaching SUMMARY and SUBMIT - everything else
  // deliberately stops earlier. Pins the soknadsdokument field alongside the
  // deterministic mock oppsummeringstekst it embeds, and the SvarUt kvittering
  // the same step sends.
  await call(`${merkelapp}-neste-5`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await call(`${merkelapp}-oppsummering`, `/api/prosessoekter/${id}/handling`, { method: "POST", body: {} });
  await call(`${merkelapp}-neste-6`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  const innsending = await call(`${merkelapp}-send-inn`, `/api/prosessoekter/${id}/handling`, {
    method: "POST", body: {}
  }) as { resultat: { soknadId: string } };
  await call(`${merkelapp}-oekt-fullfort`, `/api/prosessoekter/${id}`);

  // The kvittering's own route, read right after the send: the derivation's first
  // threshold is ten seconds out, so MOTTATT is the deterministic answer here the
  // same way it is for forsendelseFlyt's status-sok below.
  //
  // somPerson is explicit because the søknadId is nested inside `resultat` on the
  // POST /handling response, which learnOwner does not walk - the route is the
  // citizen's own, and reading it as nobody would only pin a 401.
  const soknadId = innsending.resultat.soknadId;
  await call(`${merkelapp}-forsendelse`, `/api/soknader/${soknadId}/forsendelse`, { somPerson: personId });
}

// The other half of the flow above: a citizen who walks past the CONSENT_REQUEST
// without answering it. The samtykke gate lives in the resource catalogue, not in
// the step, so the 403 has to reach the caller through POST /handling unchanged -
// that relay is what this pins, and the direct-route 403 in kontaktinfoOppslag
// cannot say anything about it.
//
// person-022 is used nowhere else in this script, so no other flow can leave a
// kontaktinfo samtykke behind and quietly turn this 403 into a 200.
async function stottekontaktUtenSamtykke(merkelapp: string) {
  const oekt = await call(`${merkelapp}-opprett`, "/api/prosessoekter", {
    method: "POST",
    body: { personId: "person-022", prosessId: "stottekontakt-behov" }
  });
  const id = oekt.oektsId;

  // Straight to hent-kontaktinfo: /neste only moves stegIndex, so the samtykke
  // step is passed over rather than run.
  for (const nummer of [1, 2, 3]) {
    await call(`${merkelapp}-neste-${nummer}`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  }
  await call(`${merkelapp}-kontaktinfo`, `/api/prosessoekter/${id}/handling`, { method: "POST", body: {} });
  // A refused step leaves the økt open - withSession saves nothing when the
  // handler throws - so the citizen can go back and consent.
  await call(`${merkelapp}-oekt`, `/api/prosessoekter/${id}`);
}

// Fartsdemping is the only case that exercises SJEKK, matrikkel and
// {svar.<stegId>} substitution at once.
async function fartsdempingsflyt(gate: string, merkelapp: string) {
  const oekt = await call(`${merkelapp}-opprett`, "/api/prosessoekter", {
    method: "POST",
    body: { personId: "person-001", prosessId: "fartsdempende-tiltak" }
  });
  const id = oekt.oektsId;

  await call(`${merkelapp}-neste-1`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await call(`${merkelapp}-svar-gate`, `/api/prosessoekter/${id}/svar`, {
    method: "POST",
    body: { stegId: "velg-gate", svar: gate }
  });
  await call(`${merkelapp}-neste-2`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await call(`${merkelapp}-hent-gate`, `/api/prosessoekter/${id}/handling`, { method: "POST", body: {} });
  await call(`${merkelapp}-neste-3`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await call(`${merkelapp}-sjekk-eier`, `/api/prosessoekter/${id}/handling`, { method: "POST", body: {} });
  await call(`${merkelapp}-oekt`, `/api/prosessoekter/${id}`);
}

async function soknadOgRevisjon() {
  const soknad = await call("soknad-opprett", "/api/soknader", {
    method: "POST",
    body: { personId: "person-001", prosessId: "redusert-foreldrebetaling-barnehage", prosessNavn: "Royktest" }
  });
  await call("soknad-hent", `/api/soknader/${soknad.soknadId}`);
  // With hjemmel, so the dump still records the 404 for an unknown id. Without a
  // token this is a 401 instead: authentication is settled before we say whether
  // something exists, so an anonymous caller cannot probe for valid ids.
  await call("soknad-ukjent", "/api/soknader/finnes-ikke", { somMaskin: "ks:innbyggerdialog:les" });
  // And the 401 itself, pinned deliberately rather than arrived at by accident.
  await call("uten-token", "/api/personer/person-001", { utenToken: true });
  await call("revisjonslogg", "/api/revisjonslogg", { somMaskin: "ks:innbyggerdialog:les" });
}

// The KRR lookup on fiks-simulator's real Fiks path, with every branch the route
// has: notifiable, reserved (person-014 - the curated print-channel case), a kode
// 6 person whose contact info must come back nulled, the two 404s, and the 400.
// The fnr values are the curated fixtures', so the dump stays deterministic.
async function krrOppslag() {
  const sti = "/register/api/v1/ks/smoke-rolle/krr/person";
  // person-006: contact info, authored spraak "en", kanVarsles true.
  await callFiks("krr-varslbar", sti, { fnr: "14899200099" });
  // person-014: authored reservert, so kanVarsles false despite contact info.
  await callFiks("krr-reservert", sti, { fnr: "28829100055" });
  // person-031 is STRENGT_FORTROLIG: epost and tlf nulled, the rest kept.
  await callFiks("krr-kode-6", sti, { fnr: "16848300180" });
  // person-002 is 4 years old: known, but below KRR's age floor.
  await callFiks("krr-under-15", sti, { fnr: "03842250055" });
  // person-371 is UTFLYTTET: known, but not bosatt.
  await callFiks("krr-ikke-bosatt", sti, { fnr: "09810198602" });
  // Valid modulus 11, +80 month, and belongs to nobody in the population.
  await callFiks("krr-ukjent", sti, { fnr: "15879000006" });
  await callFiks("krr-ugyldig", sti, { fnr: "11111111111" });
}

// The folkeregister lookup on the real Fiks proxy path, one call per role plus
// every refusal the route has. The rolleIds come from the closed map itself, so
// the smoke test cannot drift from the code. person-001 is the curated fixture;
// the three role lookups on the same person are what makes the minimisation
// visible in the dump: same fnr, three different key sets.
async function folkeregisterOppslag() {
  const rolleId = (navn: string) =>
    FOLKEREGISTERROLLER.find((rolle) => rolle.navn === navn)!.rolleId;
  const fregSti = (rolle: string, fnr: string, soek = "") =>
    `/folkeregister/api/v1/${rolle}/v1/personer/${fnr}${soek}`;
  const lookup = (navn: string, rolle: string, fnr: string, soek = "") =>
    callFiks(navn, fregSti(rolle, fnr, soek), undefined, {
      metode: "GET",
      scope: "ks:fiks:folkeregister"
    });

  await lookup("freg-oppvekst", rolleId("oppvekst"), "12818800078");
  await lookup("freg-helse-omsorg", rolleId("helse-omsorg"), "12818800078");
  // No name, no address - the narrowest role, on the same person.
  await lookup("freg-folkehelse", rolleId("folkehelse"), "12818800078");
  // ?part= narrows within the role; the order in the answer is canonical, not
  // the query string's.
  await lookup("freg-part-innsnevret", rolleId("oppvekst"), "12818800078", "?part=kjoenn&part=foedselsdato");
  // A part outside the role is a refusal, not an empty field.
  await lookup("freg-part-utenfor-rolle", rolleId("folkehelse"), "12818800078", "?part=personnavn");
  await lookup("freg-part-ukjent", rolleId("oppvekst"), "12818800078", "?part=skonummer");
  // Unknown rolleId answers with the valid roles in the message.
  await lookup("freg-ukjent-rolle", "finnes-ikke", "12818800078");
  // person-031 is STRENGT_FORTROLIG: masked name and address, with
  // adressebeskyttelse surviving to explain why.
  await lookup("freg-kode-6", rolleId("oppvekst"), "16848300180");
  // Valid modulus 11, +80 month, and belongs to nobody in the population.
  await lookup("freg-ukjent-fnr", rolleId("oppvekst"), "15879000006");
  await lookup("freg-ugyldig-fnr", rolleId("oppvekst"), "11111111111");
  // The folkeregister is its own hjemmel: a register token must not open it.
  await callFiks(
    "freg-feil-scope",
    fregSti(rolleId("oppvekst"), "12818800078"),
    undefined,
    { metode: "GET", scope: "ks:fiks:register" }
  );
  // Nor must the citizen's own ID-porten token, even with the right audience:
  // the hjemmel belongs to the municipality, not to whoever is logged in.
  const idToken = await getInnbyggerToken({
    digdirBaseUrl: digdirUrl, personId: "person-001", clientId: "kontrakt-smoke",
    resource: "fiks-simulator"
  });
  const idSvar = await fetch(`${fiksUrl}${fregSti(rolleId("oppvekst"), "12818800078")}`, {
    headers: { Authorization: `Bearer ${idToken}` }
  });
  dump.push({
    navn: "freg-idporten",
    metode: "GET",
    sti: normalize(fregSti(rolleId("oppvekst"), "12818800078")),
    status: idSvar.status,
    kropp: normalize(await idSvar.json())
  });

  // The audit entries the lookups above produced: rolle and deler in grunnlag,
  // and no fnr. Filtered here because the backend has no handling-filter, and
  // the full log is already dumped once in soknadOgRevisjon.
  const token = await getMaskinportenToken({
    digdirBaseUrl: digdirUrl, issuer: digdirUrl, clientId: "kontrakt-smoke",
    scope: "ks:innbyggerdialog:les", resource: "sandbox-backend"
  });
  const svar = await fetch(`${backendUrl}/api/revisjonslogg`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const logg = await svar.json() as { handling?: string }[];
  dump.push({
    navn: "freg-revisjon",
    metode: "GET",
    sti: "/api/revisjonslogg (kun FOLKEREGISTEROPPSLAG_UTFOERT)",
    status: svar.status,
    kropp: normalize(logg.filter((rad) => rad.handling === "FOLKEREGISTEROPPSLAG_UTFOERT"))
  });
}

// SvarUt: one send per channel, then an immediate status-sok - deterministically
// MOTTATT for every row, since the derivation's first threshold is 10 seconds
// out. The recipients are the curated KRR fixtures, same as krrOppslag above.
async function forsendelseFlyt() {
  const sti = "/svarut/api/v2/kontoer/smoke-konto/forsendelser";
  const svarut = { scope: "ks:fiks:svarut" };
  const dokumenter = [{ filnavn: "vedtak.pdf", mimeType: "application/pdf" }];
  const postadresse = { adresselinje1: "Storgata 5", postnummer: "5003", poststed: "Bergen" };
  const tittel = "Vedtak om redusert foreldrebetaling";

  // person-006 can be notified in KRR: DIGITAL.
  const digital = await callFiks("forsendelse-digital", sti, {
    tittel, mottaker: { navn: "Amir Hassan", digitalId: "14899200099" }, dokumenter
  }, svarut) as { id?: string };
  // person-014 is authored reservert: PRINT - the curated main case.
  const print = await callFiks("forsendelse-print", sti, {
    tittel, mottaker: { navn: "Lina Berg", digitalId: "28829100055", ...postadresse }, dokumenter
  }, svarut) as { id?: string };
  // kunDigitalLevering without a digital channel: INGEN, ends as IKKE_LEVERT.
  const ingen = await callFiks("forsendelse-ingen-kanal", sti, {
    tittel, mottaker: { navn: "Lina Berg", digitalId: "28829100055" }, dokumenter,
    kunDigitalLevering: true
  }, svarut) as { id?: string };
  // No digital channel and no postal address is a 400, not a stored row.
  await callFiks("forsendelse-uten-kanal", sti, {
    tittel, mottaker: { navn: "Lina Berg" }, dokumenter
  }, svarut);
  await callFiks("forsendelse-uten-tittel", sti, {
    mottaker: { navn: "Lina Berg", ...postadresse }, dokumenter
  }, svarut);
  await callFiks("forsendelse-tom-dokumentliste", sti, {
    tittel, mottaker: { navn: "Lina Berg", ...postadresse }, dokumenter: []
  }, svarut);

  // Unknown ids are omitted from the answer rather than answered for.
  await callFiks("forsendelse-status-sok", `${sti}/status-sok`, {
    forsendelseIds: [digital.id, print.id, ingen.id, "forsendelse-0000000000000-ukjent"]
  }, svarut);
  await callFiks("forsendelse-status-sok-uten-ids", `${sti}/status-sok`, {}, svarut);
  // A register token must not open the SvarUt surface.
  await callFiks("forsendelse-feil-scope", `${sti}/status-sok`, { forsendelseIds: [] },
    { scope: "ks:fiks:register" });

  // The audit entries: id, kanal and mottakerVarslet in grunnlag - and no
  // contact info. Filtered like freg-revisjon above.
  const token = await getMaskinportenToken({
    digdirBaseUrl: digdirUrl, issuer: digdirUrl, clientId: "kontrakt-smoke",
    scope: "ks:innbyggerdialog:les", resource: "sandbox-backend"
  });
  const svar = await fetch(`${backendUrl}/api/revisjonslogg`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const logg = await svar.json() as { handling?: string }[];
  dump.push({
    navn: "forsendelse-revisjon",
    metode: "GET",
    sti: "/api/revisjonslogg (kun FORSENDELSE_SENDT)",
    status: svar.status,
    kropp: normalize(logg.filter((rad) => rad.handling === "FORSENDELSE_SENDT"))
  });
}

/*
 * The revisjonslogg, asserted rather than dumped.
 *
 * Everything else in this script is a diff baseline - a dump cannot fail, it can
 * only differ - and that is enough for wire format. It is not enough for a leak:
 * an address appearing in the log would show up as a diff a reader has to notice,
 * and the ticket's «uten at adresse eller kontaktinfo havner i … revisjonsloggen»
 * has to be able to fail a build on its own. So this one reads the whole log after
 * the flow and throws.
 *
 * The strings come off the seed rather than being written out here: the point is
 * that the protected person's real address is absent, not which street the
 * curated row happens to carry. kommune and kommunenummer are not in the list -
 * masking keeps those on purpose, see apps/shared/skjerming.ts.
 *
 * For person-218 the poststed and the kommune are the same word, so a future
 * audit row that recorded the kommune *by name* would trip this. That is the
 * right way round: the check fails closed and asks for a human to look, and the
 * answer is to look, never to shorten the list.
 */
async function krevIngenAdresselekkasje(personId: string) {
  const personer = JSON.parse(
    await readFile(path.join(repoRoot, "data/personer.json"), "utf8")
  ) as { personId: string; bostedsadresse?: Record<string, unknown>; kontakt?: Record<string, unknown> }[];
  const person = personer.find((kandidat) => kandidat.personId === personId);
  if (!person) {
    throw new Error(`Fant ikke ${personId} i seeden. Er data/personer.json endret?`);
  }
  const adresse = person.bostedsadresse || {};
  const hemmeligheter = [
    adresse.adressenavn, adresse.postnummer, adresse.poststed,
    adresse.adresseIdentifikatorFraMatrikkelen,
    person.kontakt?.epost, person.kontakt?.telefon
  ].filter((verdi): verdi is string => typeof verdi === "string" && verdi.length > 0);

  const token = await getMaskinportenToken({
    digdirBaseUrl: digdirUrl, issuer: digdirUrl, clientId: "kontrakt-smoke",
    scope: "ks:innbyggerdialog:les", resource: "sandbox-backend"
  });
  const svar = await fetch(`${backendUrl}/api/revisjonslogg`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  // hendelseId, sporingsId, oektsId and soknadId are Date.now() plus a few random
  // base36 characters (newId in state.ts), and tidspunkt is an ISO timestamp -
  // none of it is seed data. A 4-character postnummer like "8693" has roughly a
  // 1-in-300000 chance of turning up inside one of those by pure coincidence, and
  // the log holds hundreds of rows across a full run - so this check drops the
  // volatile fields rather than stringifying the whole row, or a passing run
  // would occasionally fail on nothing but bad luck.
  const rader = (await svar.json()) as Record<string, unknown>[];
  const logg = JSON.stringify(rader, (nokkel, verdi) =>
    ["hendelseId", "sporingsId", "oektsId", "soknadId", "tidspunkt"].includes(nokkel)
      ? undefined
      : verdi
  );
  const lekket = hemmeligheter.filter((hemmelig) => logg.includes(hemmelig));
  if (lekket.length) {
    throw new Error(
      `Revisjonsloggen inneholder skjermet informasjon om ${personId}: ${lekket.join(", ")}.`
    );
  }
}

// The kontaktinfo resource in front of KRR: the consent gate closed, then open,
// then the two shapes the 200 has. The consents are created on fiks-simulator's
// samtykke surface directly - the same rows stottekontakt-behov's CONSENT_REQUEST
// leaves - because the people below are not the ones that case is authored for,
// and a whole prosessøkt per lookup would tell the dump nothing extra.
async function kontaktinfoOppslag() {
  const samtykke = { scope: "ks:fiks:samtykke" };
  const grantSamtykke = async (personId: string) => {
    const opprettet = await callFiks(`kontaktinfo-samtykke-${personId}`, "/fiks/samtykke", {
      personId,
      formaal: "Velge varslings- og forsendelseskanal",
      dataKilder: ["kontaktinfo"]
    }, samtykke) as { samtykkeId: string };
    await callFiks(`kontaktinfo-samtykke-svar-${personId}`,
      `/fiks/samtykke/${opprettet.samtykkeId}/svar`,
      { status: "SAMTYKKET" }, { metode: "PUT", ...samtykke });
  };

  // The closed gate is pinned on person-014: person-001 already holds a
  // "kontaktinfo" consent by now, from stottekontaktflyt's CONSENT_REQUEST.
  await call("kontaktinfo-uten-samtykke", "/api/personer/person-014/kontaktinfo");

  // person-014 is authored reservert - the row a channel choice must read.
  await grantSamtykke("person-014");
  await call("kontaktinfo-reservert", "/api/personer/person-014/kontaktinfo");

  // person-001 now holds two kontaktinfo consents - stottekontaktflyt's and this
  // one. hasGyldigSamtykke picks the most recently created, so the formaal pinned
  // in the DATA_LES row below is deterministically this one's.
  await grantSamtykke("person-001");
  await call("kontaktinfo-varslbar", "/api/personer/person-001/kontaktinfo");

  // person-002 is 4 years old, so KRR has no row: the lookup degrades to the
  // advarsel shape instead of failing. The foresatt drives it, which also pins
  // that a representative passes the pid binding on this resource.
  await grantSamtykke("person-002");
  await call("kontaktinfo-under-15", "/api/personer/person-002/kontaktinfo", {
    somPerson: "person-001"
  });

  // The audit trail the resource leaves, from every caller: first the rows the
  // stottekontakt flows left - two DATA_LES from hent-kontaktinfo and one
  // DATA_NEKTET from the økt that skipped its samtykke - then this function's own
  // DATA_NEKTET for the closed gate and one DATA_LES per lookup, advarsel included,
  // since the attempt is what the log audits. formaal comes from the consent, not
  // the catalogue label, which is why the two groups read differently.
  const token = await getMaskinportenToken({
    digdirBaseUrl: digdirUrl, issuer: digdirUrl, clientId: "kontrakt-smoke",
    scope: "ks:innbyggerdialog:les", resource: "sandbox-backend"
  });
  const svar = await fetch(`${backendUrl}/api/revisjonslogg`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const logg = await svar.json() as { ressurs?: string }[];
  dump.push({
    navn: "kontaktinfo-revisjon",
    metode: "GET",
    sti: "/api/revisjonslogg (kun ressurs kontaktinfo)",
    status: svar.status,
    kropp: normalize(logg.filter((rad) => rad.ressurs === "kontaktinfo"))
  });
}


/**
 * TT-kort. Den eneste flyten som passerer samtykkeporten for særlige kategorier,
 * og den eneste som når et vedtak uten å røre inntekt.
 */
async function ttkortflyt(personId: string, merkelapp: string) {
  const oekt = await call(`${merkelapp}-opprett`, "/api/prosessoekter", {
    method: "POST",
    body: { personId, prosessId: "tt-kort" }
  });
  const id = oekt.oektsId;

  await call(`${merkelapp}-neste-1`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await call(`${merkelapp}-svar-om-soknaden`, `/api/prosessoekter/${id}/svar`, {
    method: "POST",
    body: {
      stegId: "om-soknaden",
      svar: { soknadstype: "Ny søknad", kollektivtilbod: "Nei", hjelpemiddel: "Manuell rullestol" }
    }
  });
  await call(`${merkelapp}-neste-2`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await call(`${merkelapp}-svar-reisebehov`, `/api/prosessoekter/${id}/svar`, {
    method: "POST",
    body: {
      stegId: "reisebehov",
      svar: { begrunnelse: "Kommer meg ikke opp trappen til holdeplassen", avstandPost: "nei" }
    }
  });
  await call(`${merkelapp}-neste-3`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await call(`${merkelapp}-samtykke-opprett`, `/api/prosessoekter/${id}/handling`, {
    method: "POST",
    body: { handling: "opprett-samtykke" }
  });
  await call(`${merkelapp}-samtykke-svar`, `/api/prosessoekter/${id}/handling`, {
    method: "POST",
    body: { handling: "samtykkesvar", status: "SAMTYKKET" }
  });
  await call(`${merkelapp}-neste-4`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await call(`${merkelapp}-legeerklaering`, `/api/prosessoekter/${id}/handling`, {
    method: "POST",
    body: {}
  });
  await call(`${merkelapp}-neste-5`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await call(`${merkelapp}-sjekk`, `/api/prosessoekter/${id}/handling`, { method: "POST", body: {} });
  await call(`${merkelapp}-oekt`, `/api/prosessoekter/${id}`);
}

/**
 * Vandelskontroll. Den eneste flyten der et godkjent-utfall kan bety «et menneske
 * må vurdere det», og den eneste der kommunen leser noe innbyggeren framviser.
 */
async function vandelsflyt(personId: string, rolle: string, merkelapp: string) {
  const oekt = await call(`${merkelapp}-opprett`, "/api/prosessoekter", {
    method: "POST",
    body: { personId, prosessId: "politiattest-oppdrag" }
  });
  const id = oekt.oektsId;

  await call(`${merkelapp}-neste-1`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await call(`${merkelapp}-svar-rolle`, `/api/prosessoekter/${id}/svar`, {
    method: "POST",
    body: { stegId: "velg-rolle", svar: { rolle } }
  });
  await call(`${merkelapp}-neste-2`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  // Bekreftelsen på formål: åpen rute, ingen samtykke, fordi den ikke sier noe om
  // den som søker - bare hva som gjelder for rollen.
  const formaal = await call(
    `${merkelapp}-formaal`,
    `/api/prosessoekter/${id}/handling`,
    { method: "POST", body: {} }
  ) as { resultat?: { kilde?: unknown } };
  if (merkelapp === "vandel-godkjent" && formaal.resultat?.kilde !== STOTTEKONTAKT_KILDE) {
    throw new Error(
      `Bekreftelsen for person-026 har feil kilde: ${String(formaal.resultat?.kilde)}.`
    );
  }
  await call(`${merkelapp}-neste-3`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await call(`${merkelapp}-svar-soekt`, `/api/prosessoekter/${id}/svar`, {
    method: "POST",
    body: { stegId: "bekreft-soknad", svar: { harSoekt: "ja" } }
  });
  await call(`${merkelapp}-neste-4`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  await call(`${merkelapp}-samtykke-opprett`, `/api/prosessoekter/${id}/handling`, {
    method: "POST",
    body: { handling: "opprett-samtykke" }
  });
  await call(`${merkelapp}-samtykke-svar`, `/api/prosessoekter/${id}/handling`, {
    method: "POST",
    body: { handling: "samtykkesvar", status: "SAMTYKKET" }
  });
  await call(`${merkelapp}-neste-5`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  // Svaret er minimert: type, dato og antall. Dumpen er stedet det pinnes, for
  // det er dette svaret som havner i oppsummeringen og i modellprompten.
  await call(`${merkelapp}-attest`, `/api/prosessoekter/${id}/handling`, { method: "POST", body: {} });
  await call(`${merkelapp}-neste-6`, `/api/prosessoekter/${id}/neste`, { method: "POST" });
  const vurdering = await call(
    `${merkelapp}-sjekk`,
    `/api/prosessoekter/${id}/handling`,
    { method: "POST", body: {} }
  ) as { resultat?: { grunnlag?: { kilde?: unknown } } };
  if (
    merkelapp === "vandel-godkjent"
    && vurdering.resultat?.grunnlag?.kilde !== STOTTEKONTAKT_KILDE
  ) {
    throw new Error(
      "Vandelsvurderingen for person-026 har feil kilde: " +
      `${String(vurdering.resultat?.grunnlag?.kilde)}.`
    );
  }
  await call(`${merkelapp}-oekt`, `/api/prosessoekter/${id}`);
}

// --- run ------------------------------------------------------------------

async function run() {
  await requireFreePort(backendPort);
  await requireFreePort(fiksPort);
  await requireFreePort(matrikkelPort);
  await requireFreePort(digdirPort);
  await requireFreePort(pasientjournalPort);
  await requireFreePort(politiattestPort);
  await requireFreePort(aiPort);

  const stateDir = await mkdtemp(path.join(tmpdir(), "kontrakt-smoke-"));
  const miljo = {
    STATE_DIR: stateDir,
    FIKS_BASE_URL: fiksUrl,
    BACKEND_BASE_URL: backendUrl,
    AI_BASE_URL: aiUrl,
    MATRIKKEL_BASE_URL: matrikkelUrl,
    PASIENTJOURNAL_BASE_URL: pasientjournalUrl,
    POLITIATTEST_BASE_URL: politiattestUrl,
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
    start("fiks", "apps/fiks-simulator/src/server.ts", { ...miljo, PORT: String(fiksPort) }),
    start("matrikkel", "apps/matrikkel-mock/src/server.ts", { ...miljo, PORT: String(matrikkelPort) }),
    start("pasientjournal", "apps/pasientjournal-mock/src/server.ts", { ...miljo, PORT: String(pasientjournalPort) }),
    start("politiattest", "apps/politiattest-mock/src/server.ts", { ...miljo, PORT: String(politiattestPort) }),
    // No AI_PROVIDER: defaults to "mock", so /ai/oppsummering answers the
    // deterministic template with no outbound call.
    start("ai", "apps/ai-gateway/src/server.ts", { ...miljo, PORT: String(aiPort) })
  ];

  try {
    await Promise.all([
      waitForHealth(digdirUrl),
      waitForHealth(backendUrl),
      waitForHealth(fiksUrl),
      waitForHealth(matrikkelUrl),
      waitForHealth(pasientjournalUrl),
      waitForHealth(politiattestUrl),
      waitForHealth(aiUrl)
    ]);

    await staticLookups();
    await foreldrebetalingsflyt("redusert-foreldrebetaling-barnehage", "barnehage");
    await foreldrebetalingsflyt("sfo-moderasjon", "sfo");
    // household-013 is the only household with both a protected guardian
    // (person-031, kode 6) and an unprotected one (person-030). It is therefore the
    // only case that reaches the infotekst in fiks-simulator's byggVisningsposter:
    // "Beløpet inkluderer et husstandsmedlem med skjermet identitet, som ikke kan
    // spesifiseres."
    //
    // That branch had no test anywhere before this. Note that the protected
    // person's amount still counts towards beregningsbeloep by design - only their
    // share is withheld. If the total ever drops here, something started masking
    // money instead of identity.
    await foreldrebetalingsflyt("sfo-moderasjon", "sfo-skjermet-medlem", {
      personId: "person-030",
      husstandId: "household-013"
    });
    await fritidskortflyt("person-028", "fritidskort-innvilget");
    await fritidskortflyt("person-008", "fritidskort-avslag");
    await stottekontaktflyt("person-001", "stottekontakt-innvilget", true);
    await stottekontaktflyt("person-003", "stottekontakt-fullt");
    // person-218 has kode 7 and is reservert in KRR: no digital channel, and
    // masking left no postal address for the print channel either. SvarUt refuses
    // the forsendelse, the kvittering degrades into an advarsel, and the søknad is
    // stored regardless - with no forsendelseId, so its status route answers 404.
    //
    // This is the leak-shaped case, and the dump is where it is pinned end to end:
    // the address must be absent from the søknadsdokument, from the SUBMIT
    // response, and from every revisjonsrad the flow leaves. Hattfjelldal has a
    // støttekontakt-tilbud for the age group, so the SJEKK still approves and the
    // flow reaches SUBMIT for an ordinary reason.
    await stottekontaktflyt("person-218", "stottekontakt-skjermet", true);
    await krevIngenAdresselekkasje("person-218");
    await stottekontaktUtenSamtykke("stottekontakt-uten-samtykke");
    await ttkortflyt("person-284", "ttkort-innvilget");
    // Erklæringen varer bare ett år, så vedtaket er avslag på et vilkår som ikke
    // har noe med inntekt å gjøre - den ene tingen denne casen finnes for å vise.
    await ttkortflyt("person-329", "ttkort-for-kort-varighet");
    // Ingen erklæring i det hele tatt. DATA_FETCH-steget svarer 200 med
    // legeerklaering: null, og vurderingen forklarer hvorfor - et 404 her ville
    // stoppet økten framfor å gi søkeren et svar hen kan gjøre noe med.
    await ttkortflyt("person-001", "ttkort-mangler-erklaering");
    await vandelsflyt("person-026", "stottekontakt", "vandel-godkjent");
    // Én anmerkning som ingen lov utelukker direkte. Utfallet er godkjent, men
    // vandelsutfallet sier krever_manuell_vurdering - og det er hele grunnen til
    // at unionen dekker begge sidene. Dumpen pinner at søknaden går videre.
    await vandelsflyt("person-138", "stottekontakt", "vandel-manuell-vurdering");
    // Samme slags anmerkning, annen hjemmel: barnehageloven § 30 utelukker direkte,
    // så her avviser motoren økten. Forskjellen mellom de to radene er casens poeng.
    await vandelsflyt("person-137", "barnehage", "vandel-absolutt-utelukkelse");
    // Ingen attest for formålet. DATA_FETCH svarer 200 med politiattest: null, og
    // vurderingen forklarer hva søkeren må gjøre.
    await vandelsflyt("person-207", "stottekontakt", "vandel-mangler-attest");
    await fartsdempingsflyt("Storgata", "fartsdemping-eier");
    await fartsdempingsflyt("Fjøsangerveien", "fartsdemping-ikke-eier");
    await soknadOgRevisjon();
    await krrOppslag();
    await folkeregisterOppslag();
    await forsendelseFlyt();
    await kontaktinfoOppslag();

    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, JSON.stringify(dump, null, 2) + "\n");
    console.log(`${dump.length} kall skrevet til ${path.relative(repoRoot, outFile)}`);
  } finally {
    for (const tjeneste of tjenester) {
      tjeneste.kill("SIGTERM");
    }
    await rm(stateDir, { recursive: true, force: true });
  }
}

run().catch((feil) => {
  console.error(`Kontrakt-royktest feilet: ${feilmelding(feil)}`);
  process.exit(1);
});
