/*
 * What the citizen gets back when a søknad is sent in: the søknadsdokument and
 * the SvarUt-forsendelsen it is delivered as.
 *
 * Both halves are pure — no fetch, no state, no token client — so the skjerming
 * test can run them straight off the seed without a stack and without paying for
 * digdir-mock's 2048-bit keypair at module load. svarut.ts is the I/O half and
 * imports this one; the arrow never goes back.
 */

import { isSkjermet } from "../../shared/skjerming.ts";
import type { Person } from "../../shared/innbyggerdata.ts";
import type { ProsessDefinisjon, ProsessSteg, Prosessoekt, SjekkResultat } from "./types.ts";

// A DATA_FETCH result's own id-fields and fødselsnummer never belong in a document
// the citizen reads back — those are for the audit log and the wire, not for the
// application content. "Id-suffikser" catches personId/husstandId/matrikkelId/...
// without a per-resource allowlist that would need updating for every new ressurs.
const FODSELSNUMMER_MOENSTER = /fodselsnummer|fnr/i;

function erDokumenterbartFelt([noekkel, verdi]: [string, unknown]): boolean {
  if (typeof verdi !== "string" && typeof verdi !== "number" && typeof verdi !== "boolean") {
    return false;
  }
  return noekkel !== "syntetisk" && !FODSELSNUMMER_MOENSTER.test(noekkel) && !/Id$/.test(noekkel);
}

// oekt.svar holds either the field-keyed object demo-gui's stegvis-side posts, or
// the bare value /chat posts for a one-field spørsmål (see replaceParametere in
// prosess.ts) — both are handled here so the document reads the same regardless
// of which client answered.
function svarLinjerForSteg(steg: ProsessSteg, verdi: unknown): string[] {
  if (steg.type !== "QUESTION" || verdi === undefined || verdi === null) {
    return [];
  }
  const felter = steg.felter || [];
  if (typeof verdi === "object") {
    return felter
      .filter((felt) => (verdi as Record<string, unknown>)[felt.id] !== undefined)
      .map((felt) => `${felt.label}: ${(verdi as Record<string, unknown>)[felt.id]}`);
  }
  const label = felter.length === 1 ? felter[0].label : steg.tittel || steg.id;
  return [`${label}: ${verdi}`];
}

function dataFetchLinjeForSteg(steg: ProsessSteg, resultat: unknown): string | null {
  if (steg.type !== "DATA_FETCH" || !resultat || typeof resultat !== "object" || Array.isArray(resultat)) {
    return null;
  }
  const felter = Object.entries(resultat as Record<string, unknown>).filter(erDokumenterbartFelt);
  if (!felter.length) return null;
  return `${steg.tittel || steg.id}: ${felter.map(([noekkel, verdi]) => `${noekkel}=${verdi}`).join(", ")}`;
}

/*
 * Builds the søknadsdokument as plain text — no PDF, no KI-kall. Walked off
 * prosess.steg in definition order rather than Object.keys(oekt.svar /
 * oekt.resultater), so the section order cannot drift with insertion order, and
 * off oekt.svar/resultater rather than re-deriving anything, so the document
 * matches exactly what the citizen answered and what was looked up for them.
 *
 * Deliberately no ids or timestamps in the text: those live on the søknadsrad,
 * so the same svar produce byte-identical text every time (see
 * kontrakt-smoke.ts's before/after diff).
 */
export function buildSoknadsdokument(
  prosess: ProsessDefinisjon,
  oekt: Prosessoekt,
  person: Person | null
): string {
  const navn = person ? fulltNavn(person) : oekt.personId;

  const linjer: string[] = [
    `Søknad: ${prosess.navn}${prosess.versjon ? ` (versjon ${prosess.versjon})` : ""}`,
    `Søker: ${navn} (${oekt.personId})`,
    ""
  ];

  const svarLinjer = prosess.steg.flatMap((steg) => svarLinjerForSteg(steg, oekt.svar[steg.id]));
  if (svarLinjer.length) {
    linjer.push("Svar:", ...svarLinjer.map((linje) => `- ${linje}`), "");
  }

  const dataLinjer = prosess.steg
    .map((steg) => dataFetchLinjeForSteg(steg, oekt.resultater[steg.id]))
    .filter((linje): linje is string => linje !== null);
  if (dataLinjer.length) {
    linjer.push("Innhentede opplysninger:", ...dataLinjer.map((linje) => `- ${linje}`), "");
  }

  for (const steg of prosess.steg) {
    if (steg.type !== "SJEKK") continue;
    const resultat = oekt.resultater[steg.id] as SjekkResultat | undefined;
    if (!resultat) continue;
    linjer.push(`Sjekk: ${resultat.godkjent ? "Godkjent" : "Avvist"} — ${resultat.melding}`, "");
  }

  for (const steg of prosess.steg) {
    if (steg.type !== "SUMMARY") continue;
    const resultat = oekt.resultater[steg.id] as { tekst?: string } | undefined;
    if (resultat?.tekst) {
      linjer.push("Oppsummering:", resultat.tekst, "");
    }
  }

  while (linjer.length && linjer[linjer.length - 1] === "") {
    linjer.pop();
  }
  return linjer.join("\n");
}

/*
 * The forsendelse body, as SvarUt' send-API wants it — the metadata part of the
 * real multipart, which is all fiks-simulator accepts and all it stores. The
 * document text itself stays on the søknadsrad: the simulator never keeps
 * document bytes, so `dokumenter` names the attachment rather than carrying it.
 */
export type Kvitteringsmottaker = {
  navn: string;
  /** Fødselsnummer. SvarUt looks it up in KRR and picks the channel from it. */
  digitalId: string;
  adresselinje1?: string;
  postnummer?: string;
  poststed?: string;
};

export type Kvitteringskropp = {
  tittel: string;
  mottaker: Kvitteringsmottaker;
  dokumenter: { filnavn: string; mimeType: string }[];
  avgivendeSystem: string;
  eksternReferanse: string;
};

/*
 * The postal half of the recipient, and the one place a protected address could
 * leave this service.
 *
 * skjerming.ts already nulls adressenavn/postnummer/poststed on the way out of
 * readState(), so a kode 6/7 person reaches this function with nothing to send.
 * The explicit guard is here anyway: "the fields happen to be null upstream" is
 * not a rule the next caller can find, and a masking change two modules away
 * should not be able to open a channel here. Without a postal address SvarUt
 * falls back to the digital channel, and refuses the forsendelse when there is
 * no digital channel either — which is the safe degradation, not an error the
 * citizen pays for.
 */
function postadresseFor(person: Person): Pick<Kvitteringsmottaker, "adresselinje1" | "postnummer" | "poststed"> {
  if (isSkjermet(person.adressebeskyttelse)) return {};
  const adresse = person.bostedsadresse;
  if (!adresse?.adressenavn || !adresse.postnummer || !adresse.poststed) return {};
  const husnummer = [adresse.husnummer, adresse.husbokstav].filter((del) => del !== null && del !== undefined);
  return {
    adresselinje1: [adresse.adressenavn, husnummer.join("")].filter(Boolean).join(" "),
    postnummer: String(adresse.postnummer),
    poststed: String(adresse.poststed)
  };
}

function fulltNavn(person: Person): string {
  return [person.navn.fornavn, person.navn.mellomnavn, person.navn.etternavn].filter(Boolean).join(" ");
}

/**
 * Nothing here decides a channel: `digitalId` is handed over and SvarUt reads
 * KRR itself, exactly as the real one does. A kanalvalg computed in this service
 * would be a second implementation of a rule that already has one — and the
 * choosing is what participants build on top of.
 */
export function buildKvitteringKropp(
  person: Person,
  soknadId: string,
  prosessNavn?: string
): Kvitteringskropp {
  return {
    tittel: `Kvittering: ${prosessNavn || "søknad"}`,
    mottaker: {
      navn: fulltNavn(person),
      digitalId: person.syntetiskFodselsnummer,
      ...postadresseFor(person)
    },
    dokumenter: [{ filnavn: "soknad.txt", mimeType: "text/plain" }],
    avgivendeSystem: "sandbox-backend",
    eksternReferanse: soknadId
  };
}
