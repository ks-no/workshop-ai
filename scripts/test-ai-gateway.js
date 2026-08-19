import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const rootDir = path.resolve(import.meta.dirname, "..");
const serverPath = path.join(rootDir, "apps/ai-gateway/src/server.js");

function freePort() {
  return 19000 + Math.floor(Math.random() * 1000);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/helse`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await sleep(100);
  }
  throw new Error(`AI-gateway svarte ikke paa /helse: ${baseUrl}`);
}

async function startGateway(env = {}) {
  const port = freePort();
  const stateDir = await mkdtemp(path.join(tmpdir(), "ai-gateway-test-"));
  const child = spawn(process.execPath, [serverPath], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: String(port),
      STATE_DIR: stateDir,
      BACKEND_BASE_URL: "http://127.0.0.1:1",
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(baseUrl);
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }
  return { child, baseUrl, stateDir };
}

async function stopGateway(gateway) {
  gateway.child.kill("SIGTERM");
  await sleep(100);
}

async function postJson(baseUrl, pathName, body, headers = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  return { status: response.status, data };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function withGateway(env, test) {
  const gateway = await startGateway(env);
  try {
    await test(gateway);
  } finally {
    await stopGateway(gateway);
  }
}

const chatBody = {
  meldinger: [
    { rolle: "system", innhold: "Du hjelper med kommunale tjenester." },
    { rolle: "user", innhold: "Hvordan søker jeg om barnehageplass?" }
  ],
  modellklasse: "standard",
  sporingsId: "test-chat"
};

await withGateway({ AI_PROVIDER: "mock" }, async ({ baseUrl }) => {
  const response = await postJson(baseUrl, "/ai/chat", chatBody);
  assert(response.status === 200, "mock chat skal svare 200");
  assert(response.data.provider === "mock", "mock chat skal bruke mock-provider");
  assert(response.data.modellklasse === "standard", "chat skal returnere modellklasse");

  const health = await fetch(`${baseUrl}/helse`).then((r) => r.json());
  assert(health.modellklasser.standard.provider === "mock", "helse skal vise standard-rute");
});

await withGateway({ AI_PROVIDER: "mock" }, async ({ baseUrl }) => {
  const response = await postJson(baseUrl, "/ai/chat", { ...chatBody, modellklasse: "giant" });
  assert(response.status === 400, "ugyldig modellklasse skal gi 400");
  assert(response.data.error === "AI_INVALID_MODEL_CLASS", "ugyldig modellklasse skal ha feilkode");
});

await withGateway({
  AI_PROVIDER: "mock",
  AI_AUTH_ENABLED: "true",
  AI_TEAM_TOKENS_JSON: JSON.stringify({ "team-01": "secret-token-1" })
}, async ({ baseUrl }) => {
  const missing = await postJson(baseUrl, "/ai/chat", chatBody);
  assert(missing.status === 401, "manglende Authorization skal gi 401");

  const ok = await postJson(baseUrl, "/ai/chat", chatBody, { Authorization: "Bearer secret-token-1" });
  assert(ok.status === 200, "gyldig team-token skal gi 200");
});

await withGateway({ AI_PROVIDER: "mock", AI_RATE_LIMIT_RPM: "1" }, async ({ baseUrl }) => {
  const first = await postJson(baseUrl, "/ai/chat", chatBody);
  const second = await postJson(baseUrl, "/ai/chat", chatBody);
  assert(first.status === 200, "første request under rate limit skal lykkes");
  assert(second.status === 429, "andre request over rate limit skal gi 429");
});

await withGateway({ AI_PROVIDER: "mock", AI_MAX_INPUT_CHARS: "20" }, async ({ baseUrl }) => {
  const response = await postJson(baseUrl, "/ai/chat", {
    meldinger: [{ rolle: "user", innhold: "Dette er en altfor lang melding for denne testen." }]
  });
  assert(response.status === 413, "for stor modellinput skal gi 413");
});

await withGateway({
  AI_PROVIDER: "openai",
  OPENAI_API_KEY: "super-secret-openai-key",
  OPENAI_MODEL: "test-model",
  AI_TRACE_MODE: "metadata"
}, async ({ baseUrl, stateDir }) => {
  const response = await postJson(baseUrl, "/ai/chat", chatBody);
  assert(response.status === 200, "providerfeil i chat skal gi mock-fallback 200");
  assert(response.data.provider === "mock", "fallback skal ikke late som provider svarte");
  assert(response.data.advarsel, "fallback skal ha advarsel");

  const traceRaw = await readFile(path.join(stateDir, "ai-trace.jsonl"), "utf8");
  assert(!traceRaw.includes("Hvordan søker jeg"), "metadata-trace skal ikke lagre prompt");
  assert(!traceRaw.includes("super-secret-openai-key"), "trace skal ikke inneholde API-key");
});

await withGateway({
  AI_PROVIDER: "openai",
  OPENAI_API_KEY: "super-secret-openai-key",
  OPENAI_MODEL: "test-model",
  AI_TRACE_MODE: "off"
}, async ({ baseUrl, stateDir }) => {
  await postJson(baseUrl, "/ai/chat", chatBody);
  let traceRaw = "";
  try {
    traceRaw = await readFile(path.join(stateDir, "ai-trace.jsonl"), "utf8");
  } catch {
    traceRaw = "";
  }
  assert(traceRaw === "", "AI_TRACE_MODE=off skal ikke skrive trace");
});

await withGateway({
  AI_PROVIDER: "mock",
  AI_MODEL_FAST_PROVIDER: "openai",
  AI_MODEL_FAST: "fast-model",
  OPENAI_API_KEY: "super-secret-openai-key"
}, async ({ baseUrl }) => {
  const health = await fetch(`${baseUrl}/helse`).then((r) => r.json());
  assert(health.modellklasser.fast.provider === "openai", "fast skal rutes til OpenAI");
  assert(health.modellklasser.fast.configured === true, "fast skal være konfigurert");
});

console.log("test:ai-gateway OK");
