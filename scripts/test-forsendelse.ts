#!/usr/bin/env node

/*
 * Forsendelsens kanalvalg, tidsutledning og tilstandsmaskin.
 *
 * Everything here is pure functions off disk - no server, no clock. The channel
 * table is exercised both with literal rows and against data/krr.json, so the
 * curated fixture the spec rests on (person-014, reservert) is pinned by name.
 * The derivation runs on an injected clock, and every step it takes is checked
 * against the state machine - a derived progression that skips a state would
 * otherwise be invisible: nothing ever writes an illegal transition, because
 * nothing ever writes at all.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FORSENDELSESSTATUSER,
  LEVERT_ETTER_MS,
  SENDT_ETTER_MS,
  chooseKanal,
  deriveForsendelsesstatus,
  hasPostadresse,
  isForsendelsesstatus,
  validateForsendelse,
  validateForsendelsesovergang
} from "../apps/fiks-simulator/src/forsendelse.ts";
import type { Kanal, Mottaker } from "../apps/fiks-simulator/src/forsendelse.ts";
import type { Krr, Person } from "../apps/shared/innbyggerdata.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let bestatt = 0;
const feil: string[] = [];

function check(navn: string, betingelse: unknown, detalj = ""): void {
  if (betingelse) {
    bestatt += 1;
    return;
  }
  feil.push(`${navn}${detalj ? ` - ${detalj}` : ""}`);
}

// --- 1. kodeverket ----------------------------------------------------------

check(
  "kodeverket har seks statuser i fast rekkefølge",
  JSON.stringify(FORSENDELSESSTATUSER) ===
    JSON.stringify(["MOTTATT", "SENDT_DIGITALT", "SENDT_PRINT", "IKKE_LEVERT", "LEST", "PRINTET"]),
  JSON.stringify(FORSENDELSESSTATUSER)
);

// --- 2. lovlige og ulovlige overganger --------------------------------------

const lovlige = [
  ["MOTTATT", "SENDT_DIGITALT"],
  ["MOTTATT", "SENDT_PRINT"],
  ["MOTTATT", "IKKE_LEVERT"],
  ["SENDT_DIGITALT", "LEST"],
  ["SENDT_PRINT", "PRINTET"]
];
for (const [fra, til] of lovlige) {
  check(`${fra} → ${til} er lovlig`, validateForsendelsesovergang(fra, til).lovlig === true);
}

// Every pair the table does not name must be refused - enumerated rather than
// sampled, so a new status cannot open a path nobody decided on.
const lovligeNoekler = new Set(lovlige.map(([fra, til]) => `${fra}>${til}`));
for (const fra of FORSENDELSESSTATUSER) {
  for (const til of FORSENDELSESSTATUSER) {
    if (fra === til || lovligeNoekler.has(`${fra}>${til}`)) continue;
    const utfall = validateForsendelsesovergang(fra, til);
    check(`${fra} → ${til} avvises`, utfall.lovlig === false && utfall.status === 409);
  }
}

// --- 3. kanalvalg-tabellen ---------------------------------------------------

const postadresse: Mottaker = {
  navn: "Test Testesen",
  adresselinje1: "Storgata 5",
  postnummer: "5003",
  poststed: "Bergen"
};
const utenAdresse: Mottaker = { navn: "Test Testesen" };

const varslbar = { kanVarsles: true, reservert: false };
const reservert = { kanVarsles: false, reservert: true };
const utenKontaktinfo = { kanVarsles: false, reservert: false };

function kanalen(mottaker: Mottaker, kunDigital: boolean, rad?: typeof varslbar): Kanal | string {
  const utfall = chooseKanal(mottaker, kunDigital, rad);
  return utfall.lovlig ? utfall.kanal : utfall.kode;
}

check("varslbar KRR-rad gir DIGITAL", kanalen(postadresse, false, varslbar) === "DIGITAL");
check(
  "DIGITAL vinner over kunDigitalLevering og postadresse",
  kanalen(postadresse, true, varslbar) === "DIGITAL"
);
check("reservert med postadresse gir PRINT", kanalen(postadresse, false, reservert) === "PRINT");
check(
  "reservert med kunDigitalLevering gir INGEN",
  kanalen(postadresse, true, reservert) === "INGEN"
);
check(
  "uten KRR-rad og med kunDigitalLevering gir INGEN",
  kanalen(postadresse, true, undefined) === "INGEN"
);
check(
  "uten kontaktinfo (kanVarsles false) gir PRINT",
  kanalen(postadresse, false, utenKontaktinfo) === "PRINT"
);
check("uten KRR-rad og med postadresse gir PRINT", kanalen(postadresse, false, undefined) === "PRINT");
check(
  "uten kanal i det hele tatt gir MANGLER_MOTTAKERADRESSE",
  kanalen(utenAdresse, false, undefined) === "MANGLER_MOTTAKERADRESSE"
);

check("postadresse uten poststed er ugyldig", !hasPostadresse({ ...postadresse, poststed: "" }));
check(
  "postnummer må være fire siffer",
  !hasPostadresse({ ...postadresse, postnummer: "503" }) &&
    !hasPostadresse({ ...postadresse, postnummer: "50 3" })
);

// --- 4. kanalvalget mot det genererte datasettet -----------------------------

const personer: Person[] = JSON.parse(await readFile(path.join(repoRoot, "data", "personer.json"), "utf8"));
const krr: Krr[] = JSON.parse(await readFile(path.join(repoRoot, "data", "krr.json"), "utf8"));

// person-014 (Lina Berg) is curated reservert with a valid postal address - the
// row that makes the print channel testable. pnpm test (valider-data) guards
// that the row exists; this guards what the channel decision does with it.
const person014 = personer.find((p) => p.personId === "person-014");
const rad014 = krr.find((rad) => rad.fnr === person014?.syntetiskFodselsnummer);
check("person-014 har KRR-rad og er reservert", rad014?.reservert === true);
check(
  "person-014 med postadresse gir PRINT",
  rad014 && kanalen(postadresse, false, rad014) === "PRINT"
);
check(
  "person-014 med kunDigitalLevering gir INGEN",
  rad014 && kanalen(postadresse, true, rad014) === "INGEN"
);

const varslbarRad = krr.find((rad) => rad.kanVarsles && !rad.reservert);
check("datasettet har minst én varslbar person", Boolean(varslbarRad));
check(
  "en ureservert varslbar person gir DIGITAL",
  varslbarRad && kanalen(utenAdresse, false, varslbarRad) === "DIGITAL"
);

// --- 5. tidsutledning med injisert klokke ------------------------------------

const opprettet = "2026-09-10T09:00:00.000Z";
const start = Date.parse(opprettet);
const rader: Record<Kanal, { kanal: Kanal; opprettet: string }> = {
  DIGITAL: { kanal: "DIGITAL", opprettet },
  PRINT: { kanal: "PRINT", opprettet },
  INGEN: { kanal: "INGEN", opprettet }
};

function statusVed(kanal: Kanal, etterMs: number) {
  return deriveForsendelsesstatus(rader[kanal], start + etterMs);
}

for (const kanal of ["DIGITAL", "PRINT", "INGEN"] as Kanal[]) {
  check(`${kanal}: umiddelbart oppslag gir MOTTATT`, statusVed(kanal, 0).status === "MOTTATT");
  check(
    `${kanal}: fortsatt MOTTATT rett før sendegrensen`,
    statusVed(kanal, SENDT_ETTER_MS - 1).status === "MOTTATT"
  );
}

check("DIGITAL sendes etter grensen", statusVed("DIGITAL", SENDT_ETTER_MS).status === "SENDT_DIGITALT");
check("PRINT sendes etter grensen", statusVed("PRINT", SENDT_ETTER_MS).status === "SENDT_PRINT");
check("INGEN ender som IKKE_LEVERT", statusVed("INGEN", SENDT_ETTER_MS).status === "IKKE_LEVERT");

check(
  "DIGITAL er fortsatt SENDT_DIGITALT rett før levering",
  statusVed("DIGITAL", LEVERT_ETTER_MS - 1).status === "SENDT_DIGITALT"
);
check("digital ender i LEST", statusVed("DIGITAL", LEVERT_ETTER_MS).status === "LEST");
check("print ender i PRINTET", statusVed("PRINT", LEVERT_ETTER_MS).status === "PRINTET");
check(
  "IKKE_LEVERT er endelig - også etter leveringsgrensen",
  statusVed("INGEN", LEVERT_ETTER_MS + 1).status === "IKKE_LEVERT"
);
check(
  "LEST står seg et døgn senere",
  statusVed("DIGITAL", 24 * 60 * 60 * 1000).status === "LEST"
);

// sisteStatusEndring is when the row entered the status, not when anyone asked.
check(
  "sisteStatusEndring for MOTTATT er opprettelsen",
  statusVed("DIGITAL", 5_000).sisteStatusEndring === opprettet
);
check(
  "sisteStatusEndring for SENDT_* er sendegrensen",
  statusVed("PRINT", 30_000).sisteStatusEndring === new Date(start + SENDT_ETTER_MS).toISOString()
);
check(
  "sisteStatusEndring for LEST er leveringsgrensen, uansett når man spør",
  statusVed("DIGITAL", 24 * 60 * 60 * 1000).sisteStatusEndring ===
    new Date(start + LEVERT_ETTER_MS).toISOString()
);

// En håndredigert rad med uparselig opprettet skal svare MOTTATT, ikke kaste
// fra en lesesti.
check(
  "uparselig opprettet gir MOTTATT",
  deriveForsendelsesstatus({ kanal: "DIGITAL", opprettet: "i går" }, start).status === "MOTTATT"
);

// --- 6. hvert utledningssteg er lovlig i tilstandsmaskinen -------------------

// Walk the clock forward through every threshold and require that each status
// the derivation answers is (a) in the kodeverk and (b) reachable from the
// previous one. This is what makes the machine load-bearing: the progression is
// never written, so this is the only place an illegal step could be caught.
const klokkeslett = [
  0,
  SENDT_ETTER_MS - 1,
  SENDT_ETTER_MS,
  LEVERT_ETTER_MS - 1,
  LEVERT_ETTER_MS,
  LEVERT_ETTER_MS + 60 * 60 * 1000
];
for (const kanal of ["DIGITAL", "PRINT", "INGEN"] as Kanal[]) {
  const stegvis = klokkeslett.map((etterMs) => statusVed(kanal, etterMs).status);
  check(
    `${kanal}: hver utledet status står i kodeverket`,
    stegvis.every((status) => isForsendelsesstatus(status))
  );
  for (let i = 1; i < stegvis.length; i++) {
    if (stegvis[i] === stegvis[i - 1]) continue;
    check(
      `${kanal}: utledningssteget ${stegvis[i - 1]} → ${stegvis[i]} er lovlig`,
      validateForsendelsesovergang(stegvis[i - 1], stegvis[i]).lovlig === true
    );
  }
  check(`${kanal}: progresjonen starter i MOTTATT`, stegvis[0] === "MOTTATT");
}

// --- 7. valideringsfeilene ---------------------------------------------------

const gyldig = {
  tittel: "Vedtak om redusert foreldrebetaling",
  mottaker: { navn: "Test Testesen", adresselinje1: "Storgata 5", postnummer: "5003", poststed: "Bergen" },
  dokumenter: [{ filnavn: "vedtak.pdf", mimeType: "application/pdf" }]
};

check("en gyldig kropp passerer valideringen", validateForsendelse(gyldig) === null);
check(
  "manglende tittel gir TITTEL_MANGLER",
  validateForsendelse({ ...gyldig, tittel: undefined })?.kode === "TITTEL_MANGLER"
);
check(
  "blank tittel gir TITTEL_MANGLER",
  validateForsendelse({ ...gyldig, tittel: "  " })?.kode === "TITTEL_MANGLER"
);
check(
  "manglende mottaker gir MOTTAKERNAVN_MANGLER",
  validateForsendelse({ ...gyldig, mottaker: undefined })?.kode === "MOTTAKERNAVN_MANGLER"
);
check(
  "mottaker uten navn gir MOTTAKERNAVN_MANGLER",
  validateForsendelse({ ...gyldig, mottaker: { navn: "" } })?.kode === "MOTTAKERNAVN_MANGLER"
);
check(
  "manglende dokumentliste gir UGYLDIG_DOKUMENTLISTE",
  validateForsendelse({ ...gyldig, dokumenter: undefined })?.kode === "UGYLDIG_DOKUMENTLISTE"
);
check(
  "tom dokumentliste gir UGYLDIG_DOKUMENTLISTE",
  validateForsendelse({ ...gyldig, dokumenter: [] })?.kode === "UGYLDIG_DOKUMENTLISTE"
);
check(
  "dokument uten mimeType gir UGYLDIG_DOKUMENTLISTE",
  validateForsendelse({ ...gyldig, dokumenter: [{ filnavn: "vedtak.pdf" }] })?.kode ===
    "UGYLDIG_DOKUMENTLISTE"
);
check(
  "duplikat filnavn+mimeType gir UGYLDIG_DOKUMENTLISTE",
  validateForsendelse({
    ...gyldig,
    dokumenter: [
      { filnavn: "vedtak.pdf", mimeType: "application/pdf" },
      { filnavn: "vedtak.pdf", mimeType: "application/pdf" }
    ]
  })?.kode === "UGYLDIG_DOKUMENTLISTE"
);
check(
  "samme filnavn med ulik mimeType er lov",
  validateForsendelse({
    ...gyldig,
    dokumenter: [
      { filnavn: "vedtak.pdf", mimeType: "application/pdf" },
      { filnavn: "vedtak.pdf", mimeType: "text/plain" }
    ]
  }) === null
);

// --- rapport -----------------------------------------------------------------

if (feil.length > 0) {
  console.error(`${feil.length} av ${bestatt + feil.length} sjekker feilet:`);
  for (const linje of feil) console.error(`  - ${linje}`);
  process.exit(1);
}
console.log(`Forsendelse: ${bestatt} sjekker bestått.`);
