import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { errorBody, headersFor, HttpError, statusFor } from "./errors.ts";
import { readRequestBody, svarhjelpere } from "../../shared/http.ts";

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
} from "../../shared/handleevne.ts";
import { openapiFile } from "./config.ts";
import { routeOverview } from "../../shared/openapi.ts";
import {
  buildProsessoektRespons,
  createSoknad,
  normaliserValgsvar,
  resultaterNaa,
  runStegHandling
} from "./prosess.ts";
import { findRessurs, ressurskatalog, runRessurs } from "./ressurser.ts";
import { addRevisjon } from "./revisjon.ts";
import { compilePathPattern, matchPath, type PathParams } from "./routing.ts";
import { readForsendelsesstatus } from "./svarut.ts";
import type { ProsessDefinisjon, Prosessoekt, State } from "./types.ts";
import {
  SEED_DATASETS,
  isMalProsess,
  findPerson,
  findProsess,
  findProsessIKatalog,
  findProsessoekt,
  getProsesserForVisning,
  updateProsesskatalog,
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
   * "egne-data" - so a route added during the hackathon is protected unless someone
   * opens it on purpose. Failing closed is the only default that survives a rush.
   */
  tilgang?: Tilgang;
  /** Scope a machine caller must hold. Defaults to SCOPE_LES. */
  scope?: string;
  /**
   * Whose data this route touches, for the pid binding. Returning null means the
   * route has no single subject - and then the handler must narrow the answer to
   * the caller itself. See the Tilgang docs in autentisering.ts.
   *
   * Runs after readState(), so it can look the subject up.
   */
  finnPersonId?: (kontekst: Omit<Kontekst, "kaller">) => string | null | Promise<string | null>;
  handter: (kontekst: Kontekst) => Promise<void> | void;
};

// --- who a route is about -------------------------------------------------

// A prosessoekt belongs to a person. Binding the token to the session's owner is
// the second half of the pid binding - without it the process path stays open even
// though the direct HTTP path is closed, because a SJEKK step runs with
// session.personId regardless of who asked.
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

// --- the økt contract, in one place ----------------------------------------

/**
 * Every route on one prosessoekt goes through here: lookup, 404, 409,
 * oppdatert-stamp and save have one owner, so one drift surface.
 *
 * `krevAapen` is the guard: an AVVIST or FULLFORT økt takes no further svar,
 * handling or navigation - a replayed POST /handling on a FULLFORT økt would
 * otherwise run the SUBMIT handler again and produce a duplicate søknad and a
 * new Fiks task per call. Reads pass `krevAapen: false` - demo-gui renders
 * finished and rejected økter, and a rejection you cannot look at afterwards
 * would be worse than the replay this closes.
 *
 * `lagre: false` is for those same reads: a GET must not touch `oppdatert` or
 * the write queue.
 *
 * `fn` is the handler's single mutation. Returning nothing answers with the
 * plain økt response; returning a value answers `{ oekt, resultat }`, which is
 * the published shape of POST /handling. Domain errors inside `fn` are thrown
 * as HttpError and reach the client before anything is saved.
 */
async function withSession(
  { response, parametere, tilstand, kaller }: Pick<Kontekst, "response" | "parametere" | "tilstand" | "kaller">,
  { krevAapen = true, lagre = true, loggGjenlesing = false }:
    { krevAapen?: boolean; lagre?: boolean; loggGjenlesing?: boolean },
  fn: (session: Prosessoekt, prosess: ProsessDefinisjon) => Promise<unknown> | unknown
) {
  const session = findProsessoekt(tilstand, parametere.oektsId);
  if (!session) {
    throw new HttpError("Fant ikke prosessøkt.", 404);
  }
  if (krevAapen && (session.status === "AVVIST" || session.status === "FULLFORT")) {
    throw new HttpError("Prosessøkten er avsluttet og kan ikke fortsette.", 400);
  }
  // The prosessbygger can delete a published process while an økt is mid-flow,
  // and then the økt points at nothing. 409 says what actually happened.
  const prosess = findProsess(tilstand, session.prosessId);
  if (!prosess) {
    throw new HttpError(`Prosessøkten peker på prosessen ${session.prosessId}, som ikke finnes lenger.`, 409);
  }
  const resultat = await fn(session, prosess);
  if (lagre) {
    session.oppdatert = new Date().toISOString();
    await lagreProsessoekt(session);
  }
  // Porten gjelder også når økten svarer med det den hentet tidligere. Et trukket
  // eller utløpt samtykke tar resultatet ut av svaret, her og ikke per rute.
  const { resultater, gjenlest } = resultaterNaa(tilstand, session, prosess, kaller);
  if (loggGjenlesing) {
    await loggGjenleste(tilstand, session, gjenlest, kaller);
  }
  const oektSvar = buildProsessoektRespons(session, prosess, resultater);
  jsonResponse(response, 200, resultat === undefined ? oektSvar : { oekt: oektSvar, resultat });
}

/*
 * GET-ruten svarer med det DATA_FETCH-stegene hentet, og det er en datatilgang.
 * Én rad per kilde per økt, ikke per henting: agentsløyfa poller denne ruten, og
 * addRevisjon skriver hele revisjonsloggen om igjen inne i den delte skrivekøen.
 */
async function loggGjenleste(
  tilstand: State,
  session: Prosessoekt,
  gjenlest: string[],
  kaller: Caller
) {
  const alleredeLogget = new Set(
    (tilstand.revisjonslogg || [])
      .filter((rad: any) => rad.sporingsId === session.sporingsId && rad.formaal === GJENLESING)
      .map((rad: any) => rad.ressurs)
  );
  for (const kilde of gjenlest) {
    if (alleredeLogget.has(kilde)) continue;
    await addRevisjon({
      sporingsId: session.sporingsId,
      handling: "DATA_LES",
      ressurs: kilde,
      formaal: GJENLESING,
      aktor: aktorFor(kaller, session.personId)
    });
  }
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
    // Den samme spesifikasjonen, lest. Se kommentaren i tools-api.
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
    // without a token - a deliberate line, not an oversight. Do not "fix" it.
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
    handter: async ({ request, response }) => {
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
      // The duplicate check belongs inside the queue, next to the append: run
      // against the request's own copy of the katalog and two saves at once both
      // pass it, and one of them is then written away.
      await updateProsesskatalog((katalog) => {
        if (findProsessIKatalog(katalog, nyProsess.id)) {
          throw new HttpError("Prosess med samme id finnes allerede.", 409);
        }
        (isMalProsess(nyProsess) ? katalog.maler : katalog.prosesser).push(nyProsess);
      });
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
      // The response key stays `fil` - it is published wire format; only the
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
    handter: async ({ request, response, parametere }) => {
      const body = await readBodyOnce(request);
      // Lookup, merge and write all happen against the same fresh read: the
      // prosessbygger sends the whole prosess, so a merge onto a stale copy
      // would silently undo whatever the other save had just added.
      const oppdatertProsess = await updateProsesskatalog((katalog) => {
        const plassering = findProsessIKatalog(katalog, parametere.prosessId);
        if (!plassering) {
          throw new HttpError("Fant ikke prosess.", 404);
        }
        const { liste, indeks } = plassering;
        const eksisterende = liste[indeks];
        const ny = normalizeProsess({
          ...eksisterende,
          navn: body.navn ?? eksisterende.navn,
          beskrivelse: body.beskrivelse ?? eksisterende.beskrivelse,
          versjon: body.versjon ?? eksisterende.versjon,
          steg: Array.isArray(body.steg) ? body.steg : eksisterende.steg,
          redigering: body.redigering ? { ...eksisterende.redigering, ...body.redigering } : eksisterende.redigering,
          syntetisk: true
        });
        liste[indeks] = ny;
        return ny;
      });
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
      const newSession: Prosessoekt = {
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
      tilstand.prosessoekter.push(newSession);
      await lagreProsessoekt(newSession);
      await addRevisjon({
        sporingsId: newSession.sporingsId,
        handling: "PROSESSOEKT_OPPRETTET",
        ressurs: "prosessoekt",
        aktor: aktorFor(kaller, newSession.personId)
      });
      jsonResponse(response, 201, buildProsessoektRespons(newSession, prosess, newSession.resultater));
    }
  },
  {
    metode: "GET",
    sti: "/api/prosessoekter/:oektsId",
    finnPersonId: eierAvOekt,
    // A read: closed økter stay readable, and nothing is stamped or saved.
    handter: (kontekst) =>
      withSession(kontekst, { krevAapen: false, lagre: false, loggGjenlesing: true }, () => {})
  },
  {
    metode: "POST",
    sti: "/api/prosessoekter/:oektsId/svar",
    finnPersonId: eierAvOekt,
    handter: (kontekst) => withSession(kontekst, {}, async (session, prosess) => {
      const body = await readBodyOnce(kontekst.request);
      const steg = prosess.steg[session.stegIndex];
      if (!steg) {
        throw new HttpError("Fant ikke aktivt steg.", 400);
      }
      // Steget svaret gjelder, ikke nødvendigvis det aktive: ruten har alltid
      // godtatt en stegId. Er den ukjent, er det ingenting å validere mot.
      const stegId = body.stegId || steg.id;
      const maalSteg = prosess.steg.find((kandidat) => kandidat.id === stegId);
      session.svar[stegId] = maalSteg ? normaliserValgsvar(maalSteg, body.svar) : body.svar;
      await addRevisjon({
        sporingsId: session.sporingsId,
        handling: "STEG_SVAR_LAGRET",
        ressurs: "prosessoekt",
        aktor: aktorFor(kontekst.kaller, session.personId)
      });
    })
  },
  {
    metode: "POST",
    sti: "/api/prosessoekter/:oektsId/handling",
    finnPersonId: eierAvOekt,
    handter: (kontekst) => withSession(kontekst, {}, async (session, prosess) => {
      const body = await readBodyOnce(kontekst.request);
      return runStegHandling(kontekst.tilstand, session, prosess, body, kontekst.kaller);
    })
  },
  {
    metode: "POST",
    sti: "/api/prosessoekter/:oektsId/neste",
    finnPersonId: eierAvOekt,
    handter: (kontekst) => withSession(kontekst, {}, (session, prosess) => {
      if (session.stegIndex >= prosess.steg.length - 1) {
        throw new HttpError("Prosessøkten er allerede på siste steg.", 400);
      }
      session.stegIndex += 1;
    })
  },
  {
    metode: "POST",
    sti: "/api/prosessoekter/:oektsId/forrige",
    finnPersonId: eierAvOekt,
    handter: (kontekst) => withSession(kontekst, {}, (session) => {
      if (session.stegIndex <= 0) {
        throw new HttpError("Prosessøkten er allerede på første steg.", 400);
      }
      session.stegIndex -= 1;
    })
  },
  {
    metode: "POST",
    sti: "/api/soknader",
    finnPersonId: personIdFromBody,
    handter: async ({ request, response, kaller }) => {
      const body = await readBodyOnce(request);
      jsonResponse(response, 201, await createSoknad(body, kaller));
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
    /*
     * A thin proxy in front of SvarUt' status-sok, and the reason it exists is
     * the token: the browser holds an ID-porten token for the citizen, and the
     * SvarUt surface takes Maskinporten only. This route is where the
     * municipality's hjemmel meets the citizen's - authorised as the søknad's
     * owner, then asked for on the machine's token.
     *
     * It answers about one forsendelse, the one this søknad's kvittering was
     * sent as. A søknad the citizen does not own is not reachable here, and
     * neither is a forsendelseId they simply guessed.
     */
    metode: "GET",
    sti: "/api/soknader/:soknadId/forsendelse",
    finnPersonId: eierAvSoknad,
    handter: async ({ response, parametere, tilstand }) => {
      const soknad = tilstand.soknader.find((kandidat: any) => kandidat.soknadId === parametere.soknadId);
      if (!soknad) {
        throw new HttpError("Fant ikke søknad.", 404);
      }
      // No forsendelseId is the ordinary case for a søknad from POST
      // /api/soknader, and for one whose kvittering degraded into an advarsel.
      // Neither is an error the citizen made, so the answer says which it is.
      if (!soknad.forsendelseId) {
        throw new HttpError("Søknaden har ingen SvarUt-forsendelse.", 404);
      }
      const status = await readForsendelsesstatus(soknad.forsendelseId);
      if (!status) {
        throw new HttpError("SvarUt kjenner ikke forsendelsen.", 404);
      }
      jsonResponse(response, 200, { ...status, syntetisk: true });
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
    // One sporingsId is one flow. A citizen may read their own - that is the
    // transparency surface demo-gui renders - so the subject is whoever the flow
    // was about. A flow with no person in it is open to any authenticated caller.
    finnPersonId: ({ parametere, tilstand }) =>
      tilstand.prosessoekter.find((session: any) => session.sporingsId === parametere.sporingsId)?.personId
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

// Formålet gjenlesingsradene bærer, brukt både når de skrives og når de telles.
const GJENLESING = "Gjenlesing av prosessøkt";

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
        // never touch tilstand - which is the whole reason they are called before
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
          // A subject we cannot resolve - an unknown oektsId, say - leaves pid null,
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
