// Samtykke gitt og trukket utenfor en prosessøkt.
//
// CONSENT_REQUEST i prosess.ts er den ene veien inn i dag: innbyggeren møter
// spørsmålet midt i en flyt, og svarer der. Dette er den andre - fra en oversikt
// over hva man kan søke på, før noen flyt er startet - og den skal være det
// *samme* samtykket, ikke et sidespor. Derfor tas både `formaal` og `dataKilder`
// fra prosessens eget CONSENT_REQUEST-steg, og derfor går skrivingen samme vei:
// POST /fiks/samtykke og PUT /fiks/samtykke/{id}/svar hos fiks-simulator, med
// tjenestens maskinporten-token og innbyggeren som `aktor`. En rad i
// state/samtykker.json skal ikke kunne røpe hvilken flate den ble til i.
import { maskinportenHeader } from "../../digdir-mock/src/client.ts";
import { aktorFor, type Caller } from "./autentisering.ts";
import { fiksBaseUrl, fiksDialogToken } from "./config.ts";
import { HttpError } from "./errors.ts";
import { hasGyldigSamtykke } from "./regler.ts";
import type { ProsessDefinisjon, State } from "./types.ts";
import { DATAKILDER, effektivStatus, isDatakilde, type Datakilde } from "../../shared/samtykke.ts";
import { callUpstream } from "./upstream.ts";

/** Datakildene personen har et gyldig samtykke for nå. */
export function kilderMedSamtykke(tilstand: State, personId: string): Datakilde[] {
  return DATAKILDER.filter((kilde) => Boolean(hasGyldigSamtykke(tilstand, personId, kilde)));
}

/** Ett CONSENT_REQUEST-steg, lest som det samtykket det ber om. */
type Samtykkebehov = { formaal: string; dataKilder: Datakilde[] };

function samtykkebehovene(prosess: ProsessDefinisjon): Samtykkebehov[] {
  return prosess.steg.flatMap((steg) => {
    if (steg.type !== "CONSENT_REQUEST") return [];
    // Ukjente koder siles bort framfor å lagres: hasGyldigSamtykke sammenligner
    // med includes, så en kilde utenfor kodeverket ville blitt et samtykke som
    // aldri kan åpne noen port. Se apps/shared/samtykke.ts.
    const dataKilder = (steg.dataKilder || []).filter(isDatakilde);
    if (dataKilder.length === 0) return [];
    return [{ formaal: steg.formaal || prosess.navn, dataKilder }];
  });
}

async function fiksKall<T>(
  action: string,
  sti: string,
  metode: string,
  kropp: Record<string, unknown>
): Promise<T> {
  const data = await callUpstream<T>(
    { service: "Fiks-simulatoren", action, relayStatus: true },
    async () => fetch(`${fiksBaseUrl}${sti}`, {
      method: metode,
      headers: {
        "Content-Type": "application/json",
        ...(await maskinportenHeader(fiksDialogToken))
      },
      body: JSON.stringify(kropp)
    })
  );
  if (!data) {
    throw new HttpError("Fiks-simulatoren svarte uten innhold på samtykkekallet.", 502);
  }
  return data;
}

/**
 * Gir samtykkene prosessen ber om, og svarer ja på dem med én gang.
 *
 * To kall og ikke ett, fordi det er to hendelser: kommunen spør, innbyggeren
 * svarer. Revisjonsloggen skal ha begge, og fiks-simulator fører dem med hver sin
 * `aktor` - se samtykkeAktor der.
 *
 * Et behov som allerede er dekket hoppes over framfor å bli et samtykke til: en
 * bryter som slås på to ganger skal ikke legge igjen to rader for samme kilde.
 * Det er samme regnestykke som porten gjør - `hasGyldigSamtykke` slår opp på
 * datakilde, så en rad til hjemler ingenting den forrige ikke alt hjemlet.
 * Tom liste tilbake er derfor et svar, og ruten svarer 200 framfor 201 på den.
 */
export async function giSamtykker(
  tilstand: State,
  personId: string,
  prosess: ProsessDefinisjon,
  kaller: Caller,
  sporingsId: string
): Promise<unknown[]> {
  const behovene = samtykkebehovene(prosess);
  if (behovene.length === 0) {
    throw new HttpError(
      `Prosessen ${prosess.id} har ingen CONSENT_REQUEST-steg, så det er ingenting å samtykke til. ` +
      `Formålet og datakildene et samtykke skal bære står i det steget, og kan ikke finnes på her.`,
      400
    );
  }

  const samtykker: unknown[] = [];
  for (const behov of behovene) {
    if (behov.dataKilder.every((kilde) => hasGyldigSamtykke(tilstand, personId, kilde))) continue;

    const opprettet = await fiksKall<{ samtykkeId: string }>(
      "Å opprette samtykke",
      "/fiks/samtykke",
      "POST",
      { personId, formaal: behov.formaal, dataKilder: behov.dataKilder, sporingsId }
    );
    samtykker.push(await fiksKall(
      "Å svare på samtykket",
      `/fiks/samtykke/${opprettet.samtykkeId}/svar`,
      "PUT",
      // Bare denne tjenesten har det verifiserte tokenet, så bare den kan si hvem
      // som samtykket. Uten dette ville hendelsen pekt på fiks-simulator.
      { status: "SAMTYKKET", sporingsId, aktor: aktorFor(kaller, personId) }
    ));
  }
  return samtykker;
}

/**
 * Trekker hvert gyldig samtykke som dekker datakilden.
 *
 * Alle, ikke det nyeste: `hasGyldigSamtykke` åpner porten på et hvilket som helst
 * av dem, så et halvt tilbaketrekk hadde vært ingen. At det kan være flere er
 * ikke en feil - de er gitt til hvert sitt formål - og alle sier de samme
 * opplysningene, så innbyggeren som sier nei sier nei til dem.
 *
 * Tomt svar er et gyldig svar. Å trekke noe som alt er trukket er ikke en feil å
 * melde, det er ingenting å gjøre.
 */
export async function trekkSamtykker(
  tilstand: State,
  personId: string,
  datakilde: Datakilde,
  kaller: Caller,
  sporingsId: string
): Promise<unknown[]> {
  const gyldige = tilstand.samtykker.filter((samtykke) =>
    samtykke.personId === personId
    && Array.isArray(samtykke.dataKilder)
    && samtykke.dataKilder.includes(datakilde)
    && effektivStatus(samtykke) === "SAMTYKKET");

  const trukket: unknown[] = [];
  for (const samtykke of gyldige) {
    trukket.push(await fiksKall(
      "Å trekke samtykket",
      `/fiks/samtykke/${samtykke.samtykkeId}/trekk`,
      "PUT",
      { sporingsId, aktor: aktorFor(kaller, personId) }
    ));
  }
  return trukket;
}
