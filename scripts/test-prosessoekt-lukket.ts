#!/usr/bin/env node

/*
 * The closed-økt guard in withSession (routes.ts).
 *
 * Without the guard, a replayed POST /handling on a FULLFORT økt runs the SUBMIT
 * handler again and produces a duplicate søknad - and a new Fiks task - per call.
 * With hackathon teams building agents against these APIs, that replay is a
 * double-click, not a theoretical race.
 *
 * This also pins the boundary before the guard: /neste may move only from a
 * completed step, and must not execute the step itself. The two real flows below
 * cover QUESTION, CONSENT_REQUEST, DATA_FETCH, SJEKK and SUMMARY before they reach
 * FULLFORT or AVVIST.
 *
 * Backend, fiks-simulator, ai-gateway, digdir-mock, tools-api and process-agent
 * run on their own ports against a fresh STATE_DIR, so this covers the shipped
 * agent path and still runs alongside a docker stack without touching it.
 *
 * Usage:
 *   node scripts/test-prosessoekt-lukket.ts
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getInnbyggerToken } from "../apps/digdir-mock/src/client.ts";
import {
  erStegFullfort,
  normaliserValgsvar,
  runStegHandling
} from "../apps/sandbox-backend/src/prosess.ts";
import { statusFor } from "../apps/sandbox-backend/src/errors.ts";
import type { ProsessSteg } from "../apps/sandbox-backend/src/types.ts";
import { feilkode } from "../apps/shared/errors.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendPort = Number(process.env.LUKKET_BACKEND_PORT) || 18094;
const digdirPort = Number(process.env.LUKKET_DIGDIR_PORT) || 18095;
const fiksPort = Number(process.env.LUKKET_FIKS_PORT) || 18096;
const aiPort = Number(process.env.LUKKET_AI_PORT) || 18097;
const toolsPort = Number(process.env.LUKKET_TOOLS_PORT) || 18098;
const agentPort = Number(process.env.LUKKET_AGENT_PORT) || 18099;
const backendUrl = `http://127.0.0.1:${backendPort}`;
const digdirUrl = `http://127.0.0.1:${digdirPort}`;
const fiksUrl = `http://127.0.0.1:${fiksPort}`;
const aiUrl = `http://127.0.0.1:${aiPort}`;
const toolsUrl = `http://127.0.0.1:${toolsPort}`;
const agentUrl = `http://127.0.0.1:${agentPort}`;

const AVSLUTTET = "Prosessøkten er avsluttet og kan ikke fortsette.";
const IKKE_FUNNET = "Fant ikke prosessøkt.";
const IKKE_FULLFORT = "Det aktive steget må fullføres før prosessen kan gå videre.";

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: unknown, detail = "") {
  if (condition) { passed += 1; return; }
  failures.push(`${name}${detail ? ` - ${detail}` : ""}`);
}

function start(name: string, relativePath: string, env: any) {
  const child = spawn(process.execPath, [path.join(repoRoot, relativePath)], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  return child;
}

async function stopService(service: ReturnType<typeof start>) {
  if (service.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    service.once("exit", () => resolve());
    service.kill("SIGTERM");
  });
}

async function requireFreePort(port: number) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error) => reject(
      feilkode(error) === "EADDRINUSE"
        ? new Error(`Port ${port} er opptatt. Sett den aktuelle LUKKET_*_PORT-variabelen.`)
        : error
    ));
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
}

async function waitForHealth(baseUrl: string, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${baseUrl}/helse`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${baseUrl} svarte ikke på /helse innen ${timeoutMs} ms`);
}

/** Hva ett kall kan overstyre. */
type Kallvalg = { method?: string; body?: unknown };

async function call(routePath: string, token: string, options: Kallvalg = {}) {
  const response = await fetch(`${backendUrl}${routePath}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body };
}

async function callJson(baseUrl: string, routePath: string, options: Kallvalg = {}) {
  const response = await fetch(`${baseUrl}${routePath}`, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : {},
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const body = await response.json() as any;
  return { status: response.status, body };
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
  return callJson(toolsUrl, "/verktoy/invoke", {
    method: "POST",
    body: { name, arguments: args }
  });
}

async function callAgent(routePath: string, body?: unknown) {
  return callJson(agentUrl, routePath, body === undefined ? {} : { method: "POST", body });
}

async function antallSoknader(personId: string, token: string) {
  const svar = await call(`/api/personer/${personId}/soknader`, token);
  return Array.isArray(svar.body) ? svar.body.length : -1;
}

async function checkBlokkert(
  navn: string,
  oektsId: string,
  token: string,
  forventetStegId: string
) {
  const neste = await call(`/api/prosessoekter/${oektsId}/neste`, token, { method: "POST" });
  check(`${navn} kan ikke hoppes over`, neste.status === 400, String(neste.status));
  check(`${navn} forklarer at steget må fullføres`, neste.body?.feil === IKKE_FULLFORT, String(neste.body?.feil));
  const etter = await call(`/api/prosessoekter/${oektsId}`, token);
  check(`${navn} står fortsatt på samme steg`, etter.body?.aktivtSteg?.id === forventetStegId,
    String(etter.body?.aktivtSteg?.id));
}

async function checkNeste(
  navn: string,
  oektsId: string,
  token: string,
  forventetStegId: string
) {
  const neste = await call(`/api/prosessoekter/${oektsId}/neste`, token, { method: "POST" });
  check(`${navn} går videre etter fullføring`, neste.status === 200, String(neste.status));
  check(`${navn} aktiverer ${forventetStegId}`, neste.body?.aktivtSteg?.id === forventetStegId,
    String(neste.body?.aktivtSteg?.id));
}

function byggSpoersmaalsoekt(svar: unknown) {
  return {
    oektsId: "oekt-svarform",
    prosessId: "prosess-svarform",
    personId: "person-001",
    sporingsId: "flyt-svarform",
    status: "AKTIV",
    stegIndex: 0,
    svar: { sporsmaal: svar },
    resultaterRaa: {},
    aktivtSamtykkeId: null,
    opprettet: "2026-09-08T00:00:00.000Z",
    oppdatert: "2026-09-08T00:00:00.000Z"
  } as any;
}

async function checkSvarformer() {
  const enkelt: ProsessSteg = {
    id: "sporsmaal",
    type: "QUESTION",
    felter: [{ id: "tekst", label: "Tekst", type: "tekst", obligatorisk: true }]
  };
  const lukketValg: ProsessSteg = {
    id: "sporsmaal",
    type: "QUESTION",
    felter: [{
      id: "valg",
      label: "Velg",
      type: "valg",
      obligatorisk: true,
      alternativer: ["A", "B"]
    }]
  };
  const flere: ProsessSteg = {
    id: "sporsmaal",
    type: "QUESTION",
    felter: [
      { id: "tekst", label: "Tekst", type: "tekst", obligatorisk: true },
      { id: "bekreftet", label: "Bekreftet", type: "ja-nei", obligatorisk: true }
    ]
  };

  check("§0 ikke-tom liste fullfører ettfeltsspørsmål",
    erStegFullfort(byggSpoersmaalsoekt(["a", "b"]), enkelt, {}));
  check("§0 tom liste fullfører ikke spørsmål",
    !erStegFullfort(byggSpoersmaalsoekt([]), enkelt, {}));
  let ugyldigValgliste: unknown;
  try {
    normaliserValgsvar(lukketValg, ["IKKE_GYLDIG"]);
  } catch (error) {
    ugyldigValgliste = error;
  }
  check("§0 liste kan ikke omgå alternativene i et lukket valgfelt",
    statusFor(ugyldigValgliste) === 400, String(statusFor(ugyldigValgliste)));
  check("§0 false er et gyldig svar",
    erStegFullfort(byggSpoersmaalsoekt(false), enkelt, {}));
  check("§0 streng fullfører ikke flerfeltsspørsmål",
    !erStegFullfort(byggSpoersmaalsoekt("ja"), flere, {}));
  check("§0 vilkårlig objektnøkkel fullfører ikke flerfeltsspørsmål",
    !erStegFullfort(byggSpoersmaalsoekt({ annet: "ja" }), flere, {}));
  check("§0 alle obligatoriske felt fullfører flerfeltsspørsmål, også med false",
    erStegFullfort(byggSpoersmaalsoekt({ tekst: "forklaring", bekreftet: false }), flere, {}));

  const oekt = byggSpoersmaalsoekt(undefined);
  oekt.svar = {};
  const prosess = { id: "prosess-svarform", navn: "Svarform", steg: [enkelt], redigering: {} } as any;
  const resultat = await runStegHandling(
    { samtykker: [] } as any,
    oekt,
    prosess,
    { svar: false },
    { type: "innbygger", id: "test" } as any
  ) as { svar?: unknown };
  check("§0 QUESTION-handleren godtar false", resultat.svar === false && oekt.svar.sporsmaal === false);
}

await checkSvarformer();
await requireFreePort(backendPort);
await requireFreePort(digdirPort);
await requireFreePort(fiksPort);
await requireFreePort(aiPort);
await requireFreePort(toolsPort);
await requireFreePort(agentPort);

const stateDir = await mkdtemp(path.join(tmpdir(), "lukket-oekt-"));
const env = {
  STATE_DIR: stateDir,
  BACKEND_BASE_URL: backendUrl,
  DIGDIR_BASE_URL: digdirUrl,
  DIGDIR_ISSUER: digdirUrl,
  FIKS_BASE_URL: fiksUrl,
  AI_BASE_URL: aiUrl,
  TOOLS_BASE_URL: toolsUrl,
  AI_PROVIDER: "mock",
  MATRIKKEL_BASE_URL: "http://127.0.0.1:1"
};

let fiksService = start("fiks", "apps/fiks-simulator/src/server.ts", { ...env, PORT: String(fiksPort) });
const services = [
  start("digdir", "apps/digdir-mock/src/server.ts", { ...env, PORT: String(digdirPort) }),
  start("backend", "apps/sandbox-backend/src/server.ts", { ...env, PORT: String(backendPort) }),
  fiksService,
  start("ai", "apps/ai-gateway/src/server.ts", { ...env, PORT: String(aiPort) }),
  start("tools", "apps/tools-api/src/server.ts", { ...env, PORT: String(toolsPort) }),
  start("agent", "apps/process-agent/src/server.ts", { ...env, PORT: String(agentPort) })
];

try {
  await Promise.all([
    waitForHealth(digdirUrl),
    waitForHealth(backendUrl),
    waitForHealth(fiksUrl),
    waitForHealth(aiUrl),
    waitForHealth(toolsUrl),
    waitForHealth(agentUrl)
  ]);

  // §1: complete a real flow before checking replay on a FULLFORT økt.
  const tokenA = await getInnbyggerToken({ digdirBaseUrl: digdirUrl, personId: "person-001", clientId: "lukket-test" });
  const opprettetA = await call("/api/prosessoekter", tokenA, {
    method: "POST",
    body: { personId: "person-001", prosessId: "redusert-foreldrebetaling-barnehage" }
  });
  check("§1 økt opprettet", opprettetA.status === 201, String(opprettetA.status));
  const idA = opprettetA.body?.oektsId;

  await checkNeste("§1 INFO", idA, tokenA, "hent-husstand");

  await checkBlokkert("§1 DATA_FETCH hent-husstand", idA, tokenA, "hent-husstand");
  const husstand = await call(`/api/prosessoekter/${idA}/handling`, tokenA, { method: "POST", body: {} });
  check("§1 DATA_FETCH hent-husstand gir 200", husstand.status === 200, String(husstand.status));
  await checkNeste("§1 DATA_FETCH hent-husstand", idA, tokenA, "samtykke-inntekt");

  await checkBlokkert("§1 CONSENT_REQUEST uten forespørsel", idA, tokenA, "samtykke-inntekt");
  const falsktSamtykkesvar = await call(`/api/prosessoekter/${idA}/svar`, tokenA, {
    method: "POST",
    body: { stegId: "samtykke-inntekt", svar: "SAMTYKKET" }
  });
  check("§1 /svar kan ikke fullføre samtykkesteget",
    falsktSamtykkesvar.status === 400, String(falsktSamtykkesvar.status));
  const vilkaarSvar = await call(`/api/prosessoekter/${idA}/svar`, tokenA, {
    method: "POST",
    body: { stegId: "vilkaarlig-steg", svar: "SAMTYKKET" }
  });
  check("§1 vilkårlig stegId kan ikke fullføre samtykkesteget",
    vilkaarSvar.status === 400, String(vilkaarSvar.status));
  await checkBlokkert("§1 ubesvart CONSENT_REQUEST etter /svar-forsøk", idA, tokenA, "samtykke-inntekt");
  const samtykkeforespoersel = await call(`/api/prosessoekter/${idA}/handling`, tokenA, {
    method: "POST",
    body: { handling: "opprett-samtykke" }
  });
  check("§1 samtykkeforespørsel opprettes", samtykkeforespoersel.status === 200, String(samtykkeforespoersel.status));
  await checkBlokkert("§1 CONSENT_REQUEST uten svar", idA, tokenA, "samtykke-inntekt");
  const samtykke = await call(`/api/prosessoekter/${idA}/handling`, tokenA, {
    method: "POST",
    body: { handling: "samtykkesvar", status: "SAMTYKKET" }
  });
  check("§1 samtykke registreres", samtykke.status === 200, String(samtykke.status));
  await checkNeste("§1 CONSENT_REQUEST", idA, tokenA, "hent-inntekt");

  await checkBlokkert("§1 DATA_FETCH hent-inntekt", idA, tokenA, "hent-inntekt");
  const inntekt = await call(`/api/prosessoekter/${idA}/handling`, tokenA, { method: "POST", body: {} });
  check("§1 DATA_FETCH hent-inntekt gir 200", inntekt.status === 200, String(inntekt.status));
  await checkNeste("§1 DATA_FETCH hent-inntekt", idA, tokenA, "sjekk-rett");

  await checkBlokkert("§1 SJEKK", idA, tokenA, "sjekk-rett");
  const sjekkA = await call(`/api/prosessoekter/${idA}/handling`, tokenA, { method: "POST", body: {} });
  check("§1 SJEKK gir 200", sjekkA.status === 200, String(sjekkA.status));
  check("§1 SJEKK godkjennes", sjekkA.body?.resultat?.godkjent === true, JSON.stringify(sjekkA.body?.resultat));
  await checkNeste("§1 SJEKK", idA, tokenA, "oppsummering");

  await checkBlokkert("§1 SUMMARY", idA, tokenA, "oppsummering");
  const oppsummering = await call(`/api/prosessoekter/${idA}/handling`, tokenA, { method: "POST", body: {} });
  check("§1 SUMMARY gir 200", oppsummering.status === 200, String(oppsummering.status));
  await checkNeste("§1 SUMMARY", idA, tokenA, "send-inn");

  const foersteSubmit = call(`/api/prosessoekter/${idA}/handling`, tokenA, { method: "POST", body: {} });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const [submitEn, submitTo, forrigeUnderSubmit] = await Promise.all([
    foersteSubmit,
    call(`/api/prosessoekter/${idA}/handling`, tokenA, { method: "POST", body: {} }),
    call(`/api/prosessoekter/${idA}/forrige`, tokenA, { method: "POST" })
  ]);
  const samtidigeSubmit = [submitEn, submitTo];
  const submit = samtidigeSubmit.find((svar) => svar.status === 200);
  check("§1 bare én samtidig SUBMIT gir 200",
    samtidigeSubmit.filter((svar) => svar.status === 200).length === 1,
    samtidigeSubmit.map((svar) => svar.status).join(","));
  check("§1 overlappende SUBMIT avvises",
    samtidigeSubmit.some((svar) => svar.status === 400 || svar.status === 409),
    samtidigeSubmit.map((svar) => svar.status).join(","));
  check("§1 /forrige kan ikke flytte økten under SUBMIT",
    forrigeUnderSubmit.status === 400 || forrigeUnderSubmit.status === 409,
    String(forrigeUnderSubmit.status));
  check("§1 økten er FULLFORT", submit?.body?.oekt?.status === "FULLFORT", String(submit?.body?.oekt?.status));
  check("§1 én søknad etter innsending", await antallSoknader("person-001", tokenA) === 1);

  // The defect this file exists for: the replay must be refused, and it must
  // not have created a second søknad.
  const replay = await call(`/api/prosessoekter/${idA}/handling`, tokenA, { method: "POST", body: {} });
  check("§1 replay av SUBMIT gir 400", replay.status === 400, String(replay.status));
  check("§1 replay-svaret bruker den ene 400-meldingen", replay.body?.feil === AVSLUTTET, String(replay.body?.feil));
  check("§1 fortsatt én søknad etter replay", await antallSoknader("person-001", tokenA) === 1);

  const svarLukket = await call(`/api/prosessoekter/${idA}/svar`, tokenA, {
    method: "POST",
    body: { stegId: "intro", svar: "for sent" }
  });
  check("§1 /svar på FULLFORT økt gir 400", svarLukket.status === 400, String(svarLukket.status));
  const nesteLukket = await call(`/api/prosessoekter/${idA}/neste`, tokenA, { method: "POST" });
  check("§1 /neste på FULLFORT økt gir 400", nesteLukket.status === 400, String(nesteLukket.status));
  const forrigeLukket = await call(`/api/prosessoekter/${idA}/forrige`, tokenA, { method: "POST" });
  check("§1 /forrige på FULLFORT økt gir 400", forrigeLukket.status === 400, String(forrigeLukket.status));

  const lesA = await call(`/api/prosessoekter/${idA}`, tokenA);
  check("§1 GET på FULLFORT økt gir fortsatt 200", lesA.status === 200, String(lesA.status));
  check("§1 GET viser FULLFORT", lesA.body?.status === "FULLFORT", String(lesA.body?.status));

  // §2: complete the QUESTION and consent path before the SJEKK that rejects.
  const tokenB = await getInnbyggerToken({ digdirBaseUrl: digdirUrl, personId: "person-003", clientId: "lukket-test" });
  const opprettetB = await call("/api/prosessoekter", tokenB, {
    method: "POST",
    body: { personId: "person-003", prosessId: "stottekontakt-behov" }
  });
  check("§2 økt opprettet", opprettetB.status === 201, String(opprettetB.status));
  const idB = opprettetB.body?.oektsId;

  await checkNeste("§2 INFO", idB, tokenB, "situasjon");
  await checkBlokkert("§2 QUESTION uten svar", idB, tokenB, "situasjon");
  const ugyldigSvar = await call(`/api/prosessoekter/${idB}/svar`, tokenB, {
    method: "POST",
    body: { stegId: "situasjon", svar: [] }
  });
  check("§2 QUESTION-svar med feil form lagres", ugyldigSvar.status === 200, String(ugyldigSvar.status));
  await checkBlokkert("§2 QUESTION med feil svarform", idB, tokenB, "situasjon");
  const ufullstendigSvar = await call(`/api/prosessoekter/${idB}/svar`, tokenB, {
    method: "POST",
    body: { stegId: "situasjon", svar: { beskrivelse: "Trenger følge i helgene" } }
  });
  check("§2 ufullstendig QUESTION-svar lagres", ufullstendigSvar.status === 200, String(ufullstendigSvar.status));
  await checkBlokkert("§2 QUESTION uten alle obligatoriske felt", idB, tokenB, "situasjon");
  const svarB = await call(`/api/prosessoekter/${idB}/svar`, tokenB, {
    method: "POST",
    body: { stegId: "situasjon", svar: { beskrivelse: "Trenger følge i helgene", onskerKontakt: "ja", kontaktkanal: "Telefon" } }
  });
  check("§2 svar på åpen økt gir 200", svarB.status === 200, String(svarB.status));
  await checkNeste("§2 QUESTION", idB, tokenB, "forklar-data");

  await checkBlokkert("§2 CONSENT_REQUEST", idB, tokenB, "forklar-data");
  const opprettSamtykkeB = await call(`/api/prosessoekter/${idB}/handling`, tokenB, {
    method: "POST",
    body: { handling: "opprett-samtykke" }
  });
  check("§2 samtykkeforespørsel opprettes", opprettSamtykkeB.status === 200, String(opprettSamtykkeB.status));
  await checkBlokkert("§2 CONSENT_REQUEST uten svar", idB, tokenB, "forklar-data");
  const samtykkeB = await call(`/api/prosessoekter/${idB}/handling`, tokenB, {
    method: "POST",
    body: { handling: "samtykkesvar", status: "SAMTYKKET" }
  });
  check("§2 samtykke registreres", samtykkeB.status === 200, String(samtykkeB.status));
  await checkNeste("§2 CONSENT_REQUEST", idB, tokenB, "hent-kontaktinfo");

  await checkBlokkert("§2 DATA_FETCH", idB, tokenB, "hent-kontaktinfo");
  const kontaktinfo = await call(`/api/prosessoekter/${idB}/handling`, tokenB, { method: "POST", body: {} });
  check("§2 DATA_FETCH gir 200", kontaktinfo.status === 200, String(kontaktinfo.status));
  await checkNeste("§2 DATA_FETCH", idB, tokenB, "sjekk-tilbud");

  const endringUtenTilbake = await call(`/api/prosessoekter/${idB}/svar`, tokenB, {
    method: "POST",
    body: {
      stegId: "situasjon",
      svar: { beskrivelse: "Trenger følge både ukedager og helger", onskerKontakt: "ja", kontaktkanal: "Telefon" }
    }
  });
  check("§2 tidligere spørsmål kan ikke endres uten /forrige",
    endringUtenTilbake.status === 400, String(endringUtenTilbake.status));
  const etterAvvistEndring = await call(`/api/prosessoekter/${idB}`, tokenB);
  check("§2 avvist endring flytter ikke økten",
    etterAvvistEndring.body?.aktivtSteg?.id === "sjekk-tilbud",
    String(etterAvvistEndring.body?.aktivtSteg?.id));

  for (const forventet of ["hent-kontaktinfo", "forklar-data", "situasjon"]) {
    const forrige = await call(`/api/prosessoekter/${idB}/forrige`, tokenB, { method: "POST" });
    check(`§2 /forrige aktiverer ${forventet}`,
      forrige.status === 200 && forrige.body?.aktivtSteg?.id === forventet,
      `${forrige.status} ${String(forrige.body?.aktivtSteg?.id)}`);
  }
  const endretSvar = await call(`/api/prosessoekter/${idB}/svar`, tokenB, {
    method: "POST",
    body: {
      stegId: "situasjon",
      svar: { beskrivelse: "Trenger følge både ukedager og helger", onskerKontakt: "ja", kontaktkanal: "Telefon" }
    }
  });
  check("§2 endret aktivt spørsmål blir stående på spørsmålet",
    endretSvar.body?.aktivtSteg?.id === "situasjon",
    String(endretSvar.body?.aktivtSteg?.id));
  check("§2 endret spørsmålssvar fjerner senere resultater",
    !("forklar-data" in (endretSvar.body?.resultater || {}))
      && !("hent-kontaktinfo" in (endretSvar.body?.resultater || {})),
    JSON.stringify(Object.keys(endretSvar.body?.resultater || {})));
  check("§2 endret spørsmålssvar fjerner aktivt samtykke",
    endretSvar.body?.aktivtSamtykkeId === null, String(endretSvar.body?.aktivtSamtykkeId));
  await checkNeste("§2 endret QUESTION", idB, tokenB, "forklar-data");
  await checkBlokkert("§2 ugyldiggjort CONSENT_REQUEST", idB, tokenB, "forklar-data");

  const nyttSamtykkeB = await call(`/api/prosessoekter/${idB}/handling`, tokenB, {
    method: "POST",
    body: { handling: "opprett-samtykke" }
  });
  check("§2 ny samtykkeforespørsel opprettes", nyttSamtykkeB.status === 200, String(nyttSamtykkeB.status));
  const nyttSamtykkesvarB = await call(`/api/prosessoekter/${idB}/handling`, tokenB, {
    method: "POST",
    body: { handling: "samtykkesvar", status: "IKKE_SAMTYKKET" }
  });
  check("§2 nytt avslag på samtykke registreres",
    nyttSamtykkesvarB.status === 200, String(nyttSamtykkesvarB.status));
  await checkNeste("§2 nytt CONSENT_REQUEST", idB, tokenB, "hent-kontaktinfo");
  const nektetKontaktinfo = await call(`/api/prosessoekter/${idB}/handling`, tokenB, { method: "POST", body: {} });
  check("§2 ny eksplisitt nektelse blokkerer gammelt samtykke",
    nektetKontaktinfo.status === 403, String(nektetKontaktinfo.status));
  const etterNektetKontaktinfo = await call(`/api/prosessoekter/${idB}`, tokenB);
  check("§2 nektet DATA_FETCH lagrer ikke resultat",
    !("hent-kontaktinfo" in (etterNektetKontaktinfo.body?.resultater || {})),
    JSON.stringify(Object.keys(etterNektetKontaktinfo.body?.resultater || {})));

  const tilbakeTilSamtykke = await call(`/api/prosessoekter/${idB}/forrige`, tokenB, { method: "POST" });
  check("§2 kan gå tilbake og gi et nytt samtykke",
    tilbakeTilSamtykke.body?.aktivtSteg?.id === "forklar-data",
    String(tilbakeTilSamtykke.body?.aktivtSteg?.id));
  const tredjeSamtykkeB = await call(`/api/prosessoekter/${idB}/handling`, tokenB, {
    method: "POST",
    body: { handling: "opprett-samtykke" }
  });
  check("§2 tredje samtykkeforespørsel opprettes", tredjeSamtykkeB.status === 200, String(tredjeSamtykkeB.status));
  const tredjeSamtykkesvarB = await call(`/api/prosessoekter/${idB}/handling`, tokenB, {
    method: "POST",
    body: { handling: "samtykkesvar", status: "SAMTYKKET" }
  });
  check("§2 nytt aktivt samtykke kan gis",
    tredjeSamtykkesvarB.status === 200, String(tredjeSamtykkesvarB.status));
  await checkNeste("§2 tredje CONSENT_REQUEST", idB, tokenB, "hent-kontaktinfo");
  const nyKontaktinfo = await call(`/api/prosessoekter/${idB}/handling`, tokenB, { method: "POST", body: {} });
  check("§2 DATA_FETCH kjøres på nytt", nyKontaktinfo.status === 200, String(nyKontaktinfo.status));
  await checkNeste("§2 ny DATA_FETCH", idB, tokenB, "sjekk-tilbud");

  await checkBlokkert("§2 SJEKK", idB, tokenB, "sjekk-tilbud");
  const sjekk = await call(`/api/prosessoekter/${idB}/handling`, tokenB, { method: "POST", body: {} });
  check("§2 SJEKK gir 200", sjekk.status === 200, String(sjekk.status));
  check("§2 økten er AVVIST", sjekk.body?.oekt?.status === "AVVIST", String(sjekk.body?.oekt?.status));

  const omkjoring = await call(`/api/prosessoekter/${idB}/handling`, tokenB, { method: "POST", body: {} });
  check("§2 omkjøring av SJEKK på AVVIST økt gir 400", omkjoring.status === 400, String(omkjoring.status));
  check("§2 omkjøringen bruker den ene 400-meldingen", omkjoring.body?.feil === AVSLUTTET, String(omkjoring.body?.feil));
  const svarAvvist = await call(`/api/prosessoekter/${idB}/svar`, tokenB, {
    method: "POST",
    body: { stegId: "situasjon", svar: "nytt forsøk" }
  });
  check("§2 /svar på AVVIST økt gir 400", svarAvvist.status === 400, String(svarAvvist.status));

  const lesB = await call(`/api/prosessoekter/${idB}`, tokenB);
  check("§2 GET på AVVIST økt gir fortsatt 200", lesB.status === 200, String(lesB.status));
  check("§2 GET viser AVVIST", lesB.body?.status === "AVVIST", String(lesB.body?.status));

  // §3: a failed DATA_FETCH stores no completion evidence and can be retried.
  const opprettetC = await call("/api/prosessoekter", tokenA, {
    method: "POST",
    body: { personId: "person-001", prosessId: "fartsdempende-tiltak" }
  });
  const idC = opprettetC.body?.oektsId;
  await checkNeste("§3 INFO", idC, tokenA, "velg-gate");
  const gateSvar = await call(`/api/prosessoekter/${idC}/svar`, tokenA, {
    method: "POST",
    body: { stegId: "velg-gate", svar: "Storgata" }
  });
  check("§3 gate lagres", gateSvar.status === 200, String(gateSvar.status));
  await checkNeste("§3 QUESTION", idC, tokenA, "hent-gate");
  const mislykketHenting = await call(`/api/prosessoekter/${idC}/handling`, tokenA, {
    method: "POST",
    body: {}
  });
  check("§3 mislykket DATA_FETCH gir 502", mislykketHenting.status === 502, String(mislykketHenting.status));
  await checkBlokkert("§3 mislykket DATA_FETCH", idC, tokenA, "hent-gate");
  const etterMislykketHenting = await call(`/api/prosessoekter/${idC}`, tokenA);
  check("§3 mislykket DATA_FETCH lagrer ikke resultat",
    !("hent-gate" in (etterMislykketHenting.body?.resultater || {})),
    JSON.stringify(Object.keys(etterMislykketHenting.body?.resultater || {})));

  const omkjoringsoekt = await call("/api/prosessoekter", tokenA, {
    method: "POST",
    body: { personId: "person-001", prosessId: "redusert-foreldrebetaling-barnehage" }
  });
  const omkjoringsId = omkjoringsoekt.body?.oektsId;
  await checkNeste("§3 omkjøring INFO", omkjoringsId, tokenA, "hent-husstand");
  await call(`/api/prosessoekter/${omkjoringsId}/handling`, tokenA, { method: "POST", body: {} });
  await checkNeste("§3 omkjøring husstand", omkjoringsId, tokenA, "samtykke-inntekt");
  await call(`/api/prosessoekter/${omkjoringsId}/handling`, tokenA, {
    method: "POST",
    body: { handling: "opprett-samtykke" }
  });
  await call(`/api/prosessoekter/${omkjoringsId}/handling`, tokenA, {
    method: "POST",
    body: { handling: "samtykkesvar", status: "SAMTYKKET" }
  });
  await checkNeste("§3 omkjøring samtykke", omkjoringsId, tokenA, "hent-inntekt");
  await call(`/api/prosessoekter/${omkjoringsId}/handling`, tokenA, { method: "POST", body: {} });
  await checkNeste("§3 omkjøring inntekt", omkjoringsId, tokenA, "sjekk-rett");
  await call(`/api/prosessoekter/${omkjoringsId}/handling`, tokenA, { method: "POST", body: {} });
  await checkNeste("§3 omkjøring sjekk", omkjoringsId, tokenA, "oppsummering");
  const opprinneligOppsummering = await call(
    `/api/prosessoekter/${omkjoringsId}/handling`,
    tokenA,
    { method: "POST", body: {} }
  );
  check("§3 omkjøring har tidligere resultatkjede",
    opprinneligOppsummering.status === 200
      && ["hent-inntekt", "sjekk-rett", "oppsummering"].every(
        (stegId) => stegId in (opprinneligOppsummering.body?.oekt?.resultater || {})
      ),
    String(opprinneligOppsummering.status));
  await call(`/api/prosessoekter/${omkjoringsId}/forrige`, tokenA, { method: "POST" });
  const tilbakeTilInntekt = await call(
    `/api/prosessoekter/${omkjoringsId}/forrige`,
    tokenA,
    { method: "POST" }
  );
  check("§3 /forrige går tilbake til fullført DATA_FETCH",
    tilbakeTilInntekt.body?.aktivtSteg?.id === "hent-inntekt",
    String(tilbakeTilInntekt.body?.aktivtSteg?.id));

  await stopService(fiksService);
  const mislykketOmkjoring = await call(
    `/api/prosessoekter/${omkjoringsId}/handling`,
    tokenA,
    { method: "POST", body: {} }
  );
  check("§3 mislykket omkjøring gir 502", mislykketOmkjoring.status === 502, String(mislykketOmkjoring.status));
  await checkBlokkert("§3 mislykket omkjøring av DATA_FETCH", omkjoringsId, tokenA, "hent-inntekt");
  const etterOmkjoring = await call(`/api/prosessoekter/${omkjoringsId}`, tokenA);
  check("§3 mislykket omkjøring fjerner gammel resultatkjede",
    ["hent-inntekt", "sjekk-rett", "oppsummering"].every(
      (stegId) => !(stegId in (etterOmkjoring.body?.resultater || {}))
    ),
    JSON.stringify(Object.keys(etterOmkjoring.body?.resultater || {})));

  fiksService = start("fiks", "apps/fiks-simulator/src/server.ts", { ...env, PORT: String(fiksPort) });
  services.push(fiksService);
  await waitForHealth(fiksUrl);

  // §4: tools-api keeps next_step as navigation and passes the gate through.
  const verktoyOekt = await callTool("start_process_session", {
    personId: "person-001",
    prosessId: "redusert-foreldrebetaling-barnehage"
  });
  check("§4 tools-api oppretter økt", verktoyOekt.status === 200, String(verktoyOekt.status));
  const verktoyOektsId = verktoyOekt.body?.result?.oektsId;
  const verktoyInfoNeste = await callTool("next_step", { oektsId: verktoyOektsId });
  check("§4 next_step går fra fullført INFO", verktoyInfoNeste.status === 200, String(verktoyInfoNeste.status));
  const verktoyHopp = await callTool("next_step", { oektsId: verktoyOektsId });
  check("§4 next_step sender fullføringsfeilen videre", verktoyHopp.status === 400, String(verktoyHopp.status));
  check("§4 next_step utfører ikke DATA_FETCH",
    verktoyHopp.body?.feil === IKKE_FULLFORT, String(verktoyHopp.body?.feil));
  const verktoyHandling = await callTool("run_current_action", { oektsId: verktoyOektsId });
  check("§4 run_current_action utfører DATA_FETCH", verktoyHandling.status === 200, String(verktoyHandling.status));
  const verktoyNeste = await callTool("next_step", { oektsId: verktoyOektsId });
  check("§4 next_step går videre etter handling",
    verktoyNeste.status === 200 && verktoyNeste.body?.result?.aktivtSteg?.type === "CONSENT_REQUEST",
    `${verktoyNeste.status} ${String(verktoyNeste.body?.result?.aktivtSteg?.type)}`);

  // §5: process-agent completes every step through tools-api under the same gate.
  const agentOekt = await callAgent("/agent/sessions", { personId: "person-028" });
  check("§5 agentøkt opprettes", agentOekt.status === 201, String(agentOekt.status));
  const agentId = agentOekt.body?.sessionId;
  const valgt = await callAgent(`/agent/sessions/${agentId}/messages`, { message: "fritidskort" });
  check("§5 agenten samler flerfeltsspørsmål etter INFO",
    valgt.status === 200 && valgt.body?.awaiting === "question_fields",
    `${valgt.status} ${String(valgt.body?.awaiting)}`);
  const gjelderFor = await callAgent(`/agent/sessions/${agentId}/messages`, {
    message: "barnet mitt"
  });
  check("§5 agenten ber om neste obligatoriske felt",
    gjelderFor.status === 200 && gjelderFor.body?.awaiting === "question_fields",
    `${gjelderFor.status} ${String(gjelderFor.body?.awaiting)}`);
  const besvart = await callAgent(`/agent/sessions/${agentId}/messages`, { message: "fotball" });
  check("§5 agenten når samtykke etter QUESTION",
    besvart.status === 200 && besvart.body?.awaiting === "consent",
    `${besvart.status} ${String(besvart.body?.awaiting)}`);
  const samtykket = await callAgent(`/agent/sessions/${agentId}/messages`, { message: "jeg samtykker" });
  check("§5 agenten kjører DATA_FETCH, SJEKK og SUMMARY før bekreftelse",
    samtykket.status === 200 && samtykket.body?.awaiting === "summary_confirm",
    `${samtykket.status} ${String(samtykket.body?.awaiting)}`);
  const bekreftet = await callAgent(`/agent/sessions/${agentId}/messages`, { message: "ja" });
  check("§5 agenten går fra fullført SUMMARY til SUBMIT",
    bekreftet.status === 200 && bekreftet.body?.awaiting === "submit",
    `${bekreftet.status} ${String(bekreftet.body?.awaiting)}`);
  const sendt = await callAgent(`/agent/sessions/${agentId}/messages`, { message: "ja, send inn" });
  check("§5 agenten fullfører SUBMIT",
    sendt.status === 200 && sendt.body?.awaiting === null,
    `${sendt.status} ${String(sendt.body?.awaiting)}`);

  // §6: one 404 message, not five. Every økt route answers an unknown id with
  // the same status and the same feil - the drift the wrapper exists to end.
  const ukjent = "oekt-0000000000000-finnes";
  const ruter: [string, Kallvalg][] = [
    [`/api/prosessoekter/${ukjent}`, {}],
    [`/api/prosessoekter/${ukjent}/svar`, { method: "POST", body: { svar: "x" } }],
    [`/api/prosessoekter/${ukjent}/handling`, { method: "POST", body: {} }],
    [`/api/prosessoekter/${ukjent}/neste`, { method: "POST" }],
    [`/api/prosessoekter/${ukjent}/forrige`, { method: "POST" }]
  ];
  const svar404 = await Promise.all(ruter.map(([sti, valg]) => call(sti, tokenA, valg)));
  check("§6 alle fem ruter gir 404 for ukjent økt", svar404.every((s) => s.status === 404),
    svar404.map((s) => s.status).join(","));
  const meldinger = new Set(svar404.map((s) => s.body?.feil));
  check("§6 én og samme 404-melding", meldinger.size === 1 && meldinger.has(IKKE_FUNNET),
    [...meldinger].join(" | "));
} finally {
  for (const service of services) service.kill("SIGTERM");
  await rm(stateDir, { recursive: true, force: true });
}

const total = passed + failures.length;
if (failures.length > 0) {
  console.error(`Lukket økt-test: ${passed}/${total} bestått.\n`);
  for (const line of failures) console.error(`  ✗ ${line}`);
  process.exit(1);
}
console.log(`Lukket økt-test ok. ${passed}/${total} sjekker bestått.`);
