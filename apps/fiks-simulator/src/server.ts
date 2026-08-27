import { createServer } from "node:http";
import { maskinportenHeader } from "../../digdir-mock/src/client.ts";
import { createVerifier, TokenError } from "../../digdir-mock/src/verify.ts";
// Masking reused rather than reimplemented: fiks-simulator reads
// data/personer.json itself, so it is a second data layer that must mask on its
// own way out - sandbox-backend's masking cannot cover it.
import { maskFregPerson, maskHusstand, maskKrr, maskPerson } from "../../shared/skjerming.ts";
// Which statuses exist, what may follow what, and when a samtykke has run out -
// all three live in samtykke.ts so the compiler can hold them together.
import { effektivStatus, validateSamtykkeovergang } from "../../shared/samtykke.ts";
import { validateOppgaveovergang } from "./oppgave.ts";
import {
  chooseKanal,
  deriveForsendelsesstatus,
  validateForsendelse
} from "./forsendelse.ts";
import type { Forsendelse, ForsendelseKropp } from "./forsendelse.ts";
import {
  buildFregPersonSvar,
  findFolkeregisterrolle,
  FOLKEREGISTERROLLER,
  INFORMASJONSDELER,
  isInformasjonsdel
} from "./folkeregister.ts";
import type { Overgangsutfall } from "../../shared/statemachine.ts";
// Modulus 11, imported rather than re-regexed: "eleven digits" was never the
// actual rule, and the sandbox's own population is Tenor's +80 form.
import { isGyldigFoedselsnummer } from "../../shared/foedselsnummer.ts";
import { updateJson } from "../../shared/jsonstore.ts";
import { createStateReader, newId } from "./state.ts";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { routeOverview } from "../../shared/openapi.ts";
import { cors, readRequestBody, svarhjelpere } from "../../shared/http.ts";
import { feilmelding } from "../../shared/errors.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Inntekt, Inntektspost, Oppgave, FiksSamtykke } from "./state.ts";
import type { Person } from "../../shared/innbyggerdata.ts";

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

// Creating a samtykke, answering it or withdrawing it is writing to a hjemmel
// surface, and so is putting work in a caseworker's queue. Left open, these
// surfaces would be a back door around the samtykke gate sandbox-backend
// enforces - pid binding, resource catalogue, purpose taken from the consent.
//
// Separate scopes rather than one: a service that may ask for consent is not
// automatically a service that may create tasks. Three surfaces, three scopes.
const SCOPE_SAMTYKKE = "ks:fiks:samtykke";
const SCOPE_OPPGAVE = "ks:fiks:oppgave";
const SCOPE_MELDING = "ks:fiks:melding";
// Folkeregisteret is its own path family with its own legal basis, so it is not
// folded into ks:fiks:register: a register token must not open FREG.
const SCOPE_FOLKEREGISTER = "ks:fiks:folkeregister";
// SvarUt is its own surface too: sending a vedtak to a citizen is not a register
// lookup, and a register token must not open the door letters leave through.
const SCOPE_SVARUT = "ks:fiks:svarut";

const verifyToken = createVerifier({
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

const { jsonResponse, textResponse } = svarhjelpere({
  cors: cors("GET,POST,PUT,OPTIONS"),
  // /docs og /openapi.yaml har bare Allow-Origin, ikke Allow-Methods og
  // Allow-Headers. Det er slik denne tjenesten alltid har svart, og det er
  // bevart her framfor rettet i en migrering - men det er neppe med vilje:
  // process-agent har en kommentar som sier at CORS hører på alle tre.
  tekstCors: { "Access-Control-Allow-Origin": "*" }
});

/*
 * Kroppene denne tjenesten tar imot, og de interne formene beregningen bygger.
 *
 * Kroppene er JSON fra tråden og har ikke vært gjennom noen validering når de
 * navngis her - typen sier hva ruten regner med, ikke hva den har fått. Derfor
 * står feilmeldingene i computeBeregning fortsatt: de sjekker det
 * typen ikke kan.
 */
type Aktor = { type: string; id?: string; paaVegneAv?: string; consumer?: string };

type BeregningKropp = {
  inntektsaar?: number;
  sporingsId?: string;
  personer?: { identifikator?: string; type?: string; ekstraposter?: Inntektspost[] }[];
};

type SamtykkeKropp = {
  personId?: string;
  formaal?: string;
  dataKilder?: string[];
  sporingsId?: string;
  status?: string;
  aktor?: Aktor;
};

type OppgaveKropp = {
  personId?: string;
  soknadId?: string;
  tittel?: string;
  status?: string;
  sporingsId?: string;
  aktor?: Aktor;
};

type MeldingKropp = { tittel?: string; innhold?: string };

/** Én person i beregningen, med alle postene som teller for dem. */
type Deltaker = { identifikator: string; skjermet: boolean; poster: Inntektspost[] };

type Beregningspost = Inntektspost & { operasjon: string; kanEndreVisningstekst: boolean; identifikator: string };

type Feilmelding = { kode: string; melding: string };

type Revisjonshendelse = {
  sporingsId?: string;
  handling: string;
  ressurs: string;
  aktor: Aktor;
  grunnlag?: Record<string, unknown>;
};



// See addRevisjon in apps/ai-gateway/src/server.ts for the audit-logging rationale.
async function addRevisjon(hendelse: Revisjonshendelse): Promise<void> {
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
    console.warn(`Kunne ikke revisjonslogge mot sandbox-backend: ${feilmelding(error)}`);
  }
}

// Skatte- og inntektsopplysninger: beregning
//
// Modelled on the KS Fiks register API:
// https://developers.fiks.ks.no/api/register-skatteoginntektsopplysninger-beregning-api-v1.json
//
// Three beregningstyper live on the same path family and share the response
// shape and this machinery; a Typeoppsett holds what differs between them.
// The /pdf variants and the generic /beregning route are not implemented
// (flagged as deviations in openapi/fiks-simulator.yaml).
//
// The simulator computes the grunnlag. The income thresholds belong to the
// municipality and live in data/satser.json, which sandbox-backend reads.

/** What separates the beregningstyper the register surface serves. */
type Typeoppsett = {
  beregningstype: string;
  persontyper: string[];
  /** Extra visningskategori built from medregnes: false posts; omitted when empty. */
  fradragskategori?: string;
};

const BARNEHAGE_SFO: Typeoppsett = {
  beregningstype: "BARNEHAGE_SFO",
  persontyper: ["SOEKER", "ANNET"]
};
const PRAKTISK_BISTAND: Typeoppsett = {
  beregningstype: "PRAKTISK_BISTAND",
  persontyper: ["SOEKER", "ANNET"]
};
// The synthetic data has no formue/gjeld posts, so FRADRAG only ever holds the
// medregnes: false ytelser. Putting formue into data/inntekter.json would change
// the answers on the existing routes and break the contract dump.
const LANGTIDSOPPHOLD_INSTITUSJON: Typeoppsett = {
  beregningstype: "LANGTIDSOPPHOLD_INSTITUSJON",
  persontyper: ["SOEKER", "EKTEFELLE", "PARTNER", "SAMBOER", "BARN"],
  fradragskategori: "FRADRAG"
};

// Entries excluded from the grunnlag are recorded as ADDERE under inntekt and
// SUBTRAHERE under fradrag. That keeps beregningsbeloep correct while still letting
// the resident see which benefits were left out, and why.
function buildPost(post: Inntektspost, identifikator: string): Beregningspost {
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

function buildBeregning(deltakere: Deltaker[]) {
  const inntektsposter: Beregningspost[] = [];
  const fradragsposter: Beregningspost[] = [];

  for (const d of deltakere) {
    for (const post of d.poster) {
      inntektsposter.push(buildPost(post, d.identifikator));
      if (!post.medregnes) {
        fradragsposter.push({
          ...buildPost(post, d.identifikator),
          operasjon: "SUBTRAHERE",
          infotekst: post.infotekst || "Inngår ikke i grunnlaget."
        });
      }
    }
  }

  const sum = (poster: Beregningspost[]) => poster.reduce((t, p) => t + p.beloep, 0);
  // TypeApiModel says which of the two child lists is populated: POST for
  // beregningsposter, GRUNNLAG for beregningsgrunnlag. We only build poster.
  const gruppe = (tekniskNavn: string, visningstekst: string, operasjon: string, poster: Beregningspost[]) => ({
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
type Visningspost = {
  tekniskNavn: string;
  visningstekst: string;
  beloep: number;
  personer: { identifikator: string; beloep: number }[];
  infotekst?: string;
};

function collectVisningsposter(deltakere: Deltaker[], medregnes: boolean) {
  const byType = new Map<string, Visningspost>();

  for (const d of deltakere) {
    for (const post of d.poster) {
      if (Boolean(post.medregnes) !== medregnes) continue;
      if (!byType.has(post.tekniskNavn)) {
        byType.set(post.tekniskNavn, {
          tekniskNavn: post.tekniskNavn,
          visningstekst: post.visningstekst,
          beloep: 0,
          personer: []
        });
      }
      const vp = byType.get(post.tekniskNavn)!;
      vp.beloep += post.beloep;
      if (d.skjermet) {
        vp.infotekst = "Beløpet inkluderer et husstandsmedlem med skjermet identitet, som ikke kan spesifiseres.";
      } else {
        vp.personer.push({ identifikator: d.identifikator, beloep: post.beloep });
      }
    }
  }

  return [...byType.values()];
}

function buildVisningsposter(deltakere: Deltaker[], fradragskategori?: string) {
  const kategorier = [{ kategori: "INNTEKT", poster: collectVisningsposter(deltakere, true) }];
  if (fradragskategori) {
    const poster = collectVisningsposter(deltakere, false);
    if (poster.length > 0) {
      kategorier.push({ kategori: fradragskategori, poster });
    }
  }
  return kategorier;
}

function computeBeregning(body: BeregningKropp, personer: Person[], inntekter: Inntekt[], typeoppsett: Typeoppsett) {
  const feilmeldinger: Feilmelding[] = [];
  const inntektsaar = body.inntektsaar;

  if (!Number.isInteger(inntektsaar)) {
    feilmeldinger.push({ kode: "INNTEKTSAAR_MANGLER", melding: "inntektsaar må være et heltall." });
  }
  if (!Array.isArray(body.personer) || body.personer.length === 0) {
    feilmeldinger.push({ kode: "PERSONER_MANGLER", melding: "personer må inneholde minst én person." });
  }
  if (feilmeldinger.length) {
    return { feilmeldinger, deltakere: [], personerResponse: [] };
  }

  const deltakere: Deltaker[] = [];
  const personerResponse: Record<string, unknown>[] = [];

  // Sjekket over - feilmeldinger-grenen returnerte allerede hvis listen manglet.
  for (const requested of body.personer ?? []) {
    // Without this check a malformed identifier returned PERSON_IKKE_FUNNET, which
    // wrongly implies it was well-formed. The two cases are kept apart because the
    // caller can act on the difference: eleven digits is a typo in the request,
    // wrong control digits is a typo in the number.
    const identifikator = String(requested.identifikator || "");
    if (!/^[0-9]{11}$/.test(identifikator)) {
      feilmeldinger.push({
        kode: "UGYLDIG_IDENTIFIKATOR",
        melding: `identifikator må være 11 siffer, fikk ${requested.identifikator}.`
      });
      continue;
    }
    if (!isGyldigFoedselsnummer(identifikator)) {
      feilmeldinger.push({
        kode: "UGYLDIG_IDENTIFIKATOR",
        melding: `identifikator ${identifikator} har ugyldige kontrollsiffer.`
      });
      continue;
    }

    const type = requested.type || "SOEKER";
    if (!typeoppsett.persontyper.includes(type)) {
      // « eller » before the last element: the BARNEHAGE_SFO message predates
      // the other beregningstyper and must stay byte-identical.
      const gyldige = typeoppsett.persontyper;
      const liste = [gyldige.slice(0, -1).join(", "), gyldige[gyldige.length - 1]]
        .filter(Boolean)
        .join(" eller ");
      feilmeldinger.push({
        kode: "UGYLDIG_PERSONTYPE",
        melding: `type må være ${liste} for beregningstype ${typeoppsett.beregningstype}, fikk ${type}.`
      });
      continue;
    }

    const person = personer.find((p) => p.syntetiskFodselsnummer === requested.identifikator);
    if (!person) {
      feilmeldinger.push({
        kode: "PERSON_IKKE_FUNNET",
        melding: `Fant ingen person med identifikator ${requested.identifikator}.`
      });
      continue;
    }

    const rad = inntekter.find(
      (i) => i.identifikator === requested.identifikator && i.inntektsaar === inntektsaar
    );
    const ekstraposter = (requested.ekstraposter || []).map((e) => ({
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
        melding: `Fant ingen skatteopplysninger for ${requested.identifikator} i inntektsåret ${inntektsaar}.`
      });
      continue;
    }

    deltakere.push({
      identifikator,
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

    personerResponse.push({
      identifikator: requested.identifikator,
      navn: person.skjermet ? undefined : navn,
      type,
      skjermet: Boolean(person.skjermet),
      skatteoppgjoersdato: rad?.skatteoppgjoersdato || undefined,
      stadie: rad?.stadie || "UKJENT",
      registreringstidpunkt: new Date().toISOString()
    });
  }

  return { feilmeldinger, deltakere, personerResponse };
}

/**
 * Maskinporten on the register surface. Throws a FiksFeil the request handler maps,
 * so the shape is Fiks' own and not sandbox-backend's.
 *
 * Real Fiks would also check which organisation the consumer claim names, and
 * whether that municipality has a data-processing agreement for the register. We
 * check the scope and record the client, which is the part the workshop is about.
 */
class FiksError extends Error {
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

/**
 * Maskinporten for one named scope. `flate` names the surface in the 401 so the
 * message says which door was locked, not just that one was.
 */
async function requireMaskinportenHjemmel(
  request: IncomingMessage,
  scope: string,
  flate: string
): Promise<{ clientId: string; consumer: string | null } | null> {
  if (!authEnforce) return null;

  const header = request.headers.authorization;
  if (!header) {
    throw new FiksError(
      `${flate} i Fiks krever et Maskinporten-token. ` +
      `Hent et med scripts/token.ts --maskinporten ${scope} --resource fiks-simulator.`,
      401,
      "MANGLER_TOKEN",
      { "WWW-Authenticate": 'Bearer realm="fiks-simulator", error="invalid_token"' }
    );
  }
  const [ordning, token] = header.split(" ");
  if (!/^bearer$/i.test(ordning || "") || !token) {
    throw new FiksError(
      "Authorization-headeren må være på formen «Bearer <token>».",
      401,
      "UGYLDIG_TOKEN",
      { "WWW-Authenticate": 'Bearer realm="fiks-simulator", error="invalid_token"' }
    );
  }

  let verified;
  try {
    verified = await verifyToken(token);
  } catch (feil) {
    if (feil instanceof TokenError) {
      throw new FiksError(feil.message, feil.status, feil.status === 401 ? "UGYLDIG_TOKEN" : "UTSTEDER_NEDE",
        feil.status === 401 ? { "WWW-Authenticate": 'Bearer realm="fiks-simulator", error="invalid_token"' } : {});
    }
    throw feil;
  }

  // A citizen's ID-porten token cannot open these. They are machine-to-machine
  // surfaces: the hjemmel belongs to the municipality, not to whoever happens to be
  // logged in. sandbox-backend holds the verified citizen token, decides, and then
  // acts here as a machine with `aktor` naming the citizen - which is exactly the
  // hjemmel/aktør distinction the sandbox exists to show.
  if (verified.utsteder !== "maskinporten") {
    throw new FiksError(
      `${flate} er en maskin-til-maskin-flate. Et personlig ID-porten-token ` +
      "gir ikke hjemmel her, uansett sikkerhetsnivå.",
      403,
      "KREVER_MASKINPORTEN"
    );
  }

  const scopes = String(verified.krav.scope || "").split(" ").filter(Boolean);
  if (!scopes.includes(scope)) {
    throw new FiksError(
      `Klienten ${verified.krav.client_id} mangler scope ${scope} ` +
      `(har: ${scopes.join(" ") || "ingen"}).`,
      403,
      "MANGLER_SCOPE"
    );
  }

  return {
    clientId: verified.krav.client_id || "ukjent",
    consumer: verified.krav.consumer?.ID || null
  };
}

/** The register surface keeps its own name at the call sites. */
function requireRegisterHjemmel(request: IncomingMessage) {
  return requireMaskinportenHjemmel(request, SCOPE_REGISTER, "Registerflaten");
}

/**
 * The fnr gauntlet both fnr-keyed lookups (KRR and Folkeregisteret) run: eleven
 * digits is a typo in the request, wrong control digits is a typo in the
 * number - the caller can act on the difference. Modulus 11 is stricter than
 * the Fiks specs' ^[0-9]{11}$, a flagged deviation on both routes.
 *
 * `oppgitt` is the value as the caller sent it, so the message can echo a
 * non-string body field verbatim.
 */
function requireGyldigFnr(fnr: string, oppgitt: unknown): void {
  if (!/^[0-9]{11}$/.test(fnr)) {
    throw new FiksError(`fnr må være 11 siffer, fikk ${oppgitt}.`, 400, "UGYLDIG_IDENTIFIKATOR");
  }
  if (!isGyldigFoedselsnummer(fnr)) {
    throw new FiksError(`fnr ${fnr} har ugyldige kontrollsiffer.`, 400, "UGYLDIG_IDENTIFIKATOR");
  }
}

const requireSamtykkeHjemmel = (request: IncomingMessage) =>
  requireMaskinportenHjemmel(request, SCOPE_SAMTYKKE, "Samtykkeflaten");

const requireOppgaveHjemmel = (request: IncomingMessage) =>
  requireMaskinportenHjemmel(request, SCOPE_OPPGAVE, "Oppgaveflaten");

const requireMeldingHjemmel = (request: IncomingMessage) =>
  requireMaskinportenHjemmel(request, SCOPE_MELDING, "Meldingsflaten");

const requireFolkeregisterHjemmel = (request: IncomingMessage) =>
  requireMaskinportenHjemmel(request, SCOPE_FOLKEREGISTER, "Folkeregisterflaten");

const requireSvarutHjemmel = (request: IncomingMessage) =>
  requireMaskinportenHjemmel(request, SCOPE_SVARUT, "SvarUt-flaten");

// The masking in skjerming.ts that sandbox-backend's readState() applies, applied
// here too. Without it a machine with register hjemmel would receive an
// address-protected person in full, and this route would be the way around the
// masking.
function maskRegisterPerson(person: Person | undefined) {
  return person ? maskPerson(person) : person;
}

/**
 * Who acted on a samtykke.
 *
 * The three events are not the same kind of act: the *service* asks for consent,
 * the *citizen* answers it and the *citizen* withdraws it. One actor for all
 * three would name the person the consent was about, not who did the thing.
 *
 * SANDBOX SIMPLIFICATION, and it belongs in the same drawer as the unverified
 * client assertion in digdir-mock: for the citizen's own acts, the actor is taken
 * from the request body, because only the caller knows. sandbox-backend supplies it
 * from the verified token it holds.
 *
 * Forwarding the citizen's own token here instead would be the real answer, and it
 * does not work: that token is minted for audience "sandbox-backend" and this
 * service refuses it - correctly. Bridging that needs token exchange (RFC 8693),
 * which is more machinery than the workshop needs. Absent a supplied actor we say
 * what is true: fiks-simulator recorded this, on behalf of someone.
 */
function samtykkeAktor(oppgitt: Aktor | undefined, personId?: string): Aktor {
  if (oppgitt && oppgitt.type) {
    return oppgitt;
  }
  return { type: "system", id: "fiks-simulator", ...(personId ? { paaVegneAv: personId } : {}) };
}

/**
 * Turns a refused transition into the answer the caller gets.
 *
 * The state machine decides both the code and the status - 400 for a status that
 * does not exist, 409 for one that cannot be reached from here - so the rule and
 * its HTTP answer stay in one place. See statemachine.ts.
 */
function requireOvergang<T extends string>(utfall: Overgangsutfall<T>): T {
  if (!utfall.lovlig) {
    throw new FiksError(utfall.melding, utfall.status, utfall.kode);
  }
  // Statusen kommer tilbake fra tilstandsmaskinen, ikke fra kroppen som kom inn.
  // Den er dermed en av de kjente statusene per konstruksjon.
  return utfall.til;
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
 * would reintroduce exactly the race the queue exists to close - two answers
 * arriving together would both see VENTER_PAA_SVAR and both be allowed.
 */
async function setSamtykkestatus(
  samtykkeId: string,
  oensket: string,
  body: SamtykkeKropp
): Promise<FiksSamtykke> {
  // Holder-objekt, ikke en `let`: tilordningen skjer inne i updateJson-callbacken,
  // og TS ser ikke at den kjører - en `let` ville blitt smalnet til null her.
  const avvist: { verdi: { personId: string; sporingsId: string; grunnlag: Record<string, unknown> } | null } =
    { verdi: null };
  try {
    return await updateJson<FiksSamtykke>("samtykker.json", [], (samtykker: FiksSamtykke[]) => {
      const treff = samtykker.find((kandidat) => kandidat.samtykkeId === samtykkeId);
      if (!treff) {
        throw new FiksError("Fant ikke samtykke.", 404, "SAMTYKKE_IKKE_FUNNET");
      }
      // Against the *effective* status, so an expired consent cannot be answered,
      // withdrawn or otherwise edited back into force.
      const utfall = validateSamtykkeovergang(effektivStatus(treff), oensket);
      if (!utfall.lovlig) {
        avvist.verdi = {
          personId: treff.personId,
          sporingsId: treff.sporingsId,
          grunnlag: { id: treff.samtykkeId, status: effektivStatus(treff), forsoekt: oensket, kode: utfall.kode }
        };
        requireOvergang(utfall);
      }
      treff.status = oensket;
      treff.historikk = [...(treff.historikk || []), { tidspunkt: new Date().toISOString(), status: oensket }];
      return treff;
    });
  } catch (feil) {
    // An attempt to revive a withdrawn or expired samtykke is exactly what an
    // audit log is for - the same reason B3 records TILGANG_NEKTET rather than
    // only successful reads. A 404 or a malformed status logs nothing: there is no
    // samtykke to attach the attempt to.
    if (avvist.verdi) {
      await addRevisjon({
        sporingsId: body.sporingsId || avvist.verdi.sporingsId,
        handling: "SAMTYKKE_AVVIST",
        ressurs: "samtykke",
        aktor: samtykkeAktor(body.aktor, avvist.verdi.personId),
        grunnlag: avvist.verdi.grunnlag
      });
    }
    throw feil;
  }
}

/**
 * A samtykke as it is answered for, with expiry applied.
 *
 * UTLOEPT is derived rather than stored - nothing here runs on a timer - so the
 * expiry has to be applied on the way out, or the API would keep reporting
 * SAMTYKKET for a consent that no longer authorises anything. Same shape as the
 * masking in skjerming.ts, likewise applied when the data leaves rather than in
 * the seed.
 */
function withEffektivStatus(samtykke: FiksSamtykke) {
  return samtykke ? { ...samtykke, status: effektivStatus(samtykke) } : samtykke;
}

function docsHtml(): string {
  return `
  <!doctype html>
  <html lang="nb">
    <head><meta charset="utf-8"><title>Fiks Simulator API</title></head>
    <body style="font-family: Arial, sans-serif; padding: 24px;">
      <h1>Fiks Simulator API</h1>
      <p><a href="/openapi.yaml">Spesifikasjonen</a> · <a href="/openapi-ruter.json">Samme, lest, som JSON</a> · <a href="http://localhost:3001/utforsker">Prøv rutene i API-utforskeren</a></p>
      <ul>
        <li><code>POST /fiks/samtykke</code></li>
        <li><code>GET /fiks/samtykke/{samtykkeId}</code></li>
        <li><code>PUT /fiks/samtykke/{samtykkeId}/svar</code></li>
        <li><code>PUT /fiks/samtykke/{samtykkeId}/trekk</code></li>
        <li><code>GET /fiks/samtykke/{samtykkeId}/historikk</code></li>
        <li><code>GET /fiks/personer/{personId}/samtykker</code></li>
        <li><code>GET /fiks/register/person/{personId}</code> · <code>/husstand</code> · <code>/inntekt</code> · <code>/barnehage</code> · <code>/kontaktinfo</code></li>
        <li><code>POST /register/api/v1/ks/{rolleId}/skatteoginntektsopplysninger/beregning/redusert-foreldrebetaling</code> · <code>/praktisk-bistand</code> · <code>/langtidsopphold-institusjon</code></li>
        <li><code>POST /register/api/v1/ks/{rolleId}/krr/person</code></li>
        <li><code>GET /folkeregister/api/v1/{rolleId}/v1/personer/{fnr}</code></li>
        <li><code>POST /svarut/api/v2/kontoer/{kontoId}/forsendelser</code> · <code>/forsendelser/status-sok</code></li>
        <li><code>POST /fiks/oppgaver</code></li>
        <li><code>GET /fiks/oppgaver/{oppgaveId}</code></li>
        <li><code>PUT /fiks/oppgaver/{oppgaveId}/status</code></li>
        <li><code>POST /fiks/meldinger</code></li>
        <li><code>GET /fiks/meldinger/{meldingId}</code></li>
      </ul>
    </body>
  </html>`;
}

async function handleBeregning(
  request: IncomingMessage,
  response: ServerResponse,
  tilstand: ReturnType<typeof createStateReader>,
  typeoppsett: Typeoppsett
) {
  const klient = await requireRegisterHjemmel(request);
  const body = await readRequestBody(request) as BeregningKropp;
  const { feilmeldinger, deltakere, personerResponse } = computeBeregning(
    body, await tilstand.personer(), await tilstand.inntekter(), typeoppsett
  );
  const { inntekt, fradrag, beregningsbeloep } = buildBeregning(deltakere);
  const stages = personerResponse.map((p) => p.stadie);

  await addRevisjon({
    sporingsId: body.sporingsId,
    handling: "BEREGNING_UTFOERT",
    ressurs: "skatteoginntektsopplysninger",
    // Who asked, not just who computed. The consumer claim names the
    // organisation behind the client, which is what makes "which municipality
    // looked this up" answerable.
    aktor: klient
      ? { type: "system", id: klient.clientId, ...(klient.consumer ? { consumer: klient.consumer } : {}) }
      : { type: "system", id: "fiks-simulator" },
    // The BARNEHAGE_SFO event predates the other beregningstyper and stays as
    // it was; for the newer types the audit log says which beregning ran.
    ...(typeoppsett.beregningstype === "BARNEHAGE_SFO"
      ? {}
      : { grunnlag: { beregningstype: typeoppsett.beregningstype } })
  });

  jsonResponse(response, 200, {
    inntektsaar: body.inntektsaar,
    stadie: stages.length === 0 || stages.includes("UKJENT")
      ? "UKJENT"
      : stages.includes("UTKAST") ? "UTKAST" : "OPPGJOER",
    personer: personerResponse,
    visningsposter: buildVisningsposter(deltakere, typeoppsett.fradragskategori),
    beregningsbeloep,
    inntekt,
    fradrag,
    soeketidspunkt: new Date().toISOString(),
    beregningstype: typeoppsett.beregningstype,
    feilmeldinger,
    syntetisk: true
  });
}

const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
  const url = new URL(request.url!, `http://${request.headers.host}`);

  if (request.method === "OPTIONS") {
    jsonResponse(response, 204, {});
    return;
  }

  try {
    if (url.pathname === "/helse") {
      jsonResponse(response, 200, { status: "ok", tjeneste: "fiks-simulator", tidspunkt: new Date().toISOString() });
      return;
    }

    if (url.pathname === "/docs") {
      textResponse(response, 200, docsHtml());
      return;
    }

    if (request.method === "GET" && url.pathname === "/openapi.yaml") {
      const yaml = await readFile(path.resolve(__dirname, "../../../openapi/fiks-simulator.yaml"), "utf8");
      textResponse(response, 200, yaml, "text/yaml; charset=utf-8");
      return;
    }

    // Den samme spesifikasjonen, lest. Se kommentaren i tools-api.
    if (request.method === "GET" && url.pathname === "/openapi-ruter.json") {
      jsonResponse(
        response,
        200,
        await routeOverview(path.resolve(__dirname, "../../../openapi/fiks-simulator.yaml"))
      );
      return;
    }

    // Lazy, so a route that only touches samtykker never opens personer.json.
    // Writes do not go through here: they go through updateJson, which reads
    // inside its own queue. See state.ts.
    const tilstand = createStateReader();

    // Full Fiks path, so calls can be copied straight from the Fiks documentation
    // and later point at the real API by changing only the base URL.
    const beregningTreff = url.pathname.match(
      /^\/register\/api\/v1\/ks\/([^/]+)\/skatteoginntektsopplysninger\/beregning\/redusert-foreldrebetaling$/
    );
    if (request.method === "POST" && beregningTreff) {
      await handleBeregning(request, response, tilstand, BARNEHAGE_SFO);
      return;
    }

    const praktiskBistandTreff = url.pathname.match(
      /^\/register\/api\/v1\/ks\/([^/]+)\/skatteoginntektsopplysninger\/beregning\/praktisk-bistand$/
    );
    if (request.method === "POST" && praktiskBistandTreff) {
      await handleBeregning(request, response, tilstand, PRAKTISK_BISTAND);
      return;
    }

    const langtidsoppholdTreff = url.pathname.match(
      /^\/register\/api\/v1\/ks\/([^/]+)\/skatteoginntektsopplysninger\/beregning\/langtidsopphold-institusjon$/
    );
    if (request.method === "POST" && langtidsoppholdTreff) {
      await handleBeregning(request, response, tilstand, LANGTIDSOPPHOLD_INSTITUSJON);
      return;
    }

    // Fiks Kontaktregisteret, on the real Fiks path. The lookup is a POST with
    // the fnr in the body, as the real API does it - an fnr in a URL would land
    // in every access log on the way.
    //
    // The error split is part of what the route teaches: a malformed fnr is a
    // 400 (the request is broken), an unknown fnr is PERSON_IKKE_FUNNET, and a
    // known person under 15 or not bosatt is IKKE_I_KONTAKTREGISTERET - the
    // register knows who they are and still has no row for them.
    const krrTreff = url.pathname.match(/^\/register\/api\/v1\/ks\/([^/]+)\/krr\/person$/);
    if (request.method === "POST" && krrTreff) {
      await requireRegisterHjemmel(request);
      const body = await readRequestBody(request) as { fnr?: string };
      const fnr = String(body.fnr || "");
      requireGyldigFnr(fnr, body.fnr);
      const person = (await tilstand.personer()).find((kandidat) => kandidat.syntetiskFodselsnummer === fnr);
      if (!person) {
        throw new FiksError(`Fant ingen person med fnr ${fnr}.`, 404, "PERSON_IKKE_FUNNET");
      }
      const rad = (await tilstand.krr()).find((kandidat) => kandidat.fnr === fnr);
      if (!rad) {
        throw new FiksError(
          "Personen er kjent, men står ikke i kontaktregisteret. Registeret dekker " +
          "bosatte på 15 år eller mer.",
          404,
          "IKKE_I_KONTAKTREGISTERET"
        );
      }
      // Kode 6/7 nulls epost and tlf on the way out; reservert, spraak and
      // kanVarsles survive. The seed is unmasked, like the rest - see skjerming.ts.
      jsonResponse(response, 200, maskKrr(rad, person.adressebeskyttelse));
      return;
    }

    // Fiks Folkeregister on the real Fiks proxy path. The double version is not
    // a typo: /api/v1/ is the Fiks proxy's, the second /v1/ is FREG's own.
    //
    // Every lookup happens in a rollekontekst, and the role decides which
    // informasjonsdeler come back - see folkeregister.ts. The refusals carry
    // the teaching: a part outside the role is 403 UTENFOR_ROLLE, not an empty
    // field, because asking for more than the hjemmel gives is a denial.
    const folkeregisterTreff = url.pathname.match(
      /^\/folkeregister\/api\/v1\/([^/]+)\/v1\/personer\/([^/]+)$/
    );
    if (request.method === "GET" && folkeregisterTreff) {
      const klient = await requireFolkeregisterHjemmel(request);

      const rolle = findFolkeregisterrolle(folkeregisterTreff[1]);
      if (!rolle) {
        const gyldige = FOLKEREGISTERROLLER.map((kandidat) => `${kandidat.rolleId} (${kandidat.navn})`);
        throw new FiksError(
          `Ukjent rolleId ${folkeregisterTreff[1]}. Gyldige roller: ${gyldige.join(", ")}.`,
          403,
          "UKJENT_ROLLE"
        );
      }

      const fnr = folkeregisterTreff[2];
      requireGyldigFnr(fnr, fnr);

      // ?part= narrows the answer within the role, repeatable. The parts are
      // judged before the person is looked up: whether a request is within its
      // hjemmel must not depend on - or reveal - whether the person exists.
      const parts = url.searchParams.getAll("part");
      for (const del of parts) {
        if (!isInformasjonsdel(del)) {
          throw new FiksError(
            `Ukjent informasjonsdel ${del}. Gyldige deler: ${INFORMASJONSDELER.join(", ")}.`,
            400,
            "UKJENT_INFORMASJONSDEL"
          );
        }
        if (!rolle.deler.includes(del)) {
          throw new FiksError(
            `Informasjonsdelen ${del} ligger utenfor hjemmelen til rollen ${rolle.navn}. ` +
            `Rollen gir: ${rolle.deler.join(", ")}.`,
            403,
            "UTENFOR_ROLLE"
          );
        }
      }

      const fregPerson = (await tilstand.folkeregister())
        .find((kandidat) => kandidat.foedselsEllerDNummer === fnr);
      if (!fregPerson) {
        throw new FiksError(`Fant ingen person med fnr ${fnr}.`, 404, "PERSON_IKKE_FUNNET");
      }

      // Canonical order regardless of the order ?part= arrived in, so the
      // response and the audit entry are byte-comparable across lookups.
      const valgte = new Set<string>(parts.length > 0 ? parts : rolle.deler);
      const deler = INFORMASJONSDELER.filter((del) => valgte.has(del));

      // The audit entry records the hjemmel that was used - role and parts -
      // not the person: which municipality read what is the question the log
      // answers, and the fnr does not belong in it.
      await addRevisjon({
        handling: "FOLKEREGISTEROPPSLAG_UTFOERT",
        ressurs: "folkeregister",
        aktor: klient
          ? { type: "system", id: klient.clientId, ...(klient.consumer ? { consumer: klient.consumer } : {}) }
          : { type: "system", id: "fiks-simulator" },
        grunnlag: { rolle: rolle.navn, deler }
      });

      jsonResponse(response, 200, buildFregPersonSvar(maskFregPerson(fregPerson), deler));
      return;
    }

    // SvarUt simplified, on the real forsendelse paths behind a /svarut prefix
    // since everything lives on one port. The body is the metadata part of the
    // real API's multipart, unchanged - JSON instead of multipart is a flagged
    // deviation, and no document bytes are ever stored. The channel is decided
    // here, at creation, and stored on the row; everything after that is derived
    // from the clock in deriveForsendelsesstatus - see forsendelse.ts.
    const forsendelseTreff = url.pathname.match(/^\/svarut\/api\/v2\/kontoer\/([^/]+)\/forsendelser$/);
    if (request.method === "POST" && forsendelseTreff) {
      const klient = await requireSvarutHjemmel(request);
      const body = await readRequestBody(request) as ForsendelseKropp;
      const feil = validateForsendelse(body);
      if (feil) {
        throw new FiksError(feil.melding, 400, feil.kode);
      }
      // Validert over: validateForsendelse slapp bare gjennom en kropp med
      // tittel og mottaker.navn.
      const mottaker = body.mottaker!;
      // Reservert i KRR betyr print: the DIGITAL rule fires only for a recipient
      // who can be notified and is not reserved. The lookup happens here, where
      // the data is; the decision itself lives in chooseKanal.
      const krrRad = mottaker.digitalId
        ? (await tilstand.krr()).find((kandidat) => kandidat.fnr === mottaker.digitalId)
        : undefined;
      const utfall = chooseKanal(mottaker, Boolean(body.kunDigitalLevering), krrRad);
      if (!utfall.lovlig) {
        throw new FiksError(utfall.melding, utfall.status, utfall.kode);
      }
      const forsendelse: Forsendelse = {
        id: newId("forsendelse"),
        kontoId: forsendelseTreff[1],
        tittel: body.tittel!,
        mottaker,
        dokumenter: (body.dokumenter || []).map((dokument) => ({
          filnavn: dokument.filnavn,
          mimeType: dokument.mimeType
        })),
        konteringskode: body.konteringskode,
        avgivendeSystem: body.avgivendeSystem,
        kunDigitalLevering: body.kunDigitalLevering,
        eksternReferanse: body.eksternReferanse,
        utskriftskonfigurasjon: body.utskriftskonfigurasjon,
        kanal: utfall.kanal,
        opprettet: new Date().toISOString(),
        syntetisk: true
      };
      await updateJson("forsendelser.json", [], (forsendelser) => forsendelser.push(forsendelse));
      // The audit entry records the forsendelse and the channel decision - not
      // the recipient's contact info: which letters left and how is the question
      // the log answers, and the address does not belong in it.
      await addRevisjon({
        handling: "FORSENDELSE_SENDT",
        ressurs: "forsendelse",
        aktor: klient
          ? { type: "system", id: klient.clientId, ...(klient.consumer ? { consumer: klient.consumer } : {}) }
          : { type: "system", id: "fiks-simulator" },
        grunnlag: { id: forsendelse.id, kanal: forsendelse.kanal, mottakerVarslet: forsendelse.kanal === "DIGITAL" }
      });
      // 200 med bare id-en, som spekken - ikke 201 med hele raden.
      jsonResponse(response, 200, { id: forsendelse.id, syntetisk: true });
      return;
    }

    const statusSoekTreff = url.pathname.match(
      /^\/svarut\/api\/v2\/kontoer\/([^/]+)\/forsendelser\/status-sok$/
    );
    if (request.method === "POST" && statusSoekTreff) {
      await requireSvarutHjemmel(request);
      const body = await readRequestBody(request) as { forsendelseIds?: unknown };
      if (!Array.isArray(body.forsendelseIds)) {
        throw new FiksError(
          "forsendelseIds må være en liste med forsendelse-id-er.",
          400,
          "FORSENDELSEIDS_MANGLER"
        );
      }
      const forsendelser = await tilstand.forsendelser();
      // One clock for the whole answer, so two rows created together cannot
      // straddle a threshold within a single response. Unknown ids are omitted
      // rather than answered for.
      const naa = Date.now();
      const statuser = body.forsendelseIds.flatMap((id) => {
        const forsendelse = forsendelser.find((kandidat) => kandidat.id === id);
        if (!forsendelse) return [];
        const { status, sisteStatusEndring } = deriveForsendelsesstatus(forsendelse, naa);
        return [{ id: forsendelse.id, status, sisteStatusEndring }];
      });
      jsonResponse(response, 200, { statuser, syntetisk: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/fiks/samtykke") {
      await requireSamtykkeHjemmel(request);
      const body = await readRequestBody(request) as SamtykkeKropp;
      const newSamtykke: FiksSamtykke = {
        samtykkeId: newId("samtykke"),
        // Ikke validert: ruten har aldri krevd personId, og en kropp uten den
        // lagrer i dag et samtykke som ikke hører til noen. Typen sier `string`
        // fordi et samtykke uten person er meningsløst. Avviket er bevart her -
        // en migrering skal ikke endre atferd - men det er et ekte hull.
        personId: body.personId as string,
        formaal: body.formaal,
        dataKilder: body.dataKilder || [],
        status: "VENTER_PAA_SVAR",
        opprettet: new Date().toISOString(),
        utloper: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        sporingsId: body.sporingsId || newId("flyt"),
        historikk: [{ tidspunkt: new Date().toISOString(), status: "VENTER_PAA_SVAR" }],
        syntetisk: true
      };
      // The queue makes the read part of the write, so two of these arriving at
      // once cannot lose one to a stale array. See jsonstore.ts.
      await updateJson("samtykker.json", [], (samtykker) => samtykker.push(newSamtykke));
      await addRevisjon({
        sporingsId: newSamtykke.sporingsId,
        handling: "SAMTYKKE_OPPRETTET",
        ressurs: "samtykke",
        // The service asked. A consent request is something a municipality sends,
        // not something the citizen does - they have not answered yet.
        aktor: { type: "system", id: "fiks-simulator", paaVegneAv: newSamtykke.personId }
      });
      jsonResponse(response, 201, newSamtykke);
      return;
    }

    const samtykkeTreff = url.pathname.match(/^\/fiks\/samtykke\/([^/]+)$/);
    if (request.method === "GET" && samtykkeTreff) {
      await requireSamtykkeHjemmel(request);
      const samtykker = await tilstand.samtykker();
      const samtykke = samtykker.find((kandidat) => kandidat.samtykkeId === samtykkeTreff[1]);
      if (!samtykke) {
        jsonResponse(response, 404, { feil: "Fant ikke samtykke." });
        return;
      }
      jsonResponse(response, 200, withEffektivStatus(samtykke));
      return;
    }

    const historikkTreff = url.pathname.match(/^\/fiks\/samtykke\/([^/]+)\/historikk$/);
    if (request.method === "GET" && historikkTreff) {
      await requireSamtykkeHjemmel(request);
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
      await requireSamtykkeHjemmel(request);
      const body = await readRequestBody(request) as SamtykkeKropp;
      const samtykke = await setSamtykkestatus(svarTreff[1], body.status || "SAMTYKKET", body);
      await addRevisjon({
        sporingsId: body.sporingsId || samtykke.sporingsId,
        handling: "SAMTYKKE_SVART",
        ressurs: "samtykke",
        // The citizen answered. This is the single most consequential entry in the
        // whole log, and it must say who agreed.
        aktor: samtykkeAktor(body.aktor, samtykke.personId),
        grunnlag: { status: samtykke.status, id: samtykke.samtykkeId }
      });
      jsonResponse(response, 200, withEffektivStatus(samtykke));
      return;
    }

    const trekkTreff = url.pathname.match(/^\/fiks\/samtykke\/([^/]+)\/trekk$/);
    if (request.method === "PUT" && trekkTreff) {
      await requireSamtykkeHjemmel(request);
      const body = await readRequestBody(request) as SamtykkeKropp;
      // A withdrawal is a transition like any other: from SAMTYKKET and nowhere
      // else - a consent cannot be withdrawn twice, or withdrawn while the citizen
      // has never answered it.
      const samtykke = await setSamtykkestatus(trekkTreff[1], "TRUKKET", body);
      await addRevisjon({
        sporingsId: body.sporingsId || samtykke.sporingsId,
        handling: "SAMTYKKE_TRUKKET",
        ressurs: "samtykke",
        aktor: samtykkeAktor(body.aktor, samtykke.personId)
      });
      jsonResponse(response, 200, withEffektivStatus(samtykke));
      return;
    }

    const personSamtykkeTreff = url.pathname.match(/^\/fiks\/personer\/([^/]+)\/samtykker$/);
    if (request.method === "GET" && personSamtykkeTreff) {
      await requireSamtykkeHjemmel(request);
      const samtykker = await tilstand.samtykker();
      jsonResponse(response, 200, samtykker
        .filter((samtykke) => samtykke.personId === personSamtykkeTreff[1])
        .map(withEffektivStatus));
      return;
    }

    const personTreff = url.pathname.match(/^\/fiks\/register\/person\/([^/]+)$/);
    if (request.method === "GET" && personTreff) {
      await requireRegisterHjemmel(request);
      const person = (await tilstand.personer()).find((kandidat) => kandidat.personId === personTreff[1]);
      jsonResponse(response, person ? 200 : 404, maskRegisterPerson(person) || { feil: "Fant ikke person." });
      return;
    }

    const husstandTreff = url.pathname.match(/^\/fiks\/register\/husstand\/([^/]+)$/);
    if (request.method === "GET" && husstandTreff) {
      await requireRegisterHjemmel(request);
      const personer = await tilstand.personer();
      const person = personer.find((kandidat) => kandidat.personId === husstandTreff[1]);
      const husstand = (await tilstand.husstander()).find((kandidat) => kandidat.husstandId === person?.husstandId);
      // The household address is masked only when every member is protected - you
      // cannot hide an address someone shares with an unprotected person. Same rule
      // as sandbox-backend, because it is the same function.
      const gradering = new Map(personer.map((p) => [p.personId, p.adressebeskyttelse]));
      jsonResponse(
        response,
        husstand ? 200 : 404,
        husstand ? maskHusstand(husstand, gradering) : { feil: "Fant ikke husstand." }
      );
      return;
    }

    const inntektTreff = url.pathname.match(/^\/fiks\/register\/inntekt\/([^/]+)$/);
    if (request.method === "GET" && inntektTreff) {
      // This route handed out full income with no token and no samtykke - the way
      // around consent-before-income, the sandbox's flagship policy rule.
      await requireRegisterHjemmel(request);
      const inntekt = (await tilstand.inntekter()).find((kandidat) => kandidat.personId === inntektTreff[1]);
      jsonResponse(response, inntekt ? 200 : 404, inntekt || { feil: "Fant ikke inntekt." });
      return;
    }

    const barnehageTreff = url.pathname.match(/^\/fiks\/register\/barnehage\/([^/]+)$/);
    if (request.method === "GET" && barnehageTreff) {
      await requireRegisterHjemmel(request);
      jsonResponse(response, 200, (await tilstand.barnehageplasser())
        .filter((kandidat) => kandidat.personId === barnehageTreff[1]));
      return;
    }

    const kontaktTreff = url.pathname.match(/^\/fiks\/register\/kontaktinfo\/([^/]+)$/);
    if (request.method === "GET" && kontaktTreff) {
      await requireRegisterHjemmel(request);
      const person = (await tilstand.personer()).find((kandidat) => kandidat.personId === kontaktTreff[1]);
      // maskPerson nulls epost and telefon for a protected person, so the contact
      // details come from the masked copy rather than the raw seed.
      if (!person) {
        jsonResponse(response, 404, { feil: "Fant ikke person." });
        return;
      }
      const maskert = maskPerson(person);
      jsonResponse(response, 200, { personId: maskert.personId, kontakt: maskert.kontakt, syntetisk: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/fiks/oppgaver") {
      await requireOppgaveHjemmel(request);
      const body = await readRequestBody(request) as OppgaveKropp;
      const oppgave: Oppgave = {
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
      await addRevisjon({
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
      await requireOppgaveHjemmel(request);
      const oppgave = (await tilstand.oppgaver()).find((kandidat) => kandidat.oppgaveId === oppgaveTreff[1]);
      jsonResponse(response, oppgave ? 200 : 404, oppgave || { feil: "Fant ikke oppgave." });
      return;
    }

    // Casework has a direction: an oppgave is picked up, then finished or rejected,
    // and none of those are undoable. No case in the sandbox drives an oppgave past
    // OPPRETTET yet - this is the surface a saksbehandlerflate would use.
    const oppgaveStatusTreff = url.pathname.match(/^\/fiks\/oppgaver\/([^/]+)\/status$/);
    if (request.method === "PUT" && oppgaveStatusTreff) {
      await requireOppgaveHjemmel(request);
      const body = await readRequestBody(request) as OppgaveKropp;
      const oppgave = await updateJson<Oppgave>("oppgaver.json", [], (oppgaver: Oppgave[]) => {
        const treff = oppgaver.find((kandidat) => kandidat.oppgaveId === oppgaveStatusTreff[1]);
        if (!treff) {
          throw new FiksError("Fant ikke oppgave.", 404, "OPPGAVE_IKKE_FUNNET");
        }
        const nyStatus = requireOvergang(validateOppgaveovergang(treff.status, body.status));
        treff.status = nyStatus;
        treff.historikk = [...(treff.historikk || []), { tidspunkt: new Date().toISOString(), status: nyStatus }];
        return treff;
      });
      await addRevisjon({
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
      await requireMeldingHjemmel(request);
      const body = await readRequestBody(request) as MeldingKropp;
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
      await requireMeldingHjemmel(request);
      const melding = (await tilstand.meldinger()).find((kandidat) => kandidat.meldingId === meldingTreff[1]);
      jsonResponse(response, melding ? 200 : 404, melding || { feil: "Fant ikke melding." });
      return;
    }

    jsonResponse(response, 404, { feil: "Fant ikke endepunkt." });
  } catch (error) {
    if (error instanceof FiksError) {
      // Fiks' own error shape: a kode alongside the melding, the way the register
      // API answers. Not sandbox-backend's shape, and not Tomcat HTML.
      jsonResponse(response, error.status, {
        feil: error.message,
        feilmeldinger: [{ kode: error.kode, melding: error.message }],
        syntetisk: true
      }, error.headers);
      return;
    }
    jsonResponse(response, 500, { feil: "Intern feil i Fiks-simulator.", detalj: feilmelding(error), syntetisk: true });
  }
});

server.listen(port, () => {
  console.log(`Fiks-simulator kjører på http://localhost:${port}`);
});
