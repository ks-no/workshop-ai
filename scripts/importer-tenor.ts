#!/usr/bin/env node

// TENOR IMPORT
//
// Builds the sandbox's four population files from two sources, and nothing else:
//
//   data/kuratert.json   the hand-authored threshold fixtures (person-001..051,
//                        household-001..018) - only forfattede felter
//   data/tenor/*.json    raw extracts from Skatteetaten's Tenor testdatasøk
//
// Everything else is derived here, in one code path shared by both sources:
// rolle, skjermet, husstandstype, the household's address and kommune, the member
// list, and the income rows for the imported population. That is the point of the
// split - a field that is derived cannot disagree with itself.
//
// Four properties this script must keep, in order of importance:
//
//  1. person-001..051 and household-001..018 keep their ids. They are the curated
//     threshold fixtures every case and every eval hangs off. New population is
//     numbered from person-052.
//  2. Ids are stable across runs. The id ledger is read from the existing
//     data/personer.json, so dropping a new extract into data/tenor/ and re-running
//     grows the population without renumbering anyone. Sorting alone would not do
//     this - a new fnr would sort into the middle and shift every id after it.
//     Only the ids are read back; every other field is rebuilt from source.
//  3. No Math.random and no Date.now. Everything derives from the fnr, so two runs
//     of the same input produce byte-identical output.
//  4. The script rebuilds. It used to be additive - it skipped every fnr that
//     already had a personId - which meant a second run was a no-op and the data
//     could never be cleaned, only grown.
//
// The family graph is built from Tenor's own morFnr, farFnr, barnFnr and
// partnerFnr rather than from the tenorRelasjoner blob. Those four fields carry
// the role, so a relation can be typed (MOR, FAR, MEDMOR, BARN) instead of a flat
// "FORELDER", and they are near-symmetric at the source - 4 of 238 parent edges
// lack the reverse - so both directions can be emitted from one authority. Edges
// pointing out of the extract are dropped: Tenor's world has a million people and
// ours has 394, so 546 of 1217 references land on someone we do not hold.
//
// Usage: node scripts/importer-tenor.ts [--tørrkjør] [--glem-id-er]
//        --glem-id-er assigns ids from scratch instead of reading the ledger.
//        Use it to prove the assignment is deterministic; it will renumber if a
//        new extract has landed since the last run.

import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { alderVed } from "../apps/shared/alder.ts";
import { buildTestpersondok } from "./testpersondok.ts";
import { feilmelding } from "../apps/shared/errors.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(repoRoot, "data");
const tenorDir = path.join(dataDir, "tenor");
const dryRun = process.argv.includes("--tørrkjør") || process.argv.includes("--torrkjor");
const forgetIds = process.argv.includes("--glem-id-er");

const MYNDIG = 18;

// Folkeregisterpersonstatus, uppercased the way every other kodeverk in the
// sandbox is. Only these five occur in the extracts; the enum has ten.
const BOSATT = "BOSATT";

const read = async (fil: any) => JSON.parse(await readFile(fil, "utf8"));
const skriv = (fil: any, data: any) =>
  writeFile(fil, JSON.stringify(data, null, 2) + "\n");

// Age is computed at the rates' effective date, like everywhere else in the
// sandbox, so the same person yields the same outcome whenever this runs. This
// used to be a hardcoded "2026-08-01" that happened to equal satser.gjelderFra,
// so the claim above was true only by coincidence of value. It matters more here
// than it looks: the adult/child split below decides `rolle` in husstander.json,
// which is an input to every rule in vilkaar.ts. A drifting reference date would
// have moved the rules' input, not just one rule.
const REFERANSEDATO = (await read(path.join(dataDir, "satser.json"))).gjelderFra;

const alder = (foedselsdato: any) => alderVed(foedselsdato, REFERANSEDATO);

// --- reading the extracts ---------------------------------------------------

// tenorMetadata.kildedata is JSON inside a JSON string. The addresses live there,
// and with them the two fields that make this import worth more than names:
// adresseIdentifikatorFraMatrikkelen, which joins a person to a property, and
// skolekrets, which the hjertesone case had nothing to stand on without.
function kildedata(dokument: any) {
  const raw = dokument?.tenorMetadata?.kildedata;
  if (typeof raw !== "string") return raw || {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function fnrFor(dokument: any) {
  const ident = dokument?.identifikator;
  return Array.isArray(ident) && ident.length ? ident[0] : dokument?.id || null;
}

function gjeldendeAdresse(dokument: any) {
  const adresser = kildedata(dokument).bostedsadresse || [];
  return adresser.find((a: any) => a.erGjeldende) || adresser[0] || {};
}

function stedTittel(verdi: unknown) {
  return String(verdi || "")
    .toLowerCase()
    .replace(/(^|[\s\-/])([\p{L}])/gu, (_, skille, bokstav) => skille + bokstav.toUpperCase());
}

function tilBostedsadresse(dokument: any, kommunenavn: any) {
  const adresse = gjeldendeAdresse(dokument);
  const veg = adresse.vegadresse || {};
  const nummer = veg.adressenummer || {};
  const sted = veg.poststed || {};
  return {
    adressenavn: veg.adressenavn || null,
    husnummer: nummer.husnummer ? Number(nummer.husnummer) : null,
    husbokstav: nummer.husbokstav || null,
    postnummer: sted.postnummer || null,
    poststed: stedTittel(sted.poststedsnavn),
    // kommunenummer is the authoritative key and is what joins to the matrikkel.
    kommunenummer: veg.kommunenummer || null,
    kommune: kommunenavn.get(String(veg.kommunenummer || "").padStart(4, "0"))
      || stedTittel(sted.poststedsnavn)
  };
}

// Tenor gives kommunenummer but no kommune name, and the name is shown in the
// person picker. data/brreg.seed.json carries both for the kommuner its 200
// organisations sit in, so those names are taken from there rather than invented.
// For the rest the poststed name stands in - a real place in the right area, but
// not the kommune. kommunenummer is the authoritative field either way, and it is
// correct for everyone. Noted in docs/syntetiske-data.md.
async function readKommunenavn() {
  const brreg = await read(path.join(dataDir, "brreg.seed.json"));
  const kart = new Map();
  for (const enhet of brreg.dokumentListe || []) {
    for (const felt of ["forretningsadresse", "postadresse"]) {
      const adresse = enhet[felt] || {};
      if (adresse.kommunenummer && adresse.kommune) {
        const nr = String(adresse.kommunenummer).padStart(4, "0");
        if (!kart.has(nr)) kart.set(nr, stedTittel(adresse.kommune));
      }
    }
  }
  return kart;
}

async function readUttrekk() {
  const files = (await readdir(tenorDir))
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .sort();
  if (files.length === 0) {
    throw new Error(`Fant ingen uttrekk i ${path.relative(repoRoot, tenorDir)}.`);
  }

  const personer = new Map();
  // Who shares a household with whom. Deliberately narrower than the family
  // graph: only people who are bosatt, because a household is people living at an
  // address, and a dead or emigrated relative is not one of them.
  const husstandsnaboer = new Map();
  const registrer = (dokument: any) => {
    const fnr = fnrFor(dokument);
    // Dead, inactive and emigrated people came along because the searches had no
    // personstatus filter, and used to be dropped here. They are kept now: the
    // register knows them, a child's mother does not stop being their mother, and
    // the 16 "inaktiv" ones turned out to be the D-numbers the sandbox had none of.
    // What they do not get is a household - see husstandsnaboer above.
    if (!fnr || !dokument.foedselsdato) return null;
    if (!personer.has(fnr)) personer.set(fnr, dokument);
    if (dokument.personstatus === "bosatt" && !husstandsnaboer.has(fnr)) {
      husstandsnaboer.set(fnr, new Set());
    }
    return fnr;
  };

  for (const fil of files) {
    const innhold = await read(path.join(tenorDir, fil));
    for (const dokument of innhold.dokumentListe || []) {
      const fnr = registrer(dokument);
      // tenorRelasjoner.freg is not a reference. It is the whole person document
      // for each mother, father and partner, address included, so households come
      // out of the child documents without a single extra API call.
      for (const rel of dokument?.tenorRelasjoner?.freg || []) {
        const relFnr = registrer(rel);
        if (fnr && relFnr && husstandsnaboer.has(fnr) && husstandsnaboer.has(relFnr)) {
          husstandsnaboer.get(fnr).add(relFnr);
          husstandsnaboer.get(relFnr).add(fnr);
        }
      }
    }
  }
  return { files, personer, husstandsnaboer };
}

// --- the family graph -------------------------------------------------------

// One authority for every relation, in one direction: who the parents of a child
// are, and who is married to whom. Both output shapes are derived from these two
// maps, so the two directions cannot disagree and neither can the role.
//
// Tenor states the same relation from both ends (a child names its mother, the
// mother names the child), and the two agree for 234 of 238 edges. Taking the
// union rather than one side keeps the four that only exist once.
function tilListe(verdi: unknown) {
  if (verdi === null || verdi === undefined) return [];
  return Array.isArray(verdi) ? verdi : [verdi];
}

function buildFamilie(personer: any, kuraterte: any) {
  const foreldreAv = new Map();   // barnFnr -> Set(forelderFnr)
  const ektefelleAv = new Map();  // fnr -> fnr

  // Everyone we hold, both sources. An edge to someone outside this set is dropped:
  // Tenor's world is a million people, ours is 394.
  const kjent = new Set([...personer.keys(), ...kuraterte.map((k: any) => k.fnr)]);

  const leggTilForelder = (barn: any, forelder: any) => {
    if (!kjent.has(barn) || !kjent.has(forelder) || barn === forelder) return;
    if (!foreldreAv.has(barn)) foreldreAv.set(barn, new Set());
    foreldreAv.get(barn).add(forelder);
  };
  const leggTilEktefelle = (en: any, to: any) => {
    if (!kjent.has(en) || !kjent.has(to) || en === to) return;
    ektefelleAv.set(en, to);
    ektefelleAv.set(to, en);
  };

  for (const [fnr, dokument] of personer) {
    for (const mor of tilListe(dokument.morFnr)) leggTilForelder(fnr, mor);
    for (const far of tilListe(dokument.farFnr)) leggTilForelder(fnr, far);
    for (const barn of tilListe(dokument.barnFnr)) leggTilForelder(barn, fnr);
    for (const partner of tilListe(dokument.partnerFnr)) leggTilEktefelle(fnr, partner);
  }
  for (const { fnr, barn, ektefelle } of kuraterte) {
    for (const barnFnr of barn) leggTilForelder(barnFnr, fnr);
    if (ektefelle) leggTilEktefelle(fnr, ektefelle);
  }
  return { foreldreAv, ektefelleAv };
}

// MEDMOR is the second mother, so the role depends on the other parent. Sorting
// by fnr makes the choice deterministic. Two fathers both get FAR - the enum has
// no co-father, and inventing one would be a wire value no spec knows.
function foreldrerolle(
  forelderFnr: string,
  alleForeldre: Iterable<string>,
  kjoennFor: (fnr: string) => string | null
) {
  const kjoenn = kjoennFor(forelderFnr);
  if (kjoenn !== "KVINNE") return "FAR";
  const moedre = [...alleForeldre].filter((f) => kjoennFor(f) === "KVINNE").sort();
  return moedre.indexOf(forelderFnr) > 0 ? "MEDMOR" : "MOR";
}

const FREG_ROLLE = { MOR: "mor", FAR: "far", MEDMOR: "medmor", BARN: "barn" };

// --- binding a person to a property -----------------------------------------

// adresseIdentifikatorFraMatrikkelen is a real Folkeregisteret field — it sits on
// Bostedsadresse next to naerAdresseIdentifikatorFraMatrikkelen, grunnkrets and
// skolekrets — and in the real register it identifies the ADDRESS, not the
// matrikkelenhet. Tenor fills it with a genuine Kartverket address id, which hit
// zero of the 8202 properties here because this repo holds a synthetic register
// with its own ids. So the value is replaced by the id that actually resolves.
// Tenor's own is dropped rather than kept beside it: a join key that resolves
// nowhere is worse than an empty one, because it looks like it works.
//
// One simplification to know about: our matrikkelId comes from Geonorge's address
// API, so it is an address row — right in kind. But this model has no separate
// matrikkelenhet at all; gnr/bnr sit on the address row, and 8202 Bergen addresses
// share 5868 gnr/bnr. Title in the real world belongs to the matrikkelenhet, so
// data/eierforhold.json keying on the address is a simplification, not the model.
//
// data/matrikkel.json is read here and nowhere else in the import. matrikkel-mock
// is still the only service that reads it.
async function readAdresseindeks() {
  const matrikkel = await read(path.join(dataDir, "matrikkel.json"));
  const indeks = new Map();
  for (const gate of matrikkel.gater) {
    for (const eiendom of gate.eiendommer) {
      if (eiendom.husnummer === null || eiendom.husnummer === undefined) continue;
      const noekkel = adressenoekkel(
        gate.kommunenummer,
        gate.adressenavn,
        eiendom.husnummer,
        eiendom.husbokstav
      );
      if (!indeks.has(noekkel)) indeks.set(noekkel, eiendom.matrikkelId);
    }
  }
  return indeks;
}

function adressenoekkel(kommunenummer: string, adressenavn: string, husnummer: number, husbokstav: string) {
  return [
    String(kommunenummer || ""),
    String(adressenavn || "").toLowerCase(),
    husnummer ?? "",
    String(husbokstav || "").toUpperCase()
  ].join("|");
}

// Returns the address with the join key filled in. The key is inside the address
// object, so both output shapes carry it without a second lookup.
function medMatrikkelId(adresse: any, indeks: Map<string, unknown>) {
  const noekkel = adressenoekkel(
    adresse.kommunenummer,
    adresse.adressenavn,
    adresse.husnummer,
    adresse.husbokstav
  );
  return { ...adresse, adresseIdentifikatorFraMatrikkelen: indeks.get(noekkel) ?? null };
}

// --- the id ledger ----------------------------------------------------------

// Only the id mapping is read back from the output. Everything else is rebuilt,
// so a wrong value in personer.json cannot survive a run - but a person's id can,
// which is the whole point.
async function readIdLedger() {
  if (forgetIds) return { personId: new Map(), husstandId: new Map() };
  let eksisterende;
  try {
    eksisterende = await read(path.join(dataDir, "personer.json"));
  } catch {
    return { personId: new Map(), husstandId: new Map() };
  }
  return {
    personId: new Map(eksisterende.map((p: any) => [p.syntetiskFodselsnummer, p.personId])),
    husstandId: new Map(eksisterende.map((p: any) => [p.syntetiskFodselsnummer, p.husstandId]))
  };
}

// --- households -------------------------------------------------------------

// A household is a connected group in the relation graph that also shares one
// address. Without the address condition a parent who has moved out would be
// pulled back in, and their income would count towards a household they left.
function buildHusstander(personer: any, husstandsnaboer: any): string[][] {
  const matrikkelId = (fnr: any) =>
    gjeldendeAdresse(personer.get(fnr)).adresseIdentifikatorFraMatrikkelen || `ukjent:${fnr}`;

  const visited = new Set<string>();
  const husstander: string[][] = [];
  // Only the bosatt are keys in husstandsnaboer, so nobody who is dead, inactive
  // or emigrated can be walked into a household.
  for (const fnr of [...husstandsnaboer.keys()].sort()) {
    if (visited.has(fnr)) continue;
    const stabel: string[] = [fnr];
    const gruppe = new Set<string>();
    while (stabel.length) {
      const denne = stabel.pop()!;
      if (gruppe.has(denne)) continue;
      gruppe.add(denne);
      visited.add(denne);
      for (const nabo of husstandsnaboer.get(denne) || []) {
        if (!gruppe.has(nabo) && matrikkelId(nabo) === matrikkelId(denne)) stabel.push(nabo);
      }
    }
    husstander.push([...gruppe].sort());
  }

  // A household of only minors is an artefact of independent searches, not a
  // family. Their parents were not bosatt, or live somewhere else.
  return husstander.filter((gruppe) =>
    gruppe.some((fnr) => alder(personer.get(fnr).foedselsdato) >= MYNDIG)
  );
}

// Three related adults at one address with no children is an adult child living
// with parents, not a household across generations of a family with kids. Calling
// both FLERGENERASJON made the type contradict the scenario text.
function husstandstype(medlemmer: any) {
  const voksne = medlemmer.filter((m: any) => alder(m.foedselsdato) >= MYNDIG);
  const barn = medlemmer.length - voksne.length;
  const gift = voksne.some((m: any) => m.sivilstand === "GIFT");
  if (voksne.length === 1) return barn > 0 ? "ENSLIG_FORSORGER" : "ENSLIG";
  if (voksne.length >= 3) return barn > 0 ? "FLERGENERASJON" : "VOKSNE_SAMMEN";
  if (barn === 0) return "PAR_UTEN_BARN";
  return gift ? "EKTEPAR" : "SAMBOERE";
}

const TYPETEKST: Record<string, string | undefined> = {
  ENSLIG: "Én voksen som bor alene.",
  ENSLIG_FORSORGER: "Én voksen med barn.",
  PAR_UTEN_BARN: "To voksne uten barn.",
  EKTEPAR: "Ektepar med barn.",
  SAMBOERE: "Samboere med barn.",
  FLERGENERASJON: "Flere generasjoner under samme tak.",
  VOKSNE_SAMMEN: "Flere voksne på samme adresse, uten barn i husstanden."
};

// Scenario text describes what the household is, not what it demonstrates. The
// curated 18 own the threshold claims and carry their own text in
// data/kuratert.json; these are breadth, and valider-data.js only cross-checks a
// text against an ordning when it names one.
// Derived from the type, so the two can never contradict each other.
function buildScenario(type: string, medlemmer: any) {
  const barnAldre = medlemmer
    .map((m: any) => alder(m.foedselsdato))
    .filter((a: any) => a < MYNDIG)
    .sort((a: any, b: any) => b - a);
  const parts = [TYPETEKST[type] || "Husstand."];
  if (barnAldre.length > 0) {
    parts.push(`Barn på ${barnAldre.join(", ")} år.`);
  }
  if (medlemmer.some((m: any) => m.adressebeskyttelse !== "UGRADERT")) {
    parts.push("Én person har adressebeskyttelse.");
  }
  parts.push("Fra Tenor, for bredde.");
  return parts.join(" ");
}

// --- eierforhold ------------------------------------------------------------

// Ownership is not in the matrikkel. The matrikkel says what a property is —
// boundaries, buildings, address — and the grunnbok says who holds title to it.
// This repo kept `eiere` inside data/matrikkel.json anyway, and the distribution
// there was unusable: 28 people, all in the curated band, held 1280 titles across
// 1225 of 8202 properties. person-026 owned 70. person-012 and person-017 owned 65
// each across 48 different streets. 341 of 369 people owned nothing at all, so a
// randomly chosen test person could never pass an ownership check, while the 28
// passed almost everywhere.
//
// Now it is derived: a household owns the home it lives in. A minority rent, and a
// minority own one extra property. Nobody owns more than three. A property absent
// from data/eierforhold.json has no registered owner in the sandbox — which is the
// honest state for a synthetic register that holds 18349 properties and 200
// households.
const EIERTAK = 3;

function buildEierforhold(husstander: any, personerUt: any, matrikkel: any) {
  const personPerId = new Map(personerUt.map((p: any) => [p.personId, p]));
  const perMatrikkelId = new Map();
  const antallEid = new Map();

  const leggTil = (matrikkelId: any, eiere: any, eierform: any) => {
    if (!matrikkelId || perMatrikkelId.has(matrikkelId)) return false;
    if (eiere.some((e: any) => (antallEid.get(e) || 0) >= EIERTAK)) return false;
    const andel = Math.round((1 / eiere.length) * 1000) / 1000;
    perMatrikkelId.set(matrikkelId, {
      matrikkelId,
      eiere: eiere.map((eier: any) => ({ eier, eierform, andel }))
    });
    for (const eier of eiere) antallEid.set(eier, (antallEid.get(eier) || 0) + 1);
    return true;
  };

  // Properties nobody lives at, per kommune, so an extra property is somewhere
  // real and not somebody else's home.
  const bebodd = new Set(
    personerUt
      .map((p: any) => p.bostedsadresse?.adresseIdentifikatorFraMatrikkelen)
      .filter(Boolean)
  );
  const ledigePerKommune = new Map();
  for (const gate of matrikkel.gater) {
    // The four hand-curated Bergen streets are left out of the extras: the
    // fartsdempende case rests on person-001 owning in Storgata and NOT in
    // Fjøsangerveien, and a randomly assigned cabin there would break the demo.
    if (gate.gateId.startsWith("gate-storgata-") || gate.gateId.startsWith("gate-nordnesveien-")
      || gate.gateId.startsWith("gate-fjosangerveien-") || gate.gateId.startsWith("gate-laksevagvegen-")) {
      continue;
    }
    for (const eiendom of gate.eiendommer) {
      if (bebodd.has(eiendom.matrikkelId)) continue;
      if (!ledigePerKommune.has(gate.kommunenummer)) ledigePerKommune.set(gate.kommunenummer, []);
      ledigePerKommune.get(gate.kommunenummer).push(eiendom.matrikkelId);
    }
  }
  for (const liste of ledigePerKommune.values()) liste.sort();

  let leietakere = 0;
  let ekstra = 0;
  for (const husstand of [...husstander].sort((a, b) => a.husstandId.localeCompare(b.husstandId))) {
    const voksne = husstand.medlemmer
      .filter((m: any) => m.rolle !== "barn")
      .map((m: any) => personPerId.get(m.personId))
      .filter(Boolean);
    if (voksne.length === 0) continue;
    const hjem = voksne[0].bostedsadresse?.adresseIdentifikatorFraMatrikkelen;
    if (!hjem) continue;
    const frø = seedOf(voksne[0].syntetiskFodselsnummer);

    // Roughly one household in five rents. Without them every household would own,
    // and "eier du i denne gata" would answer yes for everyone — the same failure
    // as before, inverted.
    if (frø % 5 === 0) {
      leietakere += 1;
      continue;
    }
    leggTil(hjem, voksne.map((v: any) => v.personId), "SELVEIER");

    // And roughly one in seven owns something more — a cabin or a let. The variant
    // is worth having; forty of them is not.
    if (frø % 7 === 0) {
      const ledige = ledigePerKommune.get(voksne[0].bostedsadresse.kommunenummer) || [];
      if (ledige.length > 0 && leggTil(ledige[frø % ledige.length], [voksne[0].personId], "UTLEIE")) {
        ekstra += 1;
      }
    }
  }

  const rader = [...perMatrikkelId.values()].sort((a, b) => a.matrikkelId.localeCompare(b.matrikkelId));
  return {
    beskrivelse:
      "Tinglyst eierforhold. Eierskap hører i grunnboken, ikke i matrikkelen - derfor " +
      "egen fil. En matrikkelenhet som ikke står her har ingen registrert eier i " +
      "sandkassen. Forenkling: raden er nøklet på adressen (matrikkelId), mens " +
      "hjemmel i virkeligheten ligger på matrikkelenheten (gnr/bnr), og flere " +
      "adresser deler samme gnr/bnr. Utledet av scripts/importer-tenor.ts.",
    syntetisk: true,
    antall: rader.length,
    eierforhold: rader,
    statistikk: {
      husstanderSomEier: rader.filter((r) => r.eiere.some((e: any) => e.eierform === "SELVEIER")).length,
      husstanderSomLeier: leietakere,
      ekstraEiendommer: ekstra,
      flestEiendommerPerPerson: EIERTAK
    }
  };
}

// --- income -----------------------------------------------------------------

// Tenor gives income for 6 of 120 main documents and none of the 224 parents, so
// it is authored here. That is the right call regardless: valider-data.js demands
// households on both sides of all five thresholds, and random income would not
// produce that coverage. The curated 18 keep owning the thresholds - their rows
// live in data/kuratert.json and are never generated; these numbers exist so the
// wider population is usable at all.
//
// Deterministic from the fnr - no Math.random, so the output is reproducible.
function seedOf(fnr: string) {
  let h = 2166136261;
  for (const char of String(fnr)) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function buildInntekt(fnr: string, harBarn: boolean) {
  const seed = seedOf(fnr);
  const loenn = 180000 + (seed % 71) * 10000;
  // infotekst finnes bare på poster som holdes utenfor grunnlaget, så typen må
  // si det — ellers utledes den fra den første posten i lista.
  const poster: {
    tekniskNavn: string;
    visningstekst: string;
    beloep: number;
    kilde: string;
    medregnes: boolean;
    infotekst?: string;
  }[] = [
    {
      tekniskNavn: "loennsinntekt",
      visningstekst: "Lønnsinntekt",
      beloep: loenn,
      kilde: "SKATTEETATEN",
      medregnes: true
    }
  ];
  if (seed % 3 === 0) {
    poster.push({
      tekniskNavn: "renteinntekt",
      visningstekst: "Renteinntekt",
      beloep: 1000 + (seed % 40) * 500,
      kilde: "SKATTEETATEN",
      medregnes: true
    });
  }
  if (harBarn) {
    poster.push({
      tekniskNavn: "barnetrygd",
      visningstekst: "Barnetrygd",
      beloep: 12648,
      kilde: "NAV",
      medregnes: false,
      infotekst: "Barnetrygd inngår ikke i grunnlaget for redusert foreldrebetaling."
    });
  }
  const utkast = seed % 11 === 0;
  return {
    identifikator: fnr,
    inntektsaar: utkast ? 2026 : 2025,
    stadie: utkast ? "UTKAST" : "OPPGJOER",
    ...(utkast ? {} : { skatteoppgjoersdato: "2026-06-15" }),
    poster,
    syntetisk: true
  };
}

// --- the contact register (KRR) ----------------------------------------------

// One row per bosatt person of 15 or older — KRR's real age floor. Curated people
// reuse the authored kontakt from data/kuratert.json, and the authored `krr`
// field (reservert, spraak) wins over the derivation, same pattern as the
// incomes. Tenor people get contact info generated here and ONLY here:
// personer.json never learns it, because that wire format is frozen.
const KRR_ALDERSGULV = 15;

// 2025-01-01 plus seed % 365 days. Dates, not timestamps, so the file stays
// byte-identical across runs — no Date.now anywhere in this script.
function krrDato(seed: number) {
  const dato = new Date(Date.UTC(2025, 0, 1));
  dato.setUTCDate(dato.getUTCDate() + (seed % 365));
  return dato.toISOString().slice(0, 10);
}

// fornavn.etternavn@example.test, the same shape the curated contact info uses.
// Norwegian letters are transliterated rather than stripped so Kåre and Kare do
// not collide any more than they must.
function epostSlug(navn: any) {
  const del = (verdi: unknown) =>
    String(verdi || "")
      .toLowerCase()
      .replaceAll("æ", "ae")
      .replaceAll("ø", "oe")
      .replaceAll("å", "aa")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");
  return [del(navn.fornavn), del(navn.etternavn)].filter(Boolean).join(".");
}

function buildKrr(person: any) {
  const seed = seedOf(person.fnr);
  const dato = krrDato(seed);
  const forfattet = person.krr || {};
  const reservert = forfattet.reservert ?? seed % 10 === 0;
  const spraak = forfattet.spraak ?? (seed % 13 === 0 ? "nn" : seed % 17 === 0 ? "en" : "nb");

  // Curated contact info is authored and reused as it is — a curated person
  // without kontakt has none in KRR either. The seed % 12 no-contact minority
  // only applies where the contact info is generated to begin with.
  let epostadresse = person.kontakt?.epost || null;
  let telefonnummer = person.kontakt?.telefon || null;
  if (person.kilde === "tenor" && seed % 12 !== 0) {
    epostadresse = `${epostSlug(person.navn)}@example.test`;
    telefonnummer = `+479${String(seed % 10_000_000).padStart(7, "0")}`;
  }

  const epost = epostadresse
    ? { adresse: epostadresse, sistOppdatert: dato, sistVerifisert: dato }
    : null;
  const tlf = telefonnummer
    ? { nummer: telefonnummer, sistOppdatert: dato, sistVerifisert: dato }
    : null;

  return {
    fnr: person.fnr,
    epost,
    tlf,
    status: "AKTIV",
    reservert,
    kanVarsles: !reservert && Boolean(epost || tlf),
    spraak,
    syntetisk: true
  };
}

// --- mapping ----------------------------------------------------------------

function beskyttelse(dokument: any) {
  const level = dokument.adresseBeskyttelse;
  if (level === "strengtFortrolig") return "STRENGT_FORTROLIG";
  if (level === "fortrolig") return "FORTROLIG";
  return "UGRADERT";
}

function navnDeler(dokument: any) {
  return {
    fornavn: stedTittel(dokument.fornavn),
    mellomnavn: dokument.mellomnavn ? stedTittel(dokument.mellomnavn) : null,
    etternavn: stedTittel(dokument.etternavn)
  };
}

// Tenor's kodeverk is camelCase; the sandbox's is UPPER_SNAKE. One transform for
// sivilstand and personstatus both, since they are the same shape of value.
function kodeverk(verdi: unknown) {
  return String(verdi || "")
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toUpperCase();
}

// --- one record builder, both sources ---------------------------------------

// The two output shapes, built from the same normalised person. `tenor` carries
// the six fields that only exist for imported people; a curated person passes
// null and the keys stay out, exactly as they are today.
function buildPerson(person: any) {
  return {
    personId: person.personId,
    syntetiskFodselsnummer: person.fnr,
    navn: person.navn,
    foedselsdato: person.foedselsdato,
    // The population had no life status at all, so nothing downstream could refuse
    // a dead person or tell an emigrated one from a resident. doedsdato is null
    // unless personstatus is DOED, and the gate holds the two together.
    personstatus: person.personstatus,
    doedsdato: person.doedsdato,
    bostedsadresse: person.bostedsadresse,
    sivilstand: person.sivilstand,
    // Both null for anyone who is not bosatt: they are in the register, not in a
    // household. GET /api/personer/:id/husstand answers 404 for them, which is the
    // honest answer.
    rolle: person.rolle,
    husstandId: person.husstandId,
    skjermet: person.adressebeskyttelse !== "UGRADERT",
    adressebeskyttelse: person.adressebeskyttelse,
    foreldrebarnrelasjon: person.relasjoner,
    // The legal basis a guardian acts on. Mirrored here from the register so the
    // process engine reads one population file - handleevne.ts needs it, and
    // loading the 435 KB FREG mirror into sandbox-backend for one field would be a
    // second person model in the engine.
    foreldreansvar: person.foreldreansvar,
    kontakt: person.kontakt,
    ...(person.kilde ? { kilde: person.kilde } : {}),
    syntetisk: true
  };
}

function buildFreg(person: any, fnrForPersonId: any) {
  const navn = person.navn;
  return {
    foedselsEllerDNummer: person.fnr,
    personnavn: navn,
    foedselsdato: person.foedselsdato,
    kjoenn: person.kjoenn,
    // Folkeregisterpersonstatus and Doedsfall, in the register's own shape. Note
    // that a dead person is NOT taushetsbelagt - the status values bosatt,
    // utflyttet, doed, opphoert and inaktiv are the five that are public.
    personstatus: person.personstatus,
    doedsfall: person.doedsdato ? { doedsdato: person.doedsdato } : null,
    sivilstand: person.sivilstand,
    bostedsadresse: person.bostedsadresse,
    kontaktadresse: null,
    // The shallow parent/child view. relatertPersonsIdent used to be null on every
    // curated row - 61 of 163 - because the two sources filled it differently. It
    // is one derivation now, so it is filled for everyone.
    forelderbarnrelasjon: person.relasjoner.map((rel: any) => ({
      relatertPersonsIdent: fnrForPersonId.get(rel.relatertPersonId) ?? null,
      relatertPersonsRolle: rel.relasjon,
      _sandboxRelatertPersonId: rel.relatertPersonId
    })),
    // Folkeregisteret's own Familierelasjon: every relation, with the role in both
    // directions and the register's own camelCase kodeverk. This is where the
    // spouse lives - foreldrebarnrelasjon is named for parents and children, so a
    // marriage has no business in it. Taushetsbelagt in the real register, which is
    // why the sandbox keeps it in the register model rather than in personer.json.
    familierelasjon: person.familierelasjon,
    // Foreldreansvar is the legal basis a guardian acts on, and the reason it is
    // here rather than derived at read time: it does not always follow the parent
    // list. Tenor states it; for the curated fixtures it is derived from the
    // parents, since they have no other source.
    foreldreansvar: person.foreldreansvar,
    sivilstandDetalj: null,
    skjermet: person.adressebeskyttelse !== "UGRADERT",
    adressebeskyttelse: person.adressebeskyttelse,
    // The property this person's address resolves to in data/matrikkel.json. It
    // sits inside bostedsadresse too, and the gate holds the two equal — this one
    // is the wire field that was already here.
    adresseIdentifikatorFraMatrikkelen: person.bostedsadresse.adresseIdentifikatorFraMatrikkelen,
    ...(person.tenor
      ? {
        adressegradering: person.tenor.adressegradering,
        harBostedsadresseHistorikk: person.tenor.harBostedsadresseHistorikk,
        vergemaalType: person.tenor.vergemaalType,
        // The school district the hjertesone case had nothing to stand on without.
        skolekrets: person.tenor.skolekrets,
        grunnkrets: person.tenor.grunnkrets
      }
      : {}),
    kontakt: person.kontakt,
    _sandbox: {
      personId: person.personId,
      husstandId: person.husstandId,
      rolle: person.rolle,
      visningsnavn: [navn.fornavn, navn.mellomnavn, navn.etternavn].filter(Boolean).join(" ")
    },
    ...(person.kilde ? { kilde: person.kilde } : {}),
    syntetisk: true
  };
}

// --- assembling the population ---------------------------------------------

// `rolle` is derived for everyone, curated and imported, from the same rule:
// under 18 is barn; an adult related to a child in this household is foresatt,
// and so is any adult in a household without children; every other adult is
// voksen. Only a parent of a child here is `foresatt`, because that role is what
// regler.ts sums income over - a grandparent under the same roof is `voksen`, and
// the rule engine simply does not match them.
function assignRoller(medlemmer: any, naboer: any) {
  const barn = new Set(medlemmer.filter((m: any) => alder(m.foedselsdato) < MYNDIG).map((m: any) => m.fnr));
  for (const medlem of medlemmer) {
    if (barn.has(medlem.fnr)) {
      medlem.rolle = "barn";
      continue;
    }
    const erForelder = [...barn].some((b) => (naboer.get(b) || new Set()).has(medlem.fnr));
    medlem.rolle = erForelder || barn.size === 0 ? "foresatt" : "voksen";
  }
  return barn;
}

function buildHusstandRad(husstandId: string, medlemmer: any, scenario: any, kilde: any) {
  const foerste = medlemmer[0];
  const adresse = foerste.bostedsadresse;
  const type = husstandstype(medlemmer);
  return {
    husstandId,
    type,
    adresse: [adresse.adressenavn, adresse.husnummer].filter((x) => x !== null).join(" ") +
      (adresse.husbokstav || ""),
    kommune: adresse.kommune,
    kommunenummer: adresse.kommunenummer,
    medlemmer: medlemmer.map((m: any) => ({ personId: m.personId, rolle: m.rolle })),
    ...(kilde ? { kilde } : {}),
    syntetisk: true,
    scenario: scenario ?? buildScenario(type, medlemmer)
  };
}

async function run() {
  const kuratert = await read(path.join(dataDir, "kuratert.json"));
  const { files, personer, husstandsnaboer } = await readUttrekk();
  const kommunenavn = await readKommunenavn();
  const adresseindeks = await readAdresseindeks();
  const ledger = await readIdLedger();

  // --- curated: ids, households and one-directional relations are authored ---
  const kuraterteFnrForPersonId = new Map(
    kuratert.personer.map((p: any) => [p.personId, p.syntetiskFodselsnummer])
  );
  const tilFnr = (personId: any, eier: any) => {
    const fnr = kuraterteFnrForPersonId.get(personId);
    if (!fnr) {
      throw new Error(
        `${eier} peker på ${personId}, som ikke finnes i data/kuratert.json.`
      );
    }
    return fnr;
  };

  const kuraterteMedlemmer = kuratert.personer.map((p: any) => ({
    fnr: p.syntetiskFodselsnummer,
    personId: p.personId,
    husstandId: p.husstandId,
    navn: p.navn,
    kjoenn: p.kjoenn,
    foedselsdato: p.foedselsdato,
    personstatus: BOSATT,
    doedsdato: null,
    bostedsadresse: medMatrikkelId(p.bostedsadresse, adresseindeks),
    sivilstand: p.sivilstand,
    adressebeskyttelse: p.adressebeskyttelse,
    kontakt: p.kontakt,
    // Authored KRR overrides (reservert, spraak); the derivation fills the rest.
    krr: p.krr || null,
    relasjoner: [],
    familierelasjon: [],
    foreldreansvar: null,
    kilde: null,
    tenor: null
  }));

  // The whole population, curated and imported, in one map keyed by fnr - so the
  // family graph, the roles and the two output shapes all read from one place.
  const alle = new Map<string, any>(kuraterteMedlemmer.map((m: any) => [m.fnr, m]));

  const { foreldreAv, ektefelleAv } = buildFamilie(
    personer,
    kuratert.personer.map((p: any) => ({
      fnr: p.syntetiskFodselsnummer,
      barn: (p.barn || []).map((b: any) => tilFnr(b, p.personId)),
      ektefelle: p.ektefelle ? tilFnr(p.ektefelle, p.personId) : null
    }))
  );

  const husstanderUt = [];
  const inntekterUt = [];

  for (const husstand of kuratert.husstander) {
    const medlemmer = kuraterteMedlemmer
      .filter((m: any) => m.husstandId === husstand.husstandId)
      .sort((a: any, b: any) => a.personId.localeCompare(b.personId));
    if (medlemmer.length === 0) {
      throw new Error(`${husstand.husstandId} i data/kuratert.json har ingen medlemmer.`);
    }
    // Roles come from the family graph, which for curated people is the authored
    // `barn` list read back as parent edges.
    assignRoller(medlemmer, foreldreAv);
    husstanderUt.push(buildHusstandRad(husstand.husstandId, medlemmer, husstand.scenario, null));
  }

  // Curated income is authored, never generated - the threshold claims the
  // workshop text rests on live in these numbers. Only `identifikator` is derived.
  for (const rad of kuratert.inntekter) {
    inntekterUt.push({
      personId: rad.personId,
      identifikator: tilFnr(rad.personId, `inntektsrad for ${rad.personId}`),
      inntektsaar: rad.inntektsaar,
      stadie: rad.stadie,
      ...("skatteoppgjoersdato" in rad ? { skatteoppgjoersdato: rad.skatteoppgjoersdato } : {}),
      poster: rad.poster,
      syntetisk: true
    });
  }

  // --- imported: households come out of the household-neighbour graph -------
  const kuraterteFnr = new Set(kuraterteMedlemmer.map((m: any) => m.fnr));
  const kuraterteHusstandIder = new Set(kuratert.husstander.map((h: any) => h.husstandId));
  let nestePerson = Math.max(
    51,
    ...[...ledger.personId.values()].map((id) => Number(String(id).split("-").pop()))
  ) + 1;
  let nesteHusstand = Math.max(
    18,
    ...[...ledger.husstandId.values()].map((id) => Number(String(id).split("-").pop()))
  ) + 1;

  const tildelPersonId = (fnr: any) => {
    if (!ledger.personId.has(fnr)) {
      ledger.personId.set(fnr, `person-${String(nestePerson++).padStart(3, "0")}`);
    }
    return ledger.personId.get(fnr);
  };

  const fraTenor = (fnr: any, husstandId: any) => {
    const dokument = personer.get(fnr);
    const raw = gjeldendeAdresse(dokument);
    return {
      fnr,
      personId: tildelPersonId(fnr),
      husstandId,
      navn: navnDeler(dokument),
      kjoenn: String(dokument.kjoenn || "").toUpperCase() || null,
      foedselsdato: dokument.foedselsdato,
      personstatus: kodeverk(dokument.personstatus),
      doedsdato: dokument.doedsdato || null,
      bostedsadresse: medMatrikkelId(tilBostedsadresse(dokument, kommunenavn), adresseindeks),
      sivilstand: kodeverk(dokument.sivilstand || "uoppgitt"),
      adressebeskyttelse: beskyttelse(dokument),
      kontakt: {},
      krr: null,
      relasjoner: [],
      familierelasjon: [],
      foreldreansvar: dokument.foreldreansvar || null,
      kilde: "tenor",
      tenor: {
        adressegradering: raw.adressegradering || null,
        harBostedsadresseHistorikk: Boolean(dokument.harBostedsadresseHistorikk),
        vergemaalType: dokument.vergemaalType || null,
        skolekrets: raw.skolekrets ?? null,
        grunnkrets: raw.grunnkrets ?? null
      }
    };
  };

  const tenorHusstander = buildHusstander(personer, husstandsnaboer)
    .filter((gruppe) => !gruppe.some((fnr) => kuraterteFnr.has(fnr)))
    .sort((a, b) => a[0].localeCompare(b[0]));

  for (const gruppe of tenorHusstander) {
    // Reuse the household id the ledger already knows for these people, so a new
    // extract cannot renumber an existing household.
    const kjente = [...new Set(gruppe.map((fnr) => ledger.husstandId.get(fnr)).filter(Boolean))];
    if (kjente.length > 1) {
      throw new Error(
        `Husstanden ${gruppe.join(", ")} er kjent under flere id-er (${kjente.join(", ")}). ` +
        `Slett data/personer.json eller kjør med --glem-id-er for å tildele id-er på nytt.`
      );
    }
    const husstandId = kjente[0] ?? `household-${String(nesteHusstand++).padStart(3, "0")}`;
    if (!kjente.length && kuraterteHusstandIder.has(husstandId)) {
      throw new Error(`${husstandId} finnes allerede. Id-tildelingen er ikke trygg.`);
    }

    // Ids for the whole household first. A child can sort before its parent, and
    // the relation lists reference ids, so they must all exist before any record
    // is built - otherwise a relation points at undefined.
    for (const fnr of gruppe) tildelPersonId(fnr);

    const medlemmer: any[] = gruppe.map((fnr) => fraTenor(fnr, husstandId));
    for (const medlem of medlemmer) alle.set(medlem.fnr, medlem);
    const barn = assignRoller(medlemmer, foreldreAv);

    husstanderUt.push(buildHusstandRad(husstandId, medlemmer, null, "tenor"));
    for (const medlem of medlemmer) {
      if (medlem.rolle === "foresatt") inntekterUt.push(buildInntekt(medlem.fnr, barn.size > 0));
    }
  }

  // Everyone the register knows who is not in a household: the dead, the
  // inactive, the emigrated. They carry no husstandId and no rolle, because they
  // are not members of anything - and that is exactly what makes them useful.
  // Seventeen of them are D-numbers, which the sandbox had none of.
  for (const fnr of [...personer.keys()].sort()) {
    if (alle.has(fnr) || husstandsnaboer.has(fnr)) continue;
    const utenfor: any = fraTenor(fnr, null);
    utenfor.rolle = null;
    alle.set(fnr, utenfor);
  }

  // --- relations, derived once for everyone --------------------------------
  const personIdFor = (fnr: string): string | null => alle.get(fnr)?.personId ?? null;
  const kjoennFor = (fnr: string): string | null => alle.get(fnr)?.kjoenn ?? null;
  const barnAv = new Map();
  for (const [barnFnr, foreldre] of foreldreAv) {
    for (const forelder of foreldre) {
      if (!barnAv.has(forelder)) barnAv.set(forelder, new Set());
      barnAv.get(forelder).add(barnFnr);
    }
  }

  for (const [fnr, person] of alle) {
    const foreldre = [...(foreldreAv.get(fnr) || [])].sort();
    const egneBarn = [...(barnAv.get(fnr) || [])].sort();

    // The shallow view: a parent's role as seen from the child, and BARN the other
    // way. Both directions, always - 113 of 138 edges used to exist in one
    // direction only, so "which children does this parent have" answered nothing.
    person.relasjoner = [
      ...foreldre.map((f) => ({
        relatertPersonId: personIdFor(f),
        relasjon: foreldrerolle(f, foreldreAv.get(fnr), kjoennFor)
      })),
      ...egneBarn.map((b) => ({ relatertPersonId: personIdFor(b), relasjon: "BARN" }))
    ];

    // Folkeregisteret's Familierelasjon carries the role in both directions, so a
    // consumer can answer "what am I to them" without walking back.
    const minRolleOverfor = (annen: any) => {
      if (foreldre.includes(annen)) return "barn";
      return FREG_ROLLE[foreldrerolle(fnr, foreldreAv.get(annen) || new Set([fnr]), kjoennFor)];
    };
    const ektefelle = ektefelleAv.get(fnr);
    person.familierelasjon = [
      ...foreldre.map((f) => ({
        relatertPersonsIdent: f,
        relatertPersonsRolle: FREG_ROLLE[foreldrerolle(f, foreldreAv.get(fnr), kjoennFor)],
        minRolleForPerson: "barn",
        _sandboxRelatertPersonId: personIdFor(f)
      })),
      ...egneBarn.map((b) => ({
        relatertPersonsIdent: b,
        relatertPersonsRolle: "barn",
        minRolleForPerson: minRolleOverfor(b),
        _sandboxRelatertPersonId: personIdFor(b)
      })),
      ...(ektefelle
        ? [{
          relatertPersonsIdent: ektefelle,
          relatertPersonsRolle: "ektefelleEllerPartner",
          minRolleForPerson: "ektefelleEllerPartner",
          _sandboxRelatertPersonId: personIdFor(ektefelle)
        }]
        : [])
    ];

    // Derived only where Tenor has nothing to say - the curated fixtures. Two
    // parents means shared responsibility; one means it rests with that one.
    if (person.foreldreansvar === null && foreldre.length > 0) {
      person.foreldreansvar = foreldre.length > 1
        ? "felles"
        : FREG_ROLLE[foreldrerolle(foreldre[0], foreldreAv.get(fnr), kjoennFor)];
    }
  }

  // Married to a dead spouse is not married. Tenor leaves the survivor's
  // sivilstand at `gift` because the extract was pulled per person and never
  // reconciled; the register would say enkeEllerEnkemann. This is the one place
  // the import overrides a value Tenor stated, and it is why the two agree now.
  let enker = 0;
  for (const [fnr, person] of alle) {
    if (person.sivilstand !== "GIFT" && person.sivilstand !== "SEPARERT") continue;
    const ektefelle = ektefelleAv.get(fnr);
    if (!ektefelle) continue;
    if (alle.get(ektefelle)?.personstatus !== "DOED") continue;
    person.sivilstand = "ENKE_ELLER_ENKEMANN";
    enker += 1;
  }

  // --- writing --------------------------------------------------------------
  const befolkning = [...alle.values()].sort((a, b) => a.personId.localeCompare(b.personId));
  const fnrForPersonId = new Map(befolkning.map((m) => [m.personId, m.fnr]));
  const personerUt = befolkning.map((m) => buildPerson(m));
  const fregUt = {
    kilde: "syntetisk",
    versjon: "1.7.0",
    beskrivelse:
      "Syntetiske testpersoner fra workshop-ai personas kombinert med Folkeregisteret-format",
    antall: befolkning.length,
    personer: befolkning.map((m) => buildFreg(m, fnrForPersonId))
  };
  husstanderUt.sort((a, b) => a.husstandId.localeCompare(b.husstandId));

  // The contact register: exactly the bosatt population of 15 or older, in
  // personId order like everything else this script writes.
  const krrUt = befolkning
    .filter((m) => m.personstatus === BOSATT && alder(m.foedselsdato) >= KRR_ALDERSGULV)
    .map((m) => buildKrr(m));

  const utenforHusstand = befolkning.filter((m) => m.husstandId === null).length;
  const sammendrag =
    `${files.length} uttrekk lest. ${personerUt.length} personer i ` +
    `${husstanderUt.length} husstander, ${inntekterUt.length} inntektsrader, ` +
    `${krrUt.length} rader i kontaktregisteret. ` +
    `${kuratert.personer.length} kuraterte, ${personerUt.length - kuratert.personer.length} fra Tenor, ` +
    `${utenforHusstand} utenfor husstand. ${enker} enke/enkemann utledet.`;

  if (dryRun) {
    console.log(`[tørrkjør] ${sammendrag}`);
    return;
  }

  const eierforhold = buildEierforhold(husstanderUt, personerUt, await read(path.join(dataDir, "matrikkel.json")));

  const plasser = {
    barnehage: await read(path.join(dataDir, "barnehageplasser.json")),
    sfo: await read(path.join(dataDir, "sfoplasser.json")),
    fritid: await read(path.join(dataDir, "fritidsdeltakelse.json"))
  };
  await writeFile(
    path.join(repoRoot, "docs", "testpersoner.md"),
    buildTestpersondok(
      personerUt,
      husstanderUt,
      inntekterUt,
      eierforhold,
      plasser,
      krrUt,
      kuratert,
      REFERANSEDATO
    )
  );

  await skriv(path.join(dataDir, "eierforhold.json"), eierforhold);
  await skriv(path.join(dataDir, "personer.json"), personerUt);
  await skriv(path.join(dataDir, "husstander.json"), husstanderUt);
  await skriv(path.join(dataDir, "inntekter.json"), inntekterUt);
  await skriv(path.join(dataDir, "krr.json"), krrUt);
  await skriv(path.join(dataDir, "folkeregister.seed.json"), fregUt);
  console.log(sammendrag);
}


run().catch((feil) => {
  console.error(`Tenor-import feilet: ${feilmelding(feil)}`);
  process.exit(1);
});
