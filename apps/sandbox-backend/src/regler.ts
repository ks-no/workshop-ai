import { maskinportenHeader } from "../../digdir-mock/src/client.ts";
import { getNorwegianCalendarYear } from "../../shared/dato.ts";
// The samtykke kodeverk belongs to the service that owns the resource, and expiry
// is part of it. This backend reads state/samtykker.json directly - a sandbox
// simplification it already lived with - so importing the rule is strictly better
// than keeping a second copy of it here that can drift.
import { effektivStatus } from "../../shared/samtykke.ts";
import { HttpError } from "./errors.ts";
import { fiksBaseUrl, fiksRegisterToken, fiksRolleId } from "./config.ts";
import { findPerson, getHusstandForPerson } from "./state.ts";
import { callUpstream } from "./upstream.ts";
import type { Satser, SjekkResultat, State } from "./types.ts";
// The rules themselves live in vilkaar.ts and are pure. This file is the I/O half:
// it fetches the beregning, then hands the numbers over. The arrow points one way,
// and pnpm test:vilkaar fails if vilkaar.ts imports this file back.
import { regelBehov, evaluateVilkaar } from "./vilkaar.ts";
import { finnGjeldendeLegeerklaering } from "./pasientjournal.ts";
import { finnGjeldendeAttest } from "./politiattest.ts";

// Fetches the household income basis from the Fiks simulator. Spouses, registered
// partners and cohabitants count as one household, per forskrift om
// foreldrebetaling. Return type stays any until the Fiks response is modelled in
// types.ts.
async function getInntektsgrunnlag(tilstand: State, personId: string, inntektsaar: number): Promise<any> {
  const husstand = getHusstandForPerson(tilstand, personId);
  const personer = husstand.medlemmer
    .filter((medlem: any) => medlem.rolle === "foresatt")
    .map((medlem: any) => {
      const person = findPerson(tilstand, medlem.personId);
      // `pnpm test` holds referential integrity across data/, so this cannot
      // happen from the seed. It can happen from a shadowed state/husstander.json
      // or a hand edit - and the old `any` turned that into «Cannot read
      // properties of null» from inside a Fiks call, which names nothing.
      if (!person) {
        throw new HttpError(
          `Husstanden viser til ${medlem.personId}, som ikke finnes i personregisteret.`,
          500
        );
      }
      return {
        identifikator: person.syntetiskFodselsnummer,
        type: medlem.personId === personId ? "SOEKER" : "ANNET"
      };
    });

  // A plain Error here became «Intern feil i sandbox-backend» with the status
  // buried in `detalj`, which named this service for a failure in another one.
  // upstream.ts owns that reading now - see the header comment there.
  return callUpstream<any>(
    { service: "Fiks-simulatoren", action: "Beregningen av inntektsgrunnlaget" },
    async () => fetch(
      `${fiksBaseUrl}/register/api/v1/ks/${fiksRolleId}/skatteoginntektsopplysninger/beregning/redusert-foreldrebetaling`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await maskinportenHeader(fiksRegisterToken))
        },
        body: JSON.stringify({ inntektsaar, personer })
      }
    )
  );
}

function sisteInntektsaar(tilstand: State, personId: string) {
  const husstand = getHusstandForPerson(tilstand, personId);
  const identer = husstand.medlemmer
    .filter((medlem: any) => medlem.rolle === "foresatt")
    .map((medlem: any) => findPerson(tilstand, medlem.personId)?.syntetiskFodselsnummer);
  const aar = tilstand.inntekter
    .filter((rad: any) => identer.includes(rad.identifikator))
    .map((rad: any) => rad.inntektsaar);
  return aar.length ? Math.max(...aar) : getNorwegianCalendarYear() - 1;
}

export async function getInntektForPerson(tilstand: State, personId: string) {
  return getInntektsgrunnlag(tilstand, personId, sisteInntektsaar(tilstand, personId));
}

// Assesses one ordning in data/satser.json against the income basis from Fiks.
// The calculation is deterministic and happens here, not in the AI layer - see
// ai-no-decisions in policies/ai-policy.yaml.
export async function evaluateOrdning(tilstand: State, personId: string, ordningId: string | null): Promise<SjekkResultat> {
  const satser: Satser = tilstand.satser;
  const ordning = satser.ordninger.find((kandidat) => kandidat.id === ordningId);
  if (!ordning) {
    throw new Error(`Ukjent ordning: ${ordningId}. Gyldige: ${satser.ordninger.map((o) => o.id).join(", ")}.`);
  }

  // Only fetch income for rules that actually use it. Asking for an income basis to
  // assess støttekontakt would pull data the decision never touches, and drag the
  // consent for it along - the opposite of what consent-before-income is for.
  const behov = regelBehov[ordning.regel];
  const brukerInntekt = behov.inntekt;
  const beregning = brukerInntekt
    ? await getInntektsgrunnlag(tilstand, personId, sisteInntektsaar(tilstand, personId))
    : null;

  if (beregning && beregning.feilmeldinger.length > 0) {
    const feil = beregning.feilmeldinger[0];
    return {
      godkjent: false,
      melding: feil.melding,
      grunnlag: { ordning: ordning.id, feilkode: feil.kode, stadie: beregning.stadie }
    };
  }

  // Samme mekanikk som over: bare reglene som faktisk bruker et journalutdrag
  // henter et. Å slå opp i journalen for en barnehageordning ville vært å lese
  // særlige kategorier vedtaket aldri rører.
  const legeerklaering = behov.legeerklaering
    ? await finnGjeldendeLegeerklaering(tilstand, personId, satser.gjelderFra)
    : null;

  // Samme mekanikk igjen: bare vandelskontrollen slår opp en politiattest. En
  // straffedom er artikkel 10-opplysninger, og de leses ikke for en ordning
  // vedtaket aldri rører.
  const politiattest = behov.politiattest && ordning.formaal
    ? await finnGjeldendeAttest(tilstand, personId, ordning.formaal)
    : null;

  const grunnlag = beregning ? beregning.beregningsbeloep : null;
  const felles = {
    ordning: ordning.id,
    ordningNavn: ordning.navn,
    ...(beregning ? { beregningsbeloep: grunnlag, stadie: beregning.stadie } : {}),
    gjelderFra: satser.gjelderFra,
    kilde: ordning.kilde
  };
  const forbehold = beregning?.stadie === "UTKAST"
    ? " Merk at skatteoppgjøret ikke er ferdig, så grunnlaget kan endre seg."
    : "";

  return evaluateVilkaar(ordning.regel, {
    tilstand, personId, ordning, satser, grunnlag, legeerklaering, politiattest, felles, forbehold
  });
}

// Every samtykke this person has given for this source, whatever state it is in.
/*
 * De tre samtykkepredikatene leser bare tilstand.samtykker. Parameteren sier det,
 * framfor å kreve hele State - da kan de kalles med et par rader fra en test uten
 * at testen må bygge en hel tilstand den ikke bruker.
 */
type Samtykketilstand = Pick<State, "samtykker">;

function samtykkerFor(tilstand: Samtykketilstand, personId: string, datakilde: string) {
  return tilstand.samtykker.filter((samtykke: any) =>
    samtykke.personId === personId &&
    Array.isArray(samtykke.dataKilder) &&
    samtykke.dataKilder.includes(datakilde)
  );
}

/**
 * The samtykke that authorises reading `datakilde` for `personId`, or null.
 *
 * `foretrukketId` is the consent the current process session just created. It
 * matters because a person can hold several valid consents for the same source,
 * and the audit log records *which* one justified the read - that is the whole
 * point of writing `grunnlag`. Picking the first match meant a flow could log a
 * consent from a previous run as the basis for this read, and then the trail
 * could not be followed back to the moment the citizen agreed.
 *
 * Without a preference, the most recently created one wins. An arbitrary order is
 * the one thing an audit basis must not be.
 *
 * Expiry counts from Del D on: `utloper` was written 30 days ahead and read by
 * nobody, so a consent given a year ago still opened the income route. The status
 * comes from `effektivStatus`, which is the only place that rule lives - see
 * fiks-simulator/src/samtykke.ts.
 */
export function hasGyldigSamtykke(
  tilstand: Samtykketilstand,
  personId: string,
  datakilde: string,
  foretrukketId?: string | null
) {
  const gyldige = samtykkerFor(tilstand, personId, datakilde)
    .filter((samtykke: any) => effektivStatus(samtykke) === "SAMTYKKET");
  if (gyldige.length === 0) {
    return null;
  }
  const foretrukket = foretrukketId
    ? gyldige.find((samtykke: any) => samtykke.samtykkeId === foretrukketId)
    : null;
  if (foretrukket) {
    return foretrukket;
  }
  return gyldige.reduce((nyeste: any, kandidat: any) =>
    String(kandidat.opprettet || "") > String(nyeste.opprettet || "") ? kandidat : nyeste
  );
}

/**
 * Whether the citizen ever did consent to this source, and it has since run out.
 *
 * Only used to pick which of the two refusals to answer with. "Krever registrert
 * samtykke" is a confusing thing to read when you remember agreeing - the useful
 * answer says the consent expired and has to be given again.
 */
export function hasUtloeptSamtykke(tilstand: Samtykketilstand, personId: string, datakilde: string) {
  return samtykkerFor(tilstand, personId, datakilde)
    .some((samtykke: any) => effektivStatus(samtykke) === "UTLOEPT");
}
