import { createServer } from "node:http";
import { maskinportenHeader } from "../../digdir-mock/src/klient.ts";
import { lagVerifikator, TokenFeil } from "../../digdir-mock/src/verifiser.ts";
// A2's masking, reused rather than reimplemented. fiks-simulator reads
// data/personer.json itself, so it is a second data layer that A2 never covered —
// which is why /fiks/register/person/person-031 handed out a kode 6 person's name
// and street address in full. The repo already carries four masking
// implementations; this makes it three rather than five.
import { maskerHusstand, maskerPerson } from "../../sandbox-backend/src/skjerming.ts";
// Consent has rules now: which statuses exist, what may follow what, and when a
// samtykke has run out. All three live in samtykke.ts so the compiler can hold
// them together — see the comment there.
import { effektivStatus, validerSamtykkeovergang } from "./samtykke.ts";
import { validerOppgaveovergang } from "./oppgave.ts";
import { lagStateLeser, newId, updateJson } from "./state.ts";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// PORT lar testskript starte en isolert instans ved siden av docker compose.
const port = Number(process.env.PORT) || 8081;
const backendBaseUrl = process.env.BACKEND_BASE_URL || "http://sandbox-backend:8080";

// This service is its own resource server, with its own audience. A token minted
// for sandbox-backend is refused here, and that is the point of audience
// restriction: a leaked token has a blast radius.
const digdirBaseUrl = process.env.DIGDIR_BASE_URL || "http://digdir-mock:8086";
const digdirIssuer = process.env.DIGDIR_ISSUER || "http://localhost:8086";
const authEnforce = process.env.AUTH_ENFORCE !== "false";

// The scope Fiks' register surface requires. Real Fiks puts its register APIs
// behind Maskinporten, and so does this.
const SCOPE_REGISTER = "ks:fiks:register";

const verifiserToken = lagVerifikator({
  digdirBaseUrl,
  maskinportenIssuer: digdirIssuer,
  idportenIssuer: `${digdirIssuer}/idporten`,
  audience: "fiks-simulator"
});

// Its only call to the backend is the audit log, so its hjemmel is exactly that
// and nothing more. Three machines, three different scopes, none of them "admin".
const TOKEN = {
  digdirBaseUrl: process.env.DIGDIR_BASE_URL || "http://digdir-mock:8086",
  issuer: process.env.DIGDIR_ISSUER || "http://localhost:8086",
  clientId: "fiks-simulator",
  scope: "ks:innbyggerdialog:revisjon",
  resource: "sandbox-backend"
};

function jsonResponse(response, statusCode, data, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    ...headers
  });
  response.end(JSON.stringify(data, null, 2));
}

function textResponse(response, statusCode, data, contentType = "text/html; charset=utf-8") {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*"
  });
  response.end(data);
}

async function readBody(request) {
  const chunks = [];
  for await (const del of request) {
    chunks.push(del);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

// sandbox-backend owns the audit log. We send events there instead of writing
// the file ourselves, so there is only ever one writer.
//
// Auditing must never break the operation being audited: if the backend is
// unavailable we log locally and carry on.
async function leggTilRevisjon(hendelse) {
  try {
    const svar = await fetch(`${backendBaseUrl}/api/revisjonslogg`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await maskinportenHeader(TOKEN)) },
      body: JSON.stringify(hendelse),
      signal: AbortSignal.timeout(2000)
    });
    if (!svar.ok) {
      throw new Error(`status ${svar.status}`);
    }
  } catch (error) {
    console.warn(`Kunne ikke revisjonslogge mot sandbox-backend: ${error.message}`);
  }
}

// --------------------------------------------------------------------------
// Skatte- og inntektsopplysninger: beregning
//
// Modelled on the KS Fiks register API, beregningstype BARNEHAGE_SFO:
// https://developers.fiks.ks.no/api/register-skatteoginntektsopplysninger-beregning-api-v1.json
//
// The simulator computes the grunnlag. The income thresholds belong to the
// municipality and live in data/satser.json, which sandbox-backend reads.
// --------------------------------------------------------------------------

// Entries excluded from the grunnlag are recorded as ADDERE under inntekt and
// SUBTRAHERE under fradrag. That keeps beregningsbeloep correct while still letting
// the resident see which benefits were left out, and why.
function byggPost(post, identifikator) {
  return {
    tekniskNavn: post.tekniskNavn,
    visningstekst: post.visningstekst,
    operasjon: "ADDERE",
    beloep: post.beloep,
    kilde: post.kilde || "SKATTEETATEN",
    kanEndreVisningstekst: false,
    identifikator,
    ...(post.infotekst ? { infotekst: post.infotekst } : {}),
    ...(post.referanse ? { referanse: post.referanse } : {})
  };
}

function byggBeregning(deltakere) {
  const inntektsposter = [];
  const fradragsposter = [];

  for (const d of deltakere) {
    for (const post of d.poster) {
      inntektsposter.push(byggPost(post, d.identifikator));
      if (!post.medregnes) {
        fradragsposter.push({
          ...byggPost(post, d.identifikator),
          operasjon: "SUBTRAHERE",
          infotekst: post.infotekst || "Inngår ikke i grunnlaget."
        });
      }
    }
  }

  const sum = (poster) => poster.reduce((t, p) => t + p.beloep, 0);
  // TypeApiModel says which of the two child lists is populated: POST for
  // beregningsposter, GRUNNLAG for beregningsgrunnlag. We only build poster.
  const gruppe = (tekniskNavn, visningstekst, operasjon, poster) => ({
    tekniskNavn,
    visningstekst,
    beloep: sum(poster),
    operasjon,
    type: "POST",
    beregningsposter: poster
  });

  const inntekt = {
    beloep: sum(inntektsposter),
    beregning: [gruppe("samletInntekt", "Samlet innrapportert inntekt", "ADDERE", inntektsposter)]
  };
  const fradrag = {
    beloep: sum(fradragsposter),
    beregning: [gruppe("ytelserUtenforGrunnlaget", "Ytelser som ikke inngår i grunnlaget", "SUBTRAHERE", fradragsposter)]
  };

  return { inntekt, fradrag, beregningsbeloep: inntekt.beloep - fradrag.beloep };
}

// One visningspost per income type, with the amount broken down by the people
// behind it. Protected individuals count towards the total, but their share is
// not shown.
function byggVisningsposter(deltakere) {
  const perType = new Map();

  for (const d of deltakere) {
    for (const post of d.poster) {
      if (!post.medregnes) continue;
      if (!perType.has(post.tekniskNavn)) {
        perType.set(post.tekniskNavn, {
          tekniskNavn: post.tekniskNavn,
          visningstekst: post.visningstekst,
          beloep: 0,
          personer: []
        });
      }
      const vp = perType.get(post.tekniskNavn);
      vp.beloep += post.beloep;
      if (d.skjermet) {
        vp.infotekst = "Beløpet inkluderer et husstandsmedlem med skjermet identitet, som ikke kan spesifiseres.";
      } else {
        vp.personer.push({ identifikator: d.identifikator, beloep: post.beloep });
      }
    }
  }

  return [{ kategori: "INNTEKT", poster: [...perType.values()] }];
}

function beregnRedusertForeldrebetaling(body, personer, inntekter) {
  const feilmeldinger = [];
  const inntektsaar = body.inntektsaar;

  if (!Number.isInteger(inntektsaar)) {
    feilmeldinger.push({ kode: "INNTEKTSAAR_MANGLER", melding: "inntektsaar må være et heltall." });
  }
  if (!Array.isArray(body.personer) || body.personer.length === 0) {
    feilmeldinger.push({ kode: "PERSONER_MANGLER", melding: "personer må inneholde minst én person." });
  }
  if (feilmeldinger.length) {
    return { feilmeldinger, deltakere: [], svarPersoner: [] };
  }

  const deltakere = [];
  const svarPersoner = [];

  for (const forespurt of body.personer) {
    // The spec requires ^[0-9]{11}$. Without this check a malformed identifier
    // returned PERSON_IKKE_FUNNET, which wrongly implies it was well-formed.
    if (!/^[0-9]{11}$/.test(String(forespurt.identifikator || ""))) {
      feilmeldinger.push({
        kode: "UGYLDIG_IDENTIFIKATOR",
        melding: `identifikator må være 11 siffer, fikk ${forespurt.identifikator}.`
      });
      continue;
    }

    const type = forespurt.type || "SOEKER";
    if (!["SOEKER", "ANNET"].includes(type)) {
      feilmeldinger.push({
        kode: "UGYLDIG_PERSONTYPE",
        melding: `type må være SOEKER eller ANNET for beregningstype BARNEHAGE_SFO, fikk ${type}.`
      });
      continue;
    }

    const person = personer.find((p) => p.syntetiskFodselsnummer === forespurt.identifikator);
    if (!person) {
      feilmeldinger.push({
        kode: "PERSON_IKKE_FUNNET",
        melding: `Fant ingen person med identifikator ${forespurt.identifikator}.`
      });
      continue;
    }

    const rad = inntekter.find(
      (i) => i.identifikator === forespurt.identifikator && i.inntektsaar === inntektsaar
    );
    const ekstraposter = (forespurt.ekstraposter || []).map((e) => ({
      tekniskNavn: e.tekniskNavn,
      visningstekst: e.visningstekst || e.tekniskNavn,
      beloep: e.beloep,
      kilde: "MANUELL_INPUT",
      medregnes: true,
      referanse: e.referanse
    }));

    if (!rad && ekstraposter.length === 0) {
      feilmeldinger.push({
        kode: "INGEN_SKATTEOPPGJOER_FUNNET",
        melding: `Fant ingen skatteopplysninger for ${forespurt.identifikator} i inntektsåret ${inntektsaar}.`
      });
      continue;
    }

    deltakere.push({
      identifikator: forespurt.identifikator,
      skjermet: Boolean(person.skjermet),
      poster: [...(rad?.poster || []), ...ekstraposter]
    });

    // PersonnavnApiModel types mellomnavn as an optional string, not nullable, so
    // an absent mellomnavn is omitted rather than sent as null.
    const navn = person.navn && {
      fornavn: person.navn.fornavn,
      ...(person.navn.mellomnavn ? { mellomnavn: person.navn.mellomnavn } : {}),
      etternavn: person.navn.etternavn
    };

    svarPersoner.push({
      identifikator: forespurt.identifikator,
      navn: person.skjermet ? undefined : navn,
      type,
      skjermet: Boolean(person.skjermet),
      skatteoppgjoersdato: rad?.skatteoppgjoersdato || undefined,
      stadie: rad?.stadie || "UKJENT",
      registreringstidpunkt: new Date().toISOString()
    });
  }

  return { feilmeldinger, deltakere, svarPersoner };
}

/**
 * Maskinporten on the register surface. Throws a FiksFeil the request handler maps,
 * so the shape is Fiks' own and not sandbox-backend's.
 *
 * Real Fiks would also check which organisation the consumer claim names, and
 * whether that municipality has a data-processing agreement for the register. We
 * check the scope and record the client, which is the part the workshop is about.
 */
class FiksFeil extends Error {
  constructor(melding, status, kode, headers = {}) {
    super(melding);
    this.status = status;
    this.kode = kode;
    this.headers = headers;
  }
}

async function krevRegisterHjemmel(request) {
  if (!authEnforce) return null;

  const header = request.headers.authorization;
  if (!header) {
    throw new FiksFeil(
      "Registerflaten i Fiks krever et Maskinporten-token. " +
      "Hent et med scripts/token.ts --maskinporten ks:fiks:register --resource fiks-simulator.",
      401,
      "MANGLER_TOKEN",
      { "WWW-Authenticate": 'Bearer realm="fiks-simulator", error="invalid_token"' }
    );
  }
  const [ordning, token] = header.split(" ");
  if (!/^bearer$/i.test(ordning || "") || !token) {
    throw new FiksFeil(
      "Authorization-headeren må være på formen «Bearer <token>».",
      401,
      "UGYLDIG_TOKEN",
      { "WWW-Authenticate": 'Bearer realm="fiks-simulator", error="invalid_token"' }
    );
  }

  let verifisert;
  try {
    verifisert = await verifiserToken(token);
  } catch (feil) {
    if (feil instanceof TokenFeil) {
      throw new FiksFeil(feil.message, feil.status, feil.status === 401 ? "UGYLDIG_TOKEN" : "UTSTEDER_NEDE",
        feil.status === 401 ? { "WWW-Authenticate": 'Bearer realm="fiks-simulator", error="invalid_token"' } : {});
    }
    throw feil;
  }

  // A citizen's ID-porten token cannot open a register API. The register is a
  // machine-to-machine surface: the hjemmel belongs to the municipality, not to
  // whoever happens to be logged in.
  if (verifisert.utsteder !== "maskinporten") {
    throw new FiksFeil(
      "Registerflaten er en maskin-til-maskin-flate. Et personlig ID-porten-token " +
      "gir ikke hjemmel her, uansett sikkerhetsnivå.",
      403,
      "KREVER_MASKINPORTEN"
    );
  }

  const scopes = String(verifisert.krav.scope || "").split(" ").filter(Boolean);
  if (!scopes.includes(SCOPE_REGISTER)) {
    throw new FiksFeil(
      `Klienten ${verifisert.krav.client_id} mangler scope ${SCOPE_REGISTER} ` +
      `(har: ${scopes.join(" ") || "ingen"}).`,
      403,
      "MANGLER_SCOPE"
    );
  }

  return {
    clientId: verifisert.krav.client_id || "ukjent",
    consumer: verifisert.krav.consumer?.ID || null
  };
}

// The masking A2 applies in sandbox-backend's readState(), applied here too. Without
// it a machine with register hjemmel still received an address-protected person in
// full, which would undo A2 for anyone who found the route.
function maskertPerson(person) {
  return person ? maskerPerson(person) : person;
}

/**
 * Who acted on a samtykke.
 *
 * The three events are not the same kind of act, and logging one actor for all
 * three was the lie: the *service* asks for consent, the *citizen* answers it and
 * the *citizen* withdraws it. Before this they all said
 * `{ type: "testbruker", id: personId }` — which named the person the consent was
 * about, not who did the thing.
 *
 * SANDBOX SIMPLIFICATION, and it belongs in the same drawer as the unverified
 * client assertion in digdir-mock: for the citizen's own acts, the actor is taken
 * from the request body, because only the caller knows. sandbox-backend supplies it
 * from the verified token it holds.
 *
 * Forwarding the citizen's own token here instead would be the real answer, and it
 * does not work: that token is minted for audience "sandbox-backend" and this
 * service refuses it — correctly. Bridging that needs token exchange (RFC 8693),
 * which is more machinery than the workshop needs. Absent a supplied actor we say
 * what is true: fiks-simulator recorded this, on behalf of someone.
 */
function samtykkeAktor(oppgitt, personId) {
  if (oppgitt && oppgitt.type) {
    return oppgitt;
  }
  return { type: "system", id: "fiks-simulator", ...(personId ? { paaVegneAv: personId } : {}) };
}

/**
 * Turns a refused transition into the answer the caller gets.
 *
 * The state machine decides both the code and the status — 400 for a status that
 * does not exist, 409 for one that cannot be reached from here — so the rule and
 * its HTTP answer stay in one place. See tilstandsmaskin.ts.
 */
function krevOvergang(utfall) {
  if (!utfall.lovlig) {
    throw new FiksFeil(utfall.melding, utfall.status, utfall.kode);
  }
}

/**
 * The one place a samtykke changes status.
 *
 * /svar and /trekk were two near-identical blocks that each did their own lookup,
 * their own mutation and their own write, which is how they ended up with two
 * different notions of what a legal change was: /svar took any string, /trekk
 * took none at all.
 *
 * Lookup, rule check and write all happen inside the queue, against the row as it
 * is on disk right now. Reading it out first and validating against that copy
 * would reintroduce exactly the race the queue exists to close — two answers
 * arriving together would both see VENTER_PAA_SVAR and both be allowed.
 */
async function settSamtykkestatus(samtykkeId, oensket, body) {
  let avvist = null;
  try {
    return await updateJson("samtykker.json", [], (samtykker) => {
      const treff = samtykker.find((kandidat) => kandidat.samtykkeId === samtykkeId);
      if (!treff) {
        throw new FiksFeil("Fant ikke samtykke.", 404, "SAMTYKKE_IKKE_FUNNET");
      }
      // Against the *effective* status, so an expired consent cannot be answered,
      // withdrawn or otherwise edited back into force.
      const utfall = validerSamtykkeovergang(effektivStatus(treff), oensket);
      if (!utfall.lovlig) {
        avvist = {
          personId: treff.personId,
          sporingsId: treff.sporingsId,
          grunnlag: { id: treff.samtykkeId, status: effektivStatus(treff), forsoekt: oensket, kode: utfall.kode }
        };
        krevOvergang(utfall);
      }
      treff.status = oensket;
      treff.historikk = [...(treff.historikk || []), { tidspunkt: new Date().toISOString(), status: oensket }];
      return treff;
    });
  } catch (feil) {
    // An attempt to revive a withdrawn or expired samtykke is exactly what an
    // audit log is for — the same reason B3 records TILGANG_NEKTET rather than
    // only successful reads. A 404 or a malformed status logs nothing: there is no
    // samtykke to attach the attempt to.
    if (avvist) {
      await leggTilRevisjon({
        sporingsId: body.sporingsId || avvist.sporingsId,
        handling: "SAMTYKKE_AVVIST",
        ressurs: "samtykke",
        aktor: samtykkeAktor(body.aktor, avvist.personId),
        grunnlag: avvist.grunnlag
      });
    }
    throw feil;
  }
}

/**
 * A samtykke as it is answered for, with expiry applied.
 *
 * UTLOEPT is derived rather than stored — nothing here runs on a timer — so the
 * expiry has to be applied on the way out, or the API would keep reporting
 * SAMTYKKET for a consent that no longer authorises anything. Same shape as A2's
 * masking, which is likewise applied when the data leaves rather than in the seed.
 */
function medEffektivStatus(samtykke) {
  return samtykke ? { ...samtykke, status: effektivStatus(samtykke) } : samtykke;
}

function docsHtml() {
  return `
  <!doctype html>
  <html lang="nb">
    <head><meta charset="utf-8"><title>Fiks Simulator API</title></head>
    <body style="font-family: Arial, sans-serif; padding: 24px;">
      <h1>Fiks Simulator API</h1>
      <ul>
        <li><code>POST /fiks/samtykke</code></li>
        <li><code>GET /fiks/samtykke/{samtykkeId}</code></li>
        <li><code>PUT /fiks/samtykke/{samtykkeId}/svar</code></li>
        <li><code>PUT /fiks/samtykke/{samtykkeId}/trekk</code></li>
        <li><code>GET /fiks/samtykke/{samtykkeId}/historikk</code></li>
        <li><code>GET /fiks/personer/{personId}/samtykker</code></li>
        <li><code>POST /fiks/oppgaver</code></li>
        <li><code>GET /fiks/oppgaver/{oppgaveId}</code></li>
        <li><code>PUT /fiks/oppgaver/{oppgaveId}/status</code></li>
      </ul>
    </body>
  </html>`;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "OPTIONS") {
    jsonResponse(response, 204, {});
    return;
  }

  try {
    if (url.pathname === "/helse" || url.pathname === "/health") {
      jsonResponse(response, 200, { status: "ok", tjeneste: "fiks-simulator", tidspunkt: new Date().toISOString() });
      return;
    }

    if (url.pathname === "/docs") {
      textResponse(response, 200, docsHtml());
      return;
    }

    if (url.pathname === "/openapi.yaml") {
      const yaml = await readFile(path.resolve(__dirname, "../../../openapi/fiks-simulator.yaml"), "utf8");
      textResponse(response, 200, yaml, "text/yaml; charset=utf-8");
      return;
    }

    // Lazy, so a route that only touches samtykker never opens personer.json —
    // this used to read all seven files, 369 people included, on every request.
    // Writes do not go through here: they go through updateJson, which reads
    // inside its own queue. See state.ts.
    const tilstand = lagStateLeser();

    // Full Fiks path, so calls can be copied straight from the Fiks documentation
    // and later point at the real API by changing only the base URL.
    const beregningTreff = url.pathname.match(
      /^\/register\/api\/v1\/ks\/([^/]+)\/skatteoginntektsopplysninger\/beregning\/redusert-foreldrebetaling$/
    );
    if (request.method === "POST" && beregningTreff) {
      const klient = await krevRegisterHjemmel(request);
      const body = await readBody(request);
      const { feilmeldinger, deltakere, svarPersoner } = beregnRedusertForeldrebetaling(
        body, await tilstand.personer(), await tilstand.inntekter()
      );
      const { inntekt, fradrag, beregningsbeloep } = byggBeregning(deltakere);
      const stadier = svarPersoner.map((p) => p.stadie);

      await leggTilRevisjon({
        sporingsId: body.sporingsId,
        handling: "BEREGNING_UTFOERT",
        ressurs: "skatteoginntektsopplysninger",
        // Who asked, not just who computed. The consumer claim names the
        // organisation behind the client, which is what makes "which municipality
        // looked this up" answerable.
        aktor: klient
          ? { type: "system", id: klient.clientId, ...(klient.consumer ? { consumer: klient.consumer } : {}) }
          : { type: "system", id: "fiks-simulator" }
      });

      jsonResponse(response, 200, {
        inntektsaar: body.inntektsaar,
        stadie: stadier.length === 0 || stadier.includes("UKJENT")
          ? "UKJENT"
          : stadier.includes("UTKAST") ? "UTKAST" : "OPPGJOER",
        personer: svarPersoner,
        visningsposter: byggVisningsposter(deltakere),
        beregningsbeloep,
        inntekt,
        fradrag,
        soeketidspunkt: new Date().toISOString(),
        beregningstype: "BARNEHAGE_SFO",
        feilmeldinger,
        syntetisk: true
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/fiks/samtykke") {
      const body = await readBody(request);
      const nyttSamtykke = {
        samtykkeId: newId("samtykke"),
        personId: body.personId,
        formaal: body.formaal,
        dataKilder: body.dataKilder || [],
        status: "VENTER_PAA_SVAR",
        opprettet: new Date().toISOString(),
        utloper: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        sporingsId: body.sporingsId || newId("flyt"),
        historikk: [{ tidspunkt: new Date().toISOString(), status: "VENTER_PAA_SVAR" }],
        syntetisk: true
      };
      // Two of these arriving at once used to produce one samtykke: both read the
      // same array, both pushed, both wrote, and the loser vanished without an
      // error. The queue makes the read part of the write.
      await updateJson("samtykker.json", [], (samtykker) => samtykker.push(nyttSamtykke));
      await leggTilRevisjon({
        sporingsId: nyttSamtykke.sporingsId,
        handling: "SAMTYKKE_OPPRETTET",
        ressurs: "samtykke",
        // The service asked. A consent request is something a municipality sends,
        // not something the citizen does — they have not answered yet.
        aktor: { type: "system", id: "fiks-simulator", paaVegneAv: nyttSamtykke.personId }
      });
      jsonResponse(response, 201, nyttSamtykke);
      return;
    }

    const samtykkeTreff = url.pathname.match(/^\/fiks\/samtykke\/([^/]+)$/);
    if (request.method === "GET" && samtykkeTreff) {
      const samtykker = await tilstand.samtykker();
      const samtykke = samtykker.find((kandidat) => kandidat.samtykkeId === samtykkeTreff[1]);
      if (!samtykke) {
        jsonResponse(response, 404, { feil: "Fant ikke samtykke." });
        return;
      }
      jsonResponse(response, 200, medEffektivStatus(samtykke));
      return;
    }

    const historikkTreff = url.pathname.match(/^\/fiks\/samtykke\/([^/]+)\/historikk$/);
    if (request.method === "GET" && historikkTreff) {
      const samtykker = await tilstand.samtykker();
      const samtykke = samtykker.find((kandidat) => kandidat.samtykkeId === historikkTreff[1]);
      if (!samtykke) {
        jsonResponse(response, 404, { feil: "Fant ikke samtykke." });
        return;
      }
      jsonResponse(response, 200, samtykke.historikk || []);
      return;
    }

    const svarTreff = url.pathname.match(/^\/fiks\/samtykke\/([^/]+)\/svar$/);
    if (request.method === "PUT" && svarTreff) {
      const body = await readBody(request);
      const samtykke = await settSamtykkestatus(svarTreff[1], body.status || "SAMTYKKET", body);
      await leggTilRevisjon({
        sporingsId: body.sporingsId || samtykke.sporingsId,
        handling: "SAMTYKKE_SVART",
        ressurs: "samtykke",
        // The citizen answered. This is the single most consequential entry in the
        // whole log, and it must say who agreed.
        aktor: samtykkeAktor(body.aktor, samtykke.personId),
        grunnlag: { status: samtykke.status, id: samtykke.samtykkeId }
      });
      jsonResponse(response, 200, medEffektivStatus(samtykke));
      return;
    }

    const trekkTreff = url.pathname.match(/^\/fiks\/samtykke\/([^/]+)\/trekk$/);
    if (request.method === "PUT" && trekkTreff) {
      const body = await readBody(request);
      // A withdrawal is a transition like any other: from SAMTYKKET and nowhere
      // else. Before this it overwrote whatever the status was, so a consent could
      // be withdrawn twice, or withdrawn while the citizen had never answered it.
      const samtykke = await settSamtykkestatus(trekkTreff[1], "TRUKKET", body);
      await leggTilRevisjon({
        sporingsId: body.sporingsId || samtykke.sporingsId,
        handling: "SAMTYKKE_TRUKKET",
        ressurs: "samtykke",
        aktor: samtykkeAktor(body.aktor, samtykke.personId)
      });
      jsonResponse(response, 200, medEffektivStatus(samtykke));
      return;
    }

    const personSamtykkeTreff = url.pathname.match(/^\/fiks\/personer\/([^/]+)\/samtykker$/);
    if (request.method === "GET" && personSamtykkeTreff) {
      const samtykker = await tilstand.samtykker();
      jsonResponse(response, 200, samtykker
        .filter((samtykke) => samtykke.personId === personSamtykkeTreff[1])
        .map(medEffektivStatus));
      return;
    }

    const personTreff = url.pathname.match(/^\/fiks\/register\/person\/([^/]+)$/);
    if (request.method === "GET" && personTreff) {
      await krevRegisterHjemmel(request);
      const person = (await tilstand.personer()).find((kandidat) => kandidat.personId === personTreff[1]);
      jsonResponse(response, person ? 200 : 404, maskertPerson(person) || { feil: "Fant ikke person." });
      return;
    }

    const husstandTreff = url.pathname.match(/^\/fiks\/register\/husstand\/([^/]+)$/);
    if (request.method === "GET" && husstandTreff) {
      await krevRegisterHjemmel(request);
      const personer = await tilstand.personer();
      const person = personer.find((kandidat) => kandidat.personId === husstandTreff[1]);
      const husstand = (await tilstand.husstander()).find((kandidat) => kandidat.husstandId === person?.husstandId);
      // The household address is masked only when every member is protected — you
      // cannot hide an address someone shares with an unprotected person. Same rule
      // as sandbox-backend, because it is the same function.
      const gradering = new Map(personer.map((p) => [p.personId, p.adressebeskyttelse]));
      jsonResponse(
        response,
        husstand ? 200 : 404,
        husstand ? maskerHusstand(husstand, gradering) : { feil: "Fant ikke husstand." }
      );
      return;
    }

    const inntektTreff = url.pathname.match(/^\/fiks\/register\/inntekt\/([^/]+)$/);
    if (request.method === "GET" && inntektTreff) {
      // This route handed out full income with no token and no samtykke — the way
      // around consent-before-income, the sandbox's flagship policy rule.
      await krevRegisterHjemmel(request);
      const inntekt = (await tilstand.inntekter()).find((kandidat) => kandidat.personId === inntektTreff[1]);
      jsonResponse(response, inntekt ? 200 : 404, inntekt || { feil: "Fant ikke inntekt." });
      return;
    }

    const barnehageTreff = url.pathname.match(/^\/fiks\/register\/barnehage\/([^/]+)$/);
    if (request.method === "GET" && barnehageTreff) {
      await krevRegisterHjemmel(request);
      jsonResponse(response, 200, (await tilstand.barnehageplasser())
        .filter((kandidat) => kandidat.personId === barnehageTreff[1]));
      return;
    }

    const kontaktTreff = url.pathname.match(/^\/fiks\/register\/kontaktinfo\/([^/]+)$/);
    if (request.method === "GET" && kontaktTreff) {
      await krevRegisterHjemmel(request);
      const person = (await tilstand.personer()).find((kandidat) => kandidat.personId === kontaktTreff[1]);
      // maskerPerson nulls epost and telefon for a protected person, so the contact
      // details come from the masked copy rather than the raw seed.
      const maskert = maskertPerson(person);
      jsonResponse(response, person ? 200 : 404, person ? { personId: maskert.personId, kontakt: maskert.kontakt, syntetisk: true } : { feil: "Fant ikke person." });
      return;
    }

    if (request.method === "POST" && url.pathname === "/fiks/oppgaver") {
      const body = await readBody(request);
      const oppgave = {
        oppgaveId: newId("oppgave"),
        personId: body.personId,
        soknadId: body.soknadId,
        tittel: body.tittel || "Ny oppgave",
        status: "OPPRETTET",
        opprettet: new Date().toISOString(),
        sporingsId: body.sporingsId || newId("flyt"),
        historikk: [{ tidspunkt: new Date().toISOString(), status: "OPPRETTET" }],
        syntetisk: true
      };
      await updateJson("oppgaver.json", [], (oppgaver) => oppgaver.push(oppgave));
      await leggTilRevisjon({
        sporingsId: oppgave.sporingsId,
        handling: "OPPGAVE_OPPRETTET",
        ressurs: "oppgave",
        aktor: { type: "system", id: "fiks-simulator" }
      });
      jsonResponse(response, 201, oppgave);
      return;
    }

    const oppgaveTreff = url.pathname.match(/^\/fiks\/oppgaver\/([^/]+)$/);
    if (request.method === "GET" && oppgaveTreff) {
      const oppgave = (await tilstand.oppgaver()).find((kandidat) => kandidat.oppgaveId === oppgaveTreff[1]);
      jsonResponse(response, oppgave ? 200 : 404, oppgave || { feil: "Fant ikke oppgave." });
      return;
    }

    // Casework has a direction: an oppgave is picked up, then finished or rejected,
    // and none of those are undoable. No case in the sandbox drives an oppgave past
    // OPPRETTET yet — this is the surface a saksbehandlerflate would use.
    const oppgaveStatusTreff = url.pathname.match(/^\/fiks\/oppgaver\/([^/]+)\/status$/);
    if (request.method === "PUT" && oppgaveStatusTreff) {
      const body = await readBody(request);
      const oppgave = await updateJson("oppgaver.json", [], (oppgaver) => {
        const treff = oppgaver.find((kandidat) => kandidat.oppgaveId === oppgaveStatusTreff[1]);
        if (!treff) {
          throw new FiksFeil("Fant ikke oppgave.", 404, "OPPGAVE_IKKE_FUNNET");
        }
        krevOvergang(validerOppgaveovergang(treff.status, body.status));
        treff.status = body.status;
        treff.historikk = [...(treff.historikk || []), { tidspunkt: new Date().toISOString(), status: body.status }];
        return treff;
      });
      await leggTilRevisjon({
        sporingsId: body.sporingsId || oppgave.sporingsId,
        handling: "OPPGAVE_STATUS_ENDRET",
        ressurs: "oppgave",
        aktor: samtykkeAktor(body.aktor, oppgave.personId),
        grunnlag: { status: oppgave.status, id: oppgave.oppgaveId }
      });
      jsonResponse(response, 200, oppgave);
      return;
    }

    if (request.method === "POST" && url.pathname === "/fiks/meldinger") {
      const body = await readBody(request);
      const melding = {
        meldingId: newId("melding"),
        tittel: body.tittel || "Ny melding",
        innhold: body.innhold || "",
        opprettet: new Date().toISOString(),
        syntetisk: true
      };
      await updateJson("meldinger.json", [], (meldinger) => meldinger.push(melding));
      jsonResponse(response, 201, melding);
      return;
    }

    const meldingTreff = url.pathname.match(/^\/fiks\/meldinger\/([^/]+)$/);
    if (request.method === "GET" && meldingTreff) {
      const melding = (await tilstand.meldinger()).find((kandidat) => kandidat.meldingId === meldingTreff[1]);
      jsonResponse(response, melding ? 200 : 404, melding || { feil: "Fant ikke melding." });
      return;
    }

    jsonResponse(response, 404, { feil: "Fant ikke endepunkt." });
  } catch (error) {
    if (error instanceof FiksFeil) {
      // Fiks' own error shape: a kode alongside the melding, the way the register
      // API answers. Not sandbox-backend's shape, and not Tomcat HTML.
      jsonResponse(response, error.status, {
        feil: error.message,
        feilmeldinger: [{ kode: error.kode, melding: error.message }],
        syntetisk: true
      }, error.headers);
      return;
    }
    jsonResponse(response, 500, { feil: "Intern feil i Fiks-simulator.", detalj: error.message, syntetisk: true });
  }
});

server.listen(port, () => {
  console.log(`Fiks-simulator kjører på http://localhost:${port}`);
});
