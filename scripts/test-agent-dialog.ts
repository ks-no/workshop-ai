#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAgentSubmitted, readAgentProsessoekt } from "./agent-test-assertions.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const services = [
  ["backend", "sandbox-backend", 21200], ["digdir", "digdir-mock", 21201],
  ["fiks", "fiks-simulator", 21202], ["ai", "ai-gateway", 21203],
  ["tools", "tools-api", 21204], ["agent", "process-agent", 21205],
  ["matrikkel", "matrikkel-mock", 21206], ["pasientjournal", "pasientjournal-mock", 21207],
  ["politiattest", "politiattest-mock", 21208]
] as const;
const ports = Object.fromEntries(services.map(([name, , port]) =>
  [name, Number(process.env[`AGENT_DIALOG_${name.toUpperCase()}_PORT`] || port)]));
const urls = Object.fromEntries(services.map(([name]) => [name, `http://127.0.0.1:${ports[name]}`]));
const toolProbePort = Number(process.env.AGENT_DIALOG_TOOL_PROBE_PORT || 21209);
const children: ChildProcess[] = [];
let passed = 0;

// Every port and directory belongs to this run; no existing stack or provider is used.
for (const port of [...Object.values(ports), toolProbePort]) {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve()));
  });
}
await mkdir(path.join(root, "state"), { recursive: true });
const stateDir = await mkdtemp(path.join(root, "state", "agent-dialog-"));
const env = {
  STATE_DIR: stateDir, AI_PROVIDER: "mock", AI_TIMEOUT_MS: "1000", AUTH_ENFORCE: "true",
  DIGDIR_ISSUER: urls.digdir, MATRIKKEL_MODE: "mock",
  MATRIKKEL_DATA_FILE: path.join(root, "data/matrikkel.seed.json"),
  EIERFORHOLD_DATA_FILE: path.join(root, "data/eierforhold.json"),
  LEGEERKLAERING_DATA_FILE: path.join(stateDir, "legeerklaeringer.json"),
  POLITIATTEST_DATA_FILE: path.join(stateDir, "politiattester.json"),
  ...Object.fromEntries(Object.entries(urls).map(([name, url]) => [`${name.toUpperCase()}_BASE_URL`, url]))
};
Object.assign(process.env, env);

let addressProbe: { status: number; tool?: string } | null = null;
const addressCalls: { name: string; arguments: { adresse: string } }[] = [];
const toolProbe = createServer(async (request, response) => {
  try {
    let body = "";
    for await (const chunk of request) body += chunk;
    const call = JSON.parse(body);
    response.setHeader("Content-Type", "application/json");
    if (addressProbe && ["matrikkel_hent_eiendom", "matrikkel_hent_eiere"].includes(call.name)) {
      addressCalls.push(call);
      const status = !addressProbe.tool || addressProbe.tool === call.name ? addressProbe.status : 200;
      response.statusCode = status;
      const feil = status === 409
        ? `Adressen ${call.arguments.adresse} er ikke entydig. Oppgi postnummer eller matrikkelId.`
        : status === 400 ? "Oppgi gatenavn og husnummer." : "Oppslaget feilet.";
      response.end(JSON.stringify(status === 200
        ? { ok: true, result: { adresse: call.arguments.adresse, gnr: 165, bnr: 3, eiere: ["Syntetisk eier"] } }
        : { ok: false, feil }));
      return;
    }
    const upstream = await fetch(`${urls.tools}/verktoy/invoke`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body
    });
    response.statusCode = upstream.status;
    response.end(await upstream.text());
  } catch {
    response.statusCode = 502;
    response.end(JSON.stringify({ ok: false, feil: "Testens verktøyproxy feilet." }));
  }
});

async function json(base: string, route: string, body?: unknown): Promise<any> {
  const response = await fetch(`${base}${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  const result = await response.json() as any;
  assert.ok(response.ok, `${route}: ${response.status} ${JSON.stringify(result)}`);
  return result;
}

async function create(personId = "person-001") {
  return json(urls.agent, "/agent/sessions", { personId });
}
async function say(session: any, message: string) {
  return json(urls.agent, `/agent/sessions/${session.sessionId}/messages`, { message });
}
async function oekt(session: any, personId = "person-001") {
  const agent = await json(urls.agent, `/agent/sessions/${session.sessionId}`);
  return (await readAgentProsessoekt(agent.oektsId, personId)).oekt;
}
async function check(name: string, test: () => Promise<void>) {
  await test();
  passed++;
  console.log(`OK: ${name}`);
}
function includes(response: any, text: string) {
  assert.ok(response.replies.join("\n").includes(text), JSON.stringify(response.replies));
}

async function runScript(script: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [script], { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    let output = "";
    child.stdout!.on("data", (chunk) => { output += chunk; });
    child.stderr!.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${script}: ${output}`)));
  });
}

try {
  await new Promise<void>((resolve, reject) => {
    toolProbe.once("error", reject);
    toolProbe.listen(toolProbePort, "127.0.0.1", () => resolve());
  });
  const definition = JSON.parse(await readFile(path.join(root, "data/prosessdefinisjoner.json"), "utf8"));
  const custom = (id: string, steg: unknown[]) => ({
    id, navn: id, versjon: "1.0.0", redigering: { status: "publisert" }, steg
  });
  const field = (id: string, label: string) => ({ id, label, type: "tekst", obligatorisk: true });
  const ending = [{ id: "oppsummering", type: "SUMMARY" }, { id: "send-inn", type: "SUBMIT" }];
  definition.prosesser.push(
    custom("dialog-info", [{ id: "orientering", type: "INFO", tekst: "Bare informasjon." }]),
    custom("dialog-data", [{ id: "oppslag", type: "DATA_FETCH", api: { method: "GET", url: "/api/personer/{personId}/husstand" } }]),
    custom("dialog-summary", [{ id: "orientering", type: "INFO" }, { id: "oppsummering", type: "SUMMARY" }]),
    custom("dialog-supported", [{ id: "sted", type: "QUESTION", tekst: "Velg gatenavn", felter: [field("navn", "Gatenavn")] }, ...ending]),
    custom("dialog-unsupported", [{ id: "enhet", type: "QUESTION", tekst: "Oppgi matrikkelnummer", felter: [field("enhet", "Matrikkelnummer")] }, ...ending]),
    custom("dialog-multifield", [{ id: "sted", type: "QUESTION", felter: [field("gate", "Gatenavn"), field("grunn", "Beskriv behovet")] }, ...ending]),
    custom("dialog-choice", [{ id: "valg", type: "QUESTION", tekst: "Velg kanal", felter: [{ id: "kanal", label: "Kanal", type: "valg", obligatorisk: true, alternativer: [{ verdi: "telefon", label: "Telefon" }, { verdi: "digital", label: "Digital melding" }] }] }, ...ending])
  );
  await writeFile(path.join(stateDir, "prosessdefinisjoner.json"), JSON.stringify(definition));
  // Calendar drift is irrelevant to dialogue: keep the issued synthetic attachments current.
  for (const [name, key] of [["legeerklaeringer", "legeerklaeringer"], ["politiattester", "attester"]]) {
    const data = JSON.parse(await readFile(path.join(root, `data/${name}.json`), "utf8"));
    for (const row of data[key]) {
      row.utstedt = new Date().toISOString().slice(0, 10);
      if (row.gyldigTil) row.gyldigTil = "2099-12-31";
    }
    await writeFile(path.join(stateDir, `${name}.json`), JSON.stringify(data));
  }
  for (const [name, app] of services) {
    const child = spawn(process.execPath, [`apps/${app}/src/server.ts`], {
      cwd: root, env: {
        ...process.env, ...env, PORT: String(ports[name]),
        ...(name === "agent" ? { TOOLS_BASE_URL: `http://127.0.0.1:${toolProbePort}` } : {})
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    children.push(child);
    let output = "";
    child.stdout!.on("data", (chunk) => { output += chunk; });
    child.stderr!.on("data", (chunk) => { output += chunk; });
    const deadline = Date.now() + 20000;
    let ready = false;
    while (Date.now() < deadline) {
      assert.equal(child.exitCode, null, `${name}: ${output}`);
      try {
        if ((await fetch(`${urls[name]}/helse`, { signal: AbortSignal.timeout(500) })).ok) { ready = true; break; }
      } catch { /* Waiting for this child, not another process on its port. */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, `${name} svarte ikke: ${output}`);
  }

  await check("auth er på og AI er mock", async () => {
    assert.equal((await fetch(`${urls.backend}/api/personer/person-001/husstand`)).status, 401);
    const health = await json(urls.ai, "/helse");
    assert.equal(health.provider, "mock");
  });

  for (const [message, address] of [
    ["Hvem eier Storgata 5, 5003 Bergen?", "Storgata 5, 5003 Bergen"],
    ["Hvem eier Storgata 5 9008 Tromsø?", "Storgata 5 9008 Tromsø"],
    ["Finnes adressen Storgata 5, 5003?", "Storgata 5, 5003"],
    ["Finnes Storgata 10 A, 5003 Bergen?", "Storgata 10 A, 5003 Bergen"],
    ["Kan du sjekke Kong Oscars gate 5, 5017 Bergen i matrikkelen?", "Kong Oscars gate 5, 5017 Bergen"]
  ]) {
    await check(`adresse beholder presiseringen: ${address}`, async () => {
      const session = await create();
      await say(session, "stottekontakt-behov");
      const before = await oekt(session);
      addressCalls.length = 0;
      addressProbe = { status: 200 };
      try {
        const reply = await say(session, message);
        includes(reply, address);
        const names = message.startsWith("Hvem eier")
          ? ["matrikkel_hent_eiendom", "matrikkel_hent_eiere"] : ["matrikkel_hent_eiendom"];
        assert.deepEqual(addressCalls, names.map((name) => ({ name, arguments: { adresse: address } })));
        const after = await oekt(session);
        assert.equal(after.stegIndex, before.stegIndex);
        assert.deepEqual(after.svar, before.svar);
        assert.equal(reply.awaiting, "question_fields");
      } finally { addressProbe = null; }
    });
  }
  for (const [status, tool, expected] of [
    [400, "matrikkel_hent_eiendom", "Oppgi gatenavn og husnummer."],
    [404, "matrikkel_hent_eiendom", "Jeg fant ikke adressen Storgata 5"],
    [409, "matrikkel_hent_eiendom", "ikke entydig. Oppgi postnummer eller matrikkelId."],
    [409, "matrikkel_hent_eiere", "ikke entydig. Oppgi postnummer eller matrikkelId."],
    [502, "matrikkel_hent_eiendom", "Jeg kunne ikke slå opp adressen akkurat nå."]
  ] as const) {
    await check(`adressefeil forklares uten falskt fravær: ${status} ${tool}`, async () => {
      const session = await create();
      await say(session, "stottekontakt-behov");
      addressProbe = { status, tool };
      try {
        const reply = await say(session, "Hvem eier Storgata 5?");
        includes(reply, expected);
        assert.equal(reply.awaiting, "question_fields");
        assert.equal((await oekt(session)).svar.situasjon, undefined);
      } finally { addressProbe = null; }
    });
  }

  for (const [message, expected] of [
    ["Jeg trenger TT-kort fordi jeg har 3 km til bussen", "tt-kort"],
    ["Jeg vil søke fritidskort til barnet i 5. klasse", "fritidskort-stotte"],
    ["Jeg trenger støttekontakt for andre aktiviteter", "stottekontakt-behov"],
    ["2", "sfo-moderasjon"], ["den tredje", "stottekontakt-behov"],
    ["den første", "redusert-foreldrebetaling-barnehage"], ["den sjette", "tt-kort"],
    ["den sjuende", "politiattest-oppdrag"],
    ["jeg velger nummer 4", "fritidskort-stotte"]
  ]) {
    await check(`prosessvalg: ${message}`, async () => {
      const response = await say(await create(), message);
      assert.equal(response.selectedProcess?.id, expected);
    });
  }

  await check("egne svar og personvern går ikke til registeroppslag", async () => {
    const session = await create();
    const selected = await say(session, "stottekontakt-behov");
    assert.equal(selected.awaiting, "question_fields");
    includes(await say(session, "Hvem ser mine personopplysninger?"), "Tilbake til der vi var:");
    let current = await oekt(session);
    assert.equal(current.aktivtSteg.id, "situasjon");
    assert.equal(current.svar.situasjon, undefined);
    const lookup = await say(session, "Finn person Maja Solberg i folkeregisteret");
    includes(lookup, "Maja");
    assert.equal(lookup.awaiting, "question_fields");
    includes(await say(session, "Jeg trenger hjelp med personlig hygiene"), "Svar ja eller nei");
    const invalid = await say(session, "kanskje");
    assert.equal(invalid.awaiting, "question_fields");
    includes(invalid, "gyldig valg");
    await say(session, "ja");
    current = await oekt(session);
    assert.deepEqual(current.svar.situasjon, { beskrivelse: "Jeg trenger hjelp med personlig hygiene", onskerKontakt: "ja" });
    assert.equal(current.aktivtSteg.type, "CONSENT_REQUEST");
    assert.equal(current.resultater["hent-kontaktinfo"], undefined);
  });

  for (const [answer, expected] of [
    ["mer enn 20 boliger", "ja"], ["minst 21 boliger", "ja"],
    ["mer enn20 boliger", "ja"],
    ["under 21 boliger", "nei"], ["maks 20 boliger", "nei"],
    ["det er 20 boliger", "nei"], ["det er 25 boliger", "ja"],
    ["mindre enn 25 boliger", null], ["mindre enn25 boliger", null], ["mer enn 19 boliger", null],
    ["ikke mer enn 20 boliger", null], ["mellom 15 og 25 boliger", null]
  ]) {
    await check(`boligantall: ${answer}`, async () => {
      const session = await create();
      await say(session, "fartsdempende-tiltak");
      const street = await say(session, "Storgata");
      assert.equal((await oekt(session)).aktivtSteg.id, "boliger-bekreft", JSON.stringify(street));
      const response = await say(session, answer!);
      const current = await oekt(session);
      if (expected) {
        assert.equal(current.svar["boliger-bekreft"], expected);
        assert.equal(current.aktivtSteg.id, "begrunnelse");
      } else {
        assert.equal(current.svar["boliger-bekreft"], undefined);
        assert.equal(current.aktivtSteg.id, "boliger-bekreft");
        includes(response, "20 boliger");
        await say(session, "ja");
        await say(session, "Høy fart om kvelden");
        assert.equal((await json(urls.agent, `/agent/sessions/${session.sessionId}`)).awaiting, "summary_confirm");
      }
    });
  }

  await check("valg viser labeler og lagrer wire-verdien", async () => {
    const session = await create();
    const prompt = await say(session, "dialog-choice");
    includes(prompt, "Telefon, Digital melding");
    includes(await say(session, "brevdue"), "gyldig valg");
    assert.equal((await oekt(session)).svar.valg, undefined);
    await say(session, "Digital melding");
    assert.equal((await oekt(session)).svar.valg, "digital");
  });

  for (const id of ["dialog-info", "dialog-data", "dialog-summary"]) {
    await check(`siste steg uten SUBMIT: ${id}`, async () => {
      const session = await create();
      let response = await say(session, id);
      if (id === "dialog-summary") response = await say(session, "ja");
      assert.equal(response.awaiting, "process_end");
      includes(response, "ingen søknad er sendt inn");
      const before = await oekt(session);
      assert.notEqual(before.status, "FULLFORT");
      const again = await say(session, "fortsett");
      assert.equal(again.awaiting, "process_end");
      const after = await oekt(session);
      assert.deepEqual(after.resultater, before.resultater);
      assert.equal(after.oppdatert, before.oppdatert, "Siste handling må ikke kjøres om igjen");
    });
  }

  await check("ukjent verktøy gir nyttig advarsel, ikke stille validering", async () => {
    const session = await create();
    const response = await say(session, "dialog-unsupported");
    includes(response, "matrikkel_hent_eiendom");
    includes(response, "Svaret blir ikke kontrollert");
    await say(session, "165/3");
    assert.equal((await oekt(session)).svar.enhet, "165/3");
  });
  await check("verktøy med flere felt gir advarsel og bevarer feltinnsamlingen", async () => {
    const session = await create();
    includes(await say(session, "dialog-multifield"), "matrikkel_finn_veger");
    await say(session, "Storgata");
    const reply = await say(session, "Jeg trenger tilgang til aktivitetene");
    assert.equal(reply.awaiting, "summary_confirm");
    assert.deepEqual((await oekt(session)).svar.sted, { gate: "Storgata", grunn: "Jeg trenger tilgang til aktivitetene" });
  });
  await check("kompatibelt verktøy virker med en ny steg-ID", async () => {
    const session = await create();
    includes(await say(session, "dialog-supported"), "Eksempler på veier");
    assert.equal((await say(session, "storg")).awaiting, "question_value_confirm");
    await say(session, "ja");
    assert.equal((await oekt(session)).svar.sted, "Storgata");
  });

  const flows = [
    { id: "redusert-foreldrebetaling-barnehage", person: "person-001", answers: ["ja"], correction: [] },
    { id: "sfo-moderasjon", person: "person-028", answers: ["ja"], correction: [] },
    { id: "stottekontakt-behov", person: "person-001", answers: ["Hjelp med personlig hygiene", "ja", "ja"], correction: ["Hjelp til sosiale aktiviteter", "nei", "ja"] },
    { id: "fritidskort-stotte", person: "person-028", answers: ["Barnet mitt", "fotball", "ja"], correction: ["Barnet i 5. klasse", "korps", "ja"] },
    { id: "fartsdempende-tiltak", person: "person-001", answers: ["Storgata", "ja", "Høy fart om kvelden"], correction: ["Vi ønsker opphøyd gangfelt"] },
    { id: "tt-kort", person: "person-284", answers: ["Ny søknad", "Nei", "Manuell rullestol", "Jeg trenger hjelp ved bussen", "nei", "ja"], correction: ["Jeg kan ikke gå av eller på bussen", "ja", "ja"] },
    { id: "politiattest-oppdrag", person: "person-026", answers: ["Støttekontakt", "ja", "ja"], correction: ["ja"] }
  ];
  for (const flow of flows) {
    await check(`avvist oppsummering og faktisk innsending: ${flow.id}`, async () => {
      const session = await create(flow.person);
      let response = await say(session, flow.id);
      for (const answer of flow.answers) response = await say(session, answer);
      assert.equal(response.awaiting, "summary_confirm", JSON.stringify(response));
      const before = await oekt(session, flow.person);
      const rejected = await say(session, "nei");
      const after = await oekt(session, flow.person);
      if (flow.correction.length === 0) {
        assert.equal(after.stegIndex, before.stegIndex);
        assert.equal(rejected.awaiting, "summary_confirm");
        includes(rejected, "ingen spørsmål med egne svar");
        assert.deepEqual(after.resultater, before.resultater);
      } else {
        assert.equal(after.aktivtSteg.type, "QUESTION");
        assert.notEqual(rejected.awaiting, "summary_confirm");
        if (flow.id !== "fartsdempende-tiltak") assert.ok(!rejected.replies.join(" ").includes("trafikk"));
        for (const answer of flow.correction) response = await say(session, answer);
        assert.equal(response.awaiting, "summary_confirm", JSON.stringify(response));
      }
      const ready = await say(session, "ja");
      assert.equal(ready.awaiting, "submit");
      const submitted = await say(session, "ja, send inn");
      assert.equal(submitted.awaiting, null);
      const final = await assertAgentSubmitted(submitted.oektsId, flow.person);
      if (flow.id === "tt-kort") {
        assert.deepEqual(final.svar["om-soknaden"], { soknadstype: "Ny søknad", kollektivtilbod: "Nei", hjelpemiddel: "Manuell rullestol" });
        assert.deepEqual(final.svar.reisebehov, { begrunnelse: flow.correction[0], avstandPost: "ja" });
      }
    });
  }
  await check("test:agent verifiserer innsending, ikke bare avsluttet dialog", () => runScript("scripts/test-agent-flow.ts"));
  await check("test:agent:nl sender faktisk inn den rettede søknaden", () => runScript("scripts/test-agent-natural-language.ts"));
  console.log(`\n${passed} agentdialogtester bestått med isolerte tjenester og AI-mock.`);
} finally {
  await Promise.all(children.map((child) => new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  })));
  toolProbe.closeAllConnections();
  await new Promise<void>((resolve) => toolProbe.close(() => resolve()));
  await rm(stateDir, { recursive: true, force: true });
}
