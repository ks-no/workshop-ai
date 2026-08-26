#!/usr/bin/env node

/*
 * Revisjonsspor for direkte HTTP-kall til SJEKK-ressursene - issue #2.
 *
 * SJEKK-steget i prosessmotoren logger SJEKK_OK/SJEKK_AVVIST selv, så oppslaget
 * under steget skal ikke gi noen DATA_LES i tillegg. Men de samme ressursene er
 * HTTP-endepunkter, og der finnes ingen SJEKK-kaller: en direkte lesning som ikke
 * etterlater DATA_LES bryter revisjon-av-all-datatilgang. Undertrykkingen ligger
 * derfor i kallkonteksten (steg.type === "SJEKK"), ikke i ressurskatalogen.
 *
 * Tre tilfeller, mot ekte tjenester på egne porter med tom STATE_DIR:
 *   1. Direkte sjekk uten samtykkekrav (matrikkel-eierforhold) gir DATA_LES.
 *   2. Direkte sjekk med gyldig samtykke (regelvurdering) gir DATA_LES med
 *      samtykkets formaal og grunnlag.
 *   3. Motor-stien (fartsdempende-tiltak) logger SJEKK_OK uten DATA_LES for
 *      sjekk-ressursen - og DATA_FETCH-steget logger fortsatt sin.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getInnbyggerToken, getMaskinportenToken } from "../apps/digdir-mock/src/client.ts";
import { feilkode, feilmelding } from "../apps/shared/errors.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendPort = Number(process.env.REVISJON_BACKEND_PORT) || 18110;
const fiksPort = Number(process.env.REVISJON_FIKS_PORT) || 18111;
const matrikkelPort = Number(process.env.REVISJON_MATRIKKEL_PORT) || 18112;
const digdirPort = Number(process.env.REVISJON_DIGDIR_PORT) || 18113;
const backendUrl = `http://127.0.0.1:${backendPort}`;
const fiksUrl = `http://127.0.0.1:${fiksPort}`;
const matrikkelUrl = `http://127.0.0.1:${matrikkelPort}`;
const digdirUrl = `http://127.0.0.1:${digdirPort}`;

let bestatt = 0;
const feil: string[] = [];

function check(navn: string, betingelse: unknown, detalj = ""): void {
  if (betingelse) {
    bestatt += 1;
    return;
  }
  feil.push(`${navn}${detalj ? ` - ${detalj}` : ""}`);
}

// --- process startup, same shape as kontrakt-smoke -------------------------

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

async function requireFreePort(portnummer: number) {
  await new Promise((klar, avvis) => {
    const proeve = createServer();
    proeve.once("error", (avbrudd) => avvis(
      feilkode(avbrudd) === "EADDRINUSE"
        ? new Error(`Port ${portnummer} er opptatt. Sett REVISJON_*_PORT til ledige porter.`)
        : avbrudd
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

// --- calls ------------------------------------------------------------------

async function innbyggerAuth(personId: string) {
  return `Bearer ${await getInnbyggerToken({
    digdirBaseUrl: digdirUrl, personId, clientId: "test-revisjonsspor"
  })}`;
}

// Audience separation is enforced: a token minted for sandbox-backend is refused
// by fiks-simulator, so the resource must name the surface being called.
async function maskinAuth(scope: string, resource = "sandbox-backend") {
  return `Bearer ${await getMaskinportenToken({
    digdirBaseUrl: digdirUrl, issuer: digdirUrl, clientId: "test-revisjonsspor",
    scope, resource
  })}`;
}

async function kall(basisUrl: string, sti: string, token: string, valg: { method?: string; body?: unknown } = {}) {
  const svar = await fetch(`${basisUrl}${sti}`, {
    method: valg.method || "GET",
    headers: {
      Authorization: token,
      ...(valg.body ? { "Content-Type": "application/json" } : {})
    },
    body: valg.body ? JSON.stringify(valg.body) : undefined
  });
  return { status: svar.status, kropp: await svar.json() as any };
}

async function loggFor(sporingsId: string) {
  const token = await maskinAuth("ks:innbyggerdialog:les");
  const { status, kropp } = await kall(backendUrl, "/api/revisjonslogg", token);
  if (status !== 200) throw new Error(`Kunne ikke lese revisjonslogg: ${status}`);
  return (kropp as any[]).filter((rad) => rad.sporingsId === sporingsId);
}

// --- 1. direkte sjekk uten samtykkekrav ------------------------------------

async function direkteEierforhold(fnr: string, token: string) {
  const sporingsId = "direkte-eierforhold";
  const { status, kropp } = await kall(
    backendUrl,
    `/api/matrikkel/sjekk/eierforhold?personId=person-001&gate=Storgata&sporingsId=${sporingsId}`,
    token
  );
  check("direkte eierforhold-sjekk svarer 200", status === 200, `status ${status}`);
  check("direkte eierforhold-sjekk godkjennes", kropp.godkjent === true, JSON.stringify(kropp));

  const rader = loggRader(await loggFor(sporingsId), "DATA_LES", "matrikkel-eierforhold");
  check("direkte eierforhold-sjekk etterlater nøyaktig én DATA_LES", rader.length === 1, `fant ${rader.length}`);
  const rad = rader[0];
  check("DATA_LES for eierforhold navngir innbyggeren", rad?.aktor?.type === "innbygger" && rad?.aktor?.id === fnr, JSON.stringify(rad?.aktor));
}

function loggRader(rader: any[], handling: string, ressurs?: string) {
  return rader.filter((rad) => rad.handling === handling && (!ressurs || rad.ressurs === ressurs));
}

// --- 2. direkte sjekk med gyldig samtykke -----------------------------------

async function direkteRegelsjekk(fnr: string, token: string) {
  const fiksToken = await maskinAuth("ks:fiks:samtykke", "fiks-simulator");
  const opprettet = await kall(fiksUrl, "/fiks/samtykke", fiksToken, {
    method: "POST",
    body: {
      personId: "person-001",
      formaal: "Vurdere rett til redusert foreldrebetaling",
      dataKilder: ["inntekt"],
      sporingsId: "samtykke-oppsett"
    }
  });
  check("samtykke opprettes i fiks", opprettet.status === 201, `status ${opprettet.status}`);
  const samtykkeId = opprettet.kropp.samtykkeId;

  const svart = await kall(fiksUrl, `/fiks/samtykke/${samtykkeId}/svar`, fiksToken, {
    method: "PUT",
    body: { status: "SAMTYKKET", sporingsId: "samtykke-oppsett" }
  });
  check("samtykket besvares", svart.status === 200, `status ${svart.status}`);

  const sporingsId = "direkte-regelsjekk";
  const { status } = await kall(
    backendUrl,
    `/api/regler/sjekk/ordning?personId=person-001&ordning=redusert-foreldrebetaling-barnehage&sporingsId=${sporingsId}`,
    token
  );
  check("direkte regelsjekk med samtykke svarer 200", status === 200, `status ${status}`);

  const rader = loggRader(await loggFor(sporingsId), "DATA_LES", "regelvurdering");
  check("direkte regelsjekk etterlater nøyaktig én DATA_LES", rader.length === 1, `fant ${rader.length}`);
  const rad = rader[0];
  check("DATA_LES for regelsjekk navngir innbyggeren", rad?.aktor?.type === "innbygger" && rad?.aktor?.id === fnr, JSON.stringify(rad?.aktor));
  check(
    "DATA_LES for regelsjekk bærer samtykkets formaal",
    rad?.formaal === "Vurdere rett til redusert foreldrebetaling",
    JSON.stringify(rad?.formaal)
  );
  check(
    "DATA_LES for regelsjekk peker på samtykket som grunnlag",
    rad?.grunnlag?.type === "samtykke" && rad?.grunnlag?.id === samtykkeId,
    JSON.stringify(rad?.grunnlag)
  );
}

// --- 3. motor-stien logger ikke dobbelt --------------------------------------

async function motorFartsdemping(token: string) {
  const opprettet = await kall(backendUrl, "/api/prosessoekter", token, {
    method: "POST",
    body: { personId: "person-001", prosessId: "fartsdempende-tiltak" }
  });
  check("prosessøkt opprettes", opprettet.status === 201 || opprettet.status === 200, `status ${opprettet.status}`);
  const id = opprettet.kropp.oektsId;
  const sporingsId = opprettet.kropp.sporingsId;

  await kall(backendUrl, `/api/prosessoekter/${id}/neste`, token, { method: "POST" });
  await kall(backendUrl, `/api/prosessoekter/${id}/svar`, token, {
    method: "POST",
    body: { stegId: "velg-gate", svar: "Storgata" }
  });
  await kall(backendUrl, `/api/prosessoekter/${id}/neste`, token, { method: "POST" });
  const hentGate = await kall(backendUrl, `/api/prosessoekter/${id}/handling`, token, { method: "POST", body: {} });
  check("DATA_FETCH-steget svarer 200", hentGate.status === 200, `status ${hentGate.status}`);
  await kall(backendUrl, `/api/prosessoekter/${id}/neste`, token, { method: "POST" });
  const sjekk = await kall(backendUrl, `/api/prosessoekter/${id}/handling`, token, { method: "POST", body: {} });
  check("SJEKK-steget svarer 200", sjekk.status === 200, `status ${sjekk.status}`);

  const rader = await loggFor(sporingsId);
  check("motor-stien logger nøyaktig én SJEKK_OK", loggRader(rader, "SJEKK_OK").length === 1,
    JSON.stringify(rader.map((rad) => rad.handling)));
  check("SJEKK-steget logger ingen DATA_LES for sjekk-ressursen",
    loggRader(rader, "DATA_LES", "matrikkel-eierforhold").length === 0,
    JSON.stringify(loggRader(rader, "DATA_LES")));
  check("DATA_FETCH-steget logger fortsatt DATA_LES",
    loggRader(rader, "DATA_LES", "matrikkel-gate").length === 1,
    JSON.stringify(loggRader(rader, "DATA_LES")));
}

// --- run ---------------------------------------------------------------------

async function run() {
  await requireFreePort(backendPort);
  await requireFreePort(fiksPort);
  await requireFreePort(matrikkelPort);
  await requireFreePort(digdirPort);

  const stateDir = await mkdtemp(path.join(tmpdir(), "test-revisjonsspor-"));
  const miljo = {
    STATE_DIR: stateDir,
    FIKS_BASE_URL: fiksUrl,
    BACKEND_BASE_URL: backendUrl,
    AI_BASE_URL: "http://127.0.0.1:8082",
    MATRIKKEL_BASE_URL: matrikkelUrl,
    DIGDIR_BASE_URL: digdirUrl,
    DIGDIR_ISSUER: digdirUrl
  };

  const tjenester = [
    // digdir-mock first: it writes its signing key into the fresh STATE_DIR.
    start("digdir", "apps/digdir-mock/src/server.ts", { ...miljo, PORT: String(digdirPort) }),
    start("backend", "apps/sandbox-backend/src/server.ts", { ...miljo, PORT: String(backendPort) }),
    start("fiks", "apps/fiks-simulator/src/server.ts", { ...miljo, PORT: String(fiksPort) }),
    start("matrikkel", "apps/matrikkel-mock/src/server.ts", { ...miljo, PORT: String(matrikkelPort) })
  ];

  try {
    await Promise.all([
      waitForHealth(digdirUrl),
      waitForHealth(backendUrl),
      waitForHealth(fiksUrl),
      waitForHealth(matrikkelUrl)
    ]);

    const token = await innbyggerAuth("person-001");
    const person = await kall(backendUrl, "/api/personer/person-001", token);
    const fnr = person.kropp.syntetiskFodselsnummer;
    check("testpersonen har syntetisk fødselsnummer", Boolean(fnr));

    await direkteEierforhold(fnr, token);
    await direkteRegelsjekk(fnr, token);
    await motorFartsdemping(token);
  } finally {
    for (const tjeneste of tjenester) {
      tjeneste.kill("SIGTERM");
    }
    await rm(stateDir, { recursive: true, force: true });
  }

  if (feil.length > 0) {
    console.error(`\n${feil.length} sjekk(er) feilet:`);
    for (const linje of feil) {
      console.error(`  ✗ ${linje}`);
    }
    process.exit(1);
  }
  console.log(`Alle ${bestatt} sjekker bestått.`);
}

run().catch((avbrudd) => {
  console.error(`test-revisjonsspor feilet: ${feilmelding(avbrudd)}`);
  process.exit(1);
});
