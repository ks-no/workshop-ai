import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { errorBody, headersFor, HttpError, statusFor } from "./errors.ts";
import { readRequestBody, svarhjelpere } from "../../shared-ui/http.ts";

import {
  aktorFor,
  classifyKaller,
  requireTilgang,
  manglerHandleevne,
  SCOPE_LES,
  SCOPE_REVISJON,
  type Caller,
  type Tilgang
} from "./autentisering.ts";
// Who may act, and on whose behalf. One module, shared with digdir-mock, so the
// login screen and the process engine cannot disagree about the two thresholds.
import {
  vurderHandleevne,
  finnRepresentanter,
  forklarHandleevne,
  representantPider
} from "./handleevne.ts";
import { openapiFile } from "./config.ts";
import { routeOverview } from "../../shared-ui/openapi.ts";
import { buildProsessoektRespons, createSoknad, runStegHandling } from "./prosess.ts";
import { findRessurs, ressurskatalog, runRessurs } from "./ressurser.ts";
import { addRevisjon } from "./revisjon.ts";
import { compilePathPattern, matchPath, type PathParams } from "./routing.ts";
import type { Prosessoekt, State } from "./types.ts";
import {
  SEED_DATASETS,
  isMalProsess,
  findPerson,
  findProsess,
  findProsessoekt,
  getProsesserForVisning,
  writeProsessdefinisjoner,
  lagreProsessoekt,
  readState,
  normalizeProsess,
  newId
} from "./state.ts";

// Default policy: GET,POST,PUT,OPTIONS and Content-Type,Authorization, on both
// JSON and text responses. Same bytes this service has always sent.
const { jsonResponse, textResponse } = svarhjelpere();

// Hand-written, not generated from the spec: it lists the routes a newcomer
// needs first, not all of them. routeOverview() below serves the complete list.

function docsHtml() {
  return `
  <!doctype html>
  <html lang="nb">
    <head><meta charset="utf-8"><title>Sandbox Backend API</title></head>
    <body style="font-family: Arial, sans-serif; padding: 24px;">
      <h1>Sandbox Backend API</h1>
      <p><a href="/openapi.yaml">Spesifikasjonen</a> · <a href="/openapi-ruter.json">Samme, lest, som JSON</a> · <a href="http://localhost:3001/utforsker">Prøv rutene i API-utforskeren</a></p>
      <ul>
        <li><code>GET /helse</code></li>
        <li><code>GET /api/personer</code></li>
        <li><code>GET /api/prosesser</code></li>
        <li><code>POST /api/prosessoekter</code></li>
        <li><code>GET /api/prosessoekter/{oektsId}</code></li>
        <li><code>POST /api/prosessoekter/{oektsId}/svar</code></li>
        <li><code>POST /api/prosessoekter/{oektsId}/handling</code></li>
        <li><code>POST /api/prosessoekter/{oektsId}/neste</code></li>
        <li><code>POST /api/prosessoekter/{oektsId}/forrige</code></li>
      </ul>
    </body>
  </html>`;
}



type Kontekst = {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  parametere: PathParams;
  tilstand: State;
  /** Who is calling, from the token. See autentisering.ts. */
  kaller: Caller;
};

type Rute = {
  metode: string;
  sti: string;
  /**
   * Which authorisation this route requires. Omitting it means the closed value,
   * "egne-data" — so a route added during the hackathon is protected unless someone
   * opens it on purpose. Failing closed is the only default that survives a rush.
   */
  tilgang?: Tilgang;
  /** Scope a machine caller must hold. Defaults to SCOPE_LES. */
  scope?: string;
  /**
   * Whose data this route touches, for the pid binding. Returning null means the
   * route has no single subject — and then the handler must narrow the answer to
   * the caller itself. See the Tilgang docs in autentisering.ts.
   *
   * Runs after readState(), so it can look the subject up.
   */
  finnPersonId?: (kontekst: Omit<Kontekst, "kaller">) => string | null | Promise<string | null>;
  handter: (kontekst: Kontekst) => Promise<void> | void;
};

// --- who a route is about -------------------------------------------------

// A prosessoekt belongs to a person. Binding the token to the session's owner is
// the second half of the pid binding — without it the process path stays open even
// though the direct HTTP path is closed, because a SJEKK step runs with
// oekt.personId regardless of who asked.
function eierAvOekt({ parametere, tilstand }: { parametere: PathParams; tilstand: State }) {
  return findProsessoekt(tilstand, parametere.oektsId)?.personId ?? null;
}

function eierAvSoknad({ parametere, tilstand }: { parametere: PathParams; tilstand: State }) {
  return tilstand.soknader.find((s: any) => s.soknadId === parametere.soknadId)?.personId ?? null;
}

// A POST that creates something names its own subject in the body. Read once here
// rather than in each handler, so the check happens before the write.
async function personIdFromBody({ request }: { request: IncomingMessage }) {
  return (await readBodyOnce(request))?.personId ?? null;
}

// readRequestBody consumes the stream, so a route whose subject comes from the body
// would otherwise find it empty by the time the handler runs. Parse once, cache on
// the request, and let both the check and the handler read the same object.
const bodyCache = new WeakMap<IncomingMessage, any>();

async function readBodyOnce(request: IncomingMessage): Promise<any> {
  if (!bodyCache.has(request)) {
    // The one place readRequestBody is still called. Everything else goes through
    // this cache, so the stream is consumed exactly once per request.
    bodyCache.set(request, await readRequestBody(request));
  }
  return bodyCache.get(request);
}

function getSporingsId(url: URL) {
  return url.searchParams.get("sporingsId") || newId("flyt");
}

// --- system routes: answer without reading state --------------------------

// A health probe that needs credentials cannot tell you the service is unhealthy,
// and documentation is not data. All three are open.
const systemruter: Rute[] = [
  {
    metode: "GET",
    tilgang: "aapen",
    sti: "/helse",
    handter: ({ response }) => {
      jsonResponse(response, 200, { status: "ok", tjeneste: "sandbox-backend", tidspunkt: new Date().toISOString() });
    }
  },
  {
    metode: "GET",
    tilgang: "aapen",
    sti: "/docs",
    handter: ({ response }) => {
      textResponse(response, 200, docsHtml());
    }
  },
  {
    metode: "GET",
    tilgang: "aapen",
    sti: "/openapi.yaml",
    handter: async ({ response }) => {
      textResponse(response, 200, await readFile(openapiFile, "utf8"), "text/yaml; charset=utf-8");
    }
  },
  {
    metode: "GET",
    tilgang: "aapen",
    sti: "/openapi-ruter.json",
    // Den samme spesifikasjonen, lest. En nettleser kan ikke lese YAML uten en
    // parser, og sandkassen har ingen — så tjenesten leser sin egen fil og svarer
    // med det API-utforskeren trenger for å rendre et skjema per rute.
    handter: async ({ response }) => {
      jsonResponse(response, 200, await routeOverview(openapiFile));
    }
  }
];

// --- routes that need state -----------------------------------------------

const ruter: Rute[] = [
  {
    metode: "GET",
    sti: "/api/personer",
    // No single subject, so the handler narrows instead: an innbygger sees only
    // themselves. That is how demo-gui learns who it is logged in as, and it is
    // why a citizen token cannot be used to enumerate the population here.
    handter: ({ response, tilstand, kaller }) => {
      // visningsnavn saves every client from assembling the name itself.
      const alle = tilstand.personer.map((person: any) => ({
        ...person,
        visningsnavn: [person.navn.fornavn, person.navn.mellomnavn, person.navn.etternavn]
          .filter(Boolean).join(" ")
      }));
      const visible = kaller.type === "innbygger"
        ? alle.filter((person: any) => person.syntetiskFodselsnummer === kaller.pid)
        : alle;
      jsonResponse(response, 200, visible);
    }
  },
  {
    metode: "GET",
    tilgang: "aapen",
    sti: "/api/regler/satser",
    handter: ({ response, tilstand }) => {
      jsonResponse(response, 200, tilstand.satser);
    }
  },
  {
    metode: "GET",
    // Open because process definitions are not person data. They are the
    // workshop's raw material, and the prosessbygger reads and writes them
    // without a token — a deliberate line, not an oversight. Do not "fix" it.
    tilgang: "aapen",
    sti: "/api/prosesser",
    handter: ({ response, url, tilstand }) => {
      const inkluderMaler = url.searchParams.get("inkluderMaler") === "true";
      jsonResponse(response, 200, getProsesserForVisning(tilstand, inkluderMaler));
    }
  },
  {
    metode: "POST",
    tilgang: "aapen",
    sti: "/api/prosesser",
    handter: async ({ request, response, tilstand }) => {
      const body = await readBodyOnce(request);
      const nyProsess = normalizeProsess({
        id: body.id || newId("prosess"),
        navn: body.navn || "Ny prosess",
        beskrivelse: body.beskrivelse || "Prosess opprettet i prosessbyggeren.",
        versjon: body.versjon || "0.1.0",
        steg: Array.isArray(body.steg) ? body.steg : [],
        redigering: body.redigering || {},
        syntetisk: true
      });
      const allProsesser = getProsesserForVisning(tilstand, true);
      if (allProsesser.some((prosess: any) => prosess.id === nyProsess.id)) {
        jsonResponse(response, 409, { feil: "Prosess med samme id finnes allerede." });
        return;
      }
      if (isMalProsess(nyProsess)) {
        tilstand.prosessMaler.push(nyProsess);
      } else {
        tilstand.prosesser.push(nyProsess);
      }
      await writeProsessdefinisjoner(tilstand);
      await addRevisjon({
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
    tilgang: "aapen",
    sti: "/api/katalog/datasett",
    handter: ({ response }) => {
      // Built from state.ts's SEED_DATASETS, not from a literal here: the literal
      // listed four of eleven and hid the data three of the five cases run on.
      // The response key stays `fil` — it is published wire format; only the
      // constant's own property is English.
      jsonResponse(
        response,
        200,
        SEED_DATASETS.map(({ id, file }) => ({ id, fil: `data/${file}`, syntetisk: true }))
      );
    }
  },
  {
    metode: "GET",
    tilgang: "aapen",
    sti: "/api/katalog/informasjonsmodeller",
    handter: ({ response, tilstand }) => {
      jsonResponse(response, 200, tilstand.informasjonsmodeller);
    }
  },
  {
    // Lets whoever writes a DATA_FETCH or SJEKK step look up which URLs exist
    // instead of guessing.
    metode: "GET",
    tilgang: "aapen",
    sti: "/api/katalog/ressurser",
    handter: ({ response }) => {
      jsonResponse(response, 200, ressurskatalog());
    }
  },
  {
    metode: "GET",
    sti: "/api/personer/:personId/soknader",
    finnPersonId: ({ parametere }) => parametere.personId,
    handter: ({ response, parametere, tilstand }) => {
      jsonResponse(response, 200, tilstand.soknader.filter((soknad: any) => soknad.personId === parametere.personId));
    }
  },
  {
    metode: "GET",
    tilgang: "aapen",
    sti: "/api/prosesser/:prosessId",
    handter: ({ response, parametere, tilstand }) => {
      const prosess = findProsess(tilstand, parametere.prosessId);
      jsonResponse(response, prosess ? 200 : 404, prosess || { feil: "Fant ikke prosess." });
    }
  },
  {
    metode: "PUT",
    tilgang: "aapen",
    sti: "/api/prosesser/:prosessId",
    handter: async ({ request, response, parametere, tilstand }) => {
      const body = await readBodyOnce(request);
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
      const oppdatertProsess = normalizeProsess({
        ...eksisterende,
        navn: body.navn ?? eksisterende.navn,
        beskrivelse: body.beskrivelse ?? eksisterende.beskrivelse,
        versjon: body.versjon ?? eksisterende.versjon,
        steg: Array.isArray(body.steg) ? body.steg : eksisterende.steg,
        redigering: body.redigering ? { ...eksisterende.redigering, ...body.redigering } : eksisterende.redigering,
        syntetisk: true
      });
      liste[listeIndeks] = oppdatertProsess;
      await writeProsessdefinisjoner(tilstand);
      await addRevisjon({
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
    // You may start a process for yourself. The subject is in the body.
    finnPersonId: personIdFromBody,
    handter: async ({ request, response, tilstand, kaller }) => {
      const body = await readBodyOnce(request);
      const prosess = tilstand.prosesser.find((kandidat: any) => kandidat.id === body.prosessId) || null;
      const person = findPerson(tilstand, body.personId);
      if (!prosess || !person) {
        jsonResponse(response, 404, { feil: "Fant ikke prosess eller person." });
        return;
      }
      // Being the party to a case is not the same as being able to send one. A
      // three-year-old is a party to their own kindergarten application; the parent
      // is the sender. The sandbox listed all 394 test people as ID-porten users,
      // 65 of them under 13, so this was reachable - and everything downstream
      // (consent, audit, purpose limitation) rests on the sender being someone who
      // may answer.
      const handleevne = vurderHandleevne(person, tilstand.satser.gjelderFra);
      const representanter = finnRepresentanter(
        { personer: tilstand.personer },
        person.personId,
        tilstand.satser.gjelderFra
      );
      const kallerErRepresentant =
        kaller.type === "system" ||
        (kaller.type === "innbygger" &&
          representantPider(tilstand, person.personId, tilstand.satser.gjelderFra)
            .includes(kaller.pid));
      if (!handleevne.kanOpptreSelv && !kallerErRepresentant) {
        throw manglerHandleevne(forklarHandleevne(handleevne, representanter));
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
      await lagreProsessoekt(nyOekt);
      await addRevisjon({
        sporingsId: nyOekt.sporingsId,
        handling: "PROSESSOEKT_OPPRETTET",
        ressurs: "prosessoekt",
        aktor: aktorFor(kaller, nyOekt.personId)
      });
      jsonResponse(response, 201, buildProsessoektRespons(nyOekt, prosess));
    }
  },
  {
    metode: "GET",
    sti: "/api/prosessoekter/:oektsId",
    finnPersonId: eierAvOekt,
    handter: ({ response, parametere, tilstand }) => {
      const oekt = findProsessoekt(tilstand, parametere.oektsId);
      if (!oekt) {
        jsonResponse(response, 404, { feil: "Fant ikke prosessøkt." });
        return;
      }
      jsonResponse(response, 200, buildProsessoektRespons(oekt, findProsess(tilstand, oekt.prosessId)));
    }
  },
  {
    metode: "POST",
    sti: "/api/prosessoekter/:oektsId/svar",
    finnPersonId: eierAvOekt,
    handter: async ({ request, response, parametere, tilstand, kaller }) => {
      const body = await readBodyOnce(request);
      const oekt = findProsessoekt(tilstand, parametere.oektsId);
      if (!oekt) {
        jsonResponse(response, 404, { feil: "Fant ikke prosessøkt." });
        return;
      }
      const prosess = findProsess(tilstand, oekt.prosessId);
      const steg = prosess?.steg?.[oekt.stegIndex];
      if (!steg) {
        jsonResponse(response, 400, { feil: "Fant ikke aktivt steg." });
        return;
      }
      oekt.svar[body.stegId || steg.id] = body.svar;
      oekt.oppdatert = new Date().toISOString();
      await lagreProsessoekt(oekt);
      await addRevisjon({
        sporingsId: oekt.sporingsId,
        handling: "STEG_SVAR_LAGRET",
        ressurs: "prosessoekt",
        aktor: aktorFor(kaller, oekt.personId)
      });
      jsonResponse(response, 200, buildProsessoektRespons(oekt, prosess));
    }
  },
  {
    metode: "POST",
    sti: "/api/prosessoekter/:oektsId/handling",
    finnPersonId: eierAvOekt,
    handter: async ({ request, response, parametere, tilstand, kaller }) => {
      const body = await readBodyOnce(request);
      const oekt = findProsessoekt(tilstand, parametere.oektsId);
      if (!oekt) {
        jsonResponse(response, 404, { feil: "Fant ikke prosessøkt." });
        return;
      }
      const prosess = findProsess(tilstand, oekt.prosessId);
      // The prosessbygger can delete a published process while an økt is mid-flow,
      // and then the økt points at nothing. The old `any` let that reach
      // runStegHandling and crash on prosess.steg; 409 says what actually happened.
      if (!prosess) {
        jsonResponse(response, 409, {
          feil: `Prosessøkten peker på prosessen ${oekt.prosessId}, som ikke finnes lenger.`
        });
        return;
      }
      const resultat = await runStegHandling(tilstand, oekt, prosess, body, kaller);
      oekt.oppdatert = new Date().toISOString();
      await lagreProsessoekt(oekt);
      jsonResponse(response, 200, {
        oekt: buildProsessoektRespons(oekt, prosess),
        resultat
      });
    }
  },
  {
    metode: "POST",
    sti: "/api/prosessoekter/:oektsId/neste",
    finnPersonId: eierAvOekt,
    handter: async ({ response, parametere, tilstand }) => {
      const oekt = findProsessoekt(tilstand, parametere.oektsId);
      if (!oekt) {
        jsonResponse(response, 404, { feil: "Fant ikke prosessøkt." });
        return;
      }
      if (oekt.status === "AVVIST" || oekt.status === "FULLFORT") {
        jsonResponse(response, 400, { feil: "Prosessøkten er avsluttet og kan ikke fortsette." });
        return;
      }
      const prosess = findProsess(tilstand, oekt.prosessId);
      if (!prosess) {
        jsonResponse(response, 409, {
          feil: `Prosessøkten peker på prosessen ${oekt.prosessId}, som ikke finnes lenger.`
        });
        return;
      }
      if (oekt.stegIndex >= prosess.steg.length - 1) {
        jsonResponse(response, 400, { feil: "Prosessøkten er allerede på siste steg." });
        return;
      }
      oekt.stegIndex += 1;
      oekt.oppdatert = new Date().toISOString();
      await lagreProsessoekt(oekt);
      jsonResponse(response, 200, buildProsessoektRespons(oekt, prosess));
    }
  },
  {
    metode: "POST",
    sti: "/api/prosessoekter/:oektsId/forrige",
    finnPersonId: eierAvOekt,
    handter: async ({ response, parametere, tilstand }) => {
      const oekt = findProsessoekt(tilstand, parametere.oektsId);
      if (!oekt) {
        jsonResponse(response, 404, { feil: "Fant ikke prosessøkt." });
        return;
      }
      const prosess = findProsess(tilstand, oekt.prosessId);
      if (oekt.stegIndex <= 0) {
        jsonResponse(response, 400, { feil: "Prosessøkten er allerede på første steg." });
        return;
      }
      oekt.stegIndex -= 1;
      oekt.oppdatert = new Date().toISOString();
      await lagreProsessoekt(oekt);
      jsonResponse(response, 200, buildProsessoektRespons(oekt, prosess));
    }
  },
  {
    metode: "POST",
    sti: "/api/soknader",
    finnPersonId: personIdFromBody,
    handter: async ({ request, response, tilstand, kaller }) => {
      const body = await readBodyOnce(request);
      jsonResponse(response, 201, await createSoknad(tilstand, body, kaller));
    }
  },
  {
    metode: "GET",
    sti: "/api/soknader/:soknadId",
    finnPersonId: eierAvSoknad,
    handter: ({ response, parametere, tilstand }) => {
      const soknad = tilstand.soknader.find((kandidat: any) => kandidat.soknadId === parametere.soknadId);
      jsonResponse(response, soknad ? 200 : 404, soknad || { feil: "Fant ikke søknad." });
    }
  },
  {
    metode: "GET",
    // The whole log, across every person. No citizen token can justify that,
    // however high the acr.
    tilgang: "bred",
    sti: "/api/revisjonslogg",
    handter: ({ response, tilstand }) => {
      jsonResponse(response, 200, tilstand.revisjonslogg);
    }
  },
  {
    // Used by fiks-simulator and ai-gateway so this service stays the only writer.
    // Writing an audit event is its own hjemmel, separate from reading person data.
    metode: "POST",
    tilgang: "bred",
    scope: SCOPE_REVISJON,
    sti: "/api/revisjonslogg",
    handter: async ({ request, response }) => {
      const hendelse = await readBodyOnce(request);
      if (!hendelse.handling) {
        jsonResponse(response, 400, { feil: "Revisjonshendelse mangler handling." });
        return;
      }
      await addRevisjon(hendelse);
      jsonResponse(response, 201, { status: "registrert", syntetisk: true });
    }
  },
  {
    metode: "GET",
    sti: "/api/revisjonslogg/:sporingsId",
    // One sporingsId is one flow. A citizen may read their own — that is the
    // transparency surface demo-gui renders — so the subject is whoever the flow
    // was about. A flow with no person in it is open to any authenticated caller.
    finnPersonId: ({ parametere, tilstand }) =>
      tilstand.prosessoekter.find((oekt: any) => oekt.sporingsId === parametere.sporingsId)?.personId
      ?? tilstand.soknader.find((s: any) => s.sporingsId === parametere.sporingsId)?.personId
      ?? null,
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

const systemPaths = new Set(systemruter.map((rute) => rute.sti));

export async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url!, `http://${request.headers.host}`);

  if (request.method === "OPTIONS") {
    jsonResponse(response, 204, {});
    return;
  }

  try {
    const treff = findRoute(request.method!, url.pathname);

    // System routes answer without state, so /helse still works if a dataset
    // is corrupt. They also answer without a token: a health probe that needs
    // credentials cannot tell you the service is unhealthy.
    if (treff && systemPaths.has(treff.rute.sti)) {
      await treff.rute.handter({
        request, response, url, parametere: treff.parametere,
        // The cast states the invariant rather than guessing at it: these are
        // exactly the routes in systemPaths, and they are the only handlers that
        // never touch tilstand — which is the whole reason they are called before
        // readState(). Widening Kontekst.tilstand to `State | null` instead would
        // push a null check into all forty handlers to describe five.
        tilstand: null as unknown as State,
        kaller: { type: "anonym" }
      });
      return;
    }

    // Once per request, before anything reads state. A broken token is a 401 here
    // and never reaches a handler; a missing one is `anonym`, and what that is
    // worth is decided per route and per resource.
    const kaller = await classifyKaller(request);

    const tilstand = await readState();

    if (treff) {
      const routeContext = { request, response, url, parametere: treff.parametere, tilstand };
      const personId = treff.rute.finnPersonId
        ? await treff.rute.finnPersonId(routeContext)
        : null;

      try {
        requireTilgang({
          kaller,
          tilgang: treff.rute.tilgang ?? "egne-data",
          scope: treff.rute.scope ?? SCOPE_LES,
          // A subject we cannot resolve — an unknown oektsId, say — leaves pid null,
          // and the handler then answers 404. Refusing with 403 instead would tell
          // an unauthenticated caller which session ids exist.
          pid: personId
            ? findPerson(tilstand, personId)?.syntetiskFodselsnummer ?? null
            : null,
          representantPider: personId
            ? representantPider(tilstand, personId, tilstand.satser.gjelderFra)
            : [],
          hva: `${treff.rute.metode} ${treff.rute.sti}`
        });
      } catch (feil) {
        await addRevisjon({
          sporingsId: getSporingsId(url),
          handling: "TILGANG_NEKTET",
          ressurs: treff.rute.sti,
          formaal: "Mangler hjemmel",
          ...(personId ? { gjaldt: personId } : {}),
          aktor: aktorFor(kaller, personId)
        });
        throw feil;
      }

      await treff.rute.handter({ ...routeContext, kaller });
      return;
    }

    // No orchestration route matched: try the shared resource catalog, which the
    // process engine consults in exactly the same way.
    if (findRessurs(request.method!, url.pathname)) {
      const data = await runRessurs(tilstand, request.method!, url, {
        sporingsId: getSporingsId(url),
        kaller
      });
      jsonResponse(response, 200, data);
      return;
    }

    jsonResponse(response, 404, { feil: "Fant ikke endepunkt." });
  } catch (error) {
    jsonResponse(response, statusFor(error), errorBody(error), headersFor(error));
  }
}

export { HttpError, ruter, systemruter };
