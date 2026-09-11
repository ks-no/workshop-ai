import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cors, readRequestBody, svarhjelpere } from "../../shared/http.ts";
import { feilmelding } from "../../shared/errors.ts";
import { docsHtml, routeOverview } from "../../shared/openapi.ts";
import { FORMAAL, formaalKilde, søk, type Formaal } from "./formaal.ts";
import { modellnavn, modellUrl, ModellUtilgjengelig, rangér } from "./modell.ts";

// HJEMMELSOK
//
// Ett oppslag: noen få ord om hva en politiattest skal brukes til, ut kommer
// hjemlene attesten kan kreves etter - hentet ordrett fra politiets egen
// formålsoversikt, aldri formulert av modellen. README-en her sier hvorfor det
// skillet er hele tjenesten.
//
// Flaten er åpen. Radene er politiets offentlige oversikt, de samme for alle, og
// spørsmålet inn er en yrkesbeskrivelse - ingen personopplysning passerer her. En
// vakt ville bare gjort en oppslagsbok til noe deltakerne måtte hente token for.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const openapiFile = path.resolve(__dirname, "../../../openapi/hjemmelsok.yaml");
// PORT lar testskript starte en isolert instans ved siden av docker compose.
const port = Number(process.env.PORT) || 8089;

/** Hvor mange rader ordsøket sender videre til modellen. */
const KANDIDATER = Number(process.env.HJEMMELSOK_KANDIDATER) || 20;
/** Hvor mange treff svaret inneholder som standard. Et nedtrekk skal være kort. */
const STANDARD_ANTALL = 5;
const MAKS_ANTALL = 25;

const { jsonResponse, textResponse } = svarhjelpere({
  cors: cors("GET,POST,OPTIONS"),
  tekstCors: { "Access-Control-Allow-Origin": "*" }
});

interface Treff extends Formaal {
  /** Modellens ene setning om hvorfor. Tom når svaret kom fra ordsøket alene. */
  begrunnelse: string;
}

/**
 * Selve oppslaget. To trinn: ordsøket plukker kandidatene, modellen rangerer dem.
 * Svarer ikke modellen, er ordsøkets egen rekkefølge svaret - da mangler bare
 * begrunnelsene, og `kilde` sier fra.
 */
async function finnHjemler(beskrivelse: string, antall: number) {
  const treffOrd = søk(beskrivelse, KANDIDATER);

  // Ordsøket er ordoverlapp, så «sykepleier på sykehjem» finner ingenting: ingen av de
  // ordene står i oversikten, selv om «Kommunale helse- og omsorgstjenester» er svaret.
  // Da får modellen hele oversikten i stedet - uten beskrivelsene, så ledeteksten holder
  // seg kort - og finner området ordene ikke traff.
  const heleOversikten = treffOrd.length === 0;
  const kandidater = heleOversikten
    ? FORMAAL.map((formaal) => ({ formaal, poeng: 0 }))
    : treffOrd;

  // Ordsøket har ingen mening om rekkefølgen når det ikke traff noe, så da er det tomt
  // som er det ærlige svaret - ikke de 164 i alfabetisk rekkefølge.
  const fraOrdsøk = (): Treff[] =>
    heleOversikten ? [] : treffOrd.slice(0, antall).map((k) => ({ ...k.formaal, begrunnelse: "" }));

  try {
    const rangert = await rangér(beskrivelse, kandidater);
    if (rangert.length === 0) {
      // Modellen mente ingen av kandidatene passet. Det er et svar, ikke en feil.
      const treff = fraOrdsøk();
      return {
        kilde: "ordsøk" as const,
        treff,
        merknad:
          `${modellnavn} fant ingen som passet` +
          (treff.length > 0 ? ". Viser ordsøkets treff." : "."),
      };
    }
    const etterId = new Map(kandidater.map((k) => [k.formaal.id, k.formaal]));
    return {
      kilde: "modell" as const,
      modell: modellnavn,
      treff: rangert
        .slice(0, antall)
        .map((r) => ({ ...etterId.get(r.id)!, begrunnelse: r.begrunnelse })),
    };
  } catch (feil) {
    if (!(feil instanceof ModellUtilgjengelig)) throw feil;
    const treff = fraOrdsøk();
    return {
      kilde: "ordsøk" as const,
      treff,
      merknad:
        `${feil.message} ` +
        (treff.length > 0
          ? "Rangeringen er ordsøkets egen."
          : "Ordsøket fant heller ingenting - prøv andre ord."),
    };
  }
}

function lesAntall(raa: unknown): number {
  const n = Number(raa);
  if (!Number.isFinite(n) || n < 1) return STANDARD_ANTALL;
  return Math.min(Math.floor(n), MAKS_ANTALL);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url!, `http://${request.headers.host}`);

  if (request.method === "OPTIONS") {
    jsonResponse(response, 204, {});
    return;
  }

  try {
    if (request.method === "GET" && url.pathname === "/helse") {
      jsonResponse(response, 200, {
        status: "ok",
        tjeneste: "hjemmelsok",
        kilde: formaalKilde,
        antallFormaal: FORMAAL.length,
        modelltjeneste: modellUrl,
        modell: modellnavn,
        tidspunkt: new Date().toISOString()
      });
      return;
    }

    if ((request.method === "GET" || request.method === "POST") && url.pathname === "/hjemler") {
      let beskrivelse = "";
      let antall: unknown;
      if (request.method === "GET") {
        beskrivelse = url.searchParams.get("beskrivelse") ?? url.searchParams.get("q") ?? "";
        antall = url.searchParams.get("antall");
      } else {
        let kropp: { beskrivelse?: unknown; antall?: unknown };
        try {
          kropp = (await readRequestBody(request)) as { beskrivelse?: unknown; antall?: unknown };
        } catch {
          jsonResponse(response, 400, { feil: 'Kroppen må være JSON: {"beskrivelse": "…"}' });
          return;
        }
        beskrivelse = String(kropp.beskrivelse ?? "");
        antall = kropp.antall;
      }

      beskrivelse = beskrivelse.trim().slice(0, 500);
      if (!beskrivelse) {
        jsonResponse(response, 400, {
          feil: "Mangler «beskrivelse» - noen få ord om hva attesten skal brukes til."
        });
        return;
      }

      const startet = Date.now();
      const svar = await finnHjemler(beskrivelse, lesAntall(antall));
      // syntetisk: false, i en sandkasse der alt annet er syntetisk. Radene er
      // politiets egen oversikt, ordrett - det er nettopp derfor hjemmelen kan bæres
      // videre inn i et bevis.
      jsonResponse(response, 200, {
        beskrivelse,
        ...svar,
        syntetisk: false,
        millisekunder: Date.now() - startet
      });
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
        docsHtml(await routeOverview(openapiFile), "http://localhost:3001/utforsker"),
        "text/html; charset=utf-8"
      );
      return;
    }

    jsonResponse(response, 404, { feil: "Fant ikke endepunkt. Tjenesten har ett oppslag: /hjemler." });
  } catch (error) {
    jsonResponse(response, 500, {
      feil: "Intern feil i hjemmelsok.",
      detalj: feilmelding(error)
    });
  }
});

server.listen(port, () => {
  console.log(`Hjemmelsok kjører på http://localhost:${port} - ${FORMAAL.length} formål lastet`);
  console.log(`Modell: ${modellUrl} (${modellnavn})`);
});
