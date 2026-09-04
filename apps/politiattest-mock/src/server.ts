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
import { docsHtml, routeOverview } from "../../shared/openapi.ts";
import { ATTESTFORMAAL, byggAttestbevis } from "../../shared/politiattest.ts";
import type { Politiattest } from "../../shared/politiattest.ts";

// POLITIATTEST-MOCK
//
// Denne integrasjonen finnes ikke i virkeligheten, og README-en sier hvorfor.
// Kort: politiattesten er en låst PDF uten maskinlesbart innhold, den utstedes til
// innbyggeren og ikke til kommunen, og ingen kan slå den opp. Mocken er den
// strukturerte utgaven av det dokumentet innbyggeren framviser.
//
// Tjenesten modellerer ikke politiets reaksjonsregister. Den svarer bare på
// attester som alt er utstedt, og både fnr og formaal er påkrevd: en attest finnes
// for ett formål, og et oppslag uten formål er spørsmålet «hva har denne personen
// på seg», som ingen skal kunne stille.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const openapiFile = path.resolve(__dirname, "../../../openapi/politiattest-mock.yaml");
// PORT lar testskript starte en isolert instans ved siden av docker compose.
const port = Number(process.env.PORT) || 8088;
const dataFile = process.env.POLITIATTEST_DATA_FILE
  || path.resolve(__dirname, "../../../data/politiattester.json");

const digdirBaseUrl = process.env.DIGDIR_BASE_URL || "http://digdir-mock:8086";
const digdirIssuer = process.env.DIGDIR_ISSUER || "http://localhost:8086";
const authEnforce = process.env.AUTH_ENFORCE !== "false";

// Scopet står utenfor `ks:fiks:`-familien: dette er verken KS eller Fiks.
const SCOPE_LES = "politiattest:attest.read";

// Ett navn, fordi de to må være like: --resource i 401-meldingen er det tokenet
// skal være myntet for.
const AUDIENCE = "politiattest-mock";

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

type Attestregister = {
  attester: Politiattest[];
  perFnr: Map<string, Politiattest[]>;
  perId: Map<string, Politiattest>;
  kilde: string;
  lastetTidspunkt: string;
};

class AttestError extends Error {
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

async function lesAttester(): Promise<Attestregister> {
  const raa = JSON.parse(await readFile(dataFile, "utf8"));
  // Beviset flettes inn her, slik matrikkel-mock fletter inn eierforhold: hvert
  // felt er en funksjon av attesten, så en kopi i seeden kunne bare gå ut av takt.
  const attester: Politiattest[] = (raa.attester || []).map(
    (attest: Omit<Politiattest, "bevis">) => ({ ...attest, bevis: byggAttestbevis(attest) })
  );
  const perFnr = new Map<string, Politiattest[]>();
  const perId = new Map<string, Politiattest>();
  for (const attest of attester) {
    const forFnr = perFnr.get(attest.fnr) || [];
    forFnr.push(attest);
    perFnr.set(attest.fnr, forFnr);
    perId.set(attest.attestId, attest);
  }
  return {
    attester,
    perFnr,
    perId,
    kilde: path.relative(path.resolve(__dirname, "../../.."), dataFile),
    lastetTidspunkt: new Date().toISOString()
  };
}

// Lastet én gang ved oppstart, som i pasientjournal-mock. Filen er seed og endrer
// seg ikke mens tjenesten kjører; `node --watch` starter prosessen på nytt om den gjør.
const attestPromise = lesAttester();

const requireMaskinporten = createMaskinportenPort({
  verifiser: verifyToken,
  realm: AUDIENCE,
  authEnforce
});

/**
 * Maskinporten for det ene scopet. Et ID-porten-token avvises: innbyggeren beviser
 * hvem hen er overfor sandbox-backend, og sandbox-backend henter her som maskin
 * etter at samtykkeporten har åpnet.
 */
function requireHjemmel(request: IncomingMessage) {
  return requireMaskinporten(request, { scope: SCOPE_LES, flate: "Attestflaten" });
}

/**
 * Fødselsnummeret er påkrevd, og det er ikke et valideringsdetalj: en attest har
 * ett personsubjekt. Uten kravet ville ruten vært et uttrekk av alle anmerkninger i
 * sandkassen.
 */
function krevFnr(sok: URLSearchParams): string {
  const fnr = (sok.get("fnr") || "").trim();
  if (!fnr) {
    throw new AttestError(
      "fnr er påkrevd. Attestflaten svarer på én person om gangen, aldri på et uttrekk.",
      400,
      "MANGLER_FNR"
    );
  }
  if (!isGyldigFoedselsnummer(fnr)) {
    throw new AttestError(
      "fnr må være elleve siffer med gyldig kontrollsiffer.",
      400,
      "UGYLDIG_FNR"
    );
  }
  return fnr;
}

/**
 * Formålet er påkrevd av samme grunn som fnr, og av en til: en attest gjelder for
 * det formålet den ble utstedt til, så et oppslag uten formål har ikke noe svar.
 */
function krevFormaal(sok: URLSearchParams): string {
  const formaal = (sok.get("formaal") || "").trim();
  if (!formaal) {
    throw new AttestError(
      `formaal er påkrevd. Gyldige: ${ATTESTFORMAAL.join(", ")}.`,
      400,
      "MANGLER_FORMAAL"
    );
  }
  if (!(ATTESTFORMAAL as readonly string[]).includes(formaal)) {
    throw new AttestError(
      `Ukjent formaal ${formaal}. Gyldige: ${ATTESTFORMAAL.join(", ")}.`,
      400,
      "UKJENT_FORMAAL"
    );
  }
  return formaal;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url!, `http://${request.headers.host}`);

  if (request.method === "OPTIONS") {
    jsonResponse(response, 204, {});
    return;
  }

  try {
    const register = await attestPromise;

    if (request.method === "GET" && url.pathname === "/helse") {
      jsonResponse(response, 200, {
        status: "ok",
        tjeneste: "politiattest-mock",
        kilde: register.kilde,
        antallAttester: register.attester.length,
        antallPersoner: register.perFnr.size,
        lastetTidspunkt: register.lastetTidspunkt,
        tidspunkt: new Date().toISOString()
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/attester") {
      await requireHjemmel(request);
      const fnr = krevFnr(url.searchParams);
      const formaal = krevFormaal(url.searchParams);
      const forPersonen = register.perFnr.get(fnr) || [];
      jsonResponse(response, 200, {
        fnr,
        formaal,
        attester: forPersonen.filter((attest) => attest.formaal === formaal),
        syntetisk: true
      });
      return;
    }

    const attestTreff = url.pathname.match(/^\/attester\/([^/]+)$/);
    if (request.method === "GET" && attestTreff) {
      await requireHjemmel(request);
      // Id-en presiserer hvilken attest, den er ingen nøkkel. Uten fnr og
      // formaal er fortløpende id-er et uttrekk av hele registeret.
      const fnr = krevFnr(url.searchParams);
      const formaal = krevFormaal(url.searchParams);
      const attest = register.perId.get(decodeURIComponent(attestTreff[1]));
      if (!attest || attest.fnr !== fnr || attest.formaal !== formaal) {
        jsonResponse(response, 404, { feil: "Fant ikke attesten.", syntetisk: true });
        return;
      }
      jsonResponse(response, 200, attest);
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

    // Generert av spesifikasjonen, ikke skrevet av hånd: en tredje liste over de
    // samme rutene driver i stillhet. Utforskeren heter /utforsker her.
    if (request.method === "GET" && url.pathname === "/docs") {
      textResponse(
        response,
        200,
        docsHtml(await routeOverview(openapiFile), "http://localhost:3001/utforsker"),
        "text/html; charset=utf-8"
      );
      return;
    }

    jsonResponse(response, 404, { feil: "Fant ikke endepunkt." });
  } catch (error) {
    if (error instanceof AttestError || error instanceof TokenportError) {
      jsonResponse(
        response,
        error.status,
        { feil: error.message, feilkode: error.kode, syntetisk: true },
        error.headers
      );
      return;
    }
    jsonResponse(response, 500, {
      feil: "Intern feil i politiattest-mock.",
      detalj: feilmelding(error),
      syntetisk: true
    });
  }
});

server.listen(port, () => {
  console.log(`Politiattest-mock kjører på http://localhost:${port}`);
});
