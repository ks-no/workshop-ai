/**
 * State I/O for every service that writes under `state/`: read with a seed
 * fallback, and write through one queue.
 *
 * The state-before-seed lookup is deliberate: it is what lets a team override a
 * seed file by dropping a copy in `state/` without editing the repo.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// data/ holds seed data and is tracked in git. Nothing here is ever written to
// at runtime. Everything the services change lives in state/, which is
// gitignored, so a demo run never dirties the working tree.
export const seedDir = path.resolve(__dirname, "../../data");
export const stateDir = process.env.STATE_DIR || path.resolve(__dirname, "../../state");

/**
 * state/ first, then the seed in data/.
 *
 * Datasets that only exist at runtime have no seed at all, so they pass a
 * default. Anything called without one is required, and a missing file fails
 * loudly rather than quietly looking empty.
 */
export async function readJson(fileName: string, fallback?: unknown): Promise<any> {
  for (const dir of [stateDir, seedDir]) {
    try {
      return JSON.parse(await readFile(path.join(dir, fileName), "utf8"));
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(`Fant ikke ${fileName} i verken state/ eller data/.`);
}

/*
 * Private on purpose. Every write goes through updateJson, which reads fresh
 * inside the queue first - so «wrote a copy the request read earlier» is not a
 * mistake a caller can make.
 */
async function writeJson(fileName: string, data: unknown) {
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
 * `change` receives the freshly read data - never a copy the request read
 * earlier - mutates it, and returns whatever the caller needs back. Throwing
 * from `change` aborts the change: nothing is written, and the error reaches the
 * caller, so a 404 or 409 decided inside the queue is decided against the state
 * that is actually on disk.
 *
 * `replace` is for the one file whose on-disk shape is not the shape the code
 * works on: `prosessdefinisjoner.json` is parsed into a katalog and serialised
 * back, and a legacy bare array has to come out as the object form. Everything
 * else ignores the second parameter and mutates in place.
 *
 * Errors are *not* swallowed here. `addRevisjon` swallows its own, because
 * logging must never break the operation it logs - but where the operation *is*
 * the write, a lost søknad has to be loud.
 */
export function updateJson<T>(
  fileName: string,
  fallback: unknown,
  change: (data: any, replace: (value: unknown) => void) => T | Promise<T>
): Promise<T> {
  const next = writeQueue.then(async () => {
    const data = await readJson(fileName, fallback);
    let outgoing: unknown = data;
    const result = await change(data, (value) => { outgoing = value; });
    await writeJson(fileName, outgoing);
    return result;
  });
  // The chain must survive a rejected link, or one 409 would wedge every later
  // write. The caller still sees the rejection - this only keeps the queue alive.
  writeQueue = next.catch(() => {});
  return next;
}
