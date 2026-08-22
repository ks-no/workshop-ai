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
export async function readJson(fileName: string, standardverdi?: unknown): Promise<any> {
  for (const dir of [stateDir, seedDir]) {
    try {
      return JSON.parse(await readFile(path.join(dir, fileName), "utf8"));
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (standardverdi !== undefined) {
    return standardverdi;
  }
  throw new Error(`Fant ikke ${fileName} i verken state/ eller data/.`);
}

export async function writeJson(fileName: string, data: unknown) {
  await mkdir(stateDir, { recursive: true });
  await writeFile(path.join(stateDir, fileName), JSON.stringify(data, null, 2) + "\n");
}

// One queue for every file, not one per file. Serialising a little more than
// strictly necessary costs nothing at sandbox scale, and it means a change that
// later spans two files cannot interleave with another.
let writeQueue: Promise<unknown> = Promise.resolve();

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
  fileName: string,
  standardverdi: unknown,
  endre: (data: any) => T | Promise<T>
): Promise<T> {
  const neste = writeQueue.then(async () => {
    const data = await readJson(fileName, standardverdi);
    const resultat = await endre(data);
    await writeJson(fileName, data);
    return resultat;
  });
  // The chain must survive a rejected link, or one 409 would wedge every later
  // write. The caller still sees the rejection — this only keeps the queue alive.
  writeQueue = neste.catch(() => {});
  return neste;
}

/**
 * A per-request reader that loads each dataset at most once, on first use.
 *
 * Make one at the top of a request and hand it to the handlers; a route that only
 * touches samtykker never opens personer.json.
 */
export function createStateReader() {
  const loaded = new Map<string, Promise<any>>();

  function read(fileName: string, standardverdi?: unknown): Promise<any> {
    if (!loaded.has(fileName)) {
      loaded.set(fileName, readJson(fileName, standardverdi));
    }
    return loaded.get(fileName)!;
  }

  return {
    personer: () => read("personer.json"),
    husstander: () => read("husstander.json"),
    inntekter: () => read("inntekter.json"),
    barnehageplasser: () => read("barnehageplasser.json"),
    samtykker: () => read("samtykker.json", []),
    oppgaver: () => read("oppgaver.json", []),
    meldinger: () => read("meldinger.json", [])
  };
}

export function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
