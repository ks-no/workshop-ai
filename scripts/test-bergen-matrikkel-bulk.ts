import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { feilmelding } from "../apps/shared/errors.ts";

const port = 18087;
const baseUrl = `http://127.0.0.1:${port}`;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url: string, attempts = 40): Promise<void> {
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

function assert(ok: unknown, message: string): void {
  if (!ok) throw new Error(message);
}

function sampleEvery<T>(items: T[], wanted: number): T[] {
  if (items.length <= wanted) return items;
  const step = items.length / wanted;
  return Array.from({ length: wanted }, (_, i) => items[Math.floor(i * step)]).filter(Boolean);
}

async function run() {
  const raw = await readFile(new URL("../data/matrikkel.seed.json", import.meta.url), "utf8");
  // Seeden leses her bare for å plukke stikkprøver; formen påstås av testen selv.
  const data = JSON.parse(raw) as any;
  const gater: any[] = Array.isArray(data.gater) ? data.gater : [];
  assert(gater.length >= 4, `Forventet seed-datasett med minst 4 gater, fikk ${gater.length} gater`);

  const gateSample = sampleEvery(gater.filter((g: any) => Array.isArray(g.eiendommer) && g.eiendommer.length > 0), 40);
  const adresseSample = gateSample.flatMap((g: any) => g.eiendommer.slice(0, 1).map((e: any) => ({ gate: g.adressenavn, adresse: e.adresse })));

  const proc = spawn("node", ["apps/matrikkel-mock/src/server.ts"], {
    env: { ...process.env, PORT: String(port) },
    stdio: "inherit"
  });

  try {
    await waitForServer(`${baseUrl}/helse`);

    for (const gate of gateSample) {
      const res = await fetch(`${baseUrl}/mock/matrikkel/gater?gate=${encodeURIComponent(gate.adressenavn)}`);
      assert(res.ok, `Gateoppslag feilet for ${gate.adressenavn}`);
      // Svarene fra endepunktene er `any` her med vilje: skriptet finnes for å påstå
      // noe om formen deres, og en type som lovet formen ville gjort påstanden sirkulær.
      const json = (await res.json()) as any;
      const treff = Array.isArray(json) ? json : (Array.isArray(json?.items) ? json.items : [json]);
      assert(treff.some((g: any) => g?.adressenavn === gate.adressenavn), `Gateoppslag returnerte feil gate for ${gate.adressenavn}`);
    }

    for (const entry of adresseSample.slice(0, 25)) {
      const res = await fetch(`${baseUrl}/mock/matrikkel/eiendom-oppslag?adresse=${encodeURIComponent(entry.adresse)}`);
      assert(res.ok, `Eiendomsoppslag feilet for ${entry.adresse}`);
      const json = (await res.json()) as any;
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
  console.error(feilmelding(error));
  process.exitCode = 1;
});


