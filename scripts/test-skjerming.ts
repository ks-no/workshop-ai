/*
 * Unit tests for address-protection masking in sandbox-backend.
 *
 * These need neither the stack nor a port: skjerming.ts is pure functions, so the
 * tests run against the real seed straight off disk. That matters because the wire
 * behaviour is otherwise only pinned by the kontrakt-smoke dump, and a dump cannot
 * fail — it can only differ. This file can fail.
 *
 * The masking rules themselves, and why fnr/foedselsdato/kommunenummer survive
 * them, are documented in apps/shared/skjerming.ts.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { maskBefolkning, maskFregPerson, maskKrr } from "../apps/shared/skjerming.ts";
import type { Husstand, Krr, Person } from "../apps/shared/innbyggerdata.ts";
import type { FolkeregisterPerson } from "../apps/shared/registerdata.ts";
// The kvittering half: the two pure modules the SUBMIT step's SvarUt send is
// built out of. Neither opens a socket or a state file, so they belong in this
// suite rather than behind the contract smoke. chooseKanal is imported from the
// simulator on purpose — what the backend hands over and what SvarUt does with it
// have to be checked against each other, not each against its own idea.
import { buildKvitteringKropp, buildSoknadsdokument } from "../apps/sandbox-backend/src/kvittering.ts";
import { chooseKanal, hasPostadresse } from "../apps/fiks-simulator/src/forsendelse.ts";
import type { ProsessDefinisjon, Prosessoekt } from "../apps/sandbox-backend/src/types.ts";

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

// --- KRR: contact info is masked, the notification facts survive -----------
// maskKrr reads the same rule table as maskPerson: both protection grades hide
// contact info. What survives is whether the person can be notified digitally,
// not where the notification would go.

const krrRader = await readJson<Krr[]>("data/krr.json");
const krrFor = (personId: string): Krr => {
  const fnr = kilde(personId).syntetiskFodselsnummer;
  return finn(krrRader, (r) => r.fnr === fnr, `KRR-rad for ${personId}`);
};

const krr031 = maskKrr(krrFor("person-031"), kilde("person-031").adressebeskyttelse);
check("person-031 mister eposten i KRR", krr031.epost === null);
check("person-031 mister telefonen i KRR", krr031.tlf === null);
check("person-031 beholder reservert i KRR", krr031.reservert === krrFor("person-031").reservert);
check("person-031 beholder spraak i KRR", krr031.spraak === krrFor("person-031").spraak);
check("person-031 beholder kanVarsles i KRR", krr031.kanVarsles === krrFor("person-031").kanVarsles);
check("person-031 beholder fnr i KRR", krr031.fnr === "16848300180");
check("person-031 beholder nøkkelsettet på KRR-raden", likeNokler(krr031, krrFor("person-031")));

const krr194 = maskKrr(krrFor("person-194"), kilde("person-194").adressebeskyttelse);
check("person-194 (FORTROLIG) mister eposten i KRR", krr194.epost === null);
check("person-194 (FORTROLIG) mister telefonen i KRR", krr194.tlf === null);

const krr001 = maskKrr(krrFor("person-001"), kilde("person-001").adressebeskyttelse);
check(
  "person-001 (UGRADERT) er uendret i KRR",
  JSON.stringify(krr001) === JSON.stringify(krrFor("person-001"))
);

// Failing open is the one mistake this must never make: an unknown grade masks.
const ukjentGrad = maskKrr(krrFor("person-001"), "NY_GRAD");
check("ukjent gradering maskerer KRR-kontakten", ukjentGrad.epost === null && ukjentGrad.tlf === null);

// --- Folkeregisteret: same rule table, applied to the freg seed row ---------
// maskFregPerson serves the folkeregister surface on fiks-simulator. FORTROLIG
// nulls everything that says where the person lives (address fields, the
// matrikkel identifier, the Tenor extract's grunnkrets/skolekrets) plus
// contact; STRENGT_FORTROLIG hides the name too. adressebeskyttelse always
// survives — the code explains why the other fields are empty.

const fregSeed = await readJson<{ personer: FolkeregisterPerson[] }>("data/folkeregister.seed.json");
const fregFor = (personId: string): FolkeregisterPerson => {
  const fnr = kilde(personId).syntetiskFodselsnummer;
  return finn(fregSeed.personer, (rad) => rad.foedselsEllerDNummer === fnr, `freg-rad for ${personId}`);
};

const freg031 = maskFregPerson(fregFor("person-031"));
check("person-031 mister personnavnet i FREG", freg031.personnavn!.fornavn === "Skjermet", String(freg031.personnavn!.fornavn));
check("person-031 mister gatenavnet i FREG", freg031.bostedsadresse!.adressenavn === null);
check("person-031 mister husnummeret i FREG", freg031.bostedsadresse!.husnummer === null);
check("person-031 mister postnummeret i FREG", freg031.bostedsadresse!.postnummer === null);
check(
  "person-031 mister matrikkelidentifikatoren i FREG",
  freg031.bostedsadresse!.adresseIdentifikatorFraMatrikkelen === null
);
check("person-031 mister e-posten i FREG", freg031.kontakt!.epost === null);
check("person-031 har null kontaktadresse i FREG", freg031.kontaktadresse === null);
check("person-031 beholder kommunen i FREG", freg031.bostedsadresse!.kommune === "Oslo");
check("person-031 beholder kommunenummeret i FREG", freg031.bostedsadresse!.kommunenummer === "0301");
check("person-031 beholder foedselsdato i FREG", freg031.foedselsdato === fregFor("person-031").foedselsdato);
check("person-031 beholder graderingen i FREG", freg031.adressebeskyttelse === "STRENGT_FORTROLIG");
check(
  "person-031 beholder relasjonene i FREG",
  JSON.stringify(freg031.forelderbarnrelasjon) === JSON.stringify(fregFor("person-031").forelderbarnrelasjon)
);
check("person-031 beholder nøkkelsettet på FREG-raden", likeNokler(freg031, fregFor("person-031")));
check("person-031 beholder nøkkelsettet på personnavn i FREG", likeNokler(freg031.personnavn!, fregFor("person-031").personnavn!));
check(
  "person-031 beholder nøkkelsettet på bostedsadresse i FREG",
  likeNokler(freg031.bostedsadresse!, fregFor("person-031").bostedsadresse!)
);

// person-194 is FORTROLIG and Tenor-imported, so the row carries grunnkrets and
// skolekrets — place-identifying, and therefore masked with the address.
const freg194 = maskFregPerson(fregFor("person-194"));
check("person-194 BEHOLDER personnavnet i FREG", freg194.personnavn!.fornavn === "Utmerket", String(freg194.personnavn!.fornavn));
check("person-194 mister gatenavnet i FREG", freg194.bostedsadresse!.adressenavn === null);
check("person-194 mister grunnkretsen i FREG", freg194.grunnkrets === null);
check("person-194 mister skolekretsen i FREG", freg194.skolekrets === null);
check("person-194 beholder kommunen i FREG", freg194.bostedsadresse!.kommune === "Inderøy");
check("person-194 beholder graderingen i FREG", freg194.adressebeskyttelse === "FORTROLIG");

check(
  "person-001 (UGRADERT) er uendret i FREG",
  JSON.stringify(maskFregPerson(fregFor("person-001"))) === JSON.stringify(fregFor("person-001"))
);

// Failing open is the one mistake this must never make: an unknown grade
// masks as strictly as we know how.
const fregUkjentGrad = maskFregPerson({ ...fregFor("person-001"), adressebeskyttelse: "NY_GRAD" });
check(
  "ukjent gradering maskerer FREG-personen",
  fregUkjentGrad.personnavn!.fornavn === "Skjermet" && fregUkjentGrad.bostedsadresse!.adressenavn === null
);

// --- the SvarUt kvittering: no address leaves this service ------------------
//
// A SUBMIT step builds the søknadsdokument and sends it as a SvarUt forsendelse
// (apps/sandbox-backend/src/svarut.ts). Both halves read the masked person, so
// this is where the masking above either holds or is quietly undone: the
// recipient is the one place a protected address could go out on the wire, and
// the document is the one place it could come back to be read.
//
// The document text and the forsendelse body are deterministic pure functions, so
// the checks below are the whole behaviour — there is no server-side leftover for
// a leak to hide in.

const prosessdefinisjoner = await readJson<{ prosesser: ProsessDefinisjon[] }>("data/prosessdefinisjoner.json");
const stottekontakt = finn(
  prosessdefinisjoner.prosesser,
  (prosess) => prosess.id === "stottekontakt-behov",
  "prosessen stottekontakt-behov"
);

// What the kontaktinfo resource left in oekt.resultater: the masked KRR row, or —
// for a person KRR holds no row for, which person-219 is — the advarsel shape it
// degrades into. Both are documented as-is, so both have to be safe to document.
function kontaktinfoResultatFor(personId: string): unknown {
  const fnr = kilde(personId).syntetiskFodselsnummer;
  const rad = krrRader.find((kandidat) => kandidat.fnr === fnr);
  return rad
    ? maskKrr(rad, kilde(personId).adressebeskyttelse)
    : {
        advarsel: "Fikk ikke kontaktinformasjon fra kontaktregisteret. Reservasjonsstatus er ukjent.",
        detalj: "Fiks-simulatoren svarte 404.",
        syntetisk: true
      };
}

// The økt as it looks when SUBMIT runs: the answers the citizen gave, the
// kontaktinfo lookup's result, and the two generated texts.
function oektFor(personId: string): Prosessoekt {
  return {
    oektsId: "prosessoekt-0000000000000-skjerm",
    personId,
    prosessId: "stottekontakt-behov",
    stegIndex: 6,
    status: "AKTIV",
    svar: {
      situasjon: {
        beskrivelse: "Trenger noen å være sammen med i helgene",
        onskerKontakt: "ja",
        kontaktkanal: "Telefon"
      }
    },
    resultater: {
      "hent-kontaktinfo": kontaktinfoResultatFor(personId),
      "sjekk-tilbud": { godkjent: true, melding: "Kommunen har et tilbud som passer." },
      oppsummering: { tekst: "Du har bedt om en støttekontakt." }
    },
    sporingsId: "flyt-0000000000000-skjerm",
    opprettet: "2026-08-26T00:00:00.000Z",
    oppdatert: "2026-08-26T00:00:00.000Z"
  } as unknown as Prosessoekt;
}

// The strings that must never appear: what the seed says about the six protected
// people, before masking. Same list as the clear-text check above, plus the
// postcodes and towns, since a forsendelse carries those as their own fields.
const hemmeligheter = forventetSkjermede.flatMap((id) => {
  const adresse = kilde(id).bostedsadresse || {};
  return [adresse.adressenavn, adresse.postnummer, adresse.poststed]
    .filter((verdi): verdi is string => typeof verdi === "string" && verdi.length > 0);
});

for (const id of forventetSkjermede) {
  const mottaker = buildKvitteringKropp(person(id), "soknad-0000000000000-skjerm", stottekontakt.navn).mottaker;
  check(`${id} får ingen adresselinje i forsendelsen`, mottaker.adresselinje1 === undefined, String(mottaker.adresselinje1));
  check(`${id} får ingen postnummer i forsendelsen`, mottaker.postnummer === undefined, String(mottaker.postnummer));
  check(`${id} får ingen poststed i forsendelsen`, mottaker.poststed === undefined, String(mottaker.poststed));
  // The rule the two services have to agree on: with no postal address SvarUt
  // cannot pick PRINT, whatever else the body says.
  check(`${id} har ingen postadresse SvarUt kan bruke`, !hasPostadresse(mottaker));
  // The fnr survives — SvarUt needs it to read KRR — and it is not contact info.
  check(`${id} beholder fodselsnummeret som digitalId`, mottaker.digitalId === kilde(id).syntetiskFodselsnummer);
}

// A kode 6 recipient is named the way masking names them; kode 7 keeps the name,
// exactly as maskPerson does. Two grades, still observably different.
const mottaker031 = buildKvitteringKropp(person("person-031"), "soknad-0000000000000-skjerm").mottaker;
check("person-031 sendes som «Skjermet person»", mottaker031.navn === "Skjermet person", mottaker031.navn);
const mottaker194 = buildKvitteringKropp(person("person-194"), "soknad-0000000000000-skjerm").mottaker;
check("person-194 BEHOLDER navnet på forsendelsen", mottaker194.navn === "Utmerket Håndkrem", mottaker194.navn);

// person-031 can be notified in KRR, so the kvittering still reaches them —
// digitally, with no address anywhere in the request. Protection is not a reason
// to withhold the receipt.
const utfall031 = chooseKanal(mottaker031, false, krrFor("person-031"));
check(
  "person-031 (kode 6, kan varsles) får kvitteringen digitalt",
  utfall031.lovlig && utfall031.kanal === "DIGITAL",
  JSON.stringify(utfall031)
);

// person-219 is FORTROLIG and has no KRR row at all: no digital channel, and a
// masked address means no print channel either. SvarUt refuses, sendKvittering
// degrades into an advarsel, and the søknad is stored regardless. That is the
// safe degradation — the alternative would be reaching for the real address.
const mottaker219 = buildKvitteringKropp(person("person-219"), "soknad-0000000000000-skjerm").mottaker;
const utfall219 = chooseKanal(mottaker219, false, undefined);
check("person-219 uten KRR-rad får ingen kanal (degraderer trygt)", utfall219.lovlig === false);

// person-001 is unprotected, so the address IS there. Without this the checks
// above would pass on a function that never sends an address to anyone.
//
// Read off the seed rather than written out, the same way forventetAdresse above
// does it: the claim is that the unmasked address survives, not which house
// number the curated row happens to carry this month.
const adresse001 = kilde("person-001").bostedsadresse;
const mottaker001 = buildKvitteringKropp(person("person-001"), "soknad-0000000000000-skjerm").mottaker;
check(
  "person-001 (UGRADERT) får adresselinje",
  mottaker001.adresselinje1 === `${adresse001.adressenavn} ${adresse001.husnummer}`,
  String(mottaker001.adresselinje1)
);
check(
  "person-001 (UGRADERT) får postnummer og poststed",
  mottaker001.postnummer === adresse001.postnummer && mottaker001.poststed === adresse001.poststed
);
check("person-001 har en postadresse SvarUt kan bruke", hasPostadresse(mottaker001));

// The whole request body, and the document the citizen reads back, as text.
for (const id of forventetSkjermede) {
  const kropp = JSON.stringify(buildKvitteringKropp(person(id), "soknad-0000000000000-skjerm", stottekontakt.navn));
  const dokument = buildSoknadsdokument(stottekontakt, oektFor(id), person(id));
  for (const hemmelig of hemmeligheter) {
    check(`"${hemmelig}" finnes ikke i forsendelsen til ${id}`, !kropp.includes(hemmelig));
    check(`"${hemmelig}" finnes ikke i søknadsdokumentet til ${id}`, !dokument.includes(hemmelig));
  }
  check(`søknadsdokumentet til ${id} har ingen e-post`, !/@/.test(dokument), dokument);
  // The fnr is on the wire to SvarUt and must not be in the document — the
  // citizen's copy is not the place for it, and neither is the audit log.
  check(
    `søknadsdokumentet til ${id} har ikke fødselsnummeret`,
    !dokument.includes(kilde(id).syntetiskFodselsnummer)
  );
}

// The unprotected case, for the same reason as person-001 above: the document is
// built from the same DATA_FETCH result, and an unmasked KRR row carries epost
// and tlf as objects. They are dropped because they are not primitives, not
// because they were masked — so this would catch a document builder that started
// flattening nested fields into the text.
const dokument001 = buildSoknadsdokument(stottekontakt, oektFor("person-001"), person("person-001"));
const navn001 = [kilde("person-001").navn.fornavn, kilde("person-001").navn.etternavn].join(" ");
check("person-001 sitt søknadsdokument har ingen e-post", !/@/.test(dokument001), dokument001);
check(
  "person-001 sitt søknadsdokument har ikke fødselsnummeret",
  !dokument001.includes(kilde("person-001").syntetiskFodselsnummer)
);
// The one thing the document must say about the applicant. Asserted as «the name
// appears», not against a phrasing: the wording of the surrounding text is the
// document's own business, and this suite is about what leaks, not about layout.
check("person-001 sitt søknadsdokument navngir søkeren", dokument001.includes(navn001), dokument001);

// --- report ---------------------------------------------------------------

if (feil.length > 0) {
  console.error(`${feil.length} av ${bestatt + feil.length} sjekker feilet:`);
  for (const linje of feil) console.error(`  - ${linje}`);
  process.exit(1);
}
console.log(`Skjerming: ${bestatt} sjekker bestått.`);
