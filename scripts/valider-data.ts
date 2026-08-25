import { readFile, readdir } from "node:fs/promises";
import { alderVed } from "../apps/shared/alder.ts";
import { SEED_DATASETS } from "../apps/sandbox-backend/src/state.ts";
import type { Ordning, Satser, State } from "../apps/sandbox-backend/src/types.ts";
import type { Husstand, Person, Plass } from "../apps/shared/innbyggerdata.ts";
// The vedtak itself, imported rather than mirrored. This file used to carry its own
// copy of every rule below, which meant data/forventet-utfall.json — the pinned
// outcomes the workshop text rests on — was validated against the copy instead of
// against the rule that ships. The two agreed, but nothing made them agree, and the
// copy had already drifted for ordning shapes that do not exist yet (a trinnTil with
// no trinnFra counted 11 plasser here and 4 in the rule).
import {
  plasserSomKvalifiserer,
  regelKreverInntekt,
  evaluateVilkaar
} from "../apps/sandbox-backend/src/vilkaar.ts";
import { SAMTYKKESTATUSER } from "../apps/shared/samtykke.ts";
// The generated participant table, imported rather than re-rendered — the same
// reason the vedtak is imported below instead of mirrored.
import { buildTestpersondok } from "./testpersondok.ts";
// Modulus 11 and Skatteetaten's +80 marker, imported rather than mirrored — the
// same reason vilkaar.ts is imported below rather than copied.
import {
  isSyntetiskFoedselsnummer,
  stemmerMedFoedselsdato
} from "../apps/shared/foedselsnummer.ts";

// Only seed data. Runtime datasets live in state/, are gitignored, and are
// created by the services on first write.
const files = [
  "data/personer.json",
  "data/husstander.json",
  "data/inntekter.json",
  "data/barnehageplasser.json",
  "data/sfoplasser.json",
  "data/satser.json",
  "data/prosessdefinisjoner.json",
  "data/informasjonsmodeller.json",
  "data/folkeregister.seed.json",
  "data/kuratert.json",
  "data/matrikkel.seed.json",
  "data/matrikkel.json",
  "data/eierforhold.json",
  "data/deltakercaser.json",
  "data/fritidsaktiviteter.json",
  "data/fritidsdeltakelse.json",
  "data/tjenestetilbud.json",
  "data/forventet-utfall.json"
];

// Generisk over datasettet: hvert kallsted navngir hva det leser, så sjekkene
// under jobber mot Person, Husstand og Satser og ikke mot any. Datasett uten en
// egen type i sandbox-backend leses som `any` — de er rene fikstur-filer, og en
// håndlaget type her ville blitt en syvende kopi av formen.
async function read<T = any>(fil: string): Promise<T> {
  return JSON.parse(await readFile(fil, "utf8")) as T;
}

for (const fil of files) {
  await read(fil);
}

const personer = await read<Person[]>("data/personer.json");
const husstander = await read<Husstand[]>("data/husstander.json");
const inntekter = await read("data/inntekter.json");
const satser = await read<Satser>("data/satser.json");

if (personer.length < 20) {
  throw new Error("Det må finnes minst 20 personer.");
}

// --- Relations must hold together ------------------------------------------
const personIder = new Set(personer.map((p) => p.personId));
const husstandIder = new Set(husstander.map((h) => h.husstandId));

for (const person of personer) {
  // A household is people living at an address, so someone who is dead, inactive
  // or emigrated has none — and null is the honest value, not a placeholder
  // household of one. GET /api/personer/:id/husstand answers 404 for them.
  const boFast = person.personstatus === "BOSATT";
  if (boFast && !husstandIder.has(person.husstandId)) {
    throw new Error(`${person.personId} peker på ukjent husstand ${person.husstandId}.`);
  }
  if (!boFast && person.husstandId !== null) {
    throw new Error(
      `${person.personId} har personstatus ${person.personstatus} men husstand ` +
      `${person.husstandId}. Bare BOSATT er medlem av en husstand.`
    );
  }
  if (!boFast && person.rolle !== null) {
    throw new Error(
      `${person.personId} har personstatus ${person.personstatus} men rolle ` +
      `"${person.rolle}". Rollen gjelder inne i en husstand.`
    );
  }
  for (const relasjon of person.foreldrebarnrelasjon || []) {
    if (!personIder.has(relasjon.relatertPersonId)) {
      throw new Error(`${person.personId} har relasjon til ukjent person ${relasjon.relatertPersonId}.`);
    }
  }
}

for (const husstand of husstander) {
  for (const medlem of husstand.medlemmer) {
    if (!personIder.has(medlem.personId)) {
      throw new Error(`${husstand.husstandId} har ukjent medlem ${medlem.personId}.`);
    }
  }
}

const identer = new Set(personer.map((p) => p.syntetiskFodselsnummer));
for (const rad of inntekter) {
  if (!identer.has(rad.identifikator)) {
    throw new Error(`Inntektsrad peker på ukjent identifikator ${rad.identifikator}.`);
  }
}

// --- Every identifier must be a well-formed synthetic one -------------------
// The 51 curated fixtures used to carry numbers of the form 12018890001: the
// personId encoded in the tail, an ordinary month, and control digits that failed
// modulus 11. They were neither valid identifiers nor recognisable as synthetic,
// and no check anywhere could see it — the only fnr validation in the repo was
// `^[0-9]{11}$`.
const ugyldigeFnr = personer.filter((p) => !isSyntetiskFoedselsnummer(p.syntetiskFodselsnummer));
if (ugyldigeFnr.length > 0) {
  const foerste = ugyldigeFnr
    .slice(0, 5)
    .map((p) => `${p.personId}=${p.syntetiskFodselsnummer}`)
    .join(", ");
  throw new Error(
    `${ugyldigeFnr.length} personer har et fødselsnummer som ikke er syntetisk og ` +
    `mod11-gyldig: ${foerste}. Syntetiske numre har +80 på fødselsmåneden ` +
    `(måned 81–92) og kontrollsifre regnet ut etter påslaget.`
  );
}
if (new Set(personer.map((p) => p.syntetiskFodselsnummer)).size !== personer.length) {
  throw new Error("To personer deler fødselsnummer.");
}

// The date inside the identifier need not equal foedselsdato — real
// Folkeregisteret allows a corrected birth date to keep the original number, and
// Tenor ships two such people. But nothing this repo *generates* may disagree with
// itself, so the rule binds the curated fixtures.
// --- Life status, and what follows from it ----------------------------------
// The population had no life status at all: no personstatus, no doedsdato, no
// field of any kind. The importer dropped everyone who was not bosatt, so a
// child's dead mother simply vanished and the family was left incomplete. Now
// they are in the register — which means the two fields have to stay in step.
const PERSONSTATUS = new Set([
  "BOSATT",
  "UTFLYTTET",
  "DOED",
  "INAKTIV",
  "MIDLERTIDIG",
  "OPPHOERT",
  "FORSVUNNET"
]);
for (const person of personer) {
  if (!PERSONSTATUS.has(person.personstatus)) {
    throw new Error(
      `${person.personId} har personstatus "${person.personstatus}". ` +
      `Gyldige: ${[...PERSONSTATUS].join(", ")}.`
    );
  }
  const doed = person.personstatus === "DOED";
  if (doed !== Boolean(person.doedsdato)) {
    throw new Error(
      `${person.personId}: personstatus=${person.personstatus} og ` +
      `doedsdato=${JSON.stringify(person.doedsdato)}. Dødsdato finnes hvis og bare ` +
      `hvis statusen er DOED.`
    );
  }
  if (doed && String(person.doedsdato) < String(person.foedselsdato)) {
    throw new Error(
      `${person.personId} døde ${person.doedsdato}, før fødselsdatoen ${person.foedselsdato}.`
    );
  }
}
if (!personer.some((p) => p.personstatus === "DOED")) {
  throw new Error(
    "Ingen person er DOED. Da har ingen sperre mot å opptre for en død person noe å " +
    "hvile på, og et barn med en død forelder kan ikke demonstreres."
  );
}

// Nobody who is not bosatt may hold anything that presumes an address or a case.
const ikkeBosattIder = new Set(
  personer.filter((p) => p.personstatus !== "BOSATT").map((p) => p.personId)
);
const ikkeBosattFnr = new Set(
  personer.filter((p) => p.personstatus !== "BOSATT").map((p) => p.syntetiskFodselsnummer)
);
for (const husstand of husstander) {
  for (const medlem of husstand.medlemmer) {
    if (ikkeBosattIder.has(medlem.personId)) {
      throw new Error(`${husstand.husstandId} har ${medlem.personId}, som ikke er BOSATT, som medlem.`);
    }
  }
}
for (const rad of inntekter) {
  if (ikkeBosattFnr.has(rad.identifikator)) {
    throw new Error(`Inntektsrad for ${rad.identifikator}, som ikke er BOSATT.`);
  }
}

// --- Relations point both ways, and carry a role ----------------------------
// 113 of 138 parent edges used to exist in one direction only: the child named
// the parent, the parent named nobody. "Which children does this person have"
// answered nothing for 102 Tenor families. And the value was a flat FORELDER,
// while openapi/sandbox-backend.yaml has said enum [BARN, FAR, MOR, MEDMOR] all
// along — the spec was right and the data was wrong.
const RELASJONER = new Set(["MOR", "FAR", "MEDMOR", "BARN"]);
const OMVENDT: Record<string, string | undefined> = { MOR: "BARN", FAR: "BARN", MEDMOR: "BARN" };
const relasjonskanter = new Set();
for (const person of personer) {
  for (const rel of person.foreldrebarnrelasjon || []) {
    if (!RELASJONER.has(rel.relasjon)) {
      throw new Error(
        `${person.personId}: relasjon "${rel.relasjon}" til ${rel.relatertPersonId}. ` +
        `Gyldige: ${[...RELASJONER].join(", ")}.`
      );
    }
    if (rel.relatertPersonId === person.personId) {
      throw new Error(`${person.personId} er sin egen ${rel.relasjon}.`);
    }
    relasjonskanter.add(`${person.personId}|${rel.relatertPersonId}|${rel.relasjon}`);
  }
}
const personPerIdForRelasjon = new Map(personer.map((p) => [p.personId, p]));

// En relatertPersonId som ikke finnes er en datafeil dette skriptet er til for å
// fange. Å kaste her sier det, framfor å la de neste linjene lese av undefined.
function krevPerson(personId: string): Person {
  const treff = personPerIdForRelasjon.get(personId);
  if (!treff) throw new Error(`Relasjon peker på ${personId}, som ikke finnes i personer.json.`);
  return treff;
}

const husstandPerIdForOppslag = new Map(husstander.map((h) => [h.husstandId, h]));

function krevHusstand(husstandId: string): Husstand {
  const treff = husstandPerIdForOppslag.get(husstandId);
  if (!treff) throw new Error(`${husstandId} finnes ikke i husstander.json.`);
  return treff;
}
for (const person of personer) {
  for (const rel of person.foreldrebarnrelasjon || []) {
    const forventet = OMVENDT[rel.relasjon];
    if (forventet) {
      if (!relasjonskanter.has(`${rel.relatertPersonId}|${person.personId}|BARN`)) {
        throw new Error(
          `${person.personId} har ${rel.relasjon} ${rel.relatertPersonId}, men ` +
          `${rel.relatertPersonId} har ikke ${person.personId} som BARN. Relasjoner ` +
          `skal gå begge veier.`
        );
      }
      // A parent younger than their child is the kind of thing a symmetric graph
      // hides: both directions agree, and both are wrong.
      const forelder = krevPerson(rel.relatertPersonId);
      const aldersforskjell =
        alderVed(String(person.foedselsdato), satser.gjelderFra) === null
          ? 0
          : Number(String(forelder.foedselsdato).slice(0, 4)) - Number(String(person.foedselsdato).slice(0, 4));
      if (aldersforskjell > -12) {
        throw new Error(
          `${rel.relatertPersonId} (f. ${forelder.foedselsdato}) er ${rel.relasjon} til ` +
          `${person.personId} (f. ${person.foedselsdato}), men er ikke minst 12 år eldre.`
        );
      }
    } else {
      const barn = krevPerson(rel.relatertPersonId);
      const harMotpart = (barn.foreldrebarnrelasjon || []).some(
        (r: any) => r.relatertPersonId === person.personId && OMVENDT[r.relasjon]
      );
      if (!harMotpart) {
        throw new Error(
          `${person.personId} har BARN ${rel.relatertPersonId}, men ${rel.relatertPersonId} ` +
          `har ikke ${person.personId} som forelder. Relasjoner skal gå begge veier.`
        );
      }
    }
  }
}

// --- data/kuratert.json is the source for the frozen fixtures ---------------
// person-001..051 and household-001..018 are hand-authored. They live in
// data/kuratert.json, and scripts/importer-tenor.ts copies the authored fields
// through while deriving rolle, skjermet, husstandstype, adresse, kommune and the
// member list. This gate is what makes that split worth having: edit a curated row
// in data/personer.json by hand and the next import silently reverts it, so the
// mistake has to surface here instead of at the next regeneration.
const kuratert = await read("data/kuratert.json");
const personPerId = new Map(personer.map((p) => [p.personId, p]));
const utenJoinnoekkel = (adresse: any) => {
  if (!adresse) return adresse;
  const { adresseIdentifikatorFraMatrikkelen, ...resten } = adresse;
  return resten;
};
const FORFATTEDE_FELT = [
  "syntetiskFodselsnummer",
  "navn",
  "foedselsdato",
  "bostedsadresse",
  "sivilstand",
  "husstandId",
  "adressebeskyttelse",
  "kontakt"
];

for (const kilde of kuratert.personer) {
  const bygget = personPerId.get(kilde.personId);
  if (!bygget) {
    throw new Error(
      `${kilde.personId} står i data/kuratert.json men ikke i data/personer.json. ` +
      `Kjør node scripts/importer-tenor.ts.`
    );
  }
  for (const felt of FORFATTEDE_FELT) {
    // adresseIdentifikatorFraMatrikkelen is derived from data/matrikkel.json, not
    // authored, so it lives in the built address and not in the source one.
    const forfattet = felt === "bostedsadresse" ? utenJoinnoekkel(kilde[felt]) : kilde[felt];
    const utledet = felt === "bostedsadresse" ? utenJoinnoekkel(bygget[felt]) : bygget[felt];
    if (JSON.stringify(forfattet) !== JSON.stringify(utledet)) {
      throw new Error(
        `${kilde.personId}: ${felt} i data/personer.json stemmer ikke med ` +
        `data/kuratert.json. Kilden er kuratert.json — rediger den og kjør ` +
        `node scripts/importer-tenor.ts.`
      );
    }
  }
  if (bygget.kilde) {
    throw new Error(
      `${kilde.personId} er merket kilde="${bygget.kilde}" men står i data/kuratert.json.`
    );
  }
  if (!stemmerMedFoedselsdato(kilde.syntetiskFodselsnummer, kilde.foedselsdato)) {
    throw new Error(
      `${kilde.personId}: fødselsnummeret ${kilde.syntetiskFodselsnummer} beskriver ikke ` +
      `${kilde.foedselsdato}. Genererte numre skal alltid stemme med datoen.`
    );
  }
  // Relations are authored in ONE direction — the parent's `barn` list — precisely
  // so the two directions cannot disagree. This checks the derivation kept it.
  const bygdeBarn = (bygget.foreldrebarnrelasjon || [])
    .filter((rel: any) => rel.relasjon === "BARN")
    .map((rel: any) => rel.relatertPersonId)
    .sort();
  if (JSON.stringify(bygdeBarn) !== JSON.stringify([...(kilde.barn || [])].sort())) {
    throw new Error(
      `${kilde.personId}: barn i data/personer.json er ${JSON.stringify(bygdeBarn)}, ` +
      `men data/kuratert.json sier ${JSON.stringify(kilde.barn || [])}.`
    );
  }
}

// The frozen ids are frozen in both directions: an imported person must never
// land on one, which is what would happen if the allocation counter drifted.
const kuraterteIder = new Set(kuratert.personer.map((p: any) => p.personId));
for (const person of personer) {
  if (person.kilde === "tenor" && kuraterteIder.has(person.personId)) {
    throw new Error(
      `${person.personId} er både kuratert og importert. Id-ene person-001..051 er frosne.`
    );
  }
}

const kuraterteHusstandIder = new Set(kuratert.husstander.map((h: any) => h.husstandId));
for (const husstand of husstander) {
  const erKuratert = kuraterteHusstandIder.has(husstand.husstandId);
  if (erKuratert === Boolean(husstand.kilde)) {
    throw new Error(
      `${husstand.husstandId}: står ${erKuratert ? "" : "ikke "}i data/kuratert.json, ` +
      `men har kilde=${JSON.stringify(husstand.kilde)}. Kuraterte husstander har ingen kilde.`
    );
  }
}

// --- The two person models must agree --------------------------------------
// data/personer.json is the sandbox's own model and data/folkeregister.seed.json
// is the FREG-shaped mirror. Both are written by the same import, both hold every
// person — and nothing held them together: the seed was not in the files list
// above, so no test read it at all. They drifted in key order for eight people
// before anyone looked.
const freg = await read("data/folkeregister.seed.json");
if (freg.antall !== freg.personer.length) {
  throw new Error(
    `folkeregister.seed.json sier antall=${freg.antall} men har ${freg.personer.length} personer.`
  );
}
const fregPerPersonId = new Map<string, any>(freg.personer.map((p: any) => [p._sandbox?.personId, p]));
if (fregPerPersonId.size !== freg.personer.length) {
  throw new Error("folkeregister.seed.json har to rader med samme _sandbox.personId.");
}
if (fregPerPersonId.size !== personer.length) {
  throw new Error(
    `${personer.length} personer i personer.json, ${fregPerPersonId.size} i ` +
    `folkeregister.seed.json. Begge skrives av samme import og skal ha samme befolkning.`
  );
}

const SPEILEDE_FELT = [
  ["syntetiskFodselsnummer", "foedselsEllerDNummer"],
  ["navn", "personnavn"],
  ["foedselsdato", "foedselsdato"],
  ["personstatus", "personstatus"],
  ["sivilstand", "sivilstand"],
  ["bostedsadresse", "bostedsadresse"],
  ["skjermet", "skjermet"],
  ["adressebeskyttelse", "adressebeskyttelse"],
  ["kontakt", "kontakt"]
];
for (const person of personer) {
  const speil = fregPerPersonId.get(person.personId);
  if (!speil) {
    throw new Error(`${person.personId} finnes ikke i folkeregister.seed.json.`);
  }
  for (const [egen, fregNavn] of SPEILEDE_FELT) {
    if (JSON.stringify(person[egen]) !== JSON.stringify(speil[fregNavn])) {
      throw new Error(
        `${person.personId}: ${egen} i personer.json er ` +
        `${JSON.stringify(person[egen])}, men ${fregNavn} i folkeregister.seed.json er ` +
        `${JSON.stringify(speil[fregNavn])}.`
      );
    }
  }
  if (JSON.stringify(person.doedsdato ? { doedsdato: person.doedsdato } : null) !==
      JSON.stringify(speil.doedsfall)) {
    throw new Error(
      `${person.personId}: doedsdato=${JSON.stringify(person.doedsdato)} men ` +
      `doedsfall=${JSON.stringify(speil.doedsfall)}.`
    );
  }
  if (speil._sandbox.husstandId !== person.husstandId || speil._sandbox.rolle !== person.rolle) {
    throw new Error(
      `${person.personId}: _sandbox i folkeregister.seed.json sier husstand ` +
      `${speil._sandbox.husstandId}/rolle ${speil._sandbox.rolle}, personer.json sier ` +
      `${person.husstandId}/${person.rolle}.`
    );
  }
  // The shallow view has to be the same relation set on both sides, and the fnr
  // has to be resolved — it was null on all 61 curated rows before.
  const egne = (person.foreldrebarnrelasjon || [])
    .map((r: any) => `${r.relatertPersonId}|${r.relasjon}`)
    .sort();
  const speilet = (speil.forelderbarnrelasjon || [])
    .map((r: any) => `${r._sandboxRelatertPersonId}|${r.relatertPersonsRolle}`)
    .sort();
  if (JSON.stringify(egne) !== JSON.stringify(speilet)) {
    throw new Error(
      `${person.personId}: relasjonene i de to modellene er ulike. ` +
      `personer.json: ${egne.join(", ")}. folkeregister.seed.json: ${speilet.join(", ")}.`
    );
  }
  for (const rel of speil.forelderbarnrelasjon || []) {
    if (!rel.relatertPersonsIdent) {
      throw new Error(
        `${person.personId}: forelderbarnrelasjon til ${rel._sandboxRelatertPersonId} ` +
        `mangler relatertPersonsIdent. Identifikatoren er alltid kjent.`
      );
    }
  }
}

// --- Familierelasjon: Folkeregisterets egen modell ---------------------------
// Wider than forelderbarnrelasjon: it carries the spouse, and the role seen from
// both ends. GIFT with nobody to be married to was true for 78 of 224 people
// before, because sivilstand was a scalar with no link behind it.
const FREG_ROLLER = new Set(["mor", "far", "medmor", "barn", "soesken", "ektefelleEllerPartner"]);
const fnrTilPersonId = new Map(personer.map((p) => [p.syntetiskFodselsnummer, p.personId]));
const familiekanter = new Set();
for (const speil of freg.personer) {
  for (const rel of speil.familierelasjon || []) {
    if (!FREG_ROLLER.has(rel.relatertPersonsRolle) || !FREG_ROLLER.has(rel.minRolleForPerson)) {
      throw new Error(
        `${speil._sandbox.personId}: familierelasjon med rolle ` +
        `${rel.relatertPersonsRolle}/${rel.minRolleForPerson}. Gyldige: ` +
        `${[...FREG_ROLLER].join(", ")}.`
      );
    }
    if (fnrTilPersonId.get(rel.relatertPersonsIdent) !== rel._sandboxRelatertPersonId) {
      throw new Error(
        `${speil._sandbox.personId}: familierelasjon peker på ` +
        `${rel.relatertPersonsIdent}, som ikke er ${rel._sandboxRelatertPersonId}.`
      );
    }
    familiekanter.add(
      `${speil._sandbox.personId}|${rel._sandboxRelatertPersonId}|` +
      `${rel.relatertPersonsRolle}|${rel.minRolleForPerson}`
    );
  }
}
for (const kant of familiekanter) {
  const [fra, til, rolle, minRolle] = String(kant).split("|");
  if (!familiekanter.has(`${til}|${fra}|${minRolle}|${rolle}`)) {
    throw new Error(
      `Familierelasjonen ${fra} -> ${til} (${rolle}) har ingen motpart ` +
      `${til} -> ${fra} (${minRolle}).`
    );
  }
}

// Married means married to someone. Where the spouse is outside the extract the
// register still says GIFT — that is Tenor's fact, not a defect — so the rule is
// that a spouse *inside* the extract must be alive, and a dead one makes the
// survivor enke/enkemann.
const statusPerPersonId = new Map(personer.map((p) => [p.personId, p.personstatus]));
for (const speil of freg.personer) {
  const ektefeller = (speil.familierelasjon || [])
    .filter((rel: any) => rel.relatertPersonsRolle === "ektefelleEllerPartner");
  if (ektefeller.length > 1) {
    throw new Error(`${speil._sandbox.personId} har ${ektefeller.length} ektefeller.`);
  }
  const doedEktefelle = ektefeller.some(
    (rel: any) => statusPerPersonId.get(rel._sandboxRelatertPersonId) === "DOED"
  );
  if (doedEktefelle && speil.sivilstand === "GIFT") {
    throw new Error(
      `${speil._sandbox.personId} er GIFT med ${ektefeller[0]._sandboxRelatertPersonId}, ` +
      `som er DOED. Da er sivilstanden ENKE_ELLER_ENKEMANN.`
    );
  }
  if (speil.sivilstand === "ENKE_ELLER_ENKEMANN" && !doedEktefelle) {
    throw new Error(
      `${speil._sandbox.personId} er ENKE_ELLER_ENKEMANN uten en død ektefelle i datasettet.`
    );
  }
}
if (!freg.personer.some((p: any) => p.sivilstand === "ENKE_ELLER_ENKEMANN")) {
  throw new Error("Ingen er enke eller enkemann. Da demonstrerer ikke datasettet konsekvensen av et dødsfall.");
}

// Every imported fødselsnummer must appear verbatim in data/tenor/. The import
// must pass them through, never mint one — the only numbers it generates belong to
// the curated fixtures.
const tenorFiler = (await readdir("data/tenor")).filter((f) => f.endsWith(".json"));
const tenorFnr = new Set();
for (const fil of tenorFiler) {
  const innhold = await read(`data/tenor/${fil}`);
  const samle = (dokument: any) => {
    const ident = dokument?.identifikator;
    const fnr = Array.isArray(ident) && ident.length ? ident[0] : dokument?.id;
    if (fnr) tenorFnr.add(fnr);
  };
  for (const dokument of innhold.dokumentListe || []) {
    samle(dokument);
    for (const rel of dokument?.tenorRelasjoner?.freg || []) samle(rel);
  }
}
const oppdiktede = personer
  .filter((p) => p.kilde === "tenor")
  .filter((p) => !tenorFnr.has(p.syntetiskFodselsnummer));
if (oppdiktede.length > 0) {
  throw new Error(
    `${oppdiktede.length} personer er merket kilde=tenor men har et fødselsnummer som ` +
    `ikke finnes i data/tenor/: ${oppdiktede.slice(0, 5).map((p) => p.personId).join(", ")}.`
  );
}

// --- Every resident joins to a property --------------------------------------
// adresseIdentifikatorFraMatrikkelen had 154 distinct values and matched exactly
// zero matrikkelId: Tenor's value points into the real Kartverket register, and
// this repo holds a synthetic one. The field looked like a working join key, which
// is worse than an empty one. It resolves now, and this is what keeps it resolving.
const matrikkel = await read("data/matrikkel.json");
const matrikkelIder = new Set(
  matrikkel.gater.flatMap((gate: any) => gate.eiendommer.map((e: any) => e.matrikkelId))
);
for (const gate of matrikkel.gater) {
  if (gate.antallEiendommer !== gate.eiendommer.length) {
    throw new Error(
      `${gate.gateId} sier antallEiendommer=${gate.antallEiendommer} men har ` +
      `${gate.eiendommer.length}. Tellerne løy på nøyaktig de fire kuraterte gatene.`
    );
  }
  const bolig = gate.eiendommer.filter((e: any) => e.bruksenhetstype === "bolig").length;
  if (gate.antallBoligeiendommer !== bolig) {
    throw new Error(
      `${gate.gateId} sier antallBoligeiendommer=${gate.antallBoligeiendommer} men har ${bolig}.`
    );
  }
}

for (const person of personer) {
  const id = person.bostedsadresse?.adresseIdentifikatorFraMatrikkelen ?? null;
  if (id !== null && !matrikkelIder.has(id)) {
    throw new Error(
      `${person.personId} peker på matrikkelenheten ${id}, som ikke finnes i ` +
      `data/matrikkel.json.`
    );
  }
  if (person.personstatus === "BOSATT" && id === null) {
    throw new Error(
      `${person.personId} er BOSATT på ${person.bostedsadresse?.adressenavn} ` +
      `${person.bostedsadresse?.husnummer} i ${person.bostedsadresse?.kommunenummer}, men ` +
      `adressen finnes ikke i matrikkelen. Kjør node scripts/hent-matrikkel.ts, eller ` +
      `flytt husstanden til en reell adresse i samme kommune i data/kuratert.json.`
    );
  }
  // Someone who is not bosatt may well have no address at all — the D-number
  // holders have none, which is exactly right — but if they have one it must join.
}

// --- Eierforhold ------------------------------------------------------------
// Issue #8: 28 people held 1280 titles across 1225 of 8202 properties, all of them
// in the curated band. person-026 held 70; person-012 and person-017 held 65 each
// across 48 streets. 341 of 369 owned nothing, so a randomly chosen test person
// could never pass an ownership check while the 28 passed almost everywhere. The
// distribution is derived now — a household owns the home it lives in — and this
// is what stops it drifting back.
const eierforhold = await read("data/eierforhold.json");
if (eierforhold.antall !== eierforhold.eierforhold.length) {
  throw new Error(
    `eierforhold.json sier antall=${eierforhold.antall} men har ` +
    `${eierforhold.eierforhold.length} rader.`
  );
}
const EIERFORMER = new Set(["SELVEIER", "UTLEIE", "UOPPGJORT_DODSBO"]);
const eidAv = new Map();
const seetteMatrikkelIder = new Set();
for (const rad of eierforhold.eierforhold) {
  if (!matrikkelIder.has(rad.matrikkelId)) {
    throw new Error(
      `eierforhold.json har ${rad.matrikkelId}, som ikke finnes i data/matrikkel.json.`
    );
  }
  if (seetteMatrikkelIder.has(rad.matrikkelId)) {
    throw new Error(`eierforhold.json har to rader for ${rad.matrikkelId}.`);
  }
  seetteMatrikkelIder.add(rad.matrikkelId);
  if (!rad.eiere?.length) {
    throw new Error(
      `${rad.matrikkelId} står i eierforhold.json uten eiere. En eiendom uten ` +
      `registrert eier utelates fra fila i stedet.`
    );
  }
  const sumAndel = rad.eiere.reduce((sum: any, e: any) => sum + e.andel, 0);
  if (Math.abs(sumAndel - 1) > 0.01) {
    throw new Error(`${rad.matrikkelId}: andelene summerer til ${sumAndel}, ikke 1.`);
  }
  for (const eier of rad.eiere) {
    if (!EIERFORMER.has(eier.eierform)) {
      throw new Error(
        `${rad.matrikkelId}: eierform "${eier.eierform}". Gyldige: ${[...EIERFORMER].join(", ")}.`
      );
    }
    if (!personIder.has(eier.eier)) {
      throw new Error(
        `${rad.matrikkelId} eies av ${eier.eier}, som ikke finnes i data/personer.json.`
      );
    }
    if (statusPerPersonId.get(eier.eier) === "DOED" && eier.eierform !== "UOPPGJORT_DODSBO") {
      throw new Error(
        `${rad.matrikkelId} eies av ${eier.eier}, som er DOED, med eierform ` +
        `${eier.eierform}. Et dødsbo er UOPPGJORT_DODSBO til skiftet er ferdig.`
      );
    }
    eidAv.set(eier.eier, (eidAv.get(eier.eier) || 0) + 1);
  }
}
const TAK = 3;
const forMange = [...eidAv.entries()].filter(([, antall]) => antall > TAK);
if (forMange.length > 0) {
  throw new Error(
    `${forMange.length} personer eier mer enn ${TAK} eiendommer: ` +
    `${forMange.slice(0, 5).map(([id, n]) => `${id}=${n}`).join(", ")}. ` +
    `Det var slik issue #8 startet.`
  );
}
if (eidAv.size < 50) {
  throw new Error(
    `Bare ${eidAv.size} personer eier noe. Da kan de fleste testpersonene aldri ` +
    `passere en eierforholdssjekk, som er halve issue #8.`
  );
}
// The fartsdempende case rests on exactly these two facts, and pnpm test:kontrakt
// and pnpm test:tools-matrikkel both assert them over HTTP. Pinned here too, so a
// redistribution fails before the stack has to be up.
const storgataEid = eierforhold.eierforhold.find((r: any) => r.matrikkelId === "matr-storg-003");
if (!storgataEid?.eiere.some((e: any) => e.eier === "person-001")) {
  throw new Error(
    "person-001 eier ikke matr-storg-003. Godkjent-utfallet i fartsdempende-tiltak " +
    "og pnpm test:tools-matrikkel hviler på det."
  );
}
const fjosangerGate = matrikkel.gater.find((g: any) => g.gateId === "gate-fjosangerveien-bergen");
const eierIFjosanger = (fjosangerGate?.eiendommer || []).some((e: any) =>
  eierforhold.eierforhold
    .find((r: any) => r.matrikkelId === e.matrikkelId)
    ?.eiere.some((eier: any) => eier.eier === "person-001")
);
if (eierIFjosanger) {
  throw new Error(
    "person-001 eier i Fjøsangerveien. Avvisningen i fartsdempende-tiltak er poenget " +
    "med steget, og den forsvinner da."
  );
}

// --- Scenario coverage -----------------------------------------------------
// Without this test the variation rots away on the next data change: adjusting one
// person's income can remove the only case on one side of a threshold, and then
// every demo produces the same outcome again.
function husstandsgrunnlag(husstand: Husstand) {
  let sum = 0;
  for (const medlem of husstand.medlemmer) {
    if (medlem.rolle !== "foresatt") continue;
    const person = krevPerson(medlem.personId);
    const rader = inntekter.filter((i: any) => i.identifikator === person.syntetiskFodselsnummer);
    if (rader.length === 0) return null;
    const nyeste = rader.reduce((a: any, b: any) => (b.inntektsaar > a.inntektsaar ? b : a));
    sum += nyeste.poster.filter((p: any) => p.medregnes).reduce((t: any, p: any) => t + p.beloep, 0);
  }
  return sum;
}

const grunnlag = husstander.map(husstandsgrunnlag).filter((v) => v !== null);

for (const ordning of satser.ordninger) {
  if (ordning.regel !== "INNTEKTSGRENSE") continue;
  const grense = ordning.inntektsgrense ?? 0;
  const under = grunnlag.filter((v) => v < grense).length;
  const over = grunnlag.filter((v) => v >= grense).length;
  if (under === 0 || over === 0) {
    throw new Error(
      `Mangler scenariodekning for ${ordning.id}: ${under} husstander under og ${over} over grensen på ${ordning.inntektsgrense}. Begge sider må finnes.`
    );
  }
}

// --- Target group coverage -------------------------------------------------
// The ordninger scope themselves by age (barnehage) or school year (SFO). Without
// this test an ordning can become impossible to grant because no husstand has a
// child in the target group — and then the rule looks like it works while it only
// ever says no.
const barnehageplasser = await read<Plass[]>("data/barnehageplasser.json");
const sfoplasser = await read<Plass[]>("data/sfoplasser.json");
const fritidsdeltakelse = await read("data/fritidsdeltakelse.json");
// The State the rules in vilkaar.ts read. The keys must match tjenesteDatasett in
// apps/sandbox-backend/src/state.ts — a new tjeneste is one line there and one line
// here. Get one wrong and getPlasserForTjeneste throws `Ukjent tjeneste`, where the
// old lookup silently yielded "no plass".
//
// This is assembled by hand rather than by calling readState(), on purpose, and it
// must stay that way. readState() reads state/ before data/ (state.ts:15-27), so one
// demo run leaving a state/satser.json behind would make this gate validate bytes
// that are not the seed — the exact trap findShadowedSeeds warns about. It also runs
// maskBefolkning, which would make the "seed is not masked" check further down
// assert against its own output. Both failures are silent.
const tjenestetilbud = await read("data/tjenestetilbud.json");
// En delmengde av State: bare datasettene reglene under faktisk leser. Castet
// sier at det er med vilje — evaluateVilkaar rører ikke resten.
const tilstand = {
  personer,
  husstander,
  satser,
  barnehageplasser,
  sfoplasser,
  fritidsdeltakelse,
  // TJENESTEBEHOV reads this through ordning.tilbudsdatasett. It was missing, so
  // evaluateVilkaar answered avslag for every støttekontakt case driven from here —
  // silently, because the block further down asks the question by hand and never
  // called the rule.
  tjenestetilbud
} as unknown as State;

// Whose data a household is assessed on. The rules take a person; this file iterates
// households, so it has to name the søker the way prosess.ts does.
function soekerFor(husstand: Husstand): string | null {
  return husstand.medlemmer.find((m) => m.rolle === "foresatt")?.personId ?? null;
}

for (const ordning of satser.ordninger) {
  // Needs-based ordninger have no plass dataset. Their target group is the
  // applicant's own age, checked against data/tjenestetilbud.json further down.
  if (ordning.regel === "TJENESTEBEHOV") continue;
  // Asked through the rule, so it is the rule's own definition of "in the target
  // group" that is checked. Slightly stricter than the old dataset-wide sweep: a
  // plass only counts if it belongs to a barn of the household it sits in. That is
  // a no-op on today's seed — every plass row does — and it is the question worth
  // asking, since a plass no household can reach cannot be granted either.
  const treff = husstander.some((husstand) => {
    const soeker = soekerFor(husstand);
    return soeker !== null && plasserSomKvalifiserer(tilstand, soeker, ordning, satser).length > 0;
  });
  if (!treff) {
    throw new Error(
      `Ingen ${ordning.tjeneste}-plass i dataene er i målgruppen for ${ordning.id}. ` +
      `Ordningen kan da aldri innvilges. Juster data/${ordning.tjeneste}plasser.json eller ordningen i data/satser.json.`
    );
  }
}

// The edge cases from the Fiks model must exist in the data.
if (!inntekter.some((r: any) => r.stadie === "UTKAST")) {
  throw new Error("Mangler minst én inntektsrad med stadie UTKAST.");
}
if (!personer.some((p) => p.skjermet)) {
  throw new Error("Mangler minst én person med skjermet identitet.");
}
if (husstander.every(husstandsgrunnlag)) {
  throw new Error("Mangler minst én husstand uten inntektsopplysninger.");
}

// --- Cross coverage: the intersection, not the two sides separately ---------
// The checks above ask two separate questions: does every threshold have
// households on both sides, and does every ordning have some child in its target
// group. Neither notices when those two sets never overlap — a household can be
// under the SFO threshold while its only child is in barnehage. Five scenario
// texts described themselves wrongly for exactly that reason, and four of six
// ordninger could only ever produce one outcome.
// The vedtak, from vilkaar.ts. Returns null when the ordning cannot be assessed at
// all for this husstand — and that distinction is load-bearing: the pinned-outcome
// check below uses `vurder(...) !== null` to enumerate which ordninger a husstand
// even touches. evaluateVilkaar never returns null (it answers "no qualifying plass"
// as a real godkjent: false), so the three not-assessable cases have to be caught
// here, before the call. Collapse them into an avslag and every husstand appears to
// hit every ordning, the completeness check inverts, and the next reader concludes
// data/forventet-utfall.json is stale. It is not; it is the oracle.
function vurder(husstand: Husstand, ordning: Ordning) {
  // TJENESTEBEHOV is assessed per person, not per household, so it has its own
  // coverage check further down and is deliberately invisible here.
  if (ordning.regel === "TJENESTEBEHOV") return null;
  const soeker = soekerFor(husstand);
  if (soeker === null) return null;
  if (plasserSomKvalifiserer(tilstand, soeker, ordning, satser).length === 0) return null;
  const g = husstandsgrunnlag(husstand);
  if (regelKreverInntekt[ordning.regel] && g === null) return null;
  // grunnlag mirrors beregningsbeloep from fiks-simulator (inntekt minus the posts
  // not marked medregnes), so the income rules are driven with the same number the
  // running service would have fetched — no stack needed.
  return evaluateVilkaar(ordning.regel, {
    tilstand,
    personId: soeker,
    ordning,
    satser,
    grunnlag: g,
    // felles and forbehold only land in SjekkResultat.grunnlag and in the prose. This
    // gate asserts on godkjent, never on melding — rewording a message must not fail
    // a data check.
    felles: {},
    forbehold: ""
  }).godkjent;
}

for (const ordning of satser.ordninger) {
  if (ordning.regel === "TJENESTEBEHOV") continue;
  const utfall = husstander
    .map((h) => ({ id: h.husstandId, godkjent: vurder(h, ordning) }))
    .filter((r) => r.godkjent !== null);
  const ja = utfall.filter((r) => r.godkjent);
  const nei = utfall.filter((r) => !r.godkjent);
  if (ja.length === 0 || nei.length === 0) {
    throw new Error(
      `${ordning.id} kan bare gi ett utfall: ${ja.length} husstander innvilget og ` +
      `${nei.length} avslått, blant husstander som faktisk har barn i målgruppen. ` +
      `Begge utfall må finnes, ellers ser regelen ut til å virke mens den alltid svarer likt.`
    );
  }
}

// --- Pinned outcomes --------------------------------------------------------
// forventetUtfall records what each husstand is supposed to demonstrate. Pinning
// it means a changed income or a moved trinn breaks the build here, instead of
// silently turning a case into something the scenario text no longer describes.
const pinnet = await read("data/forventet-utfall.json");
const pinnetPerHusstand = new Map<string, any[]>(
  pinnet.husstander.map((r: any) => [r.husstandId, r.utfall])
);
const husstandPerId = new Map(husstander.map((h) => [h.husstandId, h]));

for (const husstand of husstander) {
  const forventet = pinnetPerHusstand.get(husstand.husstandId) || [];
  for (const rad of forventet) {
    const ordning = satser.ordninger.find((o) => o.id === rad.ordning);
    if (!ordning) {
      throw new Error(`${husstand.husstandId} forventer ukjent ordning ${rad.ordning}.`);
    }
    const faktisk = vurder(husstand, ordning);
    if (faktisk === null) {
      throw new Error(
        `${husstand.husstandId} forventer et utfall for ${rad.ordning}, men har ingen ` +
        `${ordning.tjeneste}-plass i målgruppen for den ordningen.`
      );
    }
    if (faktisk !== rad.godkjent) {
      throw new Error(
        `${husstand.husstandId}: forventet ${rad.godkjent ? "innvilget" : "avslag"} for ` +
        `${rad.ordning}, men dataene gir ${faktisk ? "innvilget" : "avslag"}.`
      );
    }
  }
  const faktiske = satser.ordninger
    .filter((o) => vurder(husstand, o) !== null)
    .map((o) => o.id);
  const utelatt = faktiske.filter((id) => !forventet.some((r: any) => r.ordning === id));
  if (utelatt.length > 0) {
    throw new Error(
      `${husstand.husstandId} treffer ${utelatt.join(", ")} uten at det står i ` +
      `data/forventet-utfall.json. Legg det inn, ellers er utfallet upinnet.`
    );
  }
}

// --- Scenario text must match the pinned outcomes ---------------------------
// Participants pick a husstand by its scenario text and expect a specific result.
// Longest phrase first: "gratis kjernetid 2–5 år" must win over "gratis kjernetid".
const ORDNINGSNAVN = [
  ["gratis kjernetid for 1-åringer", "gratis-kjernetid-barnehage-1"],
  ["gratis kjernetid 1 år", "gratis-kjernetid-barnehage-1"],
  ["gratis kjernetid 2–5 år", "gratis-kjernetid-barnehage-2-5"],
  ["gratis kjernetid", "gratis-kjernetid-barnehage-2-5"],
  ["gratis sfo 1. trinn", "gratis-sfo-1-trinn"],
  ["redusert sfo 2.–3. trinn", "redusert-sfo-2-3-trinn"],
  ["redusert sfo 4. trinn", "redusert-sfo-4-trinn"],
  ["sfo 4. trinn", "redusert-sfo-4-trinn"],
  ["redusert foreldrebetaling", "redusert-foreldrebetaling-barnehage"],
  ["6 %-regelen", "redusert-foreldrebetaling-barnehage"]
];

for (const husstand of husstander) {
  if (!husstand.scenario) {
    throw new Error(`${husstand.husstandId} mangler scenario-tekst.`);
  }
  let rest = husstand.scenario.toLowerCase();
  const forventet = pinnetPerHusstand.get(husstand.husstandId) || [];
  for (const [frase, ordningId] of ORDNINGSNAVN) {
    let i = rest.indexOf(frase);
    while (i !== -1) {
      const rad = forventet.find((r: any) => r.ordning === ordningId);
      if (!rad) {
        throw new Error(
          `${husstand.husstandId} nevner «${frase}» i scenario-teksten, men husstanden ` +
          `har ingen forventet utfall for ${ordningId} i data/forventet-utfall.json. ` +
          `Enten er teksten feil, eller så ` +
          `mangler husstanden barn i målgruppen.`
        );
      }
      // The direction word sits just before "grensen for <ordning>". Only assert
      // when one is actually there — many texts name an ordning without claiming a side.
      const foran = rest.slice(Math.max(0, i - 40), i);
      const claimBelow = /\bunder grensen for $/.test(foran);
      const claimAbove = /\bover grensen for $/.test(foran);
      if ((claimBelow || claimAbove) && claimBelow !== rad.godkjent) {
        throw new Error(
          `${husstand.husstandId} sier «${claimBelow ? "under" : "over"} grensen for ${frase}», ` +
          `men dataene gir ${rad.godkjent ? "innvilget" : "avslag"} for ${ordningId}.`
        );
      }
      rest = rest.slice(0, i) + " ".repeat(frase.length) + rest.slice(i + frase.length);
      i = rest.indexOf(frase);
    }
  }
}

// --- Trinn must follow age --------------------------------------------------
// A seven-year-old in fourth grade puts the household in an ordning it could
// never belong to in real life, and the target-group check happily accepts it.
for (const plass of sfoplasser) {
  const barn = personer.find((p) => p.personId === plass.personId);
  if (!barn) throw new Error(`SFO-plass peker på ukjent person ${plass.personId}.`);
  const forventetTrinn = (alderVed(String(barn.foedselsdato), satser.gjelderFra) ?? 0) - 5;
  if (plass.trinn !== forventetTrinn) {
    throw new Error(
      `${plass.personId} er ${alderVed(String(barn.foedselsdato), satser.gjelderFra)} år ved ` +
      `${satser.gjelderFra} og skal da gå på ${forventetTrinn}. trinn, ikke ${plass.trinn}.`
    );
  }
}

// --- Needs-based ordninger, assessed per person -----------------------------
// The applicant's age and municipality decide, so the dataset has to contain
// someone the tilbud fits and someone it does not. Three distinct rejection
// reasons exist, and all three must be reachable — otherwise the branches that
// produce them are dead code nobody notices.
//
// This block stays hand-rolled, and it is not a leftover mirror. It has to tell
// `ingenTilbud` apart from `utenforMaalgruppe`, and evaluateVilkaar cannot: both
// TJENESTEBEHOV branches return godkjent: false with an identical key set in
// grunnlag, so the only discriminator is `melding` — which this gate must not
// assert on. Adding an `avslagsgrunn` key to grunnlag would fix it, but that
// changes the contract dump for the støttekontakt flows, so it is its own
// decision. Until then: the four-way classification here, the rule's own branches
// covered by pnpm test:vilkaar.
for (const ordning of satser.ordninger) {
  if (ordning.regel !== "TJENESTEBEHOV") continue;
  const utfall = { innvilget: 0, ingenTilbud: 0, utenforMaalgruppe: 0, fullt: 0 };
  for (const person of personer) {
    if (!person.foedselsdato) continue;
    const alder = alderVed(person.foedselsdato, satser.gjelderFra);
    const iKommunen = tjenestetilbud.filter(
      (t: any) => t.tjeneste === ordning.tjeneste &&
        t.kommunenummer === person.bostedsadresse?.kommunenummer
    );
    if (iKommunen.length === 0) { utfall.ingenTilbud++; continue; }
    const passer = iKommunen.filter(
      (t: any) => alder >= t.malgruppeFraAar && alder <= t.malgruppeTilAar
    );
    if (passer.length === 0) { utfall.utenforMaalgruppe++; continue; }
    if (passer.some((t: any) => t.ledigePlasser > 0)) utfall.innvilget++;
    else utfall.fullt++;
  }
  for (const [grunn, antall] of Object.entries(utfall)) {
    if (antall === 0) {
      throw new Error(
        `${ordning.id}: ingen person i datasettet gir utfallet "${grunn}". ` +
        `Alle fire utfallene må være nåbare, ellers er grenen død kode. ` +
        `Juster data/tjenestetilbud.json.`
      );
    }
  }
}

// --- Adressebeskyttelse is a kodeverk, not a boolean ------------------------
// `skjermet: true` said nothing about which level applied. FREG grades it, and
// the two levels behave differently, so the code is the field and the boolean is
// derived from it — never the other way round.
const GRADERINGER = new Set(["UGRADERT", "FORTROLIG", "STRENGT_FORTROLIG"]);
for (const person of personer) {
  const grad = person.adressebeskyttelse;
  if (!GRADERINGER.has(grad)) {
    throw new Error(
      `${person.personId} har adressebeskyttelse "${grad}". Gyldige: ${[...GRADERINGER].join(", ")}.`
    );
  }
  if (person.skjermet !== (grad !== "UGRADERT")) {
    throw new Error(
      `${person.personId} har skjermet=${person.skjermet} men adressebeskyttelse=${grad}. ` +
      `skjermet skal følge av graderingen.`
    );
  }
}
if (!personer.some((p) => p.adressebeskyttelse === "STRENGT_FORTROLIG")) {
  throw new Error("Mangler minst én person med STRENGT_FORTROLIG adressebeskyttelse.");
}
if (!personer.some((p) => p.adressebeskyttelse === "FORTROLIG")) {
  throw new Error("Mangler minst én person med FORTROLIG adressebeskyttelse.");
}

// The seed must NOT be masked. Masking is a runtime concern, applied on the way out
// of readState() in apps/shared/skjerming.ts.
//
// This looks backwards until you see the failure mode: someone finds a protected
// person's name in data/personer.json, reads it as the leak, and empties the field.
// That breaks two things at once. The grading has nothing left to protect, so the
// lesson the sandbox teaches disappears — and the masking has no input, so its
// tests pass against empty strings and stop meaning anything.
//
// kontakt is exempt: Tenor-imported people carry `kontakt: {}` and never had an
// address or phone number to begin with.
for (const person of personer.filter((p) => p.adressebeskyttelse !== "UGRADERT")) {
  const paakrevd = {
    "navn.fornavn": person.navn?.fornavn,
    "navn.etternavn": person.navn?.etternavn,
    "bostedsadresse.adressenavn": person.bostedsadresse?.adressenavn
  };
  for (const [felt, verdi] of Object.entries(paakrevd)) {
    if (!verdi) {
      throw new Error(
        `${person.personId} (${person.adressebeskyttelse}) mangler ${felt} i seeden. ` +
        `Skjerming skjer ved innlasting i skjerming.ts — seeden skal ikke maskeres.`
      );
    }
  }
}

// --- Every SJEKK step must point at an ordning that exists ------------------
// fritidskort-stotte fetched income for a long time without an ordning to measure
// it against. Nothing caught it, because the coverage checks only iterate over
// ordninger that exist.
const prosesskatalog = await read("data/prosessdefinisjoner.json");
const allProsesser = [
  ...(prosesskatalog.prosesser || []),
  ...(prosesskatalog.maler || [])
];
const ordningIder = new Set(satser.ordninger.map((o) => o.id));
const tjenester = new Set(satser.ordninger.map((o) => o.tjeneste));
for (const prosess of allProsesser) {
  for (const steg of prosess.steg || []) {
    if (steg.type !== "SJEKK") continue;
    const url = steg.api?.url || steg.ressurs || "";
    const parametere = new URLSearchParams(url.split("?")[1] || "");
    // A SJEKK can name an ordning outright, or name a tjeneste and let the child's
    // trinn decide. Both must resolve to something that exists in data/satser.json.
    const tjeneste = parametere.get("tjeneste");
    // tjenester er bygget av satser.ordninger, så den holder Tjeneste-verdier.
    if (tjeneste && !(tjenester as Set<string>).has(tjeneste)) {
      throw new Error(
        `Prosessen ${prosess.id}, steg ${steg.id}, sjekker mot tjenesten ${tjeneste}, ` +
        `som ingen ordning i data/satser.json tilbyr. Gyldige: ${[...tjenester].join(", ")}.`
      );
    }
    const ordning = steg.ordning || parametere.get("ordning");
    if (!ordning || ordning.startsWith("{")) continue;
    if (!ordningIder.has(ordning)) {
      throw new Error(
        `Prosessen ${prosess.id}, steg ${steg.id}, sjekker mot ordningen ${ordning}, ` +
        `som ikke finnes i data/satser.json.`
      );
    }
  }
}

const modeller = await read("data/informasjonsmodeller.json");

// --- Informasjonsmodellens kodeverdier mot dataene --------------------------
// Four of these had drifted into prose that was simply false: sivilstand said
// «GIFT eller UGIFT i denne forenklingen» while the data also had SEPARERT,
// household.type listed three of seven, scheme.regel two of three and
// scheme.tjeneste two of four. Prose cannot be checked, so they are kodeverdier
// now, and the rule is that the documented set equals the set the data actually
// contains. A model that only claims what is there cannot go stale.
const KODEVERDIER_FRA_DATA = [
  ["person", "sivilstand", () => personer.map((p) => p.sivilstand)],
  ["person", "personstatus", () => personer.map((p) => p.personstatus)],
  ["person", "foreldrebarnrelasjon",
    () => personer.flatMap((p) => (p.foreldrebarnrelasjon || []).map((r: any) => r.relasjon))],
  ["household", "type", () => husstander.map((h) => h.type)],
  ["household", "medlemmer",
    () => husstander.flatMap((h) => h.medlemmer.map((m) => m.rolle))],
  ["scheme", "regel", () => satser.ordninger.map((o) => o.regel)],
  ["scheme", "tjeneste", () => satser.ordninger.map((o) => o.tjeneste)]
];

const begreperIModellen = new Map(
  modeller.modeller
    .flatMap((modell: any) => modell.begreper || modell.entiteter || [])
    .map((begrep: any) => [begrep.id, begrep])
);

for (const [begrepId, attributtNavn, hentVerdier] of KODEVERDIER_FRA_DATA) {
  const begrep = begreperIModellen.get(begrepId);
  if (!begrep) {
    throw new Error(`data/informasjonsmodeller.json mangler begrepet ${begrepId}.`);
  }
  const attributt = ((begrep as any).attributter || []).find((a: any) => a.navn === attributtNavn);
  if (!attributt) {
    throw new Error(`${begrepId} mangler attributtet ${attributtNavn}.`);
  }
  const iDataene = [...new Set((hentVerdier as () => unknown[])())].sort();
  const dokumentert = [...(attributt.kodeverdier || [])].sort();
  if (JSON.stringify(dokumentert) !== JSON.stringify(iDataene)) {
    throw new Error(
      `${begrepId}.${attributtNavn}: informasjonsmodellen dokumenterer ` +
      `${JSON.stringify(dokumentert)}, dataene inneholder ${JSON.stringify(iDataene)}.`
    );
  }
}

// --- Ett kodeverk for samtykkestatus ---------------------------------------
// The statuses lived in three places with three different inventories: demo-gui
// and tools-api knew IKKE_SAMTYKKET, and the informasjonsmodell documented
// three of the five and never mentioned UTLOEPT at all. The state machine in
// apps/shared/samtykke.ts is the kodeverk now, and this check makes
// the documentation fail rather than quietly disagree with the code.

const samtykkemodeller = modeller.modeller
  .flatMap((modell: any) => modell.begreper || modell.entiteter || [])
  .filter((begrep: any) => begrep.id === "consent");

if (samtykkemodeller.length === 0) {
  throw new Error(
    "Fant ingen informasjonsmodell med id \"consent\". Kodeverket for samtykkestatus " +
    "skal dokumenteres der — se apps/shared/samtykke.ts."
  );
}

for (const modell of samtykkemodeller) {
  const status = (modell.attributter || []).find((attributt: any) => attributt.navn === "status");
  if (!status) {
    throw new Error(`Informasjonsmodellen ${modell.id} mangler attributtet status.`);
  }
  const dokumentert = JSON.stringify(status.kodeverdier || []);
  const ikode = JSON.stringify(SAMTYKKESTATUSER);
  if (dokumentert !== ikode) {
    throw new Error(
      `Kodeverket for samtykkestatus er ute av takt. Informasjonsmodellen sier ` +
      `${dokumentert}, tilstandsmaskinen i apps/shared/samtykke.ts sier ${ikode}.`
    );
  }
}

// --- docs/testpersoner.md må stemme med dataene ------------------------------
// The one thing participants actually needed was a map of who they can use. A
// hand-written table over 394 people goes stale the first time an income moves, so
// it is generated — and this is what makes the generation worth anything: the file
// is rebuilt here and compared byte for byte. A generated table that nobody checks
// is just a table with a longer half-life.
const plasser = {
  barnehage: barnehageplasser,
  sfo: sfoplasser,
  fritid: fritidsdeltakelse
};
const forventetDok = buildTestpersondok(
  personer,
  husstander,
  inntekter,
  eierforhold,
  plasser,
  kuratert,
  satser.gjelderFra
);
const faktiskDok = await readFile("docs/testpersoner.md", "utf8");
if (faktiskDok !== forventetDok) {
  const forventedeLinjer = forventetDok.split("\n");
  const faktiskeLinjer = faktiskDok.split("\n");
  const foerste = forventedeLinjer.findIndex((linje, i) => linje !== faktiskeLinjer[i]);
  throw new Error(
    `docs/testpersoner.md er ute av takt med dataene, fra linje ${foerste + 1}:\n` +
    `  i fila:     ${JSON.stringify(faktiskeLinjer[foerste])}\n` +
    `  skal være:  ${JSON.stringify(forventedeLinjer[foerste])}\n` +
    `Kjør node scripts/importer-tenor.ts.`
  );
}

// --- Case-tabellen deltakerne faktisk bruker ---------------------------------
// The recommended SFO user gave a rejection in three participant-facing surfaces at
// once — deltakerstart.md, prosessmodell.md and the dashboard — and nothing caught
// it, because the claim only ever lived in prose. It is pinned now, and the check
// runs the same rule the flow will run.
const deltakercaser = await read("data/deltakercaser.json");
const prosessIder = new Set(allProsesser.map((p) => p.id));

// deltakercaser.json is ASCII-only on purpose, the surfaces are not: "Soknad om
// fritidskort-stotte" has to match "Søknad om fritidskort-støtte". Same folding the
// matrikkel mock does on street names.
function foldNorsk(tekst: string) {
  return String(tekst)
    .toLowerCase()
    .replaceAll("ø", "o")
    .replaceAll("æ", "ae")
    .replaceAll("å", "aa")
    .replace(/\s+/g, " ");
}

// deltakerstart.md and the dashboard both carry the table itself, one row per case,
// so the check is row-level: the row for a case has to name that case's pinned
// person. Checking a file as a whole would pass a row recommending the wrong person
// as long as the right one appeared somewhere else on the page — and the page is
// what the participant reads. prosessmodell.md keys its bullets on prosessId rather
// than on the case names, so it has no rows to match; it is covered by the
// prose sweep below instead.
// radSkille = null betyr at flaten sjekkes som helhet, uten rader. tekst og rader
// fylles i løkka under.
type Caseflate = { fil: string; radSkille: RegExp | null; tekst?: string; rader?: string[] | null };

const caseFlater: Caseflate[] = [
  { fil: "docs/deltakerstart.md", radSkille: /\n/ },
  { fil: "apps/demo-gui/src/dashboard.html", radSkille: /<\/tr>/ },
  { fil: "docs/prosessmodell.md", radSkille: null }
];
for (const flate of caseFlater) {
  flate.tekst = await readFile(flate.fil, "utf8");
  flate.rader = flate.radSkille
    ? flate.tekst.split(flate.radSkille).map(foldNorsk)
    : null;
}

for (const sak of deltakercaser.caser) {
  if (!prosessIder.has(sak.prosessId)) {
    throw new Error(`data/deltakercaser.json peker på prosessen ${sak.prosessId}, som ikke finnes.`);
  }
  const person = personPerId.get(sak.personId);
  if (!person) {
    throw new Error(`data/deltakercaser.json peker på ${sak.personId}, som ikke finnes.`);
  }
  // A recommended demo user has to be someone a participant can actually log in as
  // and act for themselves. Recommending a 15-year-old would send them into a 403.
  if (person.personstatus !== "BOSATT") {
    throw new Error(
      `${sak.personId} er anbefalt for ${sak.prosessId} men har personstatus ` +
      `${person.personstatus} og kan ikke logge inn.`
    );
  }
  if ((alderVed(String(person.foedselsdato), satser.gjelderFra) ?? 0) < 18) {
    throw new Error(
      `${sak.personId} er anbefalt for ${sak.prosessId} men er under 18 og kan ikke ` +
      `være avsender på egen hånd.`
    );
  }
  // The surfaces must name the same person, row by row. A pinned table nobody
  // compares to the pages participants actually read is just a second place to be
  // wrong — which is how the SFO case managed to be wrong in three of them at once.
  for (const flate of caseFlater) {
    if (!flate.rader) continue;
    const rader = flate.rader.filter((rad: any) => rad.includes(foldNorsk(sak.navn)));
    if (rader.length === 0) {
      throw new Error(
        `${flate.fil} har ingen rad for «${sak.navn}», som data/deltakercaser.json ` +
        `pinner til ${sak.personId}.`
      );
    }
    if (rader.some((rad: any) => !rad.includes(sak.personId))) {
      throw new Error(
        `${flate.fil} anbefaler ikke ${sak.personId} i raden for «${sak.navn}», ` +
        `som data/deltakercaser.json pinner for ${sak.prosessId}.`
      );
    }
  }
  if (!sak.ordning) continue;
  const ordning = satser.ordninger.find((o) => o.id === sak.ordning);
  if (!ordning) {
    throw new Error(`data/deltakercaser.json peker på ordningen ${sak.ordning}, som ikke finnes.`);
  }
  const forventetJa = sak.forventetUtfall === "innvilget";
  let faktisk;
  if (ordning.regel === "TJENESTEBEHOV") {
    // Assessed per person, so vurder() deliberately returns null for it — the
    // household loop above skips TJENESTEBEHOV for the same reason.
    faktisk = evaluateVilkaar(ordning.regel, {
      tilstand,
      personId: sak.personId,
      ordning,
      satser,
      grunnlag: null,
      felles: {},
      forbehold: ""
    }).godkjent;
  } else {
    faktisk = vurder(krevHusstand(person.husstandId), ordning);
    if (faktisk === null) {
      throw new Error(
        `${sak.personId} er anbefalt for ${sak.prosessId}, men husstanden har ingen ` +
        `${ordning.tjeneste}-plass i målgruppen for ${sak.ordning}.`
      );
    }
  }
  if (faktisk !== forventetJa) {
    throw new Error(
      `data/deltakercaser.json sier ${sak.prosessId} med ${sak.personId} gir ` +
      `${sak.forventetUtfall}, men reglene gir ${faktisk ? "innvilget" : "avslag"}. ` +
      `Det er nøyaktig feilen som lå i SFO-caset: en anbefalt bruker som får avslag.`
    );
  }
}

// prosessmodell.md recommends in prose rather than in a table, so the row check
// above never reaches it. "Bruk `person-008`" for SFO is the exact sentence that
// was wrong, so pin the shape it was wrong in: a recommended user has to be one the
// table actually recommends somewhere.
const anbefalteBrukere = new Set(deltakercaser.caser.map((sak: any) => sak.personId));
for (const flate of caseFlater) {
  for (const treff of String(flate.tekst).matchAll(/Bruk `(person-\d+)`/g)) {
    if (!anbefalteBrukere.has(treff[1])) {
      throw new Error(
        `${flate.fil} sier «Bruk \`${treff[1]}\`», men ${treff[1]} er ikke anbefalt ` +
        `for noe case i data/deltakercaser.json.`
      );
    }
  }
}

// Next to the recommended støttekontakt user the surfaces name two counterexamples,
// and neither was asserted anywhere: person-003 meets a full tilbud, person-062
// lives in a kommune with none at all. Both rest on nobody having edited
// data/tjenestetilbud.json, and being wrong there is worse than being silent — a
// participant reads them as the explanation for the avslag they just got.
const stottekontaktOrdning = satser.ordninger.find((o) => o.id === "stottekontakt");
if (!stottekontaktOrdning) {
  throw new Error("data/satser.json mangler ordningen for stottekontakt.");
}
const stottekontaktMoteksempler = [
  { personId: "person-003", melding: "ingen ledige plasser" },
  { personId: "person-062", melding: "har ikke registrert et tilbud" }
];
for (const eksempel of stottekontaktMoteksempler) {
  const utfall = evaluateVilkaar("TJENESTEBEHOV", {
    tilstand,
    personId: eksempel.personId,
    ordning: stottekontaktOrdning,
    satser,
    grunnlag: null,
    felles: {},
    forbehold: ""
  });
  if (utfall.godkjent) {
    throw new Error(
      `${eksempel.personId} er dokumentert som et avslag i stottekontakt-behov, men ` +
      `reglene gir innvilget nå.`
    );
  }
  if (!utfall.melding.includes(eksempel.melding)) {
    throw new Error(
      `${eksempel.personId} skulle gi «${eksempel.melding}» i stottekontakt-behov, ` +
      `men ga: ${utfall.melding}`
    );
  }
}


// The dashboard tells the participant why person-001 is the wrong user for two of
// the five cases: no child in SFO, and no child in fritidskort's 6–18 band. Both
// are true because Ella is 4, which stops being true on its own as gjelderFra
// moves. Pin the claim rather than the age, so the surface has to be rewritten
// rather than quietly turning into a lie.
const fritidskortOrdning = satser.ordninger.find((o) => o.id === "fritidskort-stotte");
if (!fritidskortOrdning) {
  throw new Error("data/satser.json mangler ordningen fritidskort-stotte.");
}
const majasBarn = krevHusstand(krevPerson("person-001").husstandId)
  .medlemmer.filter((m) => m.rolle === "barn")
  .map((m) => krevPerson(m.personId));
for (const barn of majasBarn) {
  const alder = alderVed(String(barn.foedselsdato), satser.gjelderFra) ?? 0;
  if (alder >= (fritidskortOrdning.alderFraAar ?? 0) && alder <= (fritidskortOrdning.alderTilAar ?? 0)) {
    throw new Error(
      `${barn.personId} er ${alder} år og dermed i fritidskortets målgruppe. ` +
      `Dashboardet og docs/deltakerstart.md sier person-001 ikke har barn der.`
    );
  }
  if (sfoplasser.some((p) => p.personId === barn.personId)) {
    throw new Error(
      `${barn.personId} har fått en SFO-plass. Dashboardet og docs/deltakerstart.md ` +
      `sier person-001 ikke har barn i SFO — det er den vanligste snublesteinen.`
    );
  }
}

// --- the catalogue against the loader ---------------------------------------
//
// GET /api/katalog/datasett is one of two machine-readable ways a team discovers
// the data foundation, and it was a literal in routes.ts with four of eleven
// entries — it hid satser, sfoplasser, fritidsaktiviteter, fritidsdeltakelse and
// tjenestetilbud, the data three of the five published cases run on. It is now
// built from SEED_DATASETS. This keeps that list honest in both directions:
// every file it names must exist, and every seed file readState loads without a
// default must be named. The second half is what catches a *new* dataset that
// someone loads and forgets to publish.
{
  for (const { id, file } of SEED_DATASETS) {
    try {
      await readFile(`data/${file}`, "utf8");
    } catch {
      throw new Error(
        `SEED_DATASETS oppgir data/${file} for «${id}», men fila kan ikke leses. ` +
        `Katalogen på GET /api/katalog/datasett ville pekt på ingenting.`
      );
    }
  }

  // readState's calls are read as text on purpose: a readJson with a second
  // argument is runtime state (starts empty, gitignored), not a dataset.
  const source = await readFile("apps/sandbox-backend/src/state.ts", "utf8");
  const readStateBody = source.slice(source.indexOf("export async function readState()"));
  const loaded = [...readStateBody.matchAll(/readJson\("([^"]+)"\s*\)/g)].map((m) => m[1]);
  const inCatalogue: string[] = SEED_DATASETS.map((dataset) => dataset.file);

  const unpublished = loaded.filter((file) => !inCatalogue.includes(file));
  const notLoaded = inCatalogue.filter((file) => !loaded.includes(file));
  if (unpublished.length > 0 || notLoaded.length > 0) {
    throw new Error(
      `SEED_DATASETS og readState() navngir ulike filer. ` +
      (unpublished.length ? `Lastet, men ikke i katalogen: ${unpublished.join(", ")}. ` : "") +
      (notLoaded.length ? `I katalogen, men ikke lastet: ${notLoaded.join(", ")}. ` : "") +
      `Katalogen er det et team oppdager datagrunnlaget gjennom — den skal si det ` +
      `samme som lasteren.`
    );
  }
}

console.log(
  `Validering ok. ${personer.length} personer, ${husstander.length} husstander, ` +
  `${satser.ordninger.length} ordninger. Alle ordninger gir begge utfall blant husstander ` +
  `med barn i målgruppen, alle 18 scenariotekster stemmer med pinnede utfall, ` +
  `og trinn følger alder.`
);
