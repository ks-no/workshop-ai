import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync,
  rmSync, symlinkSync, writeFileSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bash = readFileSync(path.join(root, "start.sh"), "utf8");
const batch = readFileSync(path.join(root, "start.bat"), "utf8");
const compose = readFileSync(path.join(root, "docker-compose.yml"), "utf8");
const services = [...compose.matchAll(/^  ([\w-]+):\n(?:(?!^  \S)[\s\S])*?^    command: \["\/bin\/sh", "scripts\/dev.sh",/gm)]
  .map(match => match[1]).sort();
const shellServices = bash.match(/^NODE_SERVICES=\(([^)]+)\)/m)![1].split(" ").sort();
const batchServices = batch.match(/^set SERVICES=(.+)\r?$/m)![1].trim().split(" ").sort();
assert.ok(services.length > 0, "Fant ingen Node-tjenester i Compose");
assert.deepEqual(shellServices, services, "start.sh må starte alle Node-tjenestene");
assert.deepEqual(batchServices, services, "start.bat må starte alle Node-tjenestene");
const ports = [...compose.matchAll(/fetch\('http:\/\/localhost:(\d+)\/helse'/g)].map(match => match[1]).sort();
assert.deepEqual(bash.match(/^SERVICE_PORTS=\(([^)]+)\)/m)![1].split(" ").sort(), ports);
assert.deepEqual(batch.match(/^set SERVICE_PORTS=(.+)\r?$/m)![1].trim().split(" ").sort(), ports);
assert.ok(!/[^\x00-\x7f]/.test(batch), "start.bat skal være ASCII");
assert.ok(!/(?<!\r)\n/.test(batch), "start.bat skal ha CRLF");
assert.ok(batch.includes('cd /d "%~dp0"'), "start.bat må bruke sin egen mappe");
assert.ok(batch.includes("up -d --force-recreate --no-deps %SERVICES%"));
assert.ok(batch.includes("set RECREATE=--force-recreate"));
assert.ok(batch.includes("up -d %RECREATE% --no-deps %SERVICES%"));
assert.match(batch, /docker compose down -t 0\r\nif errorlevel 1 goto compose_failed/);
assert.match(batch, /docker compose stop %SERVICES%\r\nif errorlevel 1 exit \/b 1/);
assert.match(batch, /call :backup_state\r\n  if errorlevel 1 exit \/b 1\r\n  rmdir/);
assert.match(batch, /\$ErrorActionPreference = 'Stop'/);
assert.match(batch, /Get-ChildItem -LiteralPath state -Force/);
assert.ok(!batch.includes("NO_CURL"), "Mangler curl, skal oppstart feile");

for (const [shell, file] of [["bash", "start.sh"], ["sh", "scripts/dev.sh"]]) {
  const result = spawnSync(shell, ["-n", path.join(root, file)], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

type Event = { command: string; args: string[]; state: boolean; running: boolean; provider?: string };
const fixtures = path.join(root, `.startup-fixtures-${randomUUID()}`);
mkdirSync(fixtures);
let passed = 0;

// Only these copies execute. Every external service command is a fake, even on
// a workstation with Docker running. Files and cleanup stay inside fixtures.
const fake = `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const [command, ...args] = process.argv.slice(2);
const running = existsSync("running") && readFileSync("running", "utf8") === "yes";
appendFileSync("events.jsonl", JSON.stringify({
  command, args, state: existsSync("state"), running, provider: process.env.AI_PROVIDER
}) + "\\n");
const fail = process.env.FIXTURE_FAIL;
if (command === "docker") {
  if (args[0] === "info") process.exit(fail === "daemon" ? 1 : 0);
  if (args.includes("config") && fail === "config") process.exit(1);
  if (args.includes("stop")) {
    if (fail === "stop") { console.error("SIMULERT STOPPFEIL"); process.exit(1); }
    if (existsSync("state")) writeFileSync("state/shutdown.json", '{"ferdig":true}');
    writeFileSync("running", "no");
  }
  if (args.includes("down")) process.exit(fail === "down" ? 1 : 0);
  if (args.includes("up") && (args.includes("sandbox-backend") || args.at(-1) === "-d")) {
    if (fail === "up") { console.error("SIMULERT OPPSTARTSFEIL"); process.exit(1); }
    writeFileSync("running", "yes");
  }
  if (args.includes("pull")) {
    if (fail === "pull") process.exit(1);
    writeFileSync("model-present", "yes");
  }
  process.exit(0);
}
if (command === "curl") {
  const url = args.find(arg => arg.startsWith("http"));
  if (url.includes("/api/tags")) {
    console.log(JSON.stringify({ models: existsSync("model-present") ? [{name:"qwen2.5:0.5b"}] : [] }));
  } else if (url.includes("/ai/klarsprak")) {
    console.log('{"modell":"qwen2.5:0.5b"}');
  } else {
    if (fail === "health" && running) process.exit(22);
    const provider = existsSync("state/ai-provider-override.json")
      ? JSON.parse(readFileSync("state/ai-provider-override.json", "utf8")).provider
      : process.env.AI_PROVIDER || "ollama";
    console.log(JSON.stringify({tjeneste:"fixture", provider}));
  }
  process.exit(0);
}
if (command === "uname") { console.log(process.env.FIXTURE_PLATFORM || "Linux"); process.exit(0); }
if (command === "date") { console.log("20260908-200000"); process.exit(0); }
if (command === "nvidia-smi") process.exit(1);
if (command === "sleep") process.exit(0);
if (command === "ollama") {
  if (args[0] === "pull") writeFileSync("model-present", "yes");
  process.exit(0);
}
if (command === "cp" && args[0] === "-R" && fail === "backup") {
  console.error("SIMULERT KOPIERINGSFEIL"); process.exit(1);
}
if (command === "mkdir" && args[0].startsWith("_backup/") && fail === "mkdir") process.exit(1);
if (command === "rm" && args.includes("state") && fail === "delete") process.exit(1);
if (["cp", "rm", "mkdir"].includes(command)) {
  const result = spawnSync("/bin/" + command, args, {stdio:"inherit"});
  process.exit(result.status ?? 1);
}
`;

function makeFixture(name: string, state = true): string {
  const directory = path.join(fixtures, name);
  mkdirSync(directory);
  mkdirSync(path.join(directory, "bin"));
  for (const file of ["start.sh", ".env.example"]) {
    copyFileSync(path.join(root, file), path.join(directory, file));
  }
  writeFileSync(path.join(directory, "bin/fixture.ts"), fake);
  for (const command of ["docker", "curl", "uname", "date", "nvidia-smi", "sleep", "ollama", "cp", "rm", "mkdir"]) {
    const target = path.join(directory, "bin", command);
    writeFileSync(target, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fixture.ts" ${command} "$@"\n`);
    chmodSync(target, 0o755);
  }
  writeFileSync(path.join(directory, ".env"), "OLLAMA_BASE_URL=http://ollama:11434\nOLLAMA_MODEL=qwen2.5:0.5b\n");
  writeFileSync(path.join(directory, "running"), "yes");
  if (state) {
    mkdirSync(path.join(directory, "state"));
    mkdirSync(path.join(directory, "state/nested"));
    writeFileSync(path.join(directory, "state/nested/data.json"), '{"egne":true}');
    writeFileSync(path.join(directory, "state/.hidden"), "skjult");
    writeFileSync(path.join(directory, "state/ai-trace.jsonl"), '{"prompt":"behold"}\n');
    writeFileSync(path.join(directory, "state/digdir-nokkel.json"), '{"privateKey":"syntetisk-testnoekkel"}');
    writeFileSync(path.join(directory, "state/ai-provider-override.json"), '{"provider":"openrouter"}');
  }
  return directory;
}

function run(directory: string, args: string[], extra: Record<string, string> = {}) {
  const env = { ...process.env };
  for (const key of ["OLLAMA_MODEL", "OLLAMA_BASE_URL", "AI_PROVIDER", "BASH_ENV", "ENV", "SHELLOPTS"]) delete env[key];
  const result = spawnSync("bash", [path.join(directory, "start.sh"), ...args], {
    cwd: fixtures, encoding: "utf8", timeout: 30_000,
    env: { ...env, PATH: `${directory}/bin:${process.env.PATH}`, ...extra }
  });
  assert.ifError(result.error);
  return result;
}

function events(directory: string): Event[] {
  const file = path.join(directory, "events.jsonl");
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").map(line => JSON.parse(line)) : [];
}

function nodeUp(directory: string): Event {
  const event = events(directory).find(event => event.command === "docker" && event.args.includes("up") && (event.args.includes("sandbox-backend") || event.args.at(-1) === "-d"));
  assert.ok(event, "Node-tjenestene ble ikke startet");
  if (event.args.at(-1) !== "-d") {
    assert.deepEqual(event.args.filter(arg => services.includes(arg)).sort(), services);
  }
  assert.ok(!event.args.includes("ollama"), "Ollama skal ikke tvangsgjenskapes");
  return event;
}

function assertOriginalState(directory: string) {
  assert.equal(readFileSync(path.join(directory, "state/ai-trace.jsonl"), "utf8"), '{"prompt":"behold"}\n');
  assert.ok(existsSync(path.join(directory, "state/digdir-nokkel.json")));
  assert.equal(JSON.parse(readFileSync(path.join(directory, "state/ai-provider-override.json"), "utf8")).provider, "openrouter");
}

function check(name: string, work: () => void) {
  work();
  passed += 1;
  console.log(`  OK ${name}`);
}

try {
  for (const platform of ["Linux", "Darwin"]) {
    check(`Nullstilling med mock på ${platform}`, () => {
      const directory = makeFixture(`reset ${platform}`);
      const result = run(directory, ["--mock", "--reset"], { FIXTURE_PLATFORM: platform });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const history = events(directory);
      const stop = history.findIndex(event => event.command === "docker" && event.args.includes("stop"));
      const copy = history.findIndex(event => event.command === "cp" && event.args.includes("-R"));
      const remove = history.findIndex(event => event.command === "rm" && event.args.includes("state"));
      const up = history.findIndex(event => event.command === "docker" && event.args.includes("up"));
      assert.ok(stop >= 0 && stop < copy && copy < remove && remove < up);
      assert.equal(history[copy].running, false);
      assert.equal(nodeUp(directory).state, false);
      assert.ok(nodeUp(directory).args.includes("--force-recreate"));
      assert.ok(nodeUp(directory).args.includes("--no-deps"));
      assert.ok(!history.some(event => event.args.includes("ollama") || event.command === "ollama"));
      const backup = path.join(directory, "_backup", readdirSync(path.join(directory, "_backup"))[0]);
      for (const file of ["ai-trace.jsonl", "ai-provider-override.json", "shutdown.json", ".hidden", "nested/data.json"]) {
        assert.ok(existsSync(path.join(backup, file)), `Mangler ${file} i sikkerhetskopien`);
      }
      assert.ok(!existsSync(path.join(backup, "digdir-nokkel.json")));
      assert.ok(!existsSync(path.join(directory, "state")));
    });
  }

  for (const platform of ["Linux", "Darwin"]) {
    check(`Modellen klargjøres før nullstilling på ${platform}`, () => {
      const directory = makeFixture(`reset-model-${platform}`);
      const result = run(directory, ["--reset", "-y", "-m", "qwen2.5:0.5b"], { FIXTURE_PLATFORM: platform });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const history = events(directory);
      const pull = history.findIndex(event => event.args.includes("pull"));
      const stop = history.findIndex(event => event.command === "docker" && event.args.includes("stop"));
      assert.ok(pull >= 0 && pull < stop, "Ingen sletting før modellen er lastet ned");
      assert.ok(nodeUp(directory).args.includes("--force-recreate"));
      assert.equal(nodeUp(directory).state, false);
      if (platform === "Darwin") assert.ok(nodeUp(directory).args.includes("--no-deps"));
    });
  }

  check("Første mock-oppstart lager miljø uten å hente modell", () => {
    const directory = makeFixture("first-mock", false);
    rmSync(path.join(directory, ".env"));
    const result = run(directory, ["--mock"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(existsSync(path.join(directory, ".env")));
    assert.ok(nodeUp(directory).args.includes("--no-deps"));
    assert.ok(!nodeUp(directory).args.includes("--force-recreate"));
    assert.ok(!events(directory).some(event => event.args.includes("ollama") || event.command === "ollama"));
  });

  for (const failure of ["daemon", "config", "stop", "backup", "mkdir", "delete", "pull"]) {
    check(`Feil ved ${failure} bevarer data`, () => {
      const directory = makeFixture(`failure-${failure}`);
      const args = failure === "pull" ? ["--reset", "-y"] : ["--mock", "--reset"];
      const result = run(directory, args, { FIXTURE_FAIL: failure });
      assert.notEqual(result.status, 0);
      assertOriginalState(directory);
      assert.ok(!events(directory).some(event => event.command === "docker" && event.args.includes("up") && event.args.includes("sandbox-backend")));
      if (failure === "backup" || failure === "stop") assert.match(result.stderr, /SIMULERT/);
    });
  }

  check("Oppstartsfeil etter sletting beholder sikkerhetskopien", () => {
    const directory = makeFixture("failure-up");
    const result = run(directory, ["--mock", "--reset"], { FIXTURE_FAIL: "up" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SIMULERT OPPSTARTSFEIL/);
    assert.equal(readdirSync(path.join(directory, "_backup")).length, 1);
    assert.ok(!result.stdout.includes("✅ Klar"));
  });

  for (const platform of ["Linux", "Darwin"]) {
    for (const mock of [true, false]) {
      check(`Omlasting gjenskaper på ${platform}, mock=${mock}`, () => {
        const directory = makeFixture(`reload-${platform}-${mock}`, false);
        const result = run(directory, mock ? ["--reload", "--mock"] : ["--reload"], { FIXTURE_PLATFORM: platform });
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.ok(nodeUp(directory).args.includes("--force-recreate"));
        if (mock || platform === "Darwin") assert.ok(nodeUp(directory).args.includes("--no-deps"));
        if (mock) assert.equal(nodeUp(directory).provider, "mock");
        assert.ok(!events(directory).some(event => ["cp", "rm"].includes(event.command)));
      });
    }
  }

  check("Vanlig omlasting bevarer tilstand og admin-valg", () => {
    const directory = makeFixture("reload-state");
    assert.equal(run(directory, ["--reload"]).status, 0);
    assertOriginalState(directory);
  });

  check("Lagret provider blir ikke feilaktig meldt som mock", () => {
    const directory = makeFixture("mock-override");
    const result = run(directory, ["--mock", "--reload"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /admin-valg/);
    assertOriginalState(directory);
  });

  for (const platform of ["Linux", "Darwin"]) {
    check(`Oppstart lager riktig miljø på ${platform} og henter modell`, () => {
      const directory = makeFixture(`model-${platform}`, false);
      rmSync(path.join(directory, ".env"));
      const result = run(directory, ["-y", "--model", "qwen2.5:0.5b"], { FIXTURE_PLATFORM: platform });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const env = readFileSync(path.join(directory, ".env"), "utf8");
      assert.ok(env.includes(`OLLAMA_BASE_URL=http://${platform === "Darwin" ? "host.docker.internal" : "ollama"}:11434`));
      assert.ok(!nodeUp(directory).args.includes("--force-recreate"));
      assert.ok(existsSync(path.join(directory, "model-present")));
      if (platform === "Darwin") assert.ok(!events(directory).some(event => event.command === "docker" && event.args.includes("ollama")));
    });
  }

  check("Gjentatt tidsstempel overskriver ikke en sikkerhetskopi", () => {
    const directory = makeFixture("backup-collision");
    mkdirSync(path.join(directory, "_backup"));
    mkdirSync(path.join(directory, "_backup/20260908-200000-utc"));
    writeFileSync(path.join(directory, "_backup/20260908-200000-utc/behold"), "tidligere");
    assert.equal(run(directory, ["--mock", "--reset"]).status, 0);
    assert.equal(readdirSync(path.join(directory, "_backup")).length, 2);
    assert.equal(readFileSync(path.join(directory, "_backup/20260908-200000-utc/behold"), "utf8"), "tidligere");
  });

  check("Nullstilling av tom kjøring og beskyttelse av state-lenke", () => {
    const directory = makeFixture("empty", false);
    assert.equal(run(directory, ["--mock", "--reset"]).status, 0);
    assert.ok(nodeUp(directory).args.includes("--force-recreate"));
    assert.ok(!existsSync(path.join(directory, "_backup")));
    mkdirSync(path.join(directory, "own-state"));
    symlinkSync("own-state", path.join(directory, "state"));
    assert.notEqual(run(directory, ["--mock", "--reset"]).status, 0);
    assert.ok(existsSync(path.join(directory, "own-state")));
    rmSync(path.join(directory, "state"));
    writeFileSync(path.join(directory, "state"), "ikke en mappe");
    assert.notEqual(run(directory, ["--mock", "--reset"]).status, 0);
    assert.equal(readFileSync(path.join(directory, "state"), "utf8"), "ikke en mappe");
  });

  check("Flaggfeil oppdages før Docker eller sletting", () => {
    for (const args of [
      ["--reset", "--reload"], ["--reset", "--down"], ["--reload", "--down"],
      ["--model"], ["--model", "--reset"], ["--mock", "--model", "modell"], ["--ukjent"]
    ]) {
      const directory = makeFixture(`flags-${randomUUID()}`);
      assert.notEqual(run(directory, args).status, 0);
      assert.deepEqual(events(directory), []);
      assertOriginalState(directory);
    }
  });

  check("Hjelp og stopp melder riktig resultat", () => {
    const directory = makeFixture("help-down");
    assert.equal(run(directory, ["--help"]).status, 0);
    assert.deepEqual(events(directory), []);
    assert.equal(run(directory, ["--down"]).status, 0);
    assertOriginalState(directory);
    assert.notEqual(run(directory, ["--down"], { FIXTURE_FAIL: "down" }).status, 0);
  });

  check("Manglende helsesvar gir feil, ikke klar", () => {
    const directory = makeFixture("health", false);
    const result = run(directory, ["--mock"], { FIXTURE_FAIL: "health" });
    assert.notEqual(result.status, 0);
    assert.ok(!result.stdout.includes("✅ Klar"));
  });

  check("Polling følger felles kode og alle tjenesteavhengigheter, aldri state", () => {
    const directory = makeFixture("watcher", false);
    mkdirSync(path.join(directory, "node_modules"));
    mkdirSync(path.join(directory, "node_modules/.bin"));
    const capture = `#!/bin/sh\nprintf '%s\\n' "$@" > watcher-args\n`;
    for (const file of ["bin/node", "node_modules/.bin/nodemon"]) {
      writeFileSync(path.join(directory, file), capture);
      chmodSync(path.join(directory, file), 0o755);
    }
    const runWatcher = (poll: string) => spawnSync("sh", [path.join(root, "scripts/dev.sh"), "apps/sandbox-backend/src/server.ts"], {
      cwd: directory, encoding: "utf8", env: { ...process.env, WATCH_POLL: poll, PATH: `${directory}/bin:${process.env.PATH}` }
    });
    assert.equal(runWatcher("1").status, 0);
    const args = readFileSync(path.join(directory, "watcher-args"), "utf8").trim().split("\n");
    assert.deepEqual(args, ["--legacy-watch", "--exec", "node", "--watch", "apps", "--watch", "data", "--ext", "js,ts,json", "apps/sandbox-backend/src/server.ts"]);
    assert.equal(runWatcher("0").status, 0);
    assert.match(readFileSync(path.join(directory, "watcher-args"), "utf8"), /^--watch\napps\/sandbox-backend/);
    rmSync(path.join(directory, "node_modules/.bin/nodemon"));
    const result = runWatcher("1");
    assert.equal(result.status, 0);
    assert.match(result.stderr, /nodemon mangler/);
  });
  console.log(`\n${passed} oppstartssjekker bestått. Ingen ekte Docker-kall. Windows-kjøring er ikke testet.`);
} finally {
  rmSync(fixtures, { recursive: true, force: true });
}
