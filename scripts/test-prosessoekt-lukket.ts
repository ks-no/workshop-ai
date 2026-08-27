#!/usr/bin/env node

/*
 * The closed-økt guard in withSession (routes.ts).
 *
 * Without the guard, a replayed POST /handling on a FULLFORT økt runs the SUBMIT
 * handler again and produces a duplicate søknad - and a new Fiks task - per call.
 * With hackathon teams building agents against these APIs, that replay is a
 * double-click, not a theoretical race.
 *
 * This pins the guard: a FULLFORT or AVVIST økt takes no further svar, handling
 * or navigation, while GET keeps working - a rejection you cannot read
 * afterwards would be worse than the bug. Mutation-tested by hand on
 * introduction: with the guard removed from withSession, §1, §2 and §3 below go red.
 *
 * Backend and digdir-mock on their own ports against a fresh STATE_DIR, so this
 * runs alongside a docker stack without touching it. fiks-simulator is left
 * unreachable on purpose: createSoknad degrades to an advarsel instead of an
 * oppgave, and the count of søknader - the thing the replay used to duplicate -
 * is what the test asserts on.
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
import { feilkode } from "../apps/shared/errors.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendPort = Number(process.env.LUKKET_BACKEND_PORT) || 18094;
const digdirPort = Number(process.env.LUKKET_DIGDIR_PORT) || 18095;
const backendUrl = `http://127.0.0.1:${backendPort}`;
const digdirUrl = `http://127.0.0.1:${digdirPort}`;

const AVSLUTTET = "Prosessøkten er avsluttet og kan ikke fortsette.";
const IKKE_FUNNET = "Fant ikke prosessøkt.";

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

async function requireFreePort(port: number) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error) => reject(
      feilkode(error) === "EADDRINUSE"
        ? new Error(`Port ${port} er opptatt. Sett LUKKET_BACKEND_PORT/LUKKET_DIGDIR_PORT.`)
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

async function antallSoknader(personId: string, token: string) {
  const svar = await call(`/api/personer/${personId}/soknader`, token);
  return Array.isArray(svar.body) ? svar.body.length : -1;
}

await requireFreePort(backendPort);
await requireFreePort(digdirPort);

const stateDir = await mkdtemp(path.join(tmpdir(), "lukket-oekt-"));
const env = {
  STATE_DIR: stateDir,
  BACKEND_BASE_URL: backendUrl,
  DIGDIR_BASE_URL: digdirUrl,
  DIGDIR_ISSUER: digdirUrl,
  // fiks unreachable on purpose (see the header comment); ai and matrikkel are
  // never called - the flows below skip SUMMARY, and no SJEKK here needs them.
  FIKS_BASE_URL: "http://127.0.0.1:1",
  AI_BASE_URL: "http://127.0.0.1:1",
  MATRIKKEL_BASE_URL: "http://127.0.0.1:1"
};

const services = [
  start("digdir", "apps/digdir-mock/src/server.ts", { ...env, PORT: String(digdirPort) }),
  start("backend", "apps/sandbox-backend/src/server.ts", { ...env, PORT: String(backendPort) })
];

try {
  await Promise.all([waitForHealth(digdirUrl), waitForHealth(backendUrl)]);

  // §1: replay on a FULLFORT økt. redusert-foreldrebetaling ends in SUBMIT on
  // steg 6; /neste never runs a step, so the flow can walk straight there and
  // the test needs neither samtykke nor ai-gateway.
  const tokenA = await getInnbyggerToken({ digdirBaseUrl: digdirUrl, personId: "person-001", clientId: "lukket-test" });
  const opprettetA = await call("/api/prosessoekter", tokenA, {
    method: "POST",
    body: { personId: "person-001", prosessId: "redusert-foreldrebetaling-barnehage" }
  });
  check("§1 økt opprettet", opprettetA.status === 201, String(opprettetA.status));
  const idA = opprettetA.body?.oektsId;

  for (let steg = 0; steg < 6; steg++) {
    const neste = await call(`/api/prosessoekter/${idA}/neste`, tokenA, { method: "POST" });
    check(`§1 neste til steg ${steg + 1} gir 200`, neste.status === 200, String(neste.status));
  }

  const submit = await call(`/api/prosessoekter/${idA}/handling`, tokenA, { method: "POST", body: {} });
  check("§1 SUBMIT gir 200", submit.status === 200, String(submit.status));
  check("§1 økten er FULLFORT", submit.body?.oekt?.status === "FULLFORT", String(submit.body?.oekt?.status));
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

  // §2: replay on an AVVIST økt. person-003 gets avslag on støttekontakt
  // (kapasiteten er full), and that SJEKK is the one check that needs no
  // samtykke - so the flow reaches AVVIST without fiks.
  const tokenB = await getInnbyggerToken({ digdirBaseUrl: digdirUrl, personId: "person-003", clientId: "lukket-test" });
  const opprettetB = await call("/api/prosessoekter", tokenB, {
    method: "POST",
    body: { personId: "person-003", prosessId: "stottekontakt-behov" }
  });
  check("§2 økt opprettet", opprettetB.status === 201, String(opprettetB.status));
  const idB = opprettetB.body?.oektsId;

  await call(`/api/prosessoekter/${idB}/neste`, tokenB, { method: "POST" });
  const svarB = await call(`/api/prosessoekter/${idB}/svar`, tokenB, {
    method: "POST",
    body: { stegId: "situasjon", svar: { beskrivelse: "Trenger følge i helgene", onskerKontakt: "ja", kontaktkanal: "Telefon" } }
  });
  check("§2 svar på åpen økt gir 200", svarB.status === 200, String(svarB.status));
  // Three: past the CONSENT_REQUEST, past hent-kontaktinfo - which would 403
  // without a samtykke, and needs fiks - and onto the SJEKK. /neste only moves
  // stegIndex, so skipping a step is not the same as running it.
  await call(`/api/prosessoekter/${idB}/neste`, tokenB, { method: "POST" });
  await call(`/api/prosessoekter/${idB}/neste`, tokenB, { method: "POST" });
  await call(`/api/prosessoekter/${idB}/neste`, tokenB, { method: "POST" });

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

  // §3: one 404 message, not five. Every økt route answers an unknown id with
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
  check("§3 alle fem ruter gir 404 for ukjent økt", svar404.every((s) => s.status === 404),
    svar404.map((s) => s.status).join(","));
  const meldinger = new Set(svar404.map((s) => s.body?.feil));
  check("§3 én og samme 404-melding", meldinger.size === 1 && meldinger.has(IKKE_FUNNET),
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
