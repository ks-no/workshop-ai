import { spawn } from "node:child_process";

const matrikkelPort = 18085;
const mcpPort = 18083;

function vent(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ventPaa(url, forsok = 40) {
  for (let i = 0; i < forsok; i += 1) {
    try {
      const svar = await fetch(url);
      if (svar.ok) return;
    } catch {
      // Ikke oppe enda.
    }
    await vent(250);
  }
  throw new Error(`Timeout: ${url}`);
}

function assert(ok, melding) {
  if (!ok) throw new Error(melding);
}

async function invoke(name, args = {}) {
  const svar = await fetch(`http://127.0.0.1:${mcpPort}/mcp/tools/invoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, arguments: args })
  });
  const data = await svar.json();
  if (!svar.ok || !data.ok) {
    throw new Error(data.detalj || data.feil || `Tool ${name} feilet`);
  }
  return data.result;
}

async function kjor() {
  const matrikkel = spawn("node", ["apps/matrikkel-mock/src/server.js"], {
    env: { ...process.env, PORT: String(matrikkelPort) },
    stdio: "inherit"
  });

  const mcp = spawn("node", ["apps/mcp-services/src/server.js"], {
    env: {
      ...process.env,
      PORT: String(mcpPort),
      MATRIKKEL_BASE_URL: `http://127.0.0.1:${matrikkelPort}`,
      BACKEND_BASE_URL: "http://127.0.0.1:65534",
      AI_BASE_URL: "http://127.0.0.1:65535"
    },
    stdio: "inherit"
  });

  try {
    await ventPaa(`http://127.0.0.1:${matrikkelPort}/health`);
    await ventPaa(`http://127.0.0.1:${mcpPort}/health`);

    const gate = await invoke("matrikkel_finn_veger", { gate: "Storgata" });
    assert(gate.adressenavn === "Storgata", "matrikkel_finn_veger returnerte ikke Storgata");

    const eiendom = await invoke("matrikkel_hent_eiendom", { matrikkelId: "matr-storg-003" });
    assert(eiendom.matrikkelId === "matr-storg-003", "matrikkel_hent_eiendom returnerte feil eiendom");

    const eiere = await invoke("matrikkel_hent_eiere", { matrikkelId: "matr-storg-003" });
    assert(Array.isArray(eiere.eiere), "matrikkel_hent_eiere mangler eierliste");
    assert(eiere.eiere.includes("person-001"), "forventet eier person-001 mangler");

    console.log("test:mcp-matrikkel OK");
  } finally {
    mcp.kill("SIGTERM");
    matrikkel.kill("SIGTERM");
  }
}

kjor().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

