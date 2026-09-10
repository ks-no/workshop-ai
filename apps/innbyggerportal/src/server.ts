import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KLIENTSKRIPT, send, sendFil } from "../../shared/assets.ts";
import { feilmelding } from "../../shared/errors.ts";
import { svarhjelpere } from "../../shared/http.ts";
import { byggMinside, finnInnbyggerForPid, KOMMUNENAVN, listInnbyggere } from "./minside.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sharedDir = path.join(__dirname, "..", "..", "shared");
const deltKlientDir = path.join(sharedDir, "client");
const klientDir = path.join(__dirname, "client");
const port = Number(process.env.PORT || 3002);

// Adressen tjeneren ringer ID-porten-mocken på. Nettleseren bruker sin egen,
// IDPORTEN_BASE i apps/shared/client/felles.ts, fordi de to ikke er samme vei
// inn når alt kjører i Compose.
const digdirBaseUrl = process.env.DIGDIR_BASE_URL || "http://localhost:8086";

const { jsonResponse } = svarhjelpere();

// Whitelisted, because the filename comes from the URL. Never join user input
// onto a directory path without one. felles.css is deliberately absent: it has no
// @layer and would override the design system. See docs/designsystem.md.
const ASSETS: Record<string, string> = {
  "ds-base.css": "text/css; charset=utf-8",
  "ds-ksdigital.css": "text/css; charset=utf-8"
};

const KLIENTFILER: Record<string, string> = {
  "forside.ts": KLIENTSKRIPT,
  "minside.ts": KLIENTSKRIPT,
  "callback.ts": KLIENTSKRIPT
};

// ID-porten-flyten i nettleseren bor i apps/shared/client/felles.ts og deles med
// demo-gui. Den serveres som .ts og type-strippes på vei ut, akkurat som der.
const DELTE_KLIENTFILER: Record<string, string> = {
  "felles.ts": KLIENTSKRIPT
};

const SIDER: Record<string, string> = {
  "/": "forside.html",
  "/minside": "minside.html",
  // Returadressen som ligger i redirect_uri. Siden man skal tilbake til reiser
  // i `state`, ikke i stien.
  "/callback": "callback.html"
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

  // Hvem som kan logge inn. Listen kommer fra ID-porten-mocken framfor herfra:
  // aldersgrensene bor i apps/shared/handleevne.ts, som den tjenesten leser.
  if (sti === "/api/testbrukere") {
    try {
      const svar = await fetch(`${digdirBaseUrl}/idporten/testbrukere`);
      if (!svar.ok) throw new Error(`ID-porten-mocken svarte ${svar.status}.`);
      const kropp = (await svar.json()) as any;
      const alle: any[] = Array.isArray(kropp) ? kropp : (kropp.testbrukere ?? []);
      jsonResponse(response, 200, {
        testbrukere: alle
          .filter((bruker) => bruker.kommune === KOMMUNENAVN)
          .map((bruker) => ({
            pid: bruker.pid,
            personId: bruker.personId,
            navn: bruker.visningsnavn
          }))
      });
    } catch (feil) {
      jsonResponse(response, 502, {
        feil: `Nådde ikke ID-porten-mocken på ${digdirBaseUrl}: ${feilmelding(feil)}`
      });
    }
    return;
  }

  // Oppslag på pid, altså fødselsnummeret i tokenet fra ID-porten. Egen rute og
  // ikke et alternativ til personId i den under: hvem den innloggede er, og hvem
  // en side handler om, er to spørsmål.
  if (sti.startsWith("/api/minside/pid/")) {
    const pid = decodeURIComponent(sti.slice("/api/minside/pid/".length));
    try {
      const innbygger = await finnInnbyggerForPid(pid);
      if (!innbygger) {
        jsonResponse(response, 404, {
          feil: `Fant ingen innbygger med dette fødselsnummeret.`
        });
        return;
      }
      if (!innbygger.iKommunen) {
        jsonResponse(response, 403, {
          feil: `${innbygger.navn} er folkeregistrert i ${innbygger.kommune}, ikke i ${KOMMUNENAVN}.`,
          kommune: innbygger.kommune,
          navn: innbygger.navn
        });
        return;
      }
      const minside = await byggMinside(innbygger.personId);
      if (!minside) {
        jsonResponse(response, 404, { feil: `Fant ingen innbygger med dette fødselsnummeret.` });
        return;
      }
      jsonResponse(response, 200, minside);
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
    ["/delt/", deltKlientDir, DELTE_KLIENTFILER],
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

  const side = SIDER[sti];
  if (side) {
    await sendFil(response, path.join(__dirname, side), "text/html; charset=utf-8");
    return;
  }

  send(response, 404, "Fant ikke side.", "text/plain; charset=utf-8");
});

server.listen(port, () => {
  console.log(`Innbyggerportalen kjører på http://localhost:${port}`);
});
