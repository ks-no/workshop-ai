/**
 * Forsendelsens tilstandsmaskin, kanalvalg og utledede status.
 *
 * SvarUt simplified: the routes live on the real forsendelse paths behind a
 * /svarut prefix, and this module holds everything that is a rule rather than
 * HTTP. The status set is an honest subset of the real API's thirteen — the
 * omitted ones are listed in openapi/fiks-simulator.yaml, and the enum there is
 * pinned against FORSENDELSESSTATUSER by pnpm test:openapi.
 *
 * The progression is derived, never written — same pattern as the samtykke's
 * UTLOEPT (see samtykke.ts): the stored row carries `kanal` and `opprettet`,
 * and deriveForsendelsesstatus answers what the status is *now*. No timers, no
 * second write path, no race. The state machine below is not enforced by any
 * PUT; it exists so a test can prove every step the derivation takes is a legal
 * transition, and so the spec has one kodeverk to pin.
 */

import { createTilstandsmaskin } from "../../shared/statemachine.ts";
import type { Krr } from "../../shared/innbyggerdata.ts";

export type Forsendelsesstatus =
  | "MOTTATT"
  | "SENDT_DIGITALT"
  | "SENDT_PRINT"
  | "IKKE_LEVERT"
  | "LEST"
  | "PRINTET";

// A forsendelse that cannot be delivered on any channel fails at dispatch, not
// after: IKKE_LEVERT is reachable from MOTTATT only.
export const FORSENDELSESOVERGANGER: Record<Forsendelsesstatus, Forsendelsesstatus[]> = {
  MOTTATT: ["SENDT_DIGITALT", "SENDT_PRINT", "IKKE_LEVERT"],
  SENDT_DIGITALT: ["LEST"],
  SENDT_PRINT: ["PRINTET"],
  IKKE_LEVERT: [],
  LEST: [],
  PRINTET: []
};

const maskin = createTilstandsmaskin<Forsendelsesstatus>("Forsendelsen", FORSENDELSESOVERGANGER);

export const FORSENDELSESSTATUSER = maskin.statuses;
export const isForsendelsesstatus = maskin.isStatus;
export const validateForsendelsesovergang = maskin.validateOvergang;

/** How the forsendelse leaves the municipality. Decided once, at creation. */
export type Kanal = "DIGITAL" | "PRINT" | "INGEN";

export type Mottaker = {
  navn?: string;
  /** Fødselsnummer, looked up in KRR to decide the channel. */
  digitalId?: string;
  adresselinje1?: string;
  adresselinje2?: string;
  adresselinje3?: string;
  postnummer?: string;
  poststed?: string;
};

/** Only the metadata — the simulator never stores document bytes. */
export type Forsendelsesdokument = { filnavn?: string; mimeType?: string };

export type Utskriftskonfigurasjon = { utskriftMedFarger?: boolean; tosidig?: boolean };

/**
 * The request body: the metadata part of the real API's multipart, unchanged,
 * with the real field names. JSON instead of multipart is a flagged deviation.
 */
export type ForsendelseKropp = {
  tittel?: string;
  mottaker?: Mottaker;
  dokumenter?: Forsendelsesdokument[];
  konteringskode?: string;
  avgivendeSystem?: string;
  kunDigitalLevering?: boolean;
  eksternReferanse?: string;
  utskriftskonfigurasjon?: Utskriftskonfigurasjon;
};

/** The stored row: the metadata plus the decision — no status, that is derived. */
export type Forsendelse = ForsendelseKropp & {
  id: string;
  kontoId: string;
  kanal: Kanal;
  opprettet: string;
  syntetisk: boolean;
};

// The delays the derivation runs on. Long enough that an immediate status-sok
// deterministically answers MOTTATT, short enough that a hackathon team sees
// the whole progression inside a coffee refill.
export const SENDT_ETTER_MS = 10_000;
export const LEVERT_ETTER_MS = 60_000;

export type Forsendelsesfeil = { kode: string; melding: string };

/**
 * The validation the type cannot do: the body is JSON off the wire. First
 * failure wins — the caller gets one 400 with one kode, like the beregning's
 * feilmeldinger but for a write that must not happen at all.
 */
export function validateForsendelse(body: ForsendelseKropp): Forsendelsesfeil | null {
  if (typeof body.tittel !== "string" || !body.tittel.trim()) {
    return { kode: "TITTEL_MANGLER", melding: "tittel er påkrevd." };
  }
  const navn = body.mottaker?.navn;
  if (typeof navn !== "string" || !navn.trim()) {
    return { kode: "MOTTAKERNAVN_MANGLER", melding: "mottaker.navn er påkrevd." };
  }
  if (!Array.isArray(body.dokumenter) || body.dokumenter.length === 0) {
    return { kode: "UGYLDIG_DOKUMENTLISTE", melding: "dokumenter må inneholde minst ett dokument." };
  }
  const sett = new Set<string>();
  for (const dokument of body.dokumenter) {
    const filnavn = typeof dokument?.filnavn === "string" ? dokument.filnavn.trim() : "";
    const mimeType = typeof dokument?.mimeType === "string" ? dokument.mimeType.trim() : "";
    if (!filnavn || !mimeType) {
      return { kode: "UGYLDIG_DOKUMENTLISTE", melding: "hvert dokument må ha filnavn og mimeType." };
    }
    const noekkel = `${filnavn} ${mimeType}`;
    if (sett.has(noekkel)) {
      return {
        kode: "UGYLDIG_DOKUMENTLISTE",
        melding: `dokumentlisten har duplikat: ${filnavn} (${mimeType}).`
      };
    }
    sett.add(noekkel);
  }
  return null;
}

/** A postal address the print channel can actually reach. */
export function hasPostadresse(mottaker: Mottaker): boolean {
  return Boolean(
    typeof mottaker.adresselinje1 === "string" && mottaker.adresselinje1.trim() &&
    typeof mottaker.postnummer === "string" && /^[0-9]{4}$/.test(mottaker.postnummer) &&
    typeof mottaker.poststed === "string" && mottaker.poststed.trim()
  );
}

export type Kanalutfall =
  | { lovlig: true; kanal: Kanal }
  | { lovlig: false; status: 400; kode: "MANGLER_MOTTAKERADRESSE"; melding: string };

/**
 * The channel decision, in the order the rules bind:
 *
 *   1. a KRR row that can be notified and is not reserved → DIGITAL
 *   2. otherwise kunDigitalLevering → INGEN (→ IKKE_LEVERT, real SvarUt behaviour)
 *   3. otherwise a valid postal address → PRINT — reservert i KRR betyr print,
 *      which is the case the whole surface exists to make testable
 *   4. otherwise the forsendelse cannot go anywhere, and that is a 400
 *
 * The KRR lookup itself happens at the route, which has the data; this function
 * gets the row and stays pure so the table can be tested without a server.
 */
export function chooseKanal(
  mottaker: Mottaker,
  kunDigitalLevering: boolean,
  krrRad: Pick<Krr, "kanVarsles" | "reservert"> | undefined
): Kanalutfall {
  if (krrRad && krrRad.kanVarsles && !krrRad.reservert) {
    return { lovlig: true, kanal: "DIGITAL" };
  }
  if (kunDigitalLevering) {
    return { lovlig: true, kanal: "INGEN" };
  }
  if (hasPostadresse(mottaker)) {
    return { lovlig: true, kanal: "PRINT" };
  }
  return {
    lovlig: false,
    status: 400,
    kode: "MANGLER_MOTTAKERADRESSE",
    melding:
      "Mottakeren kan ikke nås: ingen digital kanal i kontaktregisteret, og ingen " +
      "gyldig postadresse (adresselinje1, firesifret postnummer og poststed)."
  };
}

/**
 * The status the forsendelse actually has now, derived from the clock.
 *
 * `naa` is a parameter so a test can pin it — same contract as samtykke.ts'
 * isUtloept. sisteStatusEndring is derived along with the status: the moment
 * the row *entered* the answered status, not when anyone asked.
 *
 * Every reader must go through this. Storing the status and advancing it on a
 * timer is the bug this function exists to prevent: two write paths to one row.
 */
export function deriveForsendelsesstatus(
  forsendelse: Pick<Forsendelse, "kanal" | "opprettet">,
  naa: number = Date.now()
): { status: Forsendelsesstatus; sisteStatusEndring: string } {
  const opprettet = Date.parse(forsendelse.opprettet);
  // Persisted rubbish (a hand-edited state file): answer MOTTATT forever rather
  // than throw from inside a read path.
  if (!Number.isFinite(opprettet) || naa < opprettet + SENDT_ETTER_MS) {
    return {
      status: "MOTTATT",
      sisteStatusEndring: Number.isFinite(opprettet)
        ? new Date(opprettet).toISOString()
        : String(forsendelse.opprettet)
    };
  }
  if (forsendelse.kanal === "INGEN") {
    return { status: "IKKE_LEVERT", sisteStatusEndring: new Date(opprettet + SENDT_ETTER_MS).toISOString() };
  }
  if (naa < opprettet + LEVERT_ETTER_MS) {
    return {
      status: forsendelse.kanal === "DIGITAL" ? "SENDT_DIGITALT" : "SENDT_PRINT",
      sisteStatusEndring: new Date(opprettet + SENDT_ETTER_MS).toISOString()
    };
  }
  return {
    status: forsendelse.kanal === "DIGITAL" ? "LEST" : "PRINTET",
    sisteStatusEndring: new Date(opprettet + LEVERT_ETTER_MS).toISOString()
  };
}
