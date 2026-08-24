#!/usr/bin/env node

/*
 * The lost update on prosessoekter.json.
 *
 * Every handler in routes.ts used to mutate its own request-scoped copy of the
 * whole prosessoekter array and write all of it back. Two requests on *different*
 * økter therefore raced: the second writer overwrote the first one's change with
 * an array that never contained it. No error, no 409 — the participant's step was
 * simply gone, and the only symptom was a session that had quietly moved backwards.
 *
 * This is the same bug fiks-simulator/src/state.ts:11-16 describes fixing for
 * samtykker.json, and that one is pinned by test-samtykke.js §6f. Nothing pinned
 * it for the økter, and kontrakt-smoke.js runs strictly sequentially so it could
 * never see it.
 *
 * Backend and digdir-mock on their own ports against a fresh STATE_DIR, so this
 * runs alongside a docker stack without touching it. Needs no model.
 *
 * Usage:
 *   node scripts/test-prosessoekt-concurrency.ts
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getInnbyggerToken } from "../apps/digdir-mock/src/client.ts";
import { feilkode } from "../apps/shared-ui/errors.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendPort = Number(process.env.CONCURRENCY_BACKEND_PORT) || 18092;
const digdirPort = Number(process.env.CONCURRENCY_DIGDIR_PORT) || 18093;
const backendUrl = `http://127.0.0.1:${backendPort}`;
const digdirUrl = `http://127.0.0.1:${digdirPort}`;

const PROSESS = "redusert-foreldrebetaling-barnehage";
const COUNT = 10;

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: unknown, detail = "") {
  if (condition) { passed += 1; return; }
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
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

await requireFreePort(backendPort);
await requireFreePort(digdirPort);

const stateDir = await mkdtemp(path.join(tmpdir(), "concurrency-"));
const oektFile = path.join(stateDir, "prosessoekter.json");
const env = {
  STATE_DIR: stateDir,
  BACKEND_BASE_URL: backendUrl,
  DIGDIR_BASE_URL: digdirUrl,
  DIGDIR_ISSUER: digdirUrl,
  // No fiks, no ai, no matrikkel: this test never advances past the INFO step, so
  // nothing calls them. Unreachable addresses beat hanging ones.
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

  /*
   * Ten different people, so every write lands on a different økt — same-person
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
    `${onDisk.length} av 10 — dette er lost update-en`);
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
    `${atSteg1.length} av 10 — de øvrige mistet endringen sin i en samtidig skriving`
  );

  // 3. The økt must belong to whoever created it, after all that racing.
  const wrongOwner = after.filter((oekt: any) => {
    const expected = created.find((s: any) => s.body?.oektsId === oekt.oektsId);
    return expected && expected.body.personId !== oekt.personId;
  });
  check("ingen økt byttet eier under kappløpet", wrongOwner.length === 0, String(wrongOwner.length));
} finally {
  for (const service of services) service.kill("SIGTERM");
  await rm(stateDir, { recursive: true, force: true });
}

const total = passed + failures.length;
if (failures.length > 0) {
  console.error(`Samtidighetstest: ${passed}/${total} bestått.\n`);
  for (const line of failures) console.error(`  ✗ ${line}`);
  process.exit(1);
}
console.log(`Samtidighetstest ok. ${passed}/${total} sjekker bestått.`);
