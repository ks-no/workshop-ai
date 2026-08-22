#!/usr/bin/env node

/*
 * Samtykkets tilstandsmaskin, utløp og skrivekø — Del D.
 *
 * Two halves. The first is pure functions off disk: the transition table, expiry,
 * and what hasGyldigSamtykke does with an expired consent. The second starts a
 * fiks-simulator on its own port against a temp STATE_DIR and drives the real
 * routes, because the interesting failures here are concurrency and HTTP status,
 * and neither shows up in a unit test.
 *
 * The lost-update test is the reason this file exists at all: before the write
 * queue, ten simultaneous POST /fiks/samtykke produced fewer than ten samtykker
 * and said nothing about it.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { hasGyldigSamtykke, hasUtloeptSamtykke } from "../apps/sandbox-backend/src/regler.ts";
import {
  SAMTYKKESTATUSER,
  effektivStatus,
  isUtloept,
  validateSamtykkeovergang
} from "../apps/fiks-simulator/src/samtykke.ts";
import { validateOppgaveovergang } from "../apps/fiks-simulator/src/oppgave.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.SAMTYKKE_FIKS_PORT) || 18091;
const basisUrl = `http://127.0.0.1:${port}`;

let bestatt = 0;
const feil = [];

function check(navn, betingelse, detalj = "") {
  if (betingelse) {
    bestatt += 1;
    return;
  }
  feil.push(`${navn}${detalj ? ` — ${detalj}` : ""}`);
}

const iTida = (dager) => new Date(Date.now() + dager * 24 * 60 * 60 * 1000).toISOString();

// --- 1. kodeverket ---------------------------------------------------------

check(
  "kodeverket har fem statuser i fast rekkefølge",
  JSON.stringify(SAMTYKKESTATUSER) ===
    JSON.stringify(["VENTER_PAA_SVAR", "SAMTYKKET", "IKKE_SAMTYKKET", "TRUKKET", "UTLOEPT"]),
  JSON.stringify(SAMTYKKESTATUSER)
);

// --- 2. lovlige og ulovlige overganger -------------------------------------

const lovlige = [
  ["VENTER_PAA_SVAR", "SAMTYKKET"],
  ["VENTER_PAA_SVAR", "IKKE_SAMTYKKET"],
  ["SAMTYKKET", "TRUKKET"],
  ["SAMTYKKET", "UTLOEPT"]
];
for (const [fra, til] of lovlige) {
  check(`${fra} → ${til} er lovlig`, validateSamtykkeovergang(fra, til).lovlig === true);
}

// Every pair the table does not name must be refused. Enumerated rather than
// listed by hand, so a widened table cannot pass this file unchanged.
const lovligeNoekler = new Set(lovlige.map(([fra, til]) => `${fra}->${til}`));
for (const fra of SAMTYKKESTATUSER) {
  for (const til of SAMTYKKESTATUSER) {
    if (lovligeNoekler.has(`${fra}->${til}`)) continue;
    const utfall = validateSamtykkeovergang(fra, til);
    check(`${fra} → ${til} avvises`, utfall.lovlig === false);
    check(`${fra} → ${til} gir 409`, utfall.lovlig === false && utfall.status === 409, String(utfall.status));
  }
}

// The refusal has to say both halves, or a client cannot tell what went wrong.
const trukketSvar = validateSamtykkeovergang("TRUKKET", "SAMTYKKET");
check(
  "avvisningen sier hva statusen var og hva som ble forsøkt",
  !trukketSvar.lovlig && trukketSvar.melding.includes("TRUKKET") && trukketSvar.melding.includes("SAMTYKKET"),
  trukketSvar.melding
);
check(
  "endelig status sies å være endelig",
  !trukketSvar.lovlig && trukketSvar.melding.includes("endelig"),
  trukketSvar.melding
);

// A status outside the kodeverk is a malformed request, not a conflict.
const tull = validateSamtykkeovergang("VENTER_PAA_SVAR", "JA_TAKK");
check("ukjent status gir 400", !tull.lovlig && tull.status === 400, String(tull.status));
check("ukjent status gir kode UKJENT_STATUS", !tull.lovlig && tull.kode === "UKJENT_STATUS");
check("ukjent status lister de gyldige", !tull.lovlig && tull.melding.includes("VENTER_PAA_SVAR"), tull.melding);

// Rubbish already on disk: the request is fine, the row is not.
const raatten = validateSamtykkeovergang("SAMTYKKA", "TRUKKET");
check("ukjent lagret status gir 409", !raatten.lovlig && raatten.status === 409, String(raatten.status));

// --- 3. utløp --------------------------------------------------------------

check("utløp i framtida er ikke utløpt", isUtloept({ utloper: iTida(1) }) === false);
check("utløp i fortida er utløpt", isUtloept({ utloper: iTida(-1) }) === true);
check("uten utloper er ingenting utløpt", isUtloept({}) === false);
check("ugyldig utloper er ingenting utløpt", isUtloept({ utloper: "i morgen" }) === false);
// An offset-carrying fixture must compare correctly against a Z-stamped clock.
check("utløp med tidssone-offset sammenlignes riktig", isUtloept({ utloper: "2020-01-01T00:00:00+02:00" }) === true);

check(
  "utløpt SAMTYKKET leses som UTLOEPT",
  effektivStatus({ status: "SAMTYKKET", utloper: iTida(-1) }) === "UTLOEPT"
);
check(
  "gyldig SAMTYKKET leses som SAMTYKKET",
  effektivStatus({ status: "SAMTYKKET", utloper: iTida(30) }) === "SAMTYKKET"
);
// Expiry applies to a consent that was given. A request nobody answered stays
// answerable — see SAMTYKKEOVERGANGER.
check(
  "utløpt VENTER_PAA_SVAR er fortsatt VENTER_PAA_SVAR",
  effektivStatus({ status: "VENTER_PAA_SVAR", utloper: iTida(-1) }) === "VENTER_PAA_SVAR"
);
check(
  "en trukket rad forblir TRUKKET selv om den er utløpt",
  effektivStatus({ status: "TRUKKET", utloper: iTida(-1) }) === "TRUKKET"
);

// Expiry must be refused by the same rule that refuses everything else.
check(
  "et utløpt samtykke kan ikke trekkes",
  validateSamtykkeovergang(effektivStatus({ status: "SAMTYKKET", utloper: iTida(-1) }), "TRUKKET").lovlig === false
);

// --- 4. hjemmel: utløpt samtykke hjemler ingen lesning ---------------------

const gyldigRad = {
  samtykkeId: "samtykke-gyldig",
  personId: "person-001",
  status: "SAMTYKKET",
  dataKilder: ["inntekt"],
  opprettet: "2026-08-01T10:00:00.000Z",
  utloper: iTida(30)
};
const expiredRow = {
  ...gyldigRad,
  samtykkeId: "samtykke-utloept",
  opprettet: "2026-08-10T10:00:00.000Z",
  utloper: iTida(-1)
};

check(
  "et gyldig samtykke hjemler lesning",
  hasGyldigSamtykke({ samtykker: [gyldigRad] }, "person-001", "inntekt")?.samtykkeId === "samtykke-gyldig"
);
check(
  "et utløpt samtykke hjemler ingen lesning",
  hasGyldigSamtykke({ samtykker: [expiredRow] }, "person-001", "inntekt") === null
);
// The newest wins, but only among the ones that still count. Before expiry was
// real, the newer expired row would have been picked over the valid older one.
check(
  "nyeste gyldige velges, ikke nyeste utløpte",
  hasGyldigSamtykke({ samtykker: [gyldigRad, expiredRow] }, "person-001", "inntekt")?.samtykkeId === "samtykke-gyldig"
);
// An expired consent must not win by being asked for by id either.
check(
  "et utløpt samtykke velges ikke selv om økten foretrekker det",
  hasGyldigSamtykke({ samtykker: [gyldigRad, expiredRow] }, "person-001", "inntekt", "samtykke-utloept")
    ?.samtykkeId === "samtykke-gyldig"
);
check(
  "utløpt samtykke skilles fra manglende samtykke",
  hasUtloeptSamtykke({ samtykker: [expiredRow] }, "person-001", "inntekt") === true
);
check(
  "ingen samtykke er ikke et utløpt samtykke",
  hasUtloeptSamtykke({ samtykker: [] }, "person-001", "inntekt") === false
);
check(
  "et trukket samtykke er ikke et utløpt samtykke",
  hasUtloeptSamtykke({ samtykker: [{ ...gyldigRad, status: "TRUKKET" }] }, "person-001", "inntekt") === false
);

// --- 5. oppgavens maskin ---------------------------------------------------

check("OPPRETTET → UNDER_BEHANDLING er lovlig", validateOppgaveovergang("OPPRETTET", "UNDER_BEHANDLING").lovlig === true);
check("UNDER_BEHANDLING → FERDIG er lovlig", validateOppgaveovergang("UNDER_BEHANDLING", "FERDIG").lovlig === true);
check("UNDER_BEHANDLING → AVVIST er lovlig", validateOppgaveovergang("UNDER_BEHANDLING", "AVVIST").lovlig === true);
check("OPPRETTET → FERDIG avvises", validateOppgaveovergang("OPPRETTET", "FERDIG").lovlig === false);
check("FERDIG → UNDER_BEHANDLING avvises", validateOppgaveovergang("FERDIG", "UNDER_BEHANDLING").lovlig === false);

// --- 6. de virkelige rutene -----------------------------------------------

async function requireFreePort(portnummer) {
  await new Promise((klar, avvis) => {
    const proeve = createServer();
    proeve.once("error", (aarsak) => avvis(
      aarsak.code === "EADDRINUSE"
        ? new Error(`Port ${portnummer} er opptatt. Sett SAMTYKKE_FIKS_PORT til en ledig port.`)
        : aarsak
    ));
    proeve.listen(portnummer, "127.0.0.1", () => proeve.close(klar));
  });
}

async function waitForHealth(tidsfrist = 15000) {
  const innen = Date.now() + tidsfrist;
  while (Date.now() < innen) {
    try {
      if ((await fetch(`${basisUrl}/helse`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((klar) => setTimeout(klar, 100));
  }
  throw new Error(`fiks-simulator svarte ikke på /helse innen ${tidsfrist} ms.`);
}

async function call(sti, valg = {}) {
  const svar = await fetch(`${basisUrl}${sti}`, {
    method: valg.method || "GET",
    headers: valg.body ? { "Content-Type": "application/json" } : {},
    body: valg.body ? JSON.stringify(valg.body) : undefined
  });
  return { status: svar.status, kropp: await svar.json() };
}

const stateDir = await mkdtemp(path.join(tmpdir(), "samtykke-test-"));
await requireFreePort(port);

// sandbox-backend owns the audit log, and what gets written to it is half the
// point of a samtykke event — so it is collected here rather than thrown away.
// Port 0 picks a free one, which keeps this out of the port-allocation table.
const revisjon = [];
const revisjonstjener = createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/api/revisjonslogg") {
    response.writeHead(404).end();
    return;
  }
  let kropp = "";
  request.on("data", (chunk) => { kropp += chunk; });
  request.on("end", () => {
    revisjon.push(JSON.parse(kropp));
    response.writeHead(201, { "Content-Type": "application/json" }).end("{}");
  });
});
await new Promise((klar) => revisjonstjener.listen(0, "127.0.0.1", klar));
const revisjonsUrl = `http://127.0.0.1:${revisjonstjener.address().port}`;

// No digdir on 127.0.0.1:1, on purpose: minting a token must not be what decides
// whether a samtykke can be answered. The address refuses instantly rather than
// hanging on a timeout, and the client falls back to calling without a token.
const tjeneste = spawn(process.execPath, [path.join(repoRoot, "apps/fiks-simulator/src/server.js")], {
  cwd: repoRoot,
  env: {
    ...process.env,
    PORT: String(port),
    STATE_DIR: stateDir,
    BACKEND_BASE_URL: revisjonsUrl,
    DIGDIR_BASE_URL: "http://127.0.0.1:1"
  },
  stdio: ["ignore", "pipe", "pipe"]
});
tjeneste.stdout.on("data", () => {});
tjeneste.stderr.on("data", (chunk) => {
  const tekst = String(chunk);
  // Expected: there is neither a backend to audit against nor a digdir to mint a
  // token from on those ports. Anything else is worth seeing.
  const forventet = ["Kunne ikke revisjonslogge", "Kunne ikke hente Maskinporten-token"];
  if (!forventet.some((linje) => tekst.includes(linje))) process.stderr.write(`[fiks] ${tekst}`);
});

const samtykkeFil = path.join(stateDir, "samtykker.json");

try {
  await waitForHealth();

  const nytt = async (personId = "person-001") =>
    call("/fiks/samtykke", {
      method: "POST",
      body: { personId, formaal: "Test av tilstandsmaskinen", dataKilder: ["inntekt"] }
    });

  // 6a. happy path
  const opprettet = await nytt();
  check("POST /fiks/samtykke gir 201", opprettet.status === 201, String(opprettet.status));
  check("nytt samtykke venter på svar", opprettet.kropp.status === "VENTER_PAA_SVAR", opprettet.kropp.status);
  check("nytt samtykke har utløp", typeof opprettet.kropp.utloper === "string");
  const id = opprettet.kropp.samtykkeId;

  const svart = await call(`/fiks/samtykke/${id}/svar`, { method: "PUT", body: { status: "SAMTYKKET" } });
  check("svar gir 200", svart.status === 200, String(svart.status));
  check("svar setter SAMTYKKET", svart.kropp.status === "SAMTYKKET", svart.kropp.status);
  check("historikken har to rader", (svart.kropp.historikk || []).length === 2, JSON.stringify(svart.kropp.historikk));

  // 6b. et svar kan ikke gjentas
  const igjen = await call(`/fiks/samtykke/${id}/svar`, { method: "PUT", body: { status: "SAMTYKKET" } });
  check("samme svar to ganger gir 409", igjen.status === 409, String(igjen.status));
  check("409 har kode UGYLDIG_OVERGANG", igjen.kropp.feilmeldinger?.[0]?.kode === "UGYLDIG_OVERGANG",
    JSON.stringify(igjen.kropp.feilmeldinger));

  // 6c. trekk, og deretter er alt endelig
  const trukket = await call(`/fiks/samtykke/${id}/trekk`, { method: "PUT", body: {} });
  check("trekk gir 200", trukket.status === 200, String(trukket.status));
  check("trekk setter TRUKKET", trukket.kropp.status === "TRUKKET", trukket.kropp.status);

  const gjenopplivet = await call(`/fiks/samtykke/${id}/svar`, { method: "PUT", body: { status: "SAMTYKKET" } });
  check("et trukket samtykke kan ikke gjenopplives", gjenopplivet.status === 409, String(gjenopplivet.status));
  check(
    "avvisningen sier både hva statusen var og hva som ble forsøkt",
    String(gjenopplivet.kropp.feil).includes("TRUKKET") && String(gjenopplivet.kropp.feil).includes("SAMTYKKET"),
    gjenopplivet.kropp.feil
  );
  const dobbeltTrekk = await call(`/fiks/samtykke/${id}/trekk`, { method: "PUT", body: {} });
  check("et trukket samtykke kan ikke trekkes igjen", dobbeltTrekk.status === 409, String(dobbeltTrekk.status));

  const etterAvvisning = await call(`/fiks/samtykke/${id}`);
  check("den avviste overgangen endret ingenting", etterAvvisning.kropp.status === "TRUKKET", etterAvvisning.kropp.status);
  check(
    "den avviste overgangen la ingen rad i historikken",
    etterAvvisning.kropp.historikk.length === 3,
    JSON.stringify(etterAvvisning.kropp.historikk)
  );

  // 6d. ukjent status er en 400, ikke en 409
  const nyttForTull = await nytt();
  const tullete = await call(`/fiks/samtykke/${nyttForTull.kropp.samtykkeId}/svar`, {
    method: "PUT",
    body: { status: "kanskje" }
  });
  check("ukjent status gir 400", tullete.status === 400, String(tullete.status));

  // 6e. 404 er fortsatt 404
  const borte = await call("/fiks/samtykke/samtykke-finnes-ikke/svar", { method: "PUT", body: { status: "SAMTYKKET" } });
  check("ukjent samtykkeId gir 404", borte.status === 404, String(borte.status));

  // 6f. skrivekøen: ti samtidige opprettelser skal gi ti samtykker
  const foer = JSON.parse(await readFile(samtykkeFil, "utf8")).length;
  const samtidige = await Promise.all(Array.from({ length: 10 }, () => nytt("person-002")));
  check("alle ti samtidige opprettelser gir 201", samtidige.every((s) => s.status === 201));
  const etter = JSON.parse(await readFile(samtykkeFil, "utf8"));
  check(
    "ti samtidige POST gir ti nye samtykker på disk",
    etter.length === foer + 10,
    `${etter.length - foer} av 10`
  );
  const unike = new Set(samtidige.map((s) => s.kropp.samtykkeId));
  check("de ti har ti forskjellige id-er", unike.size === 10, String(unike.size));
  check(
    "alle ti finnes igjen på disk",
    [...unike].every((kandidat) => etter.some((rad) => rad.samtykkeId === kandidat))
  );

  // 6g. skrivekøen: fem samtidige svar på samme samtykke gir ett svar
  const race = await nytt("person-003");
  const svarene = await Promise.all(
    Array.from({ length: 5 }, () =>
      call(`/fiks/samtykke/${race.kropp.samtykkeId}/svar`, { method: "PUT", body: { status: "SAMTYKKET" } })
    )
  );
  check(
    "bare ett av fem samtidige svar slipper gjennom",
    svarene.filter((s) => s.status === 200).length === 1,
    `${svarene.filter((s) => s.status === 200).length} ble 200`
  );
  check(
    "de fire andre får 409",
    svarene.filter((s) => s.status === 409).length === 4,
    svarene.map((s) => s.status).join(", ")
  );
  const afterRace = await call(`/fiks/samtykke/${race.kropp.samtykkeId}`);
  check(
    "historikken har én svarrad, ikke fem",
    afterRace.kropp.historikk.length === 2,
    JSON.stringify(afterRace.kropp.historikk)
  );

  // 6h. utløp på wire
  const utloepende = await nytt("person-004");
  const expiringId = utloepende.kropp.samtykkeId;
  await call(`/fiks/samtykke/${expiringId}/svar`, { method: "PUT", body: { status: "SAMTYKKET" } });
  const onDisk = JSON.parse(await readFile(samtykkeFil, "utf8"));
  const rad = onDisk.find((kandidat) => kandidat.samtykkeId === expiringId);
  rad.utloper = iTida(-1);
  await writeFile(samtykkeFil, JSON.stringify(onDisk, null, 2) + "\n");

  const utloept = await call(`/fiks/samtykke/${expiringId}`);
  check("et utløpt samtykke leses som UTLOEPT", utloept.kropp.status === "UTLOEPT", utloept.kropp.status);
  check(
    "utløpet skrives ikke inn i historikken",
    utloept.kropp.historikk.length === 2,
    JSON.stringify(utloept.kropp.historikk)
  );
  const listet = await call("/fiks/personer/person-004/samtykker");
  check("lista viser samme utløpte status", listet.kropp[0]?.status === "UTLOEPT", listet.kropp[0]?.status);
  const trekkUtloept = await call(`/fiks/samtykke/${expiringId}/trekk`, { method: "PUT", body: {} });
  check("et utløpt samtykke kan ikke trekkes", trekkUtloept.status === 409, String(trekkUtloept.status));
  check(
    "avvisningen sier UTLOEPT, ikke SAMTYKKET",
    String(trekkUtloept.kropp.feil).includes("UTLOEPT"),
    trekkUtloept.kropp.feil
  );
  const onDiskAfter = JSON.parse(await readFile(samtykkeFil, "utf8"))
    .find((kandidat) => kandidat.samtykkeId === expiringId);
  check("den lagrede raden står urørt som SAMTYKKET", onDiskAfter.status === "SAMTYKKET", onDiskAfter.status);

  // 6i. oppgavens maskin på wire
  const oppgave = await call("/fiks/oppgaver", {
    method: "POST",
    body: { personId: "person-001", tittel: "Behandle testsøknad" }
  });
  check("POST /fiks/oppgaver gir 201", oppgave.status === 201, String(oppgave.status));
  check("ny oppgave er OPPRETTET", oppgave.kropp.status === "OPPRETTET", oppgave.kropp.status);
  const oppgaveId = oppgave.kropp.oppgaveId;

  const hopp = await call(`/fiks/oppgaver/${oppgaveId}/status`, { method: "PUT", body: { status: "FERDIG" } });
  check("en oppgave kan ikke bli ferdig uten behandling", hopp.status === 409, String(hopp.status));
  const tattOpp = await call(`/fiks/oppgaver/${oppgaveId}/status`, { method: "PUT", body: { status: "UNDER_BEHANDLING" } });
  check("oppgaven kan tas under behandling", tattOpp.status === 200, String(tattOpp.status));
  const ferdig = await call(`/fiks/oppgaver/${oppgaveId}/status`, { method: "PUT", body: { status: "FERDIG" } });
  check("oppgaven kan bli ferdig etter behandling", ferdig.status === 200, String(ferdig.status));
  const angre = await call(`/fiks/oppgaver/${oppgaveId}/status`, { method: "PUT", body: { status: "UNDER_BEHANDLING" } });
  check("en ferdig oppgave kan ikke åpnes igjen", angre.status === 409, String(angre.status));
  const ukjentOppgave = await call("/fiks/oppgaver/oppgave-finnes-ikke/status", { method: "PUT", body: { status: "FERDIG" } });
  check("ukjent oppgaveId gir 404", ukjentOppgave.status === 404, String(ukjentOppgave.status));

  // 6j. revisjonsloggen
  const hendelser = (handling) => revisjon.filter((h) => h.handling === handling);

  check("svaret revisjonslogges", hendelser("SAMTYKKE_SVART").length >= 1);
  check(
    "svaret logger hvilket samtykke og hvilken status",
    hendelser("SAMTYKKE_SVART").every((h) => h.grunnlag?.id && h.grunnlag?.status),
    JSON.stringify(hendelser("SAMTYKKE_SVART")[0]?.grunnlag)
  );

  // A refused transition is an event in its own right: somebody tried to revive a
  // consent that was final. B3 logs TILGANG_NEKTET for the same reason.
  const rejected = hendelser("SAMTYKKE_AVVIST");
  check("en avvist overgang revisjonslogges", rejected.length >= 1, String(rejected.length));
  check(
    "den avviste overgangen logger både status og forsøk",
    rejected.every((h) => h.grunnlag?.status && h.grunnlag?.forsoekt && h.grunnlag?.kode),
    JSON.stringify(rejected[0]?.grunnlag)
  );
  check(
    "de fire tapte kappløpssvarene er logget som avvist",
    rejected.filter((h) => h.grunnlag?.forsoekt === "SAMTYKKET" && h.grunnlag?.status === "SAMTYKKET").length >= 4,
    String(rejected.filter((h) => h.grunnlag?.status === "SAMTYKKET").length)
  );
  // A 404 has no samtykke to attach an attempt to, and an unknown status never
  // reached a row either. Neither may invent a log entry.
  check(
    "ingen avvisning er logget uten et samtykke å knytte den til",
    rejected.every((h) => Boolean(h.grunnlag?.id))
  );
  check("oppgavens statusendring revisjonslogges", hendelser("OPPGAVE_STATUS_ENDRET").length === 2,
    String(hendelser("OPPGAVE_STATUS_ENDRET").length));
} finally {
  tjeneste.kill("SIGTERM");
  revisjonstjener.close();
  await rm(stateDir, { recursive: true, force: true });
}

// --- rapport --------------------------------------------------------------

if (feil.length > 0) {
  console.error(`${feil.length} av ${bestatt + feil.length} sjekker feilet:`);
  for (const linje of feil) console.error(`  - ${linje}`);
  process.exit(1);
}
console.log(`Samtykke: ${bestatt} sjekker bestått.`);
