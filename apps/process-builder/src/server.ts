import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KLIENTSKRIPT, send, sendFil } from "../../shared-ui/assets.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sharedUiDir = path.join(__dirname, "..", "..", "shared-ui");
const deltKlientDir = path.join(sharedUiDir, "client");
const klientDir = path.join(__dirname, "client");
const port = 3000;

// Whitelisted, because the filename comes from the URL.
const ASSETS: Record<string, string> = {
  "felles.css": "text/css; charset=utf-8",
  // Vendored design system, see docs/designsystem.md. Flat filenames on purpose:
  // the lookup below joins the URL name onto a directory, so no name may contain a slash.
  "ds-base.css": "text/css; charset=utf-8",
  "ds-ksdigital.css": "text/css; charset=utf-8"
};

// Delt klientkode, servert til begge frontendene. .ts, og nettleseren merker
// ingenting: den gaar etter Content-Type, og shared-ui/assets.ts stripper
// typene paa vei ut.
const DELTE_KLIENTFILER: Record<string, string> = {
  "felles.ts": KLIENTSKRIPT
};

// The page script. Same whitelist rule, same reason.
const KLIENTFILER: Record<string, string> = {
  "index.ts": KLIENTSKRIPT
};

const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
  const sti = (request.url || "/").split("?")[0];

  if (sti === "/helse") {
    send(response, 200, JSON.stringify({ status: "ok", tjeneste: "prosessbygger" }), "application/json; charset=utf-8");
    return;
  }

  for (const [prefiks, katalog, tillatte] of [
    // /delt/ foer /assets/: felles.ts er .ts og strippes, resten er statiske
    // filer som sendes uendret. Rekkefoelgen betyr ingenting her siden
    // prefiksene ikke overlapper, men holder de to slagene fra hverandre.
    ["/delt/", deltKlientDir, DELTE_KLIENTFILER],
    ["/assets/", sharedUiDir, ASSETS],
    ["/client/", klientDir, KLIENTFILER]
  ] as const) {
    if (!sti.startsWith(prefiks)) continue;
    const navn = sti.slice(prefiks.length);
    const contentType = tillatte[navn];
    if (!contentType) {
      send(response, 404, "Fant ikke fil.", "text/plain; charset=utf-8");
      return;
    }
    await sendFil(response, path.join(katalog, navn), contentType);
    return;
  }

  await sendFil(response, path.join(__dirname, "index.html"), "text/html; charset=utf-8");
});

server.listen(port, () => {
  console.log(`Prosessbygger kjører på http://localhost:${port}`);
});
