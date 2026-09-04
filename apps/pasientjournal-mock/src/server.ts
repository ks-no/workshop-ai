import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage } from "node:http";

import { createVerifier } from "../../digdir-mock/src/verify.ts";
import { createMaskinportenPort, TokenportError } from "../../digdir-mock/src/tokenport.ts";
import { cors, svarhjelpere } from "../../shared/http.ts";
import { feilmelding } from "../../shared/errors.ts";
import { isGyldigFoedselsnummer } from "../../shared/foedselsnummer.ts";
import { routeOverview } from "../../shared/openapi.ts";
import type { Legeerklaering } from "../../shared/legeerklaering.ts";

// PASIENTJOURNAL-MOCK
//
// Denne integrasjonen finnes ikke i virkeligheten, og README-en sier hvorfor.
// Kort: en journal eies av virksomheten som yter helsehjelpen, ikke av et
// register, og ingen fylkeskommune kan slå opp i den. I dag bærer innbyggeren en
// stemplet PDF. Mocken er den strukturerte utgaven av det vedlegget.
//
// To ting er derfor bevisst: tjenesten svarer aldri på et bulkoppslag - fnr er
// påkrevd - og den er eneste leser av data/legeerklaeringer.json.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const openapiFile = path.resolve(__dirname, "../../../openapi/pasientjournal-mock.yaml");
// PORT lar testskript starte en isolert instans ved siden av docker compose.
const port = Number(process.env.PORT) || 8087;
const dataFile = process.env.LEGEERKLAERING_DATA_FILE
  || path.resolve(__dirname, "../../../data/legeerklaeringer.json");

const digdirBaseUrl = process.env.DIGDIR_BASE_URL || "http://digdir-mock:8086";
const digdirIssuer = process.env.DIGDIR_ISSUER || "http://localhost:8086";
const authEnforce = process.env.AUTH_ENFORCE !== "false";

// Hvorfor Maskinporten og ikke HelseID, og hvorfor scopet står utenfor
// `ks:fiks:`-familien: README.md her i mappen.
const SCOPE_LES = "pasientjournal:legeerklaering.read";

// Ett navn, fordi de to må være like: --resource i 401-meldingen er det tokenet
// skal være myntet for.
const AUDIENCE = "pasientjournal-mock";

const verifyToken = createVerifier({
  digdirBaseUrl,
  maskinportenIssuer: digdirIssuer,
  idportenIssuer: `${digdirIssuer}/idporten`,
  audience: AUDIENCE
});

const { jsonResponse, textResponse } = svarhjelpere({
  cors: cors("GET,OPTIONS"),
  tekstCors: { "Access-Control-Allow-Origin": "*" }
});

type Journal = {
  erklaeringer: Legeerklaering[];
  perFnr: Map<string, Legeerklaering[]>;
  perId: Map<string, Legeerklaering>;
  kilde: string;
  lastetTidspunkt: string;
};

class JournalError extends Error {
  status: number;
  kode: string;
  headers: Record<string, string>;

  constructor(melding: string, status: number, kode: string, headers: Record<string, string> = {}) {
    super(melding);
    this.status = status;
    this.kode = kode;
    this.headers = headers;
  }
}

async function lesJournal(): Promise<Journal> {
  const raa = JSON.parse(await readFile(dataFile, "utf8"));
  const erklaeringer: Legeerklaering[] = raa.legeerklaeringer || [];
  const perFnr = new Map<string, Legeerklaering[]>();
  const perId = new Map<string, Legeerklaering>();
  for (const erklaering of erklaeringer) {
    const forFnr = perFnr.get(erklaering.fnr) || [];
    forFnr.push(erklaering);
    perFnr.set(erklaering.fnr, forFnr);
    perId.set(erklaering.erklaeringId, erklaering);
  }
  return {
    erklaeringer,
    perFnr,
    perId,
    kilde: path.relative(path.resolve(__dirname, "../../.."), dataFile),
    lastetTidspunkt: new Date().toISOString()
  };
}

// Lastet én gang ved oppstart, som i matrikkel-mock. Filen er seed og endrer seg
// ikke mens tjenesten kjører; `node --watch` starter prosessen på nytt om den gjør.
const journalPromise = lesJournal();

// The gate itself lives in digdir-mock beside verify.ts, shared with
// fiks-simulator. Only the journal's own error shape stays here.
const requireMaskinporten = createMaskinportenPort({
  verifiser: verifyToken,
  realm: AUDIENCE,
  authEnforce
});

/**
 * Maskinporten for det ene scopet. Et ID-porten-token avvises: innbyggeren beviser
 * hvem hen er overfor sandbox-backend, og sandbox-backend henter her som maskin
 * etter at samtykkeporten har åpnet. Skillet mellom hjemmel og aktør er hele
 * poenget, og det er det samme skillet fiks-simulator håndhever.
 */
function requireHjemmel(request: IncomingMessage) {
  return requireMaskinporten(request, { scope: SCOPE_LES, flate: "Journalflaten" });
}

/**
 * Fødselsnummeret er påkrevd, og det er ikke et valideringsdetalj: en journal har
 * ett personsubjekt om gangen. Uten dette kravet ville ruten vært et uttrekk av
 * alle helseopplysningene i sandkassen.
 */
function krevFnr(sok: URLSearchParams): string {
  const fnr = (sok.get("fnr") || "").trim();
  if (!fnr) {
    throw new JournalError(
      "fnr er påkrevd. Journalen svarer på én person om gangen, aldri på et uttrekk.",
      400,
      "MANGLER_FNR"
    );
  }
  if (!isGyldigFoedselsnummer(fnr)) {
    throw new JournalError(
      "fnr må være elleve siffer med gyldig kontrollsiffer.",
      400,
      "UGYLDIG_FNR"
    );
  }
  return fnr;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url!, `http://${request.headers.host}`);

  if (request.method === "OPTIONS") {
    jsonResponse(response, 204, {});
    return;
  }

  try {
    const journal = await journalPromise;

    if (request.method === "GET" && url.pathname === "/helse") {
      jsonResponse(response, 200, {
        status: "ok",
        tjeneste: "pasientjournal-mock",
        kilde: journal.kilde,
        antallErklaeringer: journal.erklaeringer.length,
        antallPersoner: journal.perFnr.size,
        lastetTidspunkt: journal.lastetTidspunkt,
        tidspunkt: new Date().toISOString()
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/journal/legeerklaeringer") {
      await requireHjemmel(request);
      const fnr = krevFnr(url.searchParams);
      jsonResponse(response, 200, {
        fnr,
        legeerklaeringer: journal.perFnr.get(fnr) || [],
        syntetisk: true
      });
      return;
    }

    const erklaeringTreff = url.pathname.match(/^\/journal\/legeerklaeringer\/([^/]+)$/);
    if (request.method === "GET" && erklaeringTreff) {
      await requireHjemmel(request);
      // Id-en presiserer hvilken erklæring, den er ingen nøkkel. Uten fnr er
      // fortløpende id-er et uttrekk av hele journalen.
      const fnr = krevFnr(url.searchParams);
      const erklaering = journal.perId.get(decodeURIComponent(erklaeringTreff[1]));
      if (!erklaering || erklaering.fnr !== fnr) {
        jsonResponse(response, 404, { feil: "Fant ikke legeerklæringen.", syntetisk: true });
        return;
      }
      jsonResponse(response, 200, erklaering);
      return;
    }

    if (request.method === "GET" && url.pathname === "/openapi.yaml") {
      textResponse(response, 200, await readFile(openapiFile, "utf8"), "text/yaml; charset=utf-8");
      return;
    }

    // Den samme spesifikasjonen, lest. Se kommentaren i tools-api.
    if (request.method === "GET" && url.pathname === "/openapi-ruter.json") {
      jsonResponse(response, 200, await routeOverview(openapiFile));
      return;
    }

    if (request.method === "GET" && url.pathname === "/docs") {
      textResponse(
        response,
        200,
        [
          "<!doctype html>",
          "<html lang=\"nb\"><head><meta charset=\"utf-8\"><title>Pasientjournal Mock</title></head><body>",
          "<h1>Pasientjournal Mock</h1>",
          "<p>Legeerklæringer til søknad om TT-kort. <strong>Denne integrasjonen finnes ikke i "
          + "virkeligheten</strong> - se <code>apps/pasientjournal-mock/README.md</code>.</p>",
          "<p><a href=\"/openapi.yaml\">Spesifikasjonen</a> · "
          + "<a href=\"/openapi-ruter.json\">Samme, lest, som JSON</a> · "
          + "<a href=\"http://localhost:3001/utforsker\">Prøv rutene i API-utforskeren</a></p>",
          "<ul>",
          "<li><code>GET /helse</code></li>",
          "<li><code>GET /journal/legeerklaeringer?fnr=04875899266</code></li>",
          "<li><code>GET /journal/legeerklaeringer/legeerkl-0002</code></li>",
          "</ul>",
          "</body></html>"
        ].join("\n"),
        "text/html; charset=utf-8"
      );
      return;
    }

    jsonResponse(response, 404, { feil: "Fant ikke endepunkt." });
  } catch (error) {
    if (error instanceof JournalError || error instanceof TokenportError) {
      jsonResponse(
        response,
        error.status,
        { feil: error.message, feilkode: error.kode, syntetisk: true },
        error.headers
      );
      return;
    }
    jsonResponse(response, 500, {
      feil: "Intern feil i pasientjournal-mock.",
      detalj: feilmelding(error),
      syntetisk: true
    });
  }
});

server.listen(port, () => {
  console.log(`Pasientjournal-mock kjører på http://localhost:${port}`);
});
