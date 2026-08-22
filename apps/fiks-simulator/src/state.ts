/**
 * Lesing og skriving av tilstand for Fiks-simulatoren.
 *
 * Two problems lived in server.js before this file existed.
 *
 * The handler read seven JSON files off disk on *every* request, including
 * personer.json with 369 people, whether or not the route touched them. Reading
 * per request is deliberate — it means a hand edit to a seed file takes effect
 * without a restart, which matters during a hackathon — so the fix is to read
 * lazily, once per request, and only what the route asks for.
 *
 * Worse: a write was a read-modify-write on a private copy. Two concurrent
 * POST /fiks/samtykke both read the same array, both pushed, both wrote, and the
 * second one won — the first samtykke was gone with no error anywhere. Writes go
 * through `updateJson` now, which does the whole read-modify-write inside one
 * queue.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Same split as sandbox-backend: data/ is seed and stays untouched, state/ holds
// everything written at runtime and is gitignored.
export const seedDir = path.resolve(__dirname, "../../../data");
export const stateDir = process.env.STATE_DIR || path.resolve(__dirname, "../../../state");

/**
 * state/ first, then the seed in data/. Datasets that only exist at runtime have
 * no seed and pass a default; anything called without one is required and fails
 * loudly rather than quietly looking empty.
 */
export async function readJson(filnavn: string, standardverdi?: unknown): Promise<any> {
  for (const mappe of [stateDir, seedDir]) {
    try {
      return JSON.parse(await readFile(path.join(mappe, filnavn), "utf8"));
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (standardverdi !== undefined) {
    return standardverdi;
  }
  throw new Error(`Fant ikke ${filnavn} i verken state/ eller data/.`);
}

export async function writeJson(filnavn: string, data: unknown) {
  await mkdir(stateDir, { recursive: true });
  await writeFile(path.join(stateDir, filnavn), JSON.stringify(data, null, 2) + "\n");
}

// One queue for every file, not one per file. Serialising a little more than
// strictly necessary costs nothing at sandbox scale, and it means a change that
// later spans two files cannot interleave with another.
let skrivekoe: Promise<unknown> = Promise.resolve();

/**
 * Read, change and write one file, with no other write in between.
 *
 * `endre` receives the freshly read data — never a copy the request read
 * earlier — mutates it, and returns whatever the handler needs back. Throwing
 * from `endre` aborts the change: nothing is written, and the error reaches the
 * caller.
 *
 * That last part is the difference from `leggTilRevisjon` in
 * sandbox-backend/src/revisjon.ts, which the queue is otherwise copied from. It
 * swallows errors on purpose, because logging must never break the operation it
 * logs. Here the operation *is* the write, so a lost samtykke has to be loud.
 */
export function updateJson<T>(
  filnavn: string,
  standardverdi: unknown,
  endre: (data: any) => T | Promise<T>
): Promise<T> {
  const neste = skrivekoe.then(async () => {
    const data = await readJson(filnavn, standardverdi);
    const resultat = await endre(data);
    await writeJson(filnavn, data);
    return resultat;
  });
  // The chain must survive a rejected link, or one 409 would wedge every later
  // write. The caller still sees the rejection — this only keeps the queue alive.
  skrivekoe = neste.catch(() => {});
  return neste;
}

/**
 * A per-request reader that loads each dataset at most once, on first use.
 *
 * Make one at the top of a request and hand it to the handlers; a route that only
 * touches samtykker never opens personer.json.
 */
export function lagStateLeser() {
  const lastet = new Map<string, Promise<any>>();

  function les(filnavn: string, standardverdi?: unknown): Promise<any> {
    if (!lastet.has(filnavn)) {
      lastet.set(filnavn, readJson(filnavn, standardverdi));
    }
    return lastet.get(filnavn)!;
  }

  return {
    personer: () => les("personer.json"),
    husstander: () => les("husstander.json"),
    inntekter: () => les("inntekter.json"),
    barnehageplasser: () => les("barnehageplasser.json"),
    samtykker: () => les("samtykker.json", []),
    oppgaver: () => les("oppgaver.json", []),
    meldinger: () => les("meldinger.json", [])
  };
}

export function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
