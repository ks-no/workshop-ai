// Static file serving for demo-gui and process-builder, including the type
// stripping that lets the client be written in TypeScript.
//
// Node strips types from .ts on import, but a browser cannot - and this repo has
// no build step and no runtime dependencies, which is the whole point. So the
// same runtime that already strips server-side .ts does it here too, at serve
// time: module.stripTypeScriptTypes() replaces types with whitespace, so line
// numbers in devtools still match the source file 1:1.
//
// Measured at 1.15 ms for 1258 lines, so nothing is cached. That is deliberate -
// apps/shared/ lies outside the `node --watch` path in scripts/dev.sh, so a
// cache would mean editing felles.ts had no visible effect until a manual
// restart. Reading fresh per request is exactly how felles.js behaved.

import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { feilmelding } from "./errors.ts";
import { svarhjelpere } from "./http.ts";

/** Content type for client .ts files. The browser reads this, not the extension. */
export const KLIENTSKRIPT = "text/javascript; charset=utf-8";

// Both frontends serve pages and assets to anyone, and neither takes a token, so
// Allow-Origin alone is the whole policy - no preflight is ever triggered.
const { textResponse: send } = svarhjelpere({
  cors: { "Access-Control-Allow-Origin": "*" }
});

export { send };

export async function sendFil(
  response: ServerResponse,
  filsti: string,
  contentType: string
): Promise<void> {
  try {
    const kilde = await readFile(filsti, "utf8");
    send(response, 200, filsti.endsWith(".ts") ? stripTypeScriptTypes(kilde) : kilde, contentType);
  } catch (feil) {
    send(response, 500, `Kunne ikke lese ${path.basename(filsti)}: ${feilmelding(feil)}`, "text/plain; charset=utf-8");
  }
}
