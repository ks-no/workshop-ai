import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { errorBody, headersFor, HttpError, statusFor } from "./errors.ts";
import {
  docsHtml,
  jsonResponse,
  readRequestBody,
  textResponse
} from "./http.ts";
import {
  aktorFor,
  klassifiserKaller,
  krevTilgang,
  SCOPE_LES,
  SCOPE_REVISJON,
  type Kaller,
  type Tilgang
} from "./autentisering.ts";
import { openapiFile } from "./config.ts";
import { ruteoversikt } from "../../shared-ui/openapi.ts";
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
  /** Who is calling, from the token. See autentisering.ts. */
  kaller: Kaller;
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
  return finnProsessoekt(tilstand, parametere.oektsId)?.personId ?? null;
}

function eierAvSoknad({ parametere, tilstand }: { parametere: PathParams; tilstand: State }) {
  return tilstand.soknader.find((s: any) => s.soknadId === parametere.soknadId)?.personId ?? null;
}

// A POST that creates something names its own subject in the body. Read once here
// rather than in each handler, so the check happens before the write.
async function personIdFraKropp({ request }: { request: IncomingMessage }) {
  return (await lesKroppEnGang(request))?.personId ?? null;
}

// readRequestBody consumes the stream, so a route whose subject comes from the body
// would otherwise find it empty by the time the handler runs. Parse once, cache on
// the request, and let both the check and the handler read the same object.
const kroppCache = new WeakMap<IncomingMessage, any>();

async function lesKroppEnGang(request: IncomingMessage): Promise<any> {
  if (!kroppCache.has(request)) {
    // The one place readRequestBody is still called. Everything else goes through
    // this cache, so the stream is consumed exactly once per request.
    kroppCache.set(request, await readRequestBody(request));
  }
  return kroppCache.get(request);
}

function hentSporingsId(url: URL) {
  return url.searchParams.get("sporingsId") || newId("flyt");
}

// --- system routes: answer without reading state --------------------------

// A health probe that needs credentials cannot tell you the service is unhealthy,
// and documentation is not data. All four are open.
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
    sti: "/health",
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
      jsonResponse(response, 200, await ruteoversikt(openapiFile));
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
      const synlige = kaller.type === "innbygger"
        ? alle.filter((person: any) => person.syntetiskFodselsnummer === kaller.pid)
        : alle;
      jsonResponse(response, 200, synlige);
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
    // Process definitions are not person data. They are the workshop's raw
    // material, and the prosessbygger reads and writes them without a token —
    // a deliberate line, not an oversight. Do not "fix" it.
    tilgang: "aapen",
    sti: "/api/prosesser",
    handter: ({ response, url, tilstand }) => {
      const inkluderMaler = url.searchParams.get("inkluderMaler") === "true";
      jsonResponse(response, 200, hentProsesserForVisning(tilstand, inkluderMaler));
    }
  },
  {
    metode: "POST",
    tilgang: "aapen",
    sti: "/api/prosesser",
    handter: async ({ request, response, tilstand }) => {
      const body = await lesKroppEnGang(request);
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
    tilgang: "aapen",
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
      const prosess = finnProsess(tilstand, parametere.prosessId);
      jsonResponse(response, prosess ? 200 : 404, prosess || { feil: "Fant ikke prosess." });
    }
  },
  {
    metode: "PUT",
    tilgang: "aapen",
    sti: "/api/prosesser/:prosessId",
    handter: async ({ request, response, parametere, tilstand }) => {
      const body = await lesKroppEnGang(request);
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
    // You may start a process for yourself. The subject is in the body.
    finnPersonId: personIdFraKropp,
    handter: async ({ request, response, tilstand, kaller }) => {
      const body = await lesKroppEnGang(request);
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
        aktor: aktorFor(kaller, nyOekt.personId)
      });
      jsonResponse(response, 201, byggProsessoektRespons(nyOekt, prosess));
    }
  },
  {
    metode: "GET",
    sti: "/api/prosessoekter/:oektsId",
    finnPersonId: eierAvOekt,
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
    finnPersonId: eierAvOekt,
    handter: async ({ request, response, parametere, tilstand, kaller }) => {
      const body = await lesKroppEnGang(request);
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
        aktor: aktorFor(kaller, oekt.personId)
      });
      jsonResponse(response, 200, byggProsessoektRespons(oekt, prosess));
    }
  },
  {
    metode: "POST",
    sti: "/api/prosessoekter/:oektsId/handling",
    finnPersonId: eierAvOekt,
    handter: async ({ request, response, parametere, tilstand, kaller }) => {
      const body = await lesKroppEnGang(request);
      const oekt = finnProsessoekt(tilstand, parametere.oektsId);
      if (!oekt) {
        jsonResponse(response, 404, { feil: "Fant ikke prosessøkt." });
        return;
      }
      const prosess = finnProsess(tilstand, oekt.prosessId);
      const resultat = await utforStegHandling(tilstand, oekt, prosess, body, kaller);
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
    finnPersonId: eierAvOekt,
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
    finnPersonId: eierAvOekt,
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
    finnPersonId: personIdFraKropp,
    handter: async ({ request, response, tilstand, kaller }) => {
      const body = await lesKroppEnGang(request);
      jsonResponse(response, 201, await opprettSoknad(tilstand, body, kaller));
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
      const hendelse = await lesKroppEnGang(request);
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
    // is corrupt. They also answer without a token: a health probe that needs
    // credentials cannot tell you the service is unhealthy.
    if (treff && systemstier.has(treff.rute.sti)) {
      await treff.rute.handter({
        request, response, url, parametere: treff.parametere, tilstand: null,
        kaller: { type: "anonym" }
      });
      return;
    }

    // Once per request, before anything reads state. A broken token is a 401 here
    // and never reaches a handler; a missing one is `anonym`, and what that is
    // worth is decided per route and per resource.
    const kaller = await klassifiserKaller(request);

    const tilstand = await readState();

    if (treff) {
      const rutekontekst = { request, response, url, parametere: treff.parametere, tilstand };
      const personId = treff.rute.finnPersonId
        ? await treff.rute.finnPersonId(rutekontekst)
        : null;

      try {
        krevTilgang({
          kaller,
          tilgang: treff.rute.tilgang ?? "egne-data",
          scope: treff.rute.scope ?? SCOPE_LES,
          // A subject we cannot resolve — an unknown oektsId, say — leaves pid null,
          // and the handler then answers 404. Refusing with 403 instead would tell
          // an unauthenticated caller which session ids exist.
          pid: personId
            ? finnPerson(tilstand, personId)?.syntetiskFodselsnummer ?? null
            : null,
          hva: `${treff.rute.metode} ${treff.rute.sti}`
        });
      } catch (feil) {
        await leggTilRevisjon({
          sporingsId: hentSporingsId(url),
          handling: "TILGANG_NEKTET",
          ressurs: treff.rute.sti,
          formaal: "Mangler hjemmel",
          ...(personId ? { gjaldt: personId } : {}),
          aktor: aktorFor(kaller, personId)
        });
        throw feil;
      }

      await treff.rute.handter({ ...rutekontekst, kaller });
      return;
    }

    // No orchestration route matched: try the shared resource catalog, which the
    // process engine consults in exactly the same way.
    if (finnRessurs(request.method!, url.pathname)) {
      const data = await utforRessurs(tilstand, request.method!, url, {
        sporingsId: hentSporingsId(url),
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
