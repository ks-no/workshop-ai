/*
 * Unit tests for address-protection masking in sandbox-backend.
 *
 * These need neither the stack nor a port: skjerming.ts is pure functions, so the
 * tests run against the real seed straight off disk. That matters because the wire
 * behaviour is otherwise only pinned by the kontrakt-smoke dump, and a dump cannot
 * fail — it can only differ. This file can fail.
 *
 * The masking rules themselves, and why fnr/foedselsdato/kommunenummer survive
 * them, are documented in apps/sandbox-backend/src/skjerming.ts.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { maskBefolkning } from "../apps/sandbox-backend/src/skjerming.ts";
import type { Husstand, Person } from "../apps/sandbox-backend/src/types.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let bestatt = 0;
const feil: string[] = [];

function check(navn: string, betingelse: unknown, detalj = ""): void {
  if (betingelse) {
    bestatt += 1;
    return;
  }
  feil.push(`${navn}${detalj ? ` — ${detalj}` : ""}`);
}

function likeNokler(a: object, b: object): boolean {
  if (!a || !b) return a === b;
  const na = Object.keys(a).sort();
  const nb = Object.keys(b).sort();
  return na.length === nb.length && na.every((nokkel, i) => nokkel === nb[i]);
}

// Generisk over datasettet: kallstedet navngir hvilken seed det leser, så
// treffene under er Person og Husstand og ikke any.
async function readJson<T>(relativSti: string): Promise<T> {
  return JSON.parse(await readFile(path.join(repoRoot, relativSti), "utf8")) as T;
}

const kildePersoner = await readJson<Person[]>("data/personer.json");
const kildeHusstander = await readJson<Husstand[]>("data/husstander.json");
const maskert = maskBefolkning(kildePersoner, kildeHusstander);

// Oppslagene kaster hvis personen mangler. Testen under sjekker at hver id
// finnes; uten dette ville alle de påfølgende sjekkene måtte null-sjekke også.
const person = (id: string): Person => finn(maskert.personer, (p) => p.personId === id, id);
const kilde = (id: string): Person => finn(kildePersoner, (p) => p.personId === id, id);
const husstand = (id: string): Husstand => finn(maskert.husstander, (h) => h.husstandId === id, id);

function finn<T>(liste: T[], predikat: (rad: T) => boolean, id: string): T {
  const treff = liste.find(predikat);
  if (!treff) throw new Error(`Fant ikke ${id} i seeden. Er data/ endret?`);
  return treff;
}

// --- STRENGT_FORTROLIG: name and address both ------------------------------

const p031 = person("person-031");
check("person-031 finnes", Boolean(p031));
check("person-031 mister fornavnet", p031.navn.fornavn === "Skjermet", p031.navn.fornavn);
check("person-031 mister etternavnet", p031.navn.etternavn === "person", p031.navn.etternavn);
check("person-031 mister gatenavnet", p031.bostedsadresse.adressenavn === null);
check("person-031 mister husnummeret", p031.bostedsadresse.husnummer === null);
check("person-031 mister postnummeret", p031.bostedsadresse.postnummer === null);
check("person-031 mister poststedet", p031.bostedsadresse.poststed === null);
check("person-031 mister e-posten", p031.kontakt.epost === null);
check("person-031 mister telefonen", p031.kontakt.telefon === null);

// What must survive, or the rules engine and the income lookup break quietly.
check("person-031 beholder kommunenummer", p031.bostedsadresse.kommunenummer === "0301", String(p031.bostedsadresse.kommunenummer));
check("person-031 beholder kommunenavn", p031.bostedsadresse.kommune === "Oslo");
check("person-031 beholder fodselsnummer", p031.syntetiskFodselsnummer === "16848300180");
check("person-031 beholder fodselsdato", p031.foedselsdato === kilde("person-031").foedselsdato);
check("person-031 beholder husstandId", p031.husstandId === "household-013");
check("person-031 beholder graderingen", p031.adressebeskyttelse === "STRENGT_FORTROLIG");
check("person-031 beholder skjermet-flagget", p031.skjermet === true);

// --- FORTROLIG: address only, name kept ------------------------------------

const p194 = person("person-194");
check("person-194 BEHOLDER fornavnet", p194.navn.fornavn === "Utmerket", p194.navn.fornavn);
check("person-194 BEHOLDER etternavnet", p194.navn.etternavn === "Håndkrem", p194.navn.etternavn);
check("person-194 mister gatenavnet", p194.bostedsadresse.adressenavn === null);
// Tenor-imported people carry `kontakt: {}`, so there is no epost key to null.
// The assertion is that nothing is exposed, not that a null appears from nowhere.
check("person-194 har ingen e-post ute", !p194.kontakt.epost);
check("person-194 beholder kommunen", p194.bostedsadresse.kommune === "Inderøy");
check("person-194 beholder graderingen", p194.adressebeskyttelse === "FORTROLIG");

// The whole point of two levels: they must be observably different.
check(
  "de to graderingene gir ulikt svar",
  p031.navn.fornavn !== kilde("person-031").navn.fornavn &&
    p194.navn.fornavn === kilde("person-194").navn.fornavn
);

// --- the other 363 are untouched -------------------------------------------

check("person-001 er uendret", JSON.stringify(person("person-001")) === JSON.stringify(kilde("person-001")));

const forventetSkjermede = ["person-031", "person-194", "person-218", "person-219", "person-319", "person-320"];
const faktiskEndret = maskert.personer
  .filter((p, i) => JSON.stringify(p) !== JSON.stringify(kildePersoner[i]))
  .map((p) => p.personId);
check(
  "nøyaktig de seks skjermede er endret",
  JSON.stringify(faktiskEndret.sort()) === JSON.stringify([...forventetSkjermede].sort()),
  faktiskEndret.join(", ")
);

// --- key sets are stable: nulled, never deleted ----------------------------
// The wire format is frozen. undefined disappears in JSON.stringify, so a mask
// that deleted fields would change the shape and not just the values.

for (const id of forventetSkjermede) {
  const etter = person(id);
  const foer = kilde(id);
  check(`${id} beholder nøkkelsettet på personobjektet`, likeNokler(etter, foer));
  check(`${id} beholder nøkkelsettet på navn`, likeNokler(etter.navn, foer.navn));
  check(`${id} beholder nøkkelsettet på bostedsadresse`, likeNokler(etter.bostedsadresse, foer.bostedsadresse));
  check(`${id} beholder nøkkelsettet på kontakt`, likeNokler(etter.kontakt, foer.kontakt));
}

// --- no clear text left in the masked population ---------------------------

const somTekst = JSON.stringify(maskert.personer.filter((p) => p.skjermet));
for (const hemmelig of ["Siri", "Rustad", "Trondheimsveien", "Kvistadbakkan", "Gamle Elsvassveien", "Gammelveien"]) {
  check(`"${hemmelig}" finnes ikke i de skjermede postene`, !somTekst.includes(hemmelig));
}

// --- households: masked only when every member is protected ---------------

for (const id of ["household-083", "household-093", "household-157"]) {
  check(`${id} mister adressen (alle medlemmer skjermet)`, husstand(id).adresse === null);
  check(`${id} beholder kommunen`, Boolean(husstand(id).kommune));
}

// Deliberately untouched: three unprotected people live at this address and their
// own records return it regardless. See the comment on maskHusstand.
// The address the seed says the household has, before masking.
const forventetAdresse = (husstandId: string) => {
  const raa = kildeHusstander.find((h) => h.husstandId === husstandId);
  return raa?.adresse ?? null;
};

check(
  "household-013 beholder adressen (har umaskerte medboere)",
  // Read from the seed rather than hardcoded: the point is that the address
  // survives masking, not which house number it happens to be. Twelve curated
  // households were moved to real addresses in the same kommune, and this line
  // asserted the invented one.
  husstand("household-013").adresse === forventetAdresse("household-013"),
  `${husstand("household-013").adresse} (forventet ${forventetAdresse("household-013")})`
);

const endredeHusstander = maskert.husstander
  .filter((h, i) => JSON.stringify(h) !== JSON.stringify(kildeHusstander[i]))
  .map((h) => h.husstandId);
check(
  "nøyaktig tre husstander er endret",
  JSON.stringify(endredeHusstander.sort()) === JSON.stringify(["household-083", "household-093", "household-157"]),
  endredeHusstander.join(", ")
);

// --- report ---------------------------------------------------------------

if (feil.length > 0) {
  console.error(`${feil.length} av ${bestatt + feil.length} sjekker feilet:`);
  for (const linje of feil) console.error(`  - ${linje}`);
  process.exit(1);
}
console.log(`Skjerming: ${bestatt} sjekker bestått.`);
