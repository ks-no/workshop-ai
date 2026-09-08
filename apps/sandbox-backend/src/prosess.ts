import { maskinportenHeader } from "../../digdir-mock/src/client.ts";
import { aktorFor, type Caller } from "./autentisering.ts";
import { aiBaseUrl, fiksBaseUrl, fiksDialogToken } from "./config.ts";
import { HttpError } from "./errors.ts";
import { findRessurs, runRessurs, samtykkekildeFor } from "./ressurser.ts";
import { hasGyldigSamtykke } from "./regler.ts";
import { addRevisjon } from "./revisjon.ts";
import { updateJson } from "../../shared/jsonstore.ts";
import type { Person } from "../../shared/innbyggerdata.ts";
import { buildSoknadsdokument } from "./kvittering.ts";
import { sendKvittering } from "./svarut.ts";
import { findPerson, newId } from "./state.ts";
import { buildAdvarsel, callUpstream, tryUpstream } from "./upstream.ts";
import { alternativVerdi, alternativLabel } from "./types.ts";
import { erKatalogsteg } from "./types.ts";
import type { Katalogsteg } from "./types.ts";
import { isDatakilde, type Datakilde } from "../../shared/samtykke.ts";
import type {
  ProsessDefinisjon,
  ProsessSteg,
  SpoersmaalsFelt,
  Prosessoekt,
  SjekkResultat,
  Stegtype,
  State
} from "./types.ts";

/*
 * Svaret på et lukket alternativsett kanoniseres her, og nowhere else: begge
 * skrivepunktene (POST /svar og QUESTION-handleren) kaller denne.
 *
 * Uten den ble «Støttekontakt» lagret som den sto, og feilen kom to steg senere
 * fra selectOrdningForFormaal - på et steg som ikke hadde noe med svaret å
 * gjøre, og med økten alt flyttet dit.
 */
function brett(tekst: string): string {
  return tekst
    .toLowerCase()
    .replace(/æ/g, "ae")
    // NFKD tar «å» og «é»; «ø» har ingen dekomponering og må stå for seg.
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ø/g, "o")
    .replace(/[^a-z0-9]/g, "");
}

function kanoniserAlternativ(felt: SpoersmaalsFelt, verdi: unknown): string {
  const alternativer = felt.alternativer || [];
  const brettet = brett(String(verdi));
  const treff = alternativer.find(
    (alternativ) => brett(alternativVerdi(alternativ)) === brettet
      || brett(alternativLabel(alternativ)) === brettet
  );
  if (!treff) {
    const gyldige = alternativer.map(alternativVerdi).join(", ");
    throw new HttpError(`Ugyldig svar på feltet ${felt.id}. Gyldige: ${gyldige}.`, 400);
  }
  return alternativVerdi(treff);
}

export function normaliserValgsvar(steg: ProsessSteg, svar: unknown): unknown {
  if (steg.type !== "QUESTION") return svar;
  const valgfelter = (steg.felter || []).filter(
    (felt) => felt.type === "valg" && (felt.alternativer || []).length > 0
  );
  if (valgfelter.length === 0) return svar;

  // /stegvis poster et objekt nøklet på felt-id, /chat poster en ren streng.
  if (typeof svar === "string") {
    return (steg.felter || []).length === 1
      ? kanoniserAlternativ(valgfelter[0], svar)
      : svar;
  }
  if (!svar || typeof svar !== "object") return svar;

  const ut: Record<string, unknown> = { ...(svar as Record<string, unknown>) };
  for (const felt of valgfelter) {
    if (ut[felt.id] !== undefined && ut[felt.id] !== "") {
      ut[felt.id] = kanoniserAlternativ(felt, ut[felt.id]);
    }
  }
  return ut;
}

function replaceParametere(url: string, oekt: Prosessoekt) {
  let result = url;
  result = result.replace(/{personId}/g, encodeURIComponent(oekt.personId));
  for (const [stegId, svarVerdi] of Object.entries(oekt.svar || {})) {
    const enkeltMal = new RegExp(`\\{svar\\.${stegId}\\}`, "g");
    if (typeof svarVerdi === "string") {
      result = result.replace(enkeltMal, encodeURIComponent(svarVerdi));
    }
    if (typeof svarVerdi === "object" && svarVerdi !== null) {
      const felter = Object.entries(svarVerdi);
      for (const [feltId, feltVerdi] of felter) {
        const feltMal = new RegExp(`\\{svar\\.${stegId}\\.${feltId}\\}`, "g");
        result = result.replace(feltMal, encodeURIComponent(String(feltVerdi)));
      }
      // A one-field answer also satisfies the short form {svar.<stegId>}.
      //
      // The two reference clients disagree on shape for the same step: a QUESTION
      // with `felter` makes demo-gui's step-by-step page post an object
      // ({gatenavn: "Storgata"}), while /chat posts the raw string. Without this,
      // `fartsdempende-tiltak` worked in /chat and via curl but left a literal
      // "{svar.velg-gate}" in the URL on localhost:3001 - surfacing as
      // `Fant ikke gaten "{svar.velg-gate}"`, which reads like a typo by the user.
      //
      // Only when there is exactly one field: with several, the short form is
      // genuinely ambiguous and should stay unsubstituted.
      if (felter.length === 1) {
        result = result.replace(enkeltMal, encodeURIComponent(String(felter[0][1])));
      }
    }
  }
  return result;
}

type Samtykkekildeoppslag =
  | { status: "kjent"; kilde: Datakilde | null }
  | { status: "ukjent" };

// Den opprinnelige kalleren er ukjent for eldre resultater. Kildeklassifiseringen
// skal ikke arve identiteten til deltakeren som senere redigerer prosessen.
const legacyKildekaller: Caller = {
  type: "system",
  clientId: "sandbox-backend",
  scope: [],
  consumer: null
};

// Katalogen håndhever samtykket, så kilden leses derfra og ikke fra stegets
// eget kreverSamtykke - to erklæringer kunne bare komme ut av takt.
//
// `erKatalogsteg` og ikke en liste over stegtyper: porten skal gjelde nøyaktig de
// stegene getFraKatalog henter for. Med en liste var SJEKK glemt, og porten serverte
// beregningsbeløpet videre under vilkårsstegets id.
function finnSamtykkekildeForSteg(
  tilstand: State,
  oekt: Prosessoekt,
  steg: ProsessSteg | undefined,
  kaller: Caller
): Samtykkekildeoppslag {
  if (!steg) return { status: "ukjent" };
  const stegtype: unknown = (steg as { type?: unknown }).type;
  switch (stegtype) {
    case "INFO":
    case "QUESTION":
    case "CONSENT_REQUEST":
    case "SUMMARY":
    case "SUBMIT":
      return { status: "kjent", kilde: null };
    case "DATA_FETCH":
    case "SJEKK":
      break;
    default:
      return { status: "ukjent" };
  }
  if (!erKatalogsteg(steg)) return { status: "ukjent" };
  const url = new URL(`http://localhost${replaceParametere(steg.api.url, oekt)}`);
  const treff = findRessurs(steg.api.method || "GET", url.pathname);
  if (!treff) return { status: "ukjent" };
  const { ressurs, parametere } = treff;
  const sok = url.searchParams;
  const kilde = samtykkekildeFor(ressurs, {
    tilstand,
    parametere,
    sok,
    // Samme rekkefølge som runRessurs: en kilde som avhenger av ?personId= skal
    // avgjøres likt når data hentes og når økten serverer dem om igjen.
    personId: parametere.personId || sok.get("personId") || oekt.personId || "",
    sporingsId: oekt.sporingsId,
    oekt,
    steg,
    kaller
  });
  return { status: "kjent", kilde };
}

// Eldre økter har ingen lagrede kilder for avledede steg. Hvert lagret resultat
// må derfor enten ha kjent metadata eller fortsatt kunne knyttes entydig til et
// steg. En fjernet produsent gjør hele det avledede resultatet uløselig.
function legacyKilderForAvledetResultat(
  tilstand: State,
  oekt: Prosessoekt,
  prosess: ProsessDefinisjon | null,
  avledetStegId: string
): Datakilde[] | null {
  if (!prosess) return null;
  const kilder = new Set<Datakilde>();
  for (const stegId of Object.keys(oekt.resultaterRaa || {})) {
    if (stegId === avledetStegId) continue;

    const lagredeKilder = lagredeKilderForResultat(oekt, stegId);
    if (lagredeKilder === null) return null;
    if (lagredeKilder !== undefined) {
      for (const kilde of lagredeKilder) kilder.add(kilde);
      continue;
    }

    const stegtreff = prosess.steg.filter((kandidat) => kandidat.id === stegId);
    if (stegtreff.length !== 1) return null;
    const [steg] = stegtreff;
    if (steg.type === "SUMMARY" || steg.type === "SUBMIT") continue;
    const oppslag = finnSamtykkekildeForSteg(tilstand, oekt, steg, legacyKildekaller);
    if (oppslag.status === "ukjent") return null;
    if (oppslag.kilde) kilder.add(oppslag.kilde);
  }
  return [...kilder];
}

function lagredeKilderForResultat(oekt: Prosessoekt, stegId: string): Datakilde[] | null | undefined {
  const metadata = oekt.resultatKilder as unknown;
  if (metadata === undefined) return undefined;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const kilder = (metadata as Record<string, unknown>)[stegId];
  if (kilder === undefined) return undefined;
  if (!Array.isArray(kilder) || !kilder.every(
    (kilde): kilde is Datakilde => typeof kilde === "string" && isDatakilde(kilde)
  )) {
    return null;
  }
  return [...new Set(kilder)];
}

function kilderForResultat(
  tilstand: State,
  oekt: Prosessoekt,
  prosess: ProsessDefinisjon | null,
  stegId: string
): Datakilde[] | null {
  const lagrede = lagredeKilderForResultat(oekt, stegId);
  if (lagrede !== undefined) return lagrede;
  if (oekt.resultatKilderFrosset) return null;

  const stegtreff = prosess?.steg?.filter((kandidat) => kandidat.id === stegId) || [];
  if (stegtreff.length !== 1) return null;
  const [steg] = stegtreff;
  if (steg.type === "SUMMARY" || steg.type === "SUBMIT") {
    return legacyKilderForAvledetResultat(tilstand, oekt, prosess, stegId);
  }
  const oppslag = finnSamtykkekildeForSteg(tilstand, oekt, steg, legacyKildekaller);
  if (oppslag.status === "ukjent") return null;
  return oppslag.kilde ? [oppslag.kilde] : [];
}

function krevKjentSamtykkekilde(oppslag: Samtykkekildeoppslag, stegId: string): Datakilde[] {
  if (oppslag.status === "kjent") return oppslag.kilde ? [oppslag.kilde] : [];
  throw new HttpError(
    `Prosessdefinisjonen for steget ${stegId} peker ikke på en kjent ressurs. ` +
    "Rett steget i prosessbyggeren før du fortsetter.",
    409
  );
}

function lagreResultat(
  oekt: Prosessoekt,
  stegId: string,
  resultat: unknown,
  kilder: readonly Datakilde[]
): void {
  oekt.resultaterRaa[stegId] = resultat;
  oekt.resultatKilder ??= {};
  oekt.resultatKilder[stegId] = [...new Set(kilder)];
}

/**
 * Pins missing metadata before the process builder can replace its only legacy source.
 *
 * A missing entry after this pass stays missing on purpose: the historical step could
 * not be resolved, so `resultaterNaa` must keep failing closed even if a later
 * definition introduces the same id.
 */
export function frysResultatKilder(
  tilstand: State,
  oekt: Prosessoekt,
  prosess: ProsessDefinisjon
): boolean {
  if (oekt.resultatKilderFrosset) return false;

  const metadata = oekt.resultatKilder as unknown;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    oekt.resultatKilderFrosset = true;
    return true;
  }

  for (const stegId of Object.keys(oekt.resultaterRaa || {})) {
    if (Object.hasOwn(oekt.resultatKilder, stegId)) continue;
    const kilder = kilderForResultat(tilstand, oekt, prosess, stegId);
    if (kilder !== null) {
      oekt.resultatKilder[stegId] = [...kilder];
    }
  }
  oekt.resultatKilderFrosset = true;
  return true;
}

/**
 * Resultatene økten kan svare med nå, ikke de den kunne svare med da stegene kjørte.
 *
 * Et samtykke kan være trukket eller ha utløpt i mellomtiden. Kildene som gjaldt da
 * resultatet ble lagret brukes selv om prosessdefinisjonen senere blir endret.
 */
export function resultaterNaa(
  tilstand: State,
  oekt: Prosessoekt,
  prosess: ProsessDefinisjon | null
) {
  const beholdt: Record<string, unknown> = {};
  const gjenlest = new Set<string>();
  const samtykkekilder = new Set<Datakilde>();
  const ukjenteResultater = new Set<string>();
  for (const [stegId, resultat] of Object.entries(oekt.resultaterRaa || {})) {
    const kilder = kilderForResultat(tilstand, oekt, prosess, stegId);
    if (kilder === null) {
      ukjenteResultater.add(stegId);
      continue;
    }
    if (kilder.every((kilde) =>
      hasGyldigSamtykke(tilstand, oekt.personId, kilde, oekt.aktivtSamtykkeId)
    )) {
      beholdt[stegId] = resultat;
      for (const kilde of kilder) {
        samtykkekilder.add(kilde);
        gjenlest.add(kilde);
      }
    }
  }
  return {
    resultater: beholdt,
    gjenlest: [...gjenlest],
    samtykkekilder: [...samtykkekilder],
    ukjenteResultater: [...ukjenteResultater]
  };
}

export function buildProsessoektRespons(
  oekt: Prosessoekt,
  prosess: ProsessDefinisjon | null,
  // Påkrevd med vilje: med en standardverdi ville en ny rute som glemmer den
  // servert ugjennomgåtte resultater, og det ville typesjekket.
  resultater: Record<string, unknown>
) {
  // De interne feltene destruktureres bort framfor å bli overskrevet av spredningen:
  // da er det umulig å svare med dem ved et uhell.
  const {
    resultaterRaa: _raa,
    resultatKilder: _kilder,
    resultatKilderFrosset: _frosset,
    ...resten
  } = oekt;
  return {
    ...resten,
    resultater,
    aktivtSteg: prosess?.steg?.[oekt.stegIndex] || null,
    totaltAntallSteg: prosess?.steg?.length || 0
  };
}

// DATA_FETCH and SJEKK consult the shared resource catalog through the same path
// as the HTTP router, so consent gating and audit cannot diverge between them.
async function getFraKatalog(tilstand: State, oekt: Prosessoekt, steg: Katalogsteg, kaller: Caller) {
  const resolvedUrl = replaceParametere(steg.api.url, oekt);
  return runRessurs(tilstand, steg.api.method || "GET", new URL(`http://localhost${resolvedUrl}`), {
    oekt,
    steg,
    sporingsId: oekt.sporingsId,
    kaller
  });
}

/*
 * The søknad is appended inside the write queue, not pushed onto the request's
 * own copy of the array and written whole. That was a lost update with no queue
 * at all: two SUBMIT at once, and the second writer's array never contained the
 * first søknad - no error, nothing in the log, one citizen's application gone.
 *
 * It takes no State any more, and that is the point: there is no request-scoped
 * copy left for it to write.
 */
export async function createSoknad(
  body: any,
  kaller: Caller,
  /**
   * Set only by the SUBMIT step handler below. Without it - the direct
   * POST /api/soknader route never passes it - the row and the response are
   * byte-identical to before these fields existed.
   *
   * `person` is the masked row readState() handed out, so the recipient this
   * service passes to SvarUt is already the protected one where that applies.
   */
  dokumentInfo?: { dokument: string; person: Person | null }
) {
  const nySoknad = {
    soknadId: newId("soknad"),
    personId: body.personId,
    prosessId: body.prosessId,
    status: "SENDT_INN",
    opprettet: new Date().toISOString(),
    sporingsId: body.sporingsId || newId("flyt"),
    syntetisk: true,
    ...(dokumentInfo ? { soknadsdokument: dokumentInfo.dokument } : {})
  };

  await updateJson("soknader.json", [], (soknader: unknown[]) => {
    soknader.push(nySoknad);
  });
  await addRevisjon({
    sporingsId: nySoknad.sporingsId,
    handling: "SOKNAD_SENDT_INN",
    ressurs: "soknad",
    aktor: aktorFor(kaller, nySoknad.personId)
  });

  /*
   * The Fiks task is best effort: the søknad is already recorded, and the citizen
   * is not made to send it again because a downstream queue is unhappy. But best
   * effort still means *one* way of degrading - tryUpstream's, not a local
   * ok-check.
   */
  const oppgave = await tryUpstream<unknown>(
    { service: "Fiks-simulatoren", action: "Å opprette oppgave" },
    async () => fetch(`${fiksBaseUrl}/fiks/oppgaver`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await maskinportenHeader(fiksDialogToken))
      },
      body: JSON.stringify({
        personId: nySoknad.personId,
        soknadId: nySoknad.soknadId,
        tittel: `Behandle ${body.prosessNavn || "søknad"}`,
        sporingsId: nySoknad.sporingsId
      })
    })
  );

  /*
   * The kvittering is the second best-effort step, and it is deliberately after
   * the task: the caseworker's queue is what the municipality owes itself, the
   * receipt is what it owes the citizen, and neither may cost the other. The
   * channel is not decided here - SvarUt reads KRR on `mottaker.digitalId` and
   * chooses, exactly as the real one does. Everything past the receipt (the
   * vedtaksbrev, the varsling, the further case handling) is still the
   * participants' build surface.
   *
   * `forsendelseId` is written back onto the row in a second pass through the
   * queue rather than held back until the send returns, so a søknad is stored
   * before anything downstream is attempted - and the row keeps no copy of the
   * advarsel: the response says what happened, the row says what exists.
   */
  const kvittering = dokumentInfo
    ? await sendKvittering(dokumentInfo.person, nySoknad.soknadId, body.prosessNavn)
    : null;
  const forsendelseId = kvittering?.ok ? kvittering.svar.id : undefined;
  if (forsendelseId) {
    await updateJson("soknader.json", [], (soknader: any[]) => {
      const rad = soknader.find((kandidat) => kandidat.soknadId === nySoknad.soknadId);
      if (rad) rad.forsendelseId = forsendelseId;
    });
  }

  return {
    ...nySoknad,
    ...(forsendelseId ? { forsendelseId } : {}),
    oppgave: oppgave.ok ? oppgave.data : buildAdvarsel(
      "Oppgaven i Fiks-simulatoren ble ikke opprettet. Søknaden er lagret.",
      oppgave.error.message
    ),
    ...(kvittering ? { forsendelse: kvittering.ok ? kvittering.svar : kvittering.advarsel } : {})
  };
}

type StegContext = {
  tilstand: State;
  oekt: Prosessoekt;
  prosess: ProsessDefinisjon;
  steg: ProsessSteg;
  body: any;
  /**
   * Resultatene økten kan svare med nå, ikke `oekt.resultaterRaa`. Regnet én gang i
   * `runStegHandling` og gitt videre, så en handler ikke kan glemme porten.
   */
  resultater: Record<string, unknown>;
  /** Samtykkekildene de tilgjengelige resultatene er bygget på. */
  samtykkekilder: Datakilde[];
  /** Lagrede resultater som mangler en sikker kobling til samtykkekilden. */
  ukjenteResultater: string[];
  /** Who is calling, from the token. See autentisering.ts. */
  kaller: Caller;
};

/*
 * Konteksten en handler får, med `steg` innsnevret til sin egen stegtype.
 *
 * Uten dette var `steg` en `any`, og da fikk CONSENT_REQUEST-handleren lese
 * `steg.api` og DATA_FETCH-handleren `steg.formaal` uten at noe sa fra. Nå er det
 * unionen i types.ts som bestemmer hva hver handler ser.
 */
/*
 * De to stegene som forbruker resultatene, gjør det ikke på et halvt grunnlag.
 *
 * Oppsummeringen og søknadsdokumentet bygges av de gjennomgåtte resultatene, så et
 * trukket samtykke tok inntekten og vedtakslinjen stille ut av begge - en tekst og et
 * dokument som ikke lenger sier hva avgjørelsen bygger på. Å nekte er det ærlige
 * svaret: innbyggeren har trukket grunnlaget, og da er det ikke noe å oppsummere
 * eller sende. 403, som ellers når samtykke mangler.
 */
function krevHeltGrunnlag(
  oekt: Prosessoekt,
  resultater: Record<string, unknown>,
  ukjenteResultater: string[]
): void {
  const gatetBort = Object.keys(oekt.resultaterRaa || {}).filter((stegId) => !(stegId in resultater));
  if (gatetBort.length === 0) return;
  if (gatetBort.some((stegId) => ukjenteResultater.includes(stegId))) {
    throw new HttpError(
      "Kildene til eldre resultater kan ikke fastslås, så søknaden kan ikke gå videre. " +
      "Start prosessen på nytt.",
      403
    );
  }
  throw new HttpError(
    "Samtykket søknaden bygger på er trukket eller utløpt, så den kan ikke gå videre. " +
    "Gi samtykke på nytt, så kan du fortsette.",
    403
  );
}

type StegContextFor<T extends Stegtype> = Omit<StegContext, "steg"> & {
  steg: Extract<ProsessSteg, { type: T }>;
};

// One handler per step type. A new step type is one entry here; the execution
// below needs no change. The mapped type makes the compiler demand a handler as
// soon as a new step type is added to types.ts.
export const stegHandlers: { [T in Stegtype]: (k: StegContextFor<T>) => unknown | Promise<unknown> } = {
  INFO: () => ({ type: "INFO", melding: "Informasjonssteg krever ingen handling." }),

  QUESTION: ({ oekt, steg, body }) => {
    const raatt = body.svar ?? oekt.svar[steg.id];
    if (!raatt) {
      throw new HttpError("Spørsmålssteg krever et svar.", 400);
    }
    const svar = normaliserValgsvar(steg, raatt);
    oekt.svar[steg.id] = svar;
    return { type: "QUESTION", svar };
  },

  CONSENT_REQUEST: async ({ oekt, steg, body, kaller }) => {
    if (body.handling === "opprett-samtykke") {
      const data = await callUpstream<any>(
        { service: "Fiks-simulatoren", action: "Å opprette samtykke", relayStatus: true },
        async () => fetch(`${fiksBaseUrl}/fiks/samtykke`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(await maskinportenHeader(fiksDialogToken))
          },
          body: JSON.stringify({
            personId: oekt.personId,
            formaal: steg.formaal,
            dataKilder: steg.dataKilder || [],
            sporingsId: oekt.sporingsId
          })
        })
      );
      oekt.aktivtSamtykkeId = data.samtykkeId;
      lagreResultat(oekt, steg.id, data, []);
      return data;
    }

    if (body.handling === "samtykkesvar") {
      const status = body.status || "SAMTYKKET";
      const samtykkeId = oekt.aktivtSamtykkeId;
      if (!samtykkeId) {
        throw new HttpError("Ingen aktiv samtykkeforespørsel finnes.", 400);
      }
      /*
       * The samtykke routes have a state machine from Del D on, so answering the
       * same request twice, or answering one that was withdrawn, comes back as
       * 409. Fiks's status and melding are passed through unchanged, so the
       * citizen reads what the samtykke service said rather than a paraphrase.
       */
      const data = await callUpstream<any>(
        { service: "Fiks-simulatoren", action: "Å svare på samtykket", relayStatus: true },
        async () => fetch(`${fiksBaseUrl}/fiks/samtykke/${samtykkeId}/svar`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...(await maskinportenHeader(fiksDialogToken))
          },
          body: JSON.stringify({
            status,
            sporingsId: oekt.sporingsId,
            // Only this service holds the verified token, so only it can say who
            // agreed. Without this the samtykke event would name fiks-simulator as
            // the actor - honest, but far less useful than the truth.
            aktor: aktorFor(kaller, oekt.personId)
          })
        })
      );
      lagreResultat(oekt, steg.id, data, []);
      return data;
    }

    throw new HttpError("Samtykkesteg krever handlingen opprett-samtykke eller samtykkesvar.", 400);
  },

  DATA_FETCH: async ({ tilstand, oekt, steg, kaller }) => {
    const kilder = krevKjentSamtykkekilde(
      finnSamtykkekildeForSteg(tilstand, oekt, steg, kaller),
      steg.id
    );
    const data = await getFraKatalog(tilstand, oekt, steg, kaller);
    lagreResultat(oekt, steg.id, data, kilder);
    return data;
  },

  SJEKK: async ({ tilstand, oekt, steg, kaller }) => {
    const kilder = krevKjentSamtykkekilde(
      finnSamtykkekildeForSteg(tilstand, oekt, steg, kaller),
      steg.id
    );
    const resultat = await getFraKatalog(tilstand, oekt, steg, kaller) as SjekkResultat;

    lagreResultat(oekt, steg.id, resultat, kilder);
    if (!resultat.godkjent) {
      oekt.status = "AVVIST";
      oekt.avvistMelding = resultat.melding;
    }
    await addRevisjon({
      sporingsId: oekt.sporingsId,
      handling: resultat.godkjent ? "SJEKK_OK" : "SJEKK_AVVIST",
      ressurs: "prosessoekt",
      aktor: aktorFor(kaller, oekt.personId)
    });
    return resultat;
  },

  /*
   * The gateway answers 200 with an `advarsel` when the model is unavailable and
   * it falls back to template text, so a failure here means the gateway itself
   * broke. Failing the step leaves the økt on SUMMARY - withSession saves
   * nothing when the handler throws - so a retry is a retry.
   */
  // Porten er tidspunktet for lesing, også når leseren er en prompt: et trukket
  // samtykke skal ikke nå modellen eller state/ai-trace.jsonl.
  SUMMARY: async ({
    oekt,
    prosess,
    steg,
    resultater,
    samtykkekilder,
    ukjenteResultater
  }) => {
    krevHeltGrunnlag(oekt, resultater, ukjenteResultater);
    const data = await callUpstream<any>(
      { service: "KI-tjenesten", action: "Å lage oppsummeringen" },
      () => fetch(`${aiBaseUrl}/ai/oppsummering`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sporingsId: oekt.sporingsId,
          kontekst: {
            tjeneste: prosess.navn,
            prosessId: oekt.prosessId,
            data: resultater,
            svar: oekt.svar
          },
          sprak: "nb"
        })
      })
    );
    lagreResultat(oekt, steg.id, data, samtykkekilder);
    return data;
  },

  SUBMIT: async ({
    tilstand,
    oekt,
    prosess,
    steg,
    resultater,
    samtykkekilder,
    ukjenteResultater,
    kaller
  }) => {
    const person = findPerson(tilstand, oekt.personId);
    krevHeltGrunnlag(oekt, resultater, ukjenteResultater);
    // Dokumentet lagres på søknadsraden og går til SvarUt, så det som står i det
    // kommer ikke ut igjen. Derfor samme port som svaret på økten.
    const dokument = buildSoknadsdokument(prosess, oekt, person, resultater);
    const data = await createSoknad({
      personId: oekt.personId,
      prosessId: oekt.prosessId,
      prosessNavn: prosess.navn,
      sporingsId: oekt.sporingsId
    }, kaller, { dokument, person });
    lagreResultat(oekt, steg.id, data, samtykkekilder);
    oekt.status = "FULLFORT";
    return data;
  }
};

export async function runStegHandling(
  tilstand: State,
  oekt: Prosessoekt,
  prosess: ProsessDefinisjon,
  body: any,
  kaller: Caller
) {
  const steg: ProsessSteg | undefined = prosess.steg[oekt.stegIndex];
  if (!steg) {
    throw new HttpError("Fant ikke aktivt steg.", 400);
  }

  // Oppslaget er på `steg.type`, så handleren og steget hører sammen - men det vet
  // bare kjøretiden, og derfor står castet her framfor i hver handler.
  const handterer = stegHandlers[steg.type as Stegtype] as
    ((k: StegContext) => unknown | Promise<unknown>) | undefined;
  if (!handterer) {
    throw new HttpError(
      `Støtter ikke stegtypen ${steg.type}. Gyldige: ${Object.keys(stegHandlers).join(", ")}.`,
      400
    );
  }

  const { resultater, samtykkekilder, ukjenteResultater } =
    resultaterNaa(tilstand, oekt, prosess);
  return handterer({
    tilstand,
    oekt,
    prosess,
    steg,
    body,
    resultater,
    samtykkekilder,
    ukjenteResultater,
    kaller
  });
}
