import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KLIENTSKRIPT, send, sendFil } from "../../shared/assets.ts";
import { feilmelding } from "../../shared/errors.ts";
import { svarhjelpere } from "../../shared/http.ts";
import { byggMinside, KOMMUNENAVN, listInnbyggere } from "./minside.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sharedDir = path.join(__dirname, "..", "..", "shared");
const klientDir = path.join(__dirname, "client");
const port = Number(process.env.PORT || 3002);

const { jsonResponse } = svarhjelpere();

// Whitelisted, because the filename comes from the URL. Never join user input
// onto a directory path without one. felles.css is deliberately absent: it has no
// @layer and would override the design system. See docs/designsystem.md.
const ASSETS: Record<string, string> = {
  "ds-base.css": "text/css; charset=utf-8",
  "ds-ksdigital.css": "text/css; charset=utf-8"
};

const KLIENTFILER: Record<string, string> = {
  "minside.ts": KLIENTSKRIPT
};

const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
  const sti = (request.url || "/").split("?")[0] || "/";

  if (sti === "/helse") {
    jsonResponse(response, 200, { status: "ok", tjeneste: "innbyggerportal" });
    return;
  }

  if (sti === "/api/innbyggere") {
    try {
      jsonResponse(response, 200, { innbyggere: await listInnbyggere() });
    } catch (feil) {
      jsonResponse(response, 500, { feil: feilmelding(feil) });
    }
    return;
  }

  if (sti.startsWith("/api/minside/")) {
    const personId = decodeURIComponent(sti.slice("/api/minside/".length));
    try {
      const minside = await byggMinside(personId);
      if (!minside) {
        jsonResponse(response, 404, {
          feil: `Fant ingen innbygger med id ${personId} i ${KOMMUNENAVN}. Se GET /api/innbyggere.`
        });
        return;
      }
      jsonResponse(response, 200, minside);
    } catch (feil) {
      jsonResponse(response, 500, { feil: feilmelding(feil) });
    }
    return;
  }

  for (const [prefiks, katalog, tillatte] of [
    ["/assets/", sharedDir, ASSETS],
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

  if (sti === "/" || sti === "/minside") {
    await sendFil(response, path.join(__dirname, "minside.html"), "text/html; charset=utf-8");
    return;
  }

  send(response, 404, "Fant ikke side.", "text/plain; charset=utf-8");
});

server.listen(port, () => {
  console.log(`Innbyggerportalen kjører på http://localhost:${port}`);
});
