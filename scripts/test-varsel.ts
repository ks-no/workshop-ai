#!/usr/bin/env node

/*
 * Kanalvalget for et varsel, som rene funksjoner.
 *
 * Hvorfor dette ikke ligger i test-forsendelse.ts: de to avgjørelsene ser like ut
 * og er det ikke. `chooseKanal` faller til PRINT, `velgVarselkanal` faller til
 * INGEN, og forskjellen er hele grunnen til at det er to funksjoner. En felles fil
 * ville invitert til en felles hjelpefunksjon, og da var skillet borte.
 *
 * Den bærende påstanden er den om reservasjon: en reservert innbygger får brev og
 * ikke SMS, så de to tabellene skal *ikke* stemme overens. Testen måler begge mot
 * de samme testpersonene, slik at «hvem får vedtaket» og «hvem blir minnet på»
 * står ved siden av hverandre og kan leses som to svar.
 *
 * Bruk:
 *   node scripts/test-varsel.ts
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SMS_MAKSLENGDE, VARSELGRUNNER, VARSELKANALER, VARSELTYPER,
  validateVarsel, validateVarsellengde, velgVarselkanal, type Varselkropp
} from "../apps/fiks-simulator/src/varsel.ts";
// chooseKanal hentes fra simulatoren med vilje: de to tabellene skal måles mot
// hverandre, ikke hver mot sin egen forestilling om hva den andre gjør.
import { chooseKanal } from "../apps/fiks-simulator/src/forsendelse.ts";
// Mottakeren bygges av den som faktisk sender den, ikke på nytt her. Endrer
// postadresseFor seg, skal brevkolonnen under endre seg med den.
import { buildKvitteringKropp } from "../apps/sandbox-backend/src/kvittering.ts";
import { maskPerson } from "../apps/shared/skjerming.ts";
import type { Krr, Person } from "../apps/shared/innbyggerdata.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let bestatt = 0;
const feil: string[] = [];
function check(navn: string, betingelse: unknown, detalj = ""): void {
  if (betingelse) { bestatt += 1; return; }
  feil.push(`${navn}${detalj ? ` - ${detalj}` : ""}`);
}

async function readJson<T>(relativSti: string): Promise<T> {
  return JSON.parse(await readFile(path.join(repoRoot, relativSti), "utf8")) as T;
}

// --- 1. Kanalregelen, som fixturer ------------------------------------------

const TLF = { nummer: "+4799990001", sistOppdatert: "2026-01-01", sistVerifisert: "2026-01-01" };
const EPOST = { adresse: "en@example.test", sistOppdatert: "2026-01-01", sistVerifisert: "2026-01-01" };
const rad = (over: Partial<Krr> = {}) =>
  ({ kanVarsles: true, reservert: false, tlf: TLF, epost: EPOST, ...over });

check("telefon gir SMS", velgVarselkanal(rad()).kanal === "SMS");
// SMS foran e-post: et varsel er kort og tidskritisk, og e-post er reserven.
check("e-post er reserven, ikke førstevalget",
  velgVarselkanal(rad({ tlf: undefined })).kanal === "EPOST");

/*
 * Den bærende påstanden. Reservasjonen gjelder digital kommunikasjon fra det
 * offentlige, og et varsel er nettopp det - og det finnes ingen papirkanal å falle
 * til. Følgen er at en reservert innbygger ikke får påminnelser i det hele tatt,
 * selv om hun får vedtaket i posten.
 */
check("reservert stenger varselet helt",
  velgVarselkanal(rad({ reservert: true })).kanal === "INGEN");

// Fire grunner og ikke én, fordi de fører til fire forskjellige handlinger.
const grunnfixturer = [
  ["ukjent i registeret", undefined, "ukjent_i_kontaktregisteret"],
  ["reservert", rad({ reservert: true }), "reservert"],
  ["kan ikke varsles", rad({ kanVarsles: false }), "kan_ikke_varsles"],
  ["rad uten kontaktopplysning", rad({ tlf: undefined, epost: undefined }),
    "ingen_kontaktopplysning"]
] as const;
for (const [navn, krrRad, ventet] of grunnfixturer) {
  const utfall = velgVarselkanal(krrRad);
  check(`grunnen navngis: ${navn}`,
    utfall.kanal === "INGEN" && utfall.grunn === ventet, JSON.stringify(utfall));
}
// Reservasjonen sjekkes før kanVarsles: begge gir INGEN, men grunnene er ikke
// utbyttbare - den ene er innbyggerens valg, den andre en tom kontaktrad.
check("reservasjonen navngis foran en tom kontaktrad",
  velgVarselkanal(rad({ reservert: true, kanVarsles: false })).grunn === "reservert");
check("en kanal som ikke er INGEN bærer ingen grunn",
  velgVarselkanal(rad()).grunn === undefined);

// Og ingen grunn i kodeverket er uten en gren som når den. Samme fixturer som over,
// så en femte grunn bare krever én ny rad for å gi rødt.
check("hver grunn i kodeverket nås av en gren",
  VARSELGRUNNER.every((grunn) => grunnfixturer.some(([, , ventet]) => ventet === grunn)),
  VARSELGRUNNER.join(","));

// --- 2. De to tabellene skal ikke stemme overens ----------------------------

/*
 * Hele befolkningen, to avgjørelser. Testen finnes for at forskjellen skal være
 * tellet og ikke oppdaget: den dagen noen slår `chooseKanal` og `velgVarselkanal`
 * sammen til én hjelpefunksjon, er det her det blir rødt.
 *
 * Retningen som er en regel, og ikke et trekk ved datasettet: den som må ha
 * vedtaket på papir, eller som ikke kan få det i det hele tatt, får heller ikke et
 * varsel. Det finnes ingen papirkanal for en påminnelse. Den motsatte retningen er
 * *ikke* en regel - en rad med `kanVarsles` og ingen kontaktopplysning gir brev
 * digitalt og varsel `INGEN` - og den grenen er pinnet med fixturer i del 1, fordi
 * ingen i datasettet står i den i dag.
 */
const personer = (await readJson<Person[]>("data/personer.json")).map(maskPerson);
const krr = await readJson<Krr[]>("data/krr.json");

const paaPapirMenVarslet: string[] = [];
const reservertMedBrev: string[] = [];
const lekket: string[] = [];
for (const person of personer) {
  const krrRad = krr.find((rad) => rad.fnr === person.syntetiskFodselsnummer);
  const varsel = velgVarselkanal(krrRad);
  const brev = chooseKanal(buildKvitteringKropp(person, "soknad-0000000000000-varsel").mottaker, false, krrRad);
  const brevkanal = brev.lovlig ? brev.kanal : "AVVIST";
  if (brevkanal !== "DIGITAL" && varsel.kanal !== "INGEN") paaPapirMenVarslet.push(person.personId);
  if (krrRad?.reservert && brevkanal === "PRINT" && varsel.kanal === "INGEN") {
    reservertMedBrev.push(person.personId);
  }
  // Utfallet er alt responsen og raden bærer av kontaktregisteret: begge bygges ved
  // å spre `...utfall`. Feltene skal være kanal og grunn, og ingenting derfra skal
  // inneholde nummeret eller adressen selv.
  const somTekst = JSON.stringify(varsel);
  const fremmedFelt = Object.keys(varsel).some((navn) => navn !== "kanal" && navn !== "grunn");
  const baererKontakt = [krrRad?.tlf?.nummer, krrRad?.epost?.adresse]
    .some((verdi) => Boolean(verdi) && somTekst.includes(String(verdi)));
  if (fremmedFelt || baererKontakt) lekket.push(person.personId);
}

/*
 * Skjermingen på varselflaten ligger i hva svarene bærer, ikke i at raden maskeres:
 * begge rutene leser den ekte kontaktraden, fordi en flate som skal sende må kjenne
 * kanalen. Da er dette påstanden som må holde - for alle, også de adressebeskyttede.
 */
check("utfallet bærer bare kanal og grunn, aldri nummeret eller adressen",
  lekket.length === 0, lekket.join(", "));

// Regelen, som ikke er en telling: papir eller avvist betyr ingen påminnelse.
check("ingen som får vedtaket på papir blir varslet",
  paaPapirMenVarslet.length === 0, paaPapirMenVarslet.join(", "));

// Den bærende påstanden, på ekte personer: reservert gir brev i posten og ingen SMS.
check("reserverte innbyggere får brev, men ikke varsel",
  reservertMedBrev.length > 0, String(reservertMedBrev.length));

// --- 3. Kroppen og SMS-lengden ----------------------------------------------

const feilkodeFor = (kropp: Varselkropp) => {
  const svar = validateVarsel(kropp);
  return "feil" in svar ? svar.feil.kode : null;
};

/*
 * Én gyldig kropp, og én tabell med det som er galt med den - samme form som
 * `gyldigForsendelse` i test-forsendelse.ts. Et nytt påkrevd felt er da én endring
 * her og ikke ni.
 *
 * Halvparten av radene handler om *typen* og ikke om at feltet mangler, og de tre
 * hadde hver sitt utfall som var verre enn et avslag: en tekst som ikke var en
 * streng ga 500 på `.trim()`, en type som array slapp gjennom `String()` og ble
 * skrevet til raden så den falt ut av sitt eget filter, og et fødselsnummer som tall
 * passerte fnr-porten for så aldri å matche en rad - «ukjent i kontaktregisteret»
 * for en innbygger som står der.
 */
const gyldigKropp = { digitalId: "1", tekst: "hei", type: "paaminnelse" };

for (const [navn, over, ventet] of [
  ["mottaker mangler", { digitalId: undefined }, "MANGLER_MOTTAKER"],
  ["mottaker er tom streng", { digitalId: "" }, "MANGLER_MOTTAKER"],
  ["fnr som tall", { digitalId: 12818800078 }, "MANGLER_MOTTAKER"],
  ["tekst mangler", { tekst: undefined }, "MANGLER_TEKST"],
  ["tekst er bare blanke tegn", { tekst: "   " }, "MANGLER_TEKST"],
  ["tekst som tall", { tekst: 123 }, "MANGLER_TEKST"],
  ["type utenfor kodeverket", { type: "reklame" }, "UKJENT_VARSELTYPE"],
  ["type som ettelements array", { type: ["paaminnelse"] }, "UKJENT_VARSELTYPE"]
] as const) {
  check(`${navn} avvises med ${ventet}`,
    feilkodeFor({ ...gyldigKropp, ...over } as Varselkropp) === ventet);
}
for (const type of VARSELTYPER) {
  check(`${type} er en gyldig type`, feilkodeFor({ ...gyldigKropp, type }) === null);
}

// Den validerte kroppen er det kalleren bygger raden av, så den skal bære feltene
// videre uten at noen må påstå med `!` at de finnes.
const validert = validateVarsel({ ...gyldigKropp, eksternReferanse: "r-1", sporingsId: "flyt-1" });
check("den validerte kroppen bærer feltene videre",
  "varsel" in validert && validert.varsel.digitalId === "1" && validert.varsel.tekst === "hei"
  && validert.varsel.type === "paaminnelse" && validert.varsel.eksternReferanse === "r-1"
  && validert.varsel.sporingsId === "flyt-1");

// Uten oppgitt sporingsId lager ruten en; kroppen skal ikke finne på en selv, ellers
// ville to lag laget hver sin id for samme flyt.
const utenSporing = validateVarsel(gyldigKropp);
check("validateVarsel dikter ikke opp en sporingsId",
  "varsel" in utenSporing && utenSporing.varsel.sporingsId === undefined);

/*
 * Lengdegrensen håndheves på sendeflaten og ikke i prompten som skrev teksten. En
 * regel modellen blir bedt om å følge holder mesteparten av tiden; dette er stedet
 * den kan holdes hver gang.
 *
 * Og den måles mot kanalen, ikke mot kroppen: 200 tegn er feil for en SMS og helt i
 * orden for en e-post, og hvilken det blir vet vi først etter oppslaget i KRR.
 */
const langTekst = "a".repeat(SMS_MAKSLENGDE + 1);
check("en for lang SMS avvises",
  validateVarsellengde(langTekst, "SMS")?.kode === "FOR_LANG_SMS");
check("nøyaktig grensen går gjennom",
  validateVarsellengde("a".repeat(SMS_MAKSLENGDE), "SMS") === null);
check("den samme teksten er grei på e-post",
  validateVarsellengde(langTekst, "EPOST") === null);
check("og grei når det ikke blir noen kanal",
  validateVarsellengde(langTekst, "INGEN") === null);

check("kanalkodeverket har tre verdier",
  VARSELKANALER.length === 3 && VARSELKANALER.includes("INGEN"));

// --- report ----------------------------------------------------------------
if (feil.length > 0) {
  console.error(`test-varsel: ${feil.length} av ${bestatt + feil.length} sjekker feilet.`);
  for (const linje of feil) console.error(`  - ${linje}`);
  process.exit(1);
}
console.log(`test-varsel ok. ${bestatt} sjekker, uten stack og uten modell.`);
