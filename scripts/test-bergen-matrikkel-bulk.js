import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const port = 18087;
const baseUrl = `http://127.0.0.1:${port}`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // keep waiting
    }
    await wait(250);
  }
  throw new Error(`Server svarte ikke på ${url}`);
}

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

function sampleEvery(items, wanted) {
  if (items.length <= wanted) return items;
  const step = items.length / wanted;
  return Array.from({ length: wanted }, (_, i) => items[Math.floor(i * step)]).filter(Boolean);
}

async function run() {
  const raw = await readFile(new URL("../data/matrikkel.seed.json", import.meta.url), "utf8");
  const data = JSON.parse(raw);
  const gater = Array.isArray(data.gater) ? data.gater : [];
  assert(gater.length >= 4, `Forventet seed-datasett med minst 4 gater, fikk ${gater.length} gater`);

  const gateSample = sampleEvery(gater.filter((g) => Array.isArray(g.eiendommer) && g.eiendommer.length > 0), 40);
  const adresseSample = gateSample.flatMap((g) => g.eiendommer.slice(0, 1).map((e) => ({ gate: g.adressenavn, adresse: e.adresse })));

  const proc = spawn("node", ["apps/matrikkel-mock/src/server.js"], {
    env: { ...process.env, PORT: String(port) },
    stdio: "inherit"
  });

  try {
    await waitForServer(`${baseUrl}/health`);

    for (const gate of gateSample) {
      const res = await fetch(`${baseUrl}/mock/matrikkel/gater?gate=${encodeURIComponent(gate.adressenavn)}`);
      assert(res.ok, `Gateoppslag feilet for ${gate.adressenavn}`);
      const json = await res.json();
      const treff = Array.isArray(json) ? json : (Array.isArray(json?.items) ? json.items : [json]);
      assert(treff.some((g) => g?.adressenavn === gate.adressenavn), `Gateoppslag returnerte feil gate for ${gate.adressenavn}`);
    }

    for (const entry of adresseSample.slice(0, 25)) {
      const res = await fetch(`${baseUrl}/mock/matrikkel/eiendom-oppslag?adresse=${encodeURIComponent(entry.adresse)}`);
      assert(res.ok, `Eiendomsoppslag feilet for ${entry.adresse}`);
      const json = await res.json();
      assert(json.adresse === entry.adresse, `Eiendomsoppslag returnerte feil adresse for ${entry.adresse}`);
      assert(typeof json.gnr === "number" && typeof json.bnr === "number", `Mangler gnr/bnr for ${entry.adresse}`);
    }

    const fjos = await fetch(`${baseUrl}/mock/matrikkel/gater?gate=${encodeURIComponent("Fjøsanger")}`);
    assert(fjos.ok, "Accent-insensitivt Bergen-oppslag feilet for Fjøsanger");

    console.log("test:bergen-matrikkel-bulk OK");
  } finally {
    proc.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});


