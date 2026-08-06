import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { errorBody, HttpError, statusFor } from "./errors.ts";
import {
  docsHtml,
  jsonResponse,
  readRequestBody,
  textResponse
} from "./http.ts";
import { openapiFile } from "./config.ts";
import { byggProsessoektRespons, opprettSoknad, utforStegHandling } from "./prosess.ts";
import { finnRessurs, ressurskatalog, utforRessurs } from "./ressurser.ts";
import { leggTilRevisjon } from "./revisjon.ts";
import { compilePathPattern, matchPath, type PathParams } from "./routing.ts";
import type { Prosessoekt } from "./types.ts";
import {
  erMalProsess,
  finnPerson,
  finnProsess,
  finnProsessoekt,
  hentProsesserForVisning,
  lagreProsessdefinisjoner,
  lagreProsessoekter,
  readState,
  normaliserProsess,
  newId
} from "./state.ts";

type State = any;

type Kontekst = {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  parametere: PathParams;
  tilstand: State;
};

type Rute = {
  metode: string;
  sti: string;
  handter: (kontekst: Kontekst) => Promise<void> | void;
};

function hentSporingsId(url: URL) {
  return url.searchParams.get("sporingsId") || newId("flyt");
}

// --- system routes: answer without reading state --------------------------

const systemruter: Rute[] = [
  {
    metode: "GET",
    sti: "/helse",
    handter: ({ response }) => {
      jsonResponse(response, 200, { status: "ok", tjeneste: "sandbox-backend", tidspunkt: new Date().toISOString() });
    }
  },
  {
    metode: "GET",
    sti: "/health",
    handter: ({ response }) => {
      jsonResponse(response, 200, { status: "ok", tjeneste: "sandbox-backend", tidspunkt: new Date().toISOString() });
    }
  },
  {
    metode: "GET",
    sti: "/docs",
    handter: ({ response }) => {
      textResponse(response, 200, docsHtml());
    }
  },
  {
    metode: "GET",
    sti: "/openapi.yaml",
    handter: async ({ response }) => {
      textResponse(response, 200, await readFile(openapiFile, "utf8"), "text/yaml; charset=utf-8");
    }
  }
];

// --- routes that need state -----------------------------------------------

const ruter: Rute[] = [
  {
    metode: "GET",
    sti: "/api/personer",
    handter: ({ response, tilstand }) => {
      // visningsnavn saves every client from assembling the name itself.
      jsonResponse(response, 200, tilstand.personer.map((person: any) => ({
        ...person,
        visningsnavn: [person.navn.fornavn, person.navn.mellomnavn, person.navn.etternavn]
          .filter(Boolean).join(" ")
      })));
    }
  },
  {
    metode: "GET",
    sti: "/api/regler/satser",
    handter: ({ response, tilstand }) => {
      jsonResponse(response, 200, tilstand.satser);
    }
  },
  {
    metode: "GET",
    sti: "/api/prosesser",
    handter: ({ response, url, tilstand }) => {
      const inkluderMaler = url.searchParams.get("inkluderMaler") === "true";
      jsonResponse(response, 200, hentProsesserForVisning(tilstand, inkluderMaler));
    }
  },
  {
    metode: "POST",
    sti: "/api/prosesser",
    handter: async ({ request, response, tilstand }) => {
      const body = await readRequestBody(request);
      const nyProsess = normaliserProsess({
        id: body.id || newId("prosess"),
        navn: body.navn || "Ny prosess",
        beskrivelse: body.beskrivelse || "Prosess opprettet i prosessbyggeren.",
        versjon: body.versjon || "0.1.0",
        steg: Array.isArray(body.steg) ? body.steg : [],
        redigering: body.redigering || {},
        syntetisk: true
      });
      const alleProsesser = hentProsesserForVisning(tilstand, true);
      if (alleProsesser.some((prosess: any) => prosess.id === nyProsess.id)) {
        jsonResponse(response, 409, { feil: "Prosess med samme id finnes allerede." });
        return;
      }
      if (erMalProsess(nyProsess)) {
        tilstand.prosessMaler.push(nyProsess);
      } else {
        tilstand.prosesser.push(nyProsess);
      }
      await lagreProsessdefinisjoner(tilstand);
      await leggTilRevisjon({
        sporingsId: newId("flyt"),
        handling: "PROSESS_OPPRETTET",
        ressurs: "prosess",
        aktor: { type: "utvikler", id: "prosessbygger" }
      });
      jsonResponse(response, 201, nyProsess);
    }
  },
  {
    metode: "GET",
    sti: "/api/katalog/datasett",
    handter: ({ response }) => {
      jsonResponse(response, 200, [
        { id: "personer", fil: "data/personer.json", syntetisk: true },
        { id: "husstander", fil: "data/husstander.json", syntetisk: true },
        { id: "inntekter", fil: "data/inntekter.json", syntetisk: true },
        { id: "barnehageplasser", fil: "data/barnehageplasser.json", syntetisk: true }
      ]);
    }
  },
  {
    metode: "GET",
    sti: "/api/katalog/informasjonsmodeller",
    handter: ({ response, tilstand }) => {
      jsonResponse(response, 200, tilstand.informasjonsmodeller);
    }
  },
  {
    // Lets whoever writes a DATA_FETCH or SJEKK step look up which URLs exist
    // instead of guessing.
    metode: "GET",
    sti: "/api/katalog/ressurser",
    handter: ({ response }) => {
      jsonResponse(response, 200, ressurskatalog());
    }
  },
  {
    metode: "GET",
    sti: "/api/personer/:personId/soknader",
    handter: ({ response, parametere, tilstand }) => {
      jsonResponse(response, 200, tilstand.soknader.filter((soknad: any) => soknad.personId === parametere.personId));
    }
  },
  {
    metode: "GET",
    sti: "/api/prosesser/:prosessId",
    handter: ({ response, parametere, tilstand }) => {
      const prosess = finnProsess(tilstand, parametere.prosessId);
      jsonResponse(response, prosess ? 200 : 404, prosess || { feil: "Fant ikke prosess." });
    }
  },
  {
    metode: "PUT",
    sti: "/api/prosesser/:prosessId",
    handter: async ({ request, response, parametere, tilstand }) => {
      const body = await readRequestBody(request);
      const index = tilstand.prosesser.findIndex((prosess: any) => prosess.id === parametere.prosessId);
      const malIndeks = tilstand.prosessMaler.findIndex((prosess: any) => prosess.id === parametere.prosessId);
      if (index === -1 && malIndeks === -1) {
        jsonResponse(response, 404, { feil: "Fant ikke prosess." });
        return;
      }
      const erMal = malIndeks !== -1;
      const liste = erMal ? tilstand.prosessMaler : tilstand.prosesser;
      const listeIndeks = erMal ? malIndeks : index;
      const eksisterende = liste[listeIndeks];
      const oppdatertProsess = normaliserProsess({
        ...eksisterende,
        navn: body.navn ?? eksisterende.navn,
        beskrivelse: body.beskrivelse ?? eksisterende.beskrivelse,
        versjon: body.versjon ?? eksisterende.versjon,
        steg: Array.isArray(body.steg) ? body.steg : eksisterende.steg,
        redigering: body.redigering ? { ...eksisterende.redigering, ...body.redigering } : eksisterende.redigering,
        syntetisk: true
      });
      liste[listeIndeks] = oppdatertProsess;
      await lagreProsessdefinisjoner(tilstand);
      await leggTilRevisjon({
        sporingsId: newId("flyt"),
        handling: "PROSESS_OPPDATERT",
        ressurs: "prosess",
        aktor: { type: "utvikler", id: "prosessbygger" }
      });
      jsonResponse(response, 200, oppdatertProsess);
    }
  },
  {
    metode: "POST",
    sti: "/api/prosessoekter",
    handter: async ({ request, response, tilstand }) => {
      const body = await readRequestBody(request);
      const prosess = tilstand.prosesser.find((kandidat: any) => kandidat.id === body.prosessId) || null;
      const person = finnPerson(tilstand, body.personId);
      if (!prosess || !person) {
        jsonResponse(response, 404, { feil: "Fant ikke prosess eller person." });
        return;
      }
      const nyOekt: Prosessoekt = {
        oektsId: newId("oekt"),
        prosessId: prosess.id,
        personId: person.personId,
        sporingsId: body.sporingsId || newId("flyt"),
        status: "AKTIV",
        stegIndex: 0,
        svar: {},
        resultater: {},
        aktivtSamtykkeId: null,
        opprettet: new Date().toISOString(),
        oppdatert: new Date().toISOString(),
        syntetisk: true
      };
      tilstand.prosessoekter.push(nyOekt);
      await lagreProsessoekter(tilstand.prosessoekter);
      await leggTilRevisjon({
        sporingsId: nyOekt.sporingsId,
        handling: "PROSESSOEKT_OPPRETTET",
        ressurs: "prosessoekt",
        aktor: { type: "testbruker", id: nyOekt.personId }
      });
      jsonResponse(response, 201, byggProsessoektRespons(nyOekt, prosess));
    }
  },
  {
    metode: "GET",
    sti: "/api/prosessoekter/:oektsId",
    handter: ({ response, parametere, tilstand }) => {
      const oekt = finnProsessoekt(tilstand, parametere.oektsId);
      if (!oekt) {
        jsonResponse(response, 404, { feil: "Fant ikke prosessøkt." });
        return;
      }
      jsonResponse(response, 200, byggProsessoektRespons(oekt, finnProsess(tilstand, oekt.prosessId)));
    }
  },
  {
    metode: "POST",
    sti: "/api/prosessoekter/:oektsId/svar",
    handter: async ({ request, response, parametere, tilstand }) => {
      const body = await readRequestBody(request);
      const oekt = finnProsessoekt(tilstand, parametere.oektsId);
      if (!oekt) {
        jsonResponse(response, 404, { feil: "Fant ikke prosessøkt." });
        return;
      }
      const prosess = finnProsess(tilstand, oekt.prosessId);
      const steg = prosess?.steg?.[oekt.stegIndex];
      if (!steg) {
        jsonResponse(response, 400, { feil: "Fant ikke aktivt steg." });
        return;
      }
      oekt.svar[body.stegId || steg.id] = body.svar;
      oekt.oppdatert = new Date().toISOString();
      await lagreProsessoekter(tilstand.prosessoekter);
      await leggTilRevisjon({
        sporingsId: oekt.sporingsId,
        handling: "STEG_SVAR_LAGRET",
        ressurs: "prosessoekt",
        aktor: { type: "testbruker", id: oekt.personId }
      });
      jsonResponse(response, 200, byggProsessoektRespons(oekt, prosess));
    }
  },
  {
    metode: "POST",
    sti: "/api/prosessoekter/:oektsId/handling",
    handter: async ({ request, response, parametere, tilstand }) => {
      const body = await readRequestBody(request);
      const oekt = finnProsessoekt(tilstand, parametere.oektsId);
      if (!oekt) {
        jsonResponse(response, 404, { feil: "Fant ikke prosessøkt." });
        return;
      }
      const prosess = finnProsess(tilstand, oekt.prosessId);
      const resultat = await utforStegHandling(tilstand, oekt, prosess, body);
      oekt.oppdatert = new Date().toISOString();
      await lagreProsessoekter(tilstand.prosessoekter);
      jsonResponse(response, 200, {
        oekt: byggProsessoektRespons(oekt, prosess),
        resultat
      });
    }
  },
  {
    metode: "POST",
    sti: "/api/prosessoekter/:oektsId/neste",
    handter: async ({ response, parametere, tilstand }) => {
      const oekt = finnProsessoekt(tilstand, parametere.oektsId);
      if (!oekt) {
        jsonResponse(response, 404, { feil: "Fant ikke prosessøkt." });
        return;
      }
      if (oekt.status === "AVVIST" || oekt.status === "FULLFORT") {
        jsonResponse(response, 400, { feil: "Prosessøkten er avsluttet og kan ikke fortsette." });
        return;
      }
      const prosess = finnProsess(tilstand, oekt.prosessId);
      if (oekt.stegIndex >= prosess.steg.length - 1) {
        jsonResponse(response, 400, { feil: "Prosessøkten er allerede på siste steg." });
        return;
      }
      oekt.stegIndex += 1;
      oekt.oppdatert = new Date().toISOString();
      await lagreProsessoekter(tilstand.prosessoekter);
      jsonResponse(response, 200, byggProsessoektRespons(oekt, prosess));
    }
  },
  {
    metode: "POST",
    sti: "/api/prosessoekter/:oektsId/forrige",
    handter: async ({ response, parametere, tilstand }) => {
      const oekt = finnProsessoekt(tilstand, parametere.oektsId);
      if (!oekt) {
        jsonResponse(response, 404, { feil: "Fant ikke prosessøkt." });
        return;
      }
      const prosess = finnProsess(tilstand, oekt.prosessId);
      if (oekt.stegIndex <= 0) {
        jsonResponse(response, 400, { feil: "Prosessøkten er allerede på første steg." });
        return;
      }
      oekt.stegIndex -= 1;
      oekt.oppdatert = new Date().toISOString();
      await lagreProsessoekter(tilstand.prosessoekter);
      jsonResponse(response, 200, byggProsessoektRespons(oekt, prosess));
    }
  },
  {
    metode: "POST",
    sti: "/api/soknader",
    handter: async ({ request, response, tilstand }) => {
      const body = await readRequestBody(request);
      jsonResponse(response, 201, await opprettSoknad(tilstand, body));
    }
  },
  {
    metode: "GET",
    sti: "/api/soknader/:soknadId",
    handter: ({ response, parametere, tilstand }) => {
      const soknad = tilstand.soknader.find((kandidat: any) => kandidat.soknadId === parametere.soknadId);
      jsonResponse(response, soknad ? 200 : 404, soknad || { feil: "Fant ikke søknad." });
    }
  },
  {
    metode: "GET",
    sti: "/api/revisjonslogg",
    handter: ({ response, tilstand }) => {
      jsonResponse(response, 200, tilstand.revisjonslogg);
    }
  },
  {
    // Used by fiks-simulator so this service stays the only writer.
    metode: "POST",
    sti: "/api/revisjonslogg",
    handter: async ({ request, response }) => {
      const hendelse = await readRequestBody(request);
      if (!hendelse.handling) {
        jsonResponse(response, 400, { feil: "Revisjonshendelse mangler handling." });
        return;
      }
      await leggTilRevisjon(hendelse);
      jsonResponse(response, 201, { status: "registrert", syntetisk: true });
    }
  },
  {
    metode: "GET",
    sti: "/api/revisjonslogg/:sporingsId",
    handter: ({ response, parametere, tilstand }) => {
      jsonResponse(response, 200, tilstand.revisjonslogg.filter((rad: any) => rad.sporingsId === parametere.sporingsId));
    }
  }
];

// Patterns are compiled once at module load, not per request.
const kompilerte = [...systemruter, ...ruter].map((rute) => ({
  rute,
  monster: compilePathPattern(rute.sti)
}));

function findRoute(metode: string, sti: string): { rute: Rute; parametere: PathParams } | null {
  for (const { rute, monster } of kompilerte) {
    if (rute.metode !== metode) continue;
    const parametere = matchPath(monster, sti);
    if (parametere) {
      return { rute, parametere };
    }
  }
  return null;
}

const systemstier = new Set(systemruter.map((rute) => rute.sti));

export async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url!, `http://${request.headers.host}`);

  if (request.method === "OPTIONS") {
    jsonResponse(response, 204, {});
    return;
  }

  try {
    const treff = findRoute(request.method!, url.pathname);

    // System routes answer without state, so /helse still works if a dataset
    // is corrupt.
    if (treff && systemstier.has(treff.rute.sti)) {
      await treff.rute.handter({ request, response, url, parametere: treff.parametere, tilstand: null });
      return;
    }

    const tilstand = await readState();

    if (treff) {
      await treff.rute.handter({ request, response, url, parametere: treff.parametere, tilstand });
      return;
    }

    // No orchestration route matched: try the shared resource catalog, which the
    // process engine consults in exactly the same way.
    if (finnRessurs(request.method!, url.pathname)) {
      const data = await utforRessurs(tilstand, request.method!, url, {
        sporingsId: hentSporingsId(url)
      });
      jsonResponse(response, 200, data);
      return;
    }

    jsonResponse(response, 404, { feil: "Fant ikke endepunkt." });
  } catch (error) {
    jsonResponse(response, statusFor(error), errorBody(error));
  }
}

export { HttpError, ruter, systemruter };
