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
 *   4. Et trukket samtykke tar inntekten ut av økten, og gjenlesingen logges.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getInnbyggerToken, getMaskinportenToken } from "../apps/digdir-mock/src/client.ts";
import { resultaterNaa } from "../apps/sandbox-backend/src/prosess.ts";
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

// --- 4. et trukket samtykke tar resultatet ut av økten ------------------------

/*
 * Resultatene ble liggende på økten og ble servert igjen på hver henting, uten at
 * porten i runRessurs var innom. Trekker innbyggeren samtykket, skal inntekten ut
 * av svaret - både DATA_FETCH-resultatet og vilkårsgrunnlaget, som bærer det samme
 * beløpet - og gjenlesingen skal ha en rad, slik en direkte lesing har.
 */
async function trukketSamtykkeTommerOekten() {
  // En annen person enn de tre foran: person-001 har alt et gyldig inntektssamtykke
  // fra §2, og da er det riktige svaret at inntekten blir stående.
  const token = await innbyggerAuth("person-003");
  const opprettet = await kall(backendUrl, "/api/prosessoekter", token, {
    method: "POST",
    body: { personId: "person-003", prosessId: "redusert-foreldrebetaling-barnehage" }
  });
  const id = opprettet.kropp.oektsId;
  const sporingsId = opprettet.kropp.sporingsId;

  // INFO -> hent-husstand
  await kall(backendUrl, `/api/prosessoekter/${id}/neste`, token, { method: "POST" });
  await kall(backendUrl, `/api/prosessoekter/${id}/handling`, token, { method: "POST", body: {} });
  // -> samtykke-inntekt
  await kall(backendUrl, `/api/prosessoekter/${id}/neste`, token, { method: "POST" });
  const bedt = await kall(backendUrl, `/api/prosessoekter/${id}/handling`, token, {
    method: "POST",
    body: { handling: "opprett-samtykke" }
  });
  check("samtykket opprettes fra steget", bedt.status === 200, `status ${bedt.status}`);
  const samtykkeId = bedt.kropp?.oekt?.aktivtSamtykkeId;
  check("økten kjenner sitt aktive samtykke", Boolean(samtykkeId), JSON.stringify(bedt.kropp?.oekt?.aktivtSamtykkeId));
  await kall(backendUrl, `/api/prosessoekter/${id}/handling`, token, {
    method: "POST",
    body: { handling: "samtykkesvar", status: "SAMTYKKET" }
  });
  // -> hent-inntekt
  await kall(backendUrl, `/api/prosessoekter/${id}/neste`, token, { method: "POST" });
  const inntekt = await kall(backendUrl, `/api/prosessoekter/${id}/handling`, token, { method: "POST", body: {} });
  check("inntektssteget svarer 200", inntekt.status === 200, `status ${inntekt.status}`);

  const foer = await kall(backendUrl, `/api/prosessoekter/${id}`, token);
  check(
    "økten bærer inntektsresultatet mens samtykket står",
    foer.kropp?.resultater?.["hent-inntekt"] !== undefined,
    JSON.stringify(Object.keys(foer.kropp?.resultater || {}))
  );
  const etterFoerste = await loggFor(sporingsId);
  check(
    "gjenlesing med gyldig samtykke logges",
    loggRader(etterFoerste, "DATA_LES", "inntekt").length >= 2,
    JSON.stringify(loggRader(etterFoerste, "DATA_LES").map((rad) => rad.ressurs))
  );

  // Agentsløyfa poller denne ruten, og hver rad skriver hele revisjonsloggen om
  // igjen. Én rad per kilde per økt, ikke én per henting.
  for (let runde = 0; runde < 3; runde++) {
    await kall(backendUrl, `/api/prosessoekter/${id}`, token);
  }
  const gjenlesinger = (await loggFor(sporingsId))
    .filter((rad: any) => rad.formaal === "Gjenlesing av prosessøkt" && rad.ressurs === "inntekt");
  check(
    "gjentatt henting av økten gir ikke en rad per henting",
    gjenlesinger.length === 1,
    `fant ${gjenlesinger.length} gjenlesingsrader etter fire hentinger`
  );

  // -> sjekk-rett. Vilkårsvurderingen legger inntekten i grunnlaget sitt, så
  // resultatet er den samme opplysningen en gang til, under en annen steg-id.
  await kall(backendUrl, `/api/prosessoekter/${id}/neste`, token, { method: "POST" });
  const sjekk = await kall(backendUrl, `/api/prosessoekter/${id}/handling`, token, { method: "POST", body: {} });
  check("vilkårssteget svarer 200", sjekk.status === 200, `status ${sjekk.status}`);
  check(
    "vilkårsgrunnlaget bærer inntekten mens samtykket står",
    typeof sjekk.kropp?.oekt?.resultater?.["sjekk-rett"]?.grunnlag?.beregningsbeloep === "number",
    JSON.stringify(sjekk.kropp?.oekt?.resultater?.["sjekk-rett"]?.grunnlag)
  );

  const fiksToken = await maskinAuth("ks:fiks:samtykke", "fiks-simulator");
  const trukket = await kall(fiksUrl, `/fiks/samtykke/${samtykkeId}/trekk`, fiksToken, {
    method: "PUT",
    body: { sporingsId: "samtykke-trekk" }
  });
  check("samtykket trekkes", trukket.status === 200, `status ${trukket.status}`);

  const etter = await kall(backendUrl, `/api/prosessoekter/${id}`, token);
  check("økten svarer fortsatt 200 etter trekket", etter.status === 200, `status ${etter.status}`);
  check(
    "inntektsresultatet er ute av økten når samtykket er trukket",
    etter.kropp?.resultater?.["hent-inntekt"] === undefined,
    JSON.stringify(Object.keys(etter.kropp?.resultater || {}))
  );
  check(
    "husstanden, som ikke krever samtykke, står igjen",
    etter.kropp?.resultater?.["hent-husstand"] !== undefined,
    JSON.stringify(Object.keys(etter.kropp?.resultater || {}))
  );
  // Samme beløp, ett steg unna: porten gjaldt bare DATA_FETCH, så dette ble stående.
  check(
    "vilkårsgrunnlaget er ute av økten når samtykket er trukket",
    etter.kropp?.resultater?.["sjekk-rett"] === undefined,
    JSON.stringify(etter.kropp?.resultater?.["sjekk-rett"]?.grunnlag)
  );

}

/*
 * Og flyten går ikke videre på et grunnlag som er trukket.
 *
 * Oppsummeringen og søknadsdokumentet bygges av de gjennomgåtte resultatene, så uten
 * vakten gikk søknaden gjennom med inntekten og vedtakslinjen stille borte.
 *
 * Egen person: person-003 sitt vedtak er avslag, så økten er AVVIST etter SJEKK og
 * tar ingen flere handlinger. person-006 innvilges og står AKTIV.
 */
async function flytenStopperNaarGrunnlagetErTrukket() {
  const token = await innbyggerAuth("person-006");
  const opprettet = await kall(backendUrl, "/api/prosessoekter", token, {
    method: "POST",
    body: { personId: "person-006", prosessId: "redusert-foreldrebetaling-barnehage" }
  });
  const id = opprettet.kropp.oektsId;

  await kall(backendUrl, `/api/prosessoekter/${id}/neste`, token, { method: "POST" });
  await kall(backendUrl, `/api/prosessoekter/${id}/handling`, token, { method: "POST", body: {} });
  await kall(backendUrl, `/api/prosessoekter/${id}/neste`, token, { method: "POST" });
  const bedt = await kall(backendUrl, `/api/prosessoekter/${id}/handling`, token, {
    method: "POST",
    body: { handling: "opprett-samtykke" }
  });
  const samtykkeId = bedt.kropp?.oekt?.aktivtSamtykkeId;
  await kall(backendUrl, `/api/prosessoekter/${id}/handling`, token, {
    method: "POST",
    body: { handling: "samtykkesvar", status: "SAMTYKKET" }
  });
  await kall(backendUrl, `/api/prosessoekter/${id}/neste`, token, { method: "POST" });
  await kall(backendUrl, `/api/prosessoekter/${id}/handling`, token, { method: "POST", body: {} });
  await kall(backendUrl, `/api/prosessoekter/${id}/neste`, token, { method: "POST" });
  const sjekk = await kall(backendUrl, `/api/prosessoekter/${id}/handling`, token, { method: "POST", body: {} });
  check(
    "person-006 innvilges, så økten står åpen",
    sjekk.kropp?.oekt?.status === "AKTIV",
    `${sjekk.kropp?.oekt?.status}: ${JSON.stringify(sjekk.kropp?.resultat?.melding)}`
  );

  const fiksToken = await maskinAuth("ks:fiks:samtykke", "fiks-simulator");
  await kall(fiksUrl, `/fiks/samtykke/${samtykkeId}/trekk`, fiksToken, {
    method: "PUT",
    body: { sporingsId: "samtykke-trekk-innsending" }
  });

  // -> oppsummering. Vakten står før kallet til KI-tjenesten, så dette er en 403 og
  // ikke en 502 om at modellen ikke svarte.
  await kall(backendUrl, `/api/prosessoekter/${id}/neste`, token, { method: "POST" });
  const oppsummering = await kall(backendUrl, `/api/prosessoekter/${id}/handling`, token, {
    method: "POST",
    body: {}
  });
  check(
    "oppsummeringen nektes når samtykket er trukket",
    oppsummering.status === 403,
    `status ${oppsummering.status}: ${JSON.stringify(oppsummering.kropp)}`
  );
  const soknader = await kall(backendUrl, "/api/personer/person-006/soknader", token);
  const antall = (soknader.kropp?.soknader || soknader.kropp || []).length;
  check("og ingen søknad ble lagret", antall === 0, JSON.stringify(soknader.kropp));
}

/*
 * Oppsummeringen er skrevet AV de gatede resultatene og siterer beløpet i klartekst,
 * mer enn SJEKK-grunnlaget bærer. Steget har ingen `api`, så porten kan ikke måles på
 * det - den holder bare så lenge hver kilde prosessen krever samtykke for, står.
 *
 * Ren funksjon, med literal-tilstand: å komme fram til SUMMARY over HTTP ville krevd
 * en KI-tjeneste, og det denne sjekken handler om er porten, ikke modellen.
 */
async function oppsummeringenGatesAvKildeneSine() {
  const definisjoner = JSON.parse(
    await readFile(path.join(repoRoot, "data/prosessdefinisjoner.json"), "utf8")
  );
  const prosess = (definisjoner.prosesser || definisjoner)
    .find((kandidat: any) => kandidat.id === "redusert-foreldrebetaling-barnehage");
  const satser = JSON.parse(await readFile(path.join(repoRoot, "data/satser.json"), "utf8"));
  const samtykke = {
    samtykkeId: "samtykke-test",
    personId: "person-001",
    dataKilder: ["inntekt"],
    status: "SAMTYKKET",
    opprettet: "2026-08-01T00:00:00.000Z",
    utloper: "2099-01-01T00:00:00.000Z"
  };
  const resultaterRaa = {
    "hent-husstand": { type: "ENSLIG_FORSORGER" },
    "hent-inntekt": { beregningsbeloep: 485000 },
    "sjekk-rett": { grunnlag: { beregningsbeloep: 485000 } },
    oppsummering: { tekst: "Inntektsgrunnlag 2025: 485 000 kr." }
  };
  const oekt = {
    oektsId: "oekt-test", personId: "person-001", prosessId: prosess.id,
    sporingsId: "flyt-test", status: "AKTIV", stegIndex: 5, svar: {},
    aktivtSamtykkeId: "samtykke-test", resultaterRaa,
    opprettet: "2026-08-01T00:00:00.000Z", oppdatert: "2026-08-01T00:00:00.000Z"
  } as any;
  const kaller = { type: "innbygger", id: "12818800078" } as any;

  const med = resultaterNaa(
    { samtykker: [samtykke], satser, personer: [], husstander: [] } as any,
    oekt, prosess, kaller
  );
  check("oppsummeringen står så lenge kildene er samtykket",
    med.resultater.oppsummering !== undefined, JSON.stringify(Object.keys(med.resultater)));

  for (const [navn, rad] of [
    ["trukket", { ...samtykke, status: "TRUKKET" }],
    ["utløpt", { ...samtykke, utloper: "2020-01-01T00:00:00.000Z" }]
  ] as const) {
    const uten = resultaterNaa(
      { samtykker: [rad], satser, personer: [], husstander: [] } as any,
      oekt, prosess, kaller
    );
    check(`oppsummeringen er ute når samtykket er ${navn}`,
      uten.resultater.oppsummering === undefined, JSON.stringify(Object.keys(uten.resultater)));
  }
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
    await trukketSamtykkeTommerOekten();
    await flytenStopperNaarGrunnlagetErTrukket();
    await oppsummeringenGatesAvKildeneSine();
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
