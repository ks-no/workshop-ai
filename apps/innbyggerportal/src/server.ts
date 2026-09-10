import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KLIENTSKRIPT, send, sendFil } from "../../shared/assets.ts";
import { feilmelding } from "../../shared/errors.ts";
import { svarhjelpere } from "../../shared/http.ts";
import { byggMinside } from "./minside.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sharedDir = path.join(__dirname, "..", "..", "shared");
const klientDir = path.join(__dirname, "client");
const deltKlientDir = path.join(sharedDir, "client");
const port = Number(process.env.PORT || 3002);
// Samme standard som resten av stakken. Portalen snakker med mocken bare for å
// telle hvem som kan logge inn; selve innloggingen skjer i nettleseren.
const digdirBaseUrl = process.env.DIGDIR_BASE_URL || "http://digdir-mock:8086";
/** Så mange testpersoner vises på forsiden. Velgeren i ID-porten har søkefeltet. */
const FORSIDE_UTVALG = 8;

const { jsonResponse } = svarhjelpere();

// Whitelisted, because the filename comes from the URL. Never join user input
// onto a directory path without one. felles.css is deliberately absent: it has no
// @layer and would override the design system. See docs/designsystem.md.
const ASSETS: Record<string, string> = {
  "ds-base.css": "text/css; charset=utf-8",
  "ds-ksdigital.css": "text/css; charset=utf-8"
};

const KLIENTFILER: Record<string, string> = {
  "minside.ts": KLIENTSKRIPT,
  "forside.ts": KLIENTSKRIPT,
  "soknad.ts": KLIENTSKRIPT,
  "callback.ts": KLIENTSKRIPT
};

// felles.ts løser ID-porten-runden for hele sandkassen. Portalen serverer den
// selv i stedet for å låne den fra demo-gui på :3001, slik at den ikke får en
// kjøretidsavhengighet til en tjeneste den ellers ikke snakker med.
const DELTE_KLIENTFILER: Record<string, string> = {
  "felles.ts": KLIENTSKRIPT
};

const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
  const sti = (request.url || "/").split("?")[0] || "/";

  if (sti === "/helse") {
    jsonResponse(response, 200, { status: "ok", tjeneste: "innbyggerportal" });
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
        antall: alle.length,
        testbrukere: alle.slice(0, FORSIDE_UTVALG).map((bruker) => ({
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

  if (sti.startsWith("/api/minside/")) {
    const personId = decodeURIComponent(sti.slice("/api/minside/".length));
    try {
      const minside = await byggMinside(personId);
      if (!minside) {
        jsonResponse(response, 404, { feil: `Fant ingen innbygger med id ${personId}.` });
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
    ["/client/", klientDir, KLIENTFILER],
    ["/delt/", deltKlientDir, DELTE_KLIENTFILER]
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

  // Dit ID-porten sender nettleseren tilbake. Siden veksler koden mot et token
  // og går videre til der innloggingen startet.
  if (sti === "/callback") {
    await sendFil(response, path.join(__dirname, "callback.html"), "text/html; charset=utf-8");
    return;
  }

  // Forsiden er forhåndsinnlogging og «/minside» er bak den. Klienten på
  // forsiden sender deg videre selv når tokenet alt ligger i fanen.
  if (sti === "/") {
    await sendFil(response, path.join(__dirname, "forside.html"), "text/html; charset=utf-8");
    return;
  }

  if (sti === "/minside") {
    await sendFil(response, path.join(__dirname, "minside.html"), "text/html; charset=utf-8");
    return;
  }

  // Søknadsskjemaet. Hvilken søknad står i ?prosess=, ikke i stien: siden er den
  // samme for alle, og prosessdefinisjonen avgjør hvilke felter den tegner.
  if (sti === "/soknad") {
    await sendFil(response, path.join(__dirname, "soknad.html"), "text/html; charset=utf-8");
    return;
  }

  send(response, 404, "Fant ikke side.", "text/plain; charset=utf-8");
});

server.listen(port, () => {
  console.log(`Innbyggerportalen kjører på http://localhost:${port}`);
});
