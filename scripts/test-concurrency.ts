#!/usr/bin/env node

/*
 * The lost update, on every file the backend writes.
 *
 * Every handler in routes.ts used to mutate its own request-scoped copy of a
 * whole array and write all of it back. Two requests therefore raced: the second
 * writer overwrote the first one's change with an array that never contained it.
 * No error, no 409 - the participant's step, søknad or prosess was simply gone.
 *
 * Four files had the bug, and only one of them had a queue:
 *
 *   §1–3  prosessoekter.json - a session that had quietly moved backwards
 *   §4    soknader.json      - two SUBMIT at once, one application lost
 *   §5–6  prosessdefinisjoner.json - two saves in the prosessbygger, one prosess lost
 *
 * samtykker.json is the same bug, fixed first in fiks-simulator and pinned by
 * test-samtykke.ts §6f. All of them now go through the one write queue in
 * apps/shared/jsonstore.ts. kontrakt-smoke.ts runs strictly sequentially, so
 * it can never see any of this.
 *
 * Backend, fiks-simulator, digdir-mock and a controlled AI stub run on their own
 * ports against a fresh STATE_DIR, so this runs alongside a docker stack without
 * touching it. Needs no model.
 *
 * Usage:
 *   node scripts/test-concurrency.ts
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getInnbyggerToken } from "../apps/digdir-mock/src/client.ts";
import {
  mergeFrossetProsessoekt,
  mergeProsessoektForLagring
} from "../apps/sandbox-backend/src/state.ts";
import { feilkode } from "../apps/shared/errors.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendPort = Number(process.env.CONCURRENCY_BACKEND_PORT) || 18092;
const digdirPort = Number(process.env.CONCURRENCY_DIGDIR_PORT) || 18093;
const fiksPort = Number(process.env.CONCURRENCY_FIKS_PORT) || 18096;
const aiPort = Number(process.env.CONCURRENCY_AI_PORT) || 18097;
const backendUrl = `http://127.0.0.1:${backendPort}`;
const digdirUrl = `http://127.0.0.1:${digdirPort}`;
const fiksUrl = `http://127.0.0.1:${fiksPort}`;
const aiUrl = `http://127.0.0.1:${aiPort}`;

const PROSESS = "redusert-foreldrebetaling-barnehage";
const COUNT = 10;
const ATOMIC_WRITE_COUNT = 12;
const ATOMIC_READER_COUNT = 8;
const ATOMIC_PAYLOAD_BYTES = 8 * 1024 * 1024;

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: unknown, detail = "") {
  if (condition) { passed += 1; return; }
  failures.push(`${name}${detail ? ` - ${detail}` : ""}`);
}

function oektMedKilder(
  resultatKilder: Record<string, string[]>,
  frosset = true,
  verdi = 1
) {
  return {
    oektsId: "oekt-fletting",
    prosessId: PROSESS,
    personId: "person-001",
    sporingsId: "flyt-fletting",
    status: "AKTIV",
    stegIndex: 1,
    svar: {},
    resultaterRaa: { resultat: { verdi } },
    resultatKilder,
    resultatKilderFrosset: frosset,
    aktivtSamtykkeId: "samtykke-fletting",
    opprettet: "2026-09-01T00:00:00.000Z",
    oppdatert: "2026-09-01T00:00:00.000Z"
  } as any;
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
        ? new Error(`Port ${port} er opptatt. Sett CONCURRENCY_BACKEND_PORT/CONCURRENCY_DIGDIR_PORT.`)
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

/*
 * The token is minted by the caller, sequentially, before any racing starts.
 * Minting ten concurrently makes digdir-mock and the backend's JWKS cache race
 * too, and the 401s that produced would be indistinguishable from the write race
 * this file exists to detect. Isolate the thing under test.
 */
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
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body };
}

async function readRows(filePath: string) {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as any[];
  } catch (error) {
    if (feilkode(error) === "ENOENT") return [];
    throw error;
  }
}

await requireFreePort(backendPort);
await requireFreePort(digdirPort);
await requireFreePort(fiksPort);
await requireFreePort(aiPort);

let markSummaryStarted!: () => void;
const summaryStarted = new Promise<void>((resolve) => {
  markSummaryStarted = resolve;
});
let releaseSummary!: () => void;
const summaryRelease = new Promise<void>((resolve) => {
  releaseSummary = resolve;
});
const aiServer = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/helse") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }
  if (request.method === "POST" && request.url === "/ai/oppsummering") {
    request.resume();
    markSummaryStarted();
    await summaryRelease;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ tekst: "Kontrollert oppsummering." }));
    return;
  }
  response.writeHead(404, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ feil: "Fant ikke endepunkt." }));
});
await new Promise<void>((resolve) => aiServer.listen(aiPort, "127.0.0.1", resolve));

const stateDir = await mkdtemp(path.join(tmpdir(), "concurrency-"));
process.env.STATE_DIR = stateDir;
const oektFile = path.join(stateDir, "prosessoekter.json");
const soknadFile = path.join(stateDir, "soknader.json");
const prosessFile = path.join(stateDir, "prosessdefinisjoner.json");
const oppgaveFile = path.join(stateDir, "oppgaver.json");
const forsendelseFile = path.join(stateDir, "forsendelser.json");
const revisjonFile = path.join(stateDir, "revisjonslogg.json");
const env = {
  STATE_DIR: stateDir,
  BACKEND_BASE_URL: backendUrl,
  DIGDIR_BASE_URL: digdirUrl,
  DIGDIR_ISSUER: digdirUrl,
  FIKS_BASE_URL: fiksUrl,
  AI_BASE_URL: aiUrl,
  // Matrikkel is never called. An unreachable address beats a hanging one.
  MATRIKKEL_BASE_URL: "http://127.0.0.1:1"
};

const services = [
  start("digdir", "apps/digdir-mock/src/server.ts", { ...env, PORT: String(digdirPort) }),
  start("backend", "apps/sandbox-backend/src/server.ts", { ...env, PORT: String(backendPort) })
];

try {
  const strengFletting = mergeProsessoektForLagring(
    oektMedKilder({ resultat: ["inntekt"] }),
    oektMedKilder({ resultat: [] })
  );
  check(
    "en gammel forespørsel kan ikke svekke en frosset kilde",
    JSON.stringify(strengFletting.resultatKilder.resultat) === JSON.stringify(["inntekt"]),
    JSON.stringify(strengFletting.resultatKilder)
  );

  const kildeunion = mergeProsessoektForLagring(
    oektMedKilder({ resultat: ["inntekt"] }),
    oektMedKilder({ resultat: ["politiattest"] })
  );
  check(
    "samtidige kjente kilder flettes til den strengeste unionen",
    JSON.stringify(kildeunion.resultatKilder.resultat?.sort())
      === JSON.stringify(["inntekt", "politiattest"]),
    JSON.stringify(kildeunion.resultatKilder)
  );

  const ukjentVinner = mergeProsessoektForLagring(
    oektMedKilder({}),
    oektMedKilder({ resultat: [] })
  );
  check(
    "ukjent frosset kilde kan ikke omklassifiseres som ubeskyttet",
    !Object.hasOwn(ukjentVinner.resultatKilder, "resultat")
      && ukjentVinner.resultatKilderFrosset,
    JSON.stringify(ukjentVinner.resultatKilder)
  );

  const samtidigFrosset = mergeFrossetProsessoekt(
    oektMedKilder({ resultat: ["inntekt"] }),
    oektMedKilder({ resultat: [] })
  );
  check(
    "en foreldet prosessfrysing kan ikke svekke metadata som alt er frosset",
    JSON.stringify(samtidigFrosset.resultatKilder.resultat) === JSON.stringify(["inntekt"]),
    JSON.stringify(samtidigFrosset.resultatKilder)
  );

  const nyttLegacyResultat = mergeProsessoektForLagring(
    oektMedKilder({}, false, 1),
    oektMedKilder({ resultat: ["inntekt"] }, true, 2)
  );
  check(
    "ny kjøring av et legacy-steg beholder den nye kilden",
    JSON.stringify(nyttLegacyResultat.resultatKilder.resultat) === JSON.stringify(["inntekt"]),
    JSON.stringify(nyttLegacyResultat.resultatKilder)
  );

  await Promise.all([waitForHealth(digdirUrl), waitForHealth(backendUrl)]);

  /*
   * A write must become visible in one step. The old writeFile(target) implementation
   * truncated the live file before filling it, so readJson could parse an empty or
   * partial document. Large repeated replacements keep readers in that window without
   * relying on timing hooks in the implementation.
   */
  const {
    readJson,
    stateDir: jsonStoreStateDir,
    updateJson
  } = await import("../apps/shared/jsonstore.ts");
  const usesTemporaryStateDir = jsonStoreStateDir === stateDir;
  check(
    "testforutsetning: jsonstore bruker testens midlertidige state-mappe",
    usesTemporaryStateDir,
    `${jsonStoreStateDir} er ikke ${stateDir}`
  );
  if (!usesTemporaryStateDir) {
    throw new Error("Avbryter før skriving fordi jsonstore peker utenfor testmappen.");
  }

  const atomicFileName = "atomic-lesing.json";
  const payload = "x".repeat(ATOMIC_PAYLOAD_BYTES);
  await updateJson(atomicFileName, {}, (_current, replace) => {
    replace({ generation: 0, payload });
  });

  let keepReading = true;
  let readFailureCount = 0;
  const readFailureExamples: string[] = [];
  const readAttempts = Array.from({ length: ATOMIC_READER_COUNT }, () => 0);
  const readers = Array.from({ length: ATOMIC_READER_COUNT }, async (_unused, readerIndex) => {
    while (keepReading) {
      readAttempts[readerIndex] += 1;
      try {
        const value = await readJson(atomicFileName);
        if (
          typeof value?.generation !== "number"
          || typeof value?.payload !== "string"
          || value.payload.length !== ATOMIC_PAYLOAD_BYTES
        ) {
          readFailureCount += 1;
          if (readFailureExamples.length < 3) {
            readFailureExamples.push(`ugyldig innhold etter generasjon ${String(value?.generation)}`);
          }
        }
      } catch (error) {
        readFailureCount += 1;
        if (readFailureExamples.length < 3) {
          readFailureExamples.push(error instanceof Error ? error.message : String(error));
        }
      }
    }
  });

  await new Promise<void>((resolve) => setImmediate(resolve));
  try {
    for (let generation = 1; generation <= ATOMIC_WRITE_COUNT; generation += 1) {
      await updateJson(atomicFileName, {}, (_current, replace) => {
        replace({ generation, payload });
      });
    }
  } finally {
    keepReading = false;
  }
  await Promise.all(readers);

  check(
    "testforutsetning: hver leser forsøkte minst én lesing",
    readAttempts.every((count) => count > 0),
    readAttempts.join(",")
  );
  check(
    "regresjon: samtidige lesere så bare komplette JSON-dokumenter",
    readFailureCount === 0,
    `${readFailureCount} feil: ${readFailureExamples.join("; ")}`
  );

  /*
   * These checks cover the atomic writer's failure path. They support the
   * regression above, but do not reproduce the old defect: a direct writer had no
   * temporary file to clean up.
   */
  const blockedFileName = "atomic-blokkert.json";
  const blockedPath = path.join(stateDir, blockedFileName);
  let blockedWriteFailed = false;
  try {
    await updateJson(blockedFileName, {}, async (_current, replace) => {
      await mkdir(blockedPath);
      replace({ skalIkkeSkrives: true });
    });
  } catch {
    blockedWriteFailed = true;
  }
  check("testforutsetning: den tvungne atomiske erstatningen feilet", blockedWriteFailed);
  const temporaryFiles = (await readdir(stateDir)).filter((entry) => entry.endsWith(".tmp"));
  check(
    "feilhåndtering: en mislykket atomisk erstatning rydder den midlertidige filen",
    temporaryFiles.length === 0,
    temporaryFiles.join(",")
  );
  await rm(blockedPath, { recursive: true, force: true });

  /*
   * Ten different people, so every write lands on a different økt - same-person
   * concurrency is a different and accepted race, see lagreProsessoekt.
   *
   * Picked from digdir-mock rather than hardcoded: person-002 is a child, and 65 of
   * the population cannot log in at all. A hardcoded person-NNN list breaks the day
   * the seed shifts, and it broke on the first run of this file.
   */
  // Formen påstås av testen selv, ikke av en type her.
  const testUsers = (await (await fetch(`${digdirUrl}/idporten/testbrukere`)).json()) as any[];
  const PERSON_IDS = testUsers.filter((user: any) => user.kanOpptreSelv).slice(0, COUNT).map((user: any) => user.personId);
  check(`fant ${COUNT} testbrukere som kan opptre selv`, PERSON_IDS.length === COUNT, String(PERSON_IDS.length));

  const tokens: string[] = [];
  for (const personId of PERSON_IDS) {
    tokens.push(await getInnbyggerToken({ digdirBaseUrl: digdirUrl, personId, clientId: "concurrency" }));
  }
  // One call first, so the backend has fetched and cached digdir's signing key
  // before ten arrive at once.
  const warmup = await call(`/api/personer/${PERSON_IDS[0]}`, tokens[0]);
  check("oppvarmingskallet er autorisert", warmup.status === 200, String(warmup.status));

  // 1. Ten økter, created concurrently. Each POST appends one row.
  const created = await Promise.all(
    PERSON_IDS.map((personId: any, i: any) =>
      call("/api/prosessoekter", tokens[i], { method: "POST", body: { personId, prosessId: PROSESS } })
    )
  );
  check("alle ti opprettelser gir 201", created.every((s: any) => s.status === 201),
    created.map((s: any) => s.status).join(","));

  const ids = created.map((s: any) => s.body?.oektsId).filter(Boolean);
  check("ti forskjellige økt-id-er", new Set(ids).size === 10, String(new Set(ids).size));

  const onDisk = JSON.parse(await readFile(oektFile, "utf8"));
  check("ti samtidige opprettelser gir ti økter på disk", onDisk.length === 10,
    `${onDisk.length} av 10 - dette er lost update-en`);
  check("alle ti finnes igjen på disk",
    ids.every((id: any) => onDisk.some((oekt: any) => oekt.oektsId === id)),
    `${ids.filter((id: any) => !onDisk.some((oekt: any) => oekt.oektsId === id)).length} forsvant`);

  // 2. Ten concurrent advances, one per økt. Every stegIndex must reach 1.
  const advanced = await Promise.all(
    ids.map((id: any, i: any) => call(`/api/prosessoekter/${id}/neste`, tokens[i], { method: "POST" }))
  );
  check("alle ti neste-kall gir 200", advanced.every((s: any) => s.status === 200),
    advanced.map((s: any) => s.status).join(","));

  const after = JSON.parse(await readFile(oektFile, "utf8"));
  check("fortsatt ti økter på disk", after.length === 10, String(after.length));
  const atSteg1 = after.filter((oekt: any) => oekt.stegIndex === 1);
  check(
    "alle ti økter står på stegIndex 1",
    atSteg1.length === 10,
    `${atSteg1.length} av 10 - de øvrige mistet endringen sin i en samtidig skriving`
  );

  // 3. The økt must belong to whoever created it, after all that racing.
  const wrongOwner = after.filter((oekt: any) => {
    const expected = created.find((s: any) => s.body?.oektsId === oekt.oektsId);
    return expected && expected.body.personId !== oekt.personId;
  });
  check("ingen økt byttet eier under kappløpet", wrongOwner.length === 0, String(wrongOwner.length));

  /*
   * 4. A long model call holds only its own session boundary. If the boundary or
   * the JSON write queue were global, the other session could not save /neste
   * before the controlled model response is released.
   */
  const summaryId = ids[3];
  for (let steg = 1; steg < 5; steg++) {
    const flyttet = await call(`/api/prosessoekter/${summaryId}/neste`, tokens[3], { method: "POST" });
    check(`modelløkten går til steg ${steg + 1}`, flyttet.status === 200, String(flyttet.status));
  }
  const summaryCall = call(
    `/api/prosessoekter/${summaryId}/handling`,
    tokens[3],
    { method: "POST", body: {} }
  );
  await Promise.race([
    summaryStarted,
    new Promise<never>((unused, reject) =>
      setTimeout(() => reject(new Error("SUMMARY nådde ikke den kontrollerte KI-tjenesten.")), 2000)
    )
  ]);

  const unrelatedCall = call(`/api/prosessoekter/${ids[4]}/neste`, tokens[4], { method: "POST" });
  const unrelatedBeforeRelease = await Promise.race([
    unrelatedCall.then((svar) => ({ ferdig: true as const, svar })),
    new Promise<{ ferdig: false }>((resolve) => setTimeout(() => resolve({ ferdig: false }), 1000))
  ]);
  check("en annen økt lagres mens SUMMARY venter på modellen",
    unrelatedBeforeRelease.ferdig && unrelatedBeforeRelease.svar.status === 200,
    unrelatedBeforeRelease.ferdig ? String(unrelatedBeforeRelease.svar.status) : "tidsavbrudd");

  releaseSummary();
  const summarySvar = await summaryCall;
  check("SUMMARY fullføres etter at modellen slippes", summarySvar.status === 200, String(summarySvar.status));
  await unrelatedCall;

  /*
   * 5. soknader.json. This is what a SUBMIT step writes, and it had no queue at
   * all - push onto the request's own array, then write the whole thing.
   *
   * POST /api/soknader rather than driving ten flows to their SUBMIT step: it is
   * the same createSoknad, and it takes seconds instead of needing samtykke, a
   * beregning and the model. The Fiks task it tries to create afterwards fails on
   * an unreachable FIKS_BASE_URL and comes back as `advarsel`, which is expected
   * here and not what is under test.
   */
  const soknader = await Promise.all(
    PERSON_IDS.map((personId: any, i: any) =>
      call("/api/soknader", tokens[i], { method: "POST", body: { personId, prosessId: PROSESS } })
    )
  );
  check("alle ti søknader gir 201", soknader.every((s: any) => s.status === 201),
    soknader.map((s: any) => s.status).join(","));

  const soknadIds = soknader.map((s: any) => s.body?.soknadId).filter(Boolean);
  const soknaderOnDisk = JSON.parse(await readFile(soknadFile, "utf8"));
  check("ti samtidige søknader gir ti søknader på disk", soknaderOnDisk.length === 10,
    `${soknaderOnDisk.length} av 10 - dette er lost update-en`);
  check("alle ti søknader finnes igjen på disk",
    soknadIds.every((id: any) => soknaderOnDisk.some((soknad: any) => soknad.soknadId === id)),
    `${soknadIds.filter((id: any) => !soknaderOnDisk.some((s: any) => s.soknadId === id)).length} forsvant`);

  /*
   * 6. Five SUBMIT calls against one økt must cross one boundary around the
   * status check, downstream side effects and the FULLFORT transition. Exactly
   * one call succeeds; the rest see the saved closed status.
   */
  services.push(start("fiks", "apps/fiks-simulator/src/server.ts", { ...env, PORT: String(fiksPort) }));
  await waitForHealth(fiksUrl);

  const submitIds = ids.slice(0, 3);
  for (let steg = 1; steg < 6; steg++) {
    const flyttet = await Promise.all(
      submitIds.map((id: string, i: number) =>
        call(`/api/prosessoekter/${id}/neste`, tokens[i], { method: "POST" })
      )
    );
    check(`tre økter går samtidig til steg ${steg + 1}`,
      flyttet.every((svar) => svar.status === 200),
      flyttet.map((svar) => svar.status).join(","));
  }

  const sporingsId = created[0].body.sporingsId;
  const samtidigeSubmit = await Promise.all(
    Array.from({ length: 5 }, () =>
      call(`/api/prosessoekter/${submitIds[0]}/handling`, tokens[0], { method: "POST", body: {} })
    )
  );
  const vellykkedeSubmit = samtidigeSubmit.filter((svar) => svar.status === 200);
  const avvisteSubmit = samtidigeSubmit.filter((svar) => svar.status === 400);
  check("nøyaktig ett av fem samtidige SUBMIT-kall gir 200",
    vellykkedeSubmit.length === 1,
    samtidigeSubmit.map((svar) => svar.status).join(","));
  check("de fire senere SUBMIT-kallene gir den dokumenterte 400-feilen",
    avvisteSubmit.length === 4 &&
      avvisteSubmit.every((svar) => svar.body?.feil === "Prosessøkten er avsluttet og kan ikke fortsette."),
    JSON.stringify(avvisteSubmit.map((svar) => svar.body)));

  const submitSoknader = (await readRows(soknadFile)).filter((soknad) => soknad.sporingsId === sporingsId);
  const submitSoknadIds = new Set(submitSoknader.map((soknad) => soknad.soknadId));
  const submitOppgaver = (await readRows(oppgaveFile)).filter((oppgave) => oppgave.sporingsId === sporingsId);
  const submitForsendelser = (await readRows(forsendelseFile))
    .filter((forsendelse) => submitSoknadIds.has(forsendelse.eksternReferanse));
  const alleRevisjoner = await readRows(revisjonFile);
  const submitRevisjoner = alleRevisjoner.filter((rad) => rad.sporingsId === sporingsId);
  check("fem samtidige SUBMIT-kall lagrer én søknad", submitSoknader.length === 1, String(submitSoknader.length));
  check("fem samtidige SUBMIT-kall oppretter én Fiks-oppgave", submitOppgaver.length === 1, String(submitOppgaver.length));
  check("fem samtidige SUBMIT-kall sender én forsendelse", submitForsendelser.length === 1, String(submitForsendelser.length));
  for (const handling of ["SOKNAD_SENDT_INN", "OPPGAVE_OPPRETTET"]) {
    const antall = submitRevisjoner.filter((rad) => rad.handling === handling).length;
    check(`fem samtidige SUBMIT-kall gir én ${handling}`, antall === 1, String(antall));
  }
  const submitForsendelseIds = new Set(submitForsendelser.map((forsendelse) => forsendelse.id));
  const senderevisjoner = alleRevisjoner.filter((rad) =>
    rad.handling === "FORSENDELSE_SENDT" && submitForsendelseIds.has(rad.grunnlag?.id)
  );
  check("fem samtidige SUBMIT-kall gir én FORSENDELSE_SENDT", senderevisjoner.length === 1,
    String(senderevisjoner.length));
  const submitOekt = (await readRows(oektFile)).find((oekt) => oekt.oektsId === submitIds[0]);
  check("SUBMIT-økten lagres som FULLFORT", submitOekt?.status === "FULLFORT", String(submitOekt?.status));

  const senereSubmit = await call(
    `/api/prosessoekter/${submitIds[0]}/handling`,
    tokens[0],
    { method: "POST", body: {} }
  );
  check("et senere SUBMIT-kall får samme stabile 400-feil",
    senereSubmit.status === 400 &&
      senereSubmit.body?.feil === "Prosessøkten er avsluttet og kan ikke fortsette.",
    JSON.stringify(senereSubmit));

  const ulikeSubmit = await Promise.all(
    submitIds.slice(1).map((id: string, i: number) =>
      call(`/api/prosessoekter/${id}/handling`, tokens[i + 1], { method: "POST", body: {} })
    )
  );
  check("SUBMIT på to forskjellige økter kan lykkes samtidig",
    ulikeSubmit.every((svar) => svar.status === 200),
    ulikeSubmit.map((svar) => svar.status).join(","));
  const ulikeSporingsIder = new Set(created.slice(1, 3).map((svar) => svar.body.sporingsId));
  const ulikeSoknader = (await readRows(soknadFile))
    .filter((soknad) => ulikeSporingsIder.has(soknad.sporingsId));
  check("begge forskjellige økter lagrer hver sin søknad", ulikeSoknader.length === 2, String(ulikeSoknader.length));

  /*
   * 7. prosessdefinisjoner.json, created. Same missing queue, and this is the
   * file the prosessbygger saves to - the one a team edits live during the
   * workshop while someone else is demoing.
   *
   * The seed count comes from the API rather than a literal, so adding a prosess
   * to data/prosessdefinisjoner.json does not break this file.
   */
  const foerProsesser = (await call("/api/prosesser", tokens[0])).body as any[];
  const nyeIds = Array.from({ length: COUNT }, (unused, i) => `samtidig-prosess-${i}`);
  const opprettede = await Promise.all(
    nyeIds.map((id) =>
      call("/api/prosesser", tokens[0], {
        method: "POST",
        body: { id, navn: `Samtidig ${id}`, steg: [] }
      })
    )
  );
  check("alle ti prosesser gir 201", opprettede.every((s: any) => s.status === 201),
    opprettede.map((s: any) => s.status).join(","));

  const katalog = JSON.parse(await readFile(prosessFile, "utf8"));
  check("ti samtidige prosesser gir ti nye prosesser på disk",
    katalog.prosesser.length === foerProsesser.length + COUNT,
    `${katalog.prosesser.length} av ${foerProsesser.length + COUNT} - dette er lost update-en`);
  check("alle ti prosesser finnes igjen på disk",
    nyeIds.every((id) => katalog.prosesser.some((prosess: any) => prosess.id === id)),
    `${nyeIds.filter((id) => !katalog.prosesser.some((p: any) => p.id === id)).length} forsvant`);
  // The katalog is parsed on read and serialised back on write, so the halves the
  // writer does not touch have to survive the round trip. maler and the meta keys
  // are the two that would go missing without a sound.
  check("malene overlevde skrivingen", Array.isArray(katalog.maler) && katalog.maler.length > 0,
    String(katalog.maler?.length));
  check("katalog-metaen overlevde skrivingen",
    typeof katalog.formatVersion === "string" && typeof katalog.beskrivelse === "string",
    JSON.stringify({ formatVersion: katalog.formatVersion, beskrivelse: katalog.beskrivelse }));

  /*
   * 8. prosessdefinisjoner.json, updated. PUT is what «Lagre» in the
   * prosessbygger actually calls, and it sends the whole prosess - so a merge
   * onto a stale copy of the katalog undoes whatever the other save added.
   */
  const omdoept = await Promise.all(
    nyeIds.map((id, i) =>
      call(`/api/prosesser/${id}`, tokens[0], { method: "PUT", body: { navn: `Omdøpt ${i}` } })
    )
  );
  check("alle ti oppdateringer gir 200", omdoept.every((s: any) => s.status === 200),
    omdoept.map((s: any) => s.status).join(","));

  const etterPut = JSON.parse(await readFile(prosessFile, "utf8"));
  const omdoepte = nyeIds.filter((id, i) =>
    etterPut.prosesser.some((prosess: any) => prosess.id === id && prosess.navn === `Omdøpt ${i}`)
  );
  check("alle ti navneendringer står på disk", omdoepte.length === COUNT,
    `${omdoepte.length} av ${COUNT} - de øvrige mistet endringen sin i en samtidig skriving`);
  check("ingen prosess forsvant under oppdateringene",
    etterPut.prosesser.length === foerProsesser.length + COUNT,
    String(etterPut.prosesser.length));
} finally {
  releaseSummary();
  for (const service of services) service.kill("SIGTERM");
  await new Promise<void>((resolve, reject) => {
    aiServer.close((error) => error ? reject(error) : resolve());
  });
  await rm(stateDir, { recursive: true, force: true });
}

const total = passed + failures.length;
if (failures.length > 0) {
  console.error(`Samtidighetstest: ${passed}/${total} bestått.\n`);
  for (const line of failures) console.error(`  ✗ ${line}`);
  process.exit(1);
}
console.log(`Samtidighetstest ok. ${passed}/${total} sjekker bestått.`);
