#!/usr/bin/env node

// TENOR IMPORT
//
// Turns the raw Tenor extracts in data/tenor/ into the sandbox's own datasets.
// The extracts stay untouched: each carries its own `seed` and `treff`, and that
// provenance is what makes the pull reproducible.
//
// Three properties this script must keep, in order of importance:
//
//  1. person-001..051 and household-001..018 are never touched. They are the
//     curated threshold fixtures every case and every eval hangs off.
//  2. Ids are stable across runs. A fnr that already has a personId keeps it, so
//     dropping a new extract into data/tenor/ and re-running grows the population
//     without renumbering anyone. Sorting alone would not do this — a new fnr
//     would sort into the middle and shift every id after it.
//  3. No Math.random and no Date.now. Everything derives from the fnr, so two
//     runs of the same input produce byte-identical output.
//
// Usage: node scripts/importer-tenor.js [--tørrkjør]

import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(rot, "data");
const tenorDir = path.join(dataDir, "tenor");
const tørrkjør = process.argv.includes("--tørrkjør") || process.argv.includes("--torrkjor");

// Age is computed at the rates' effective date, like everywhere else in the
// sandbox, so the same person yields the same outcome whenever this runs.
const REFERANSEDATO = "2026-08-01";
const MYNDIG = 18;

const les = async (fil) => JSON.parse(await readFile(fil, "utf8"));
const skriv = (fil, data) =>
  writeFile(fil, JSON.stringify(data, null, 2) + "\n");

function alderVed(foedselsdato, referansedato) {
  const f = new Date(foedselsdato);
  const r = new Date(referansedato);
  const alder = r.getFullYear() - f.getFullYear();
  const foerBursdag =
    r.getMonth() < f.getMonth() ||
    (r.getMonth() === f.getMonth() && r.getDate() < f.getDate());
  return foerBursdag ? alder - 1 : alder;
}

// --- reading the extracts ---------------------------------------------------

// tenorMetadata.kildedata is JSON inside a JSON string. The addresses live there,
// and with them the two fields that make this import worth more than names:
// adresseIdentifikatorFraMatrikkelen, which joins a person to a property, and
// skolekrets, which the hjertesone case had nothing to stand on without.
function kildedata(dokument) {
  const rå = dokument?.tenorMetadata?.kildedata;
  if (typeof rå !== "string") return rå || {};
  try {
    return JSON.parse(rå);
  } catch {
    return {};
  }
}

function fnrFor(dokument) {
  const ident = dokument?.identifikator;
  return Array.isArray(ident) && ident.length ? ident[0] : dokument?.id || null;
}

function gjeldendeAdresse(dokument) {
  const adresser = kildedata(dokument).bostedsadresse || [];
  return adresser.find((a) => a.erGjeldende) || adresser[0] || {};
}

function stedTittel(verdi) {
  return String(verdi || "")
    .toLowerCase()
    .replace(/(^|[\s\-/])([\p{L}])/gu, (_, skille, bokstav) => skille + bokstav.toUpperCase());
}

function tilBostedsadresse(dokument, kommunenavn = new Map()) {
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
// For the rest the poststed name stands in — a real place in the right area, but
// not the kommune. kommunenummer is the authoritative field either way, and it is
// correct for everyone. Noted in docs/syntetiske-data.md.
async function lesKommunenavn() {
  const brreg = await les(path.join(dataDir, "brreg.seed.json"));
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

async function lesUttrekk() {
  const filer = (await readdir(tenorDir))
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .sort();
  if (filer.length === 0) {
    throw new Error(`Fant ingen uttrekk i ${path.relative(rot, tenorDir)}.`);
  }

  const personer = new Map();
  const relasjoner = new Map();
  const registrer = (dokument) => {
    const fnr = fnrFor(dokument);
    // Dead, inactive and emigrated people came along because the searches had no
    // personstatus filter. One of them is a "child" in the 6-12 band.
    if (!fnr || dokument.personstatus !== "bosatt" || !dokument.foedselsdato) return null;
    if (!personer.has(fnr)) personer.set(fnr, dokument);
    if (!relasjoner.has(fnr)) relasjoner.set(fnr, new Set());
    return fnr;
  };

  for (const fil of filer) {
    const innhold = await les(path.join(tenorDir, fil));
    for (const dokument of innhold.dokumentListe || []) {
      const fnr = registrer(dokument);
      // tenorRelasjoner.freg is not a reference. It is the whole person document
      // for each mother, father and partner, address included, so households come
      // out of the child documents without a single extra API call.
      for (const rel of dokument?.tenorRelasjoner?.freg || []) {
        const relFnr = registrer(rel);
        if (fnr && relFnr) {
          relasjoner.get(fnr).add(relFnr);
          relasjoner.get(relFnr).add(fnr);
        }
      }
    }
  }
  return { filer, personer, relasjoner };
}

// --- households -------------------------------------------------------------

// A household is a connected group in the relation graph that also shares one
// address. Without the address condition a parent who has moved out would be
// pulled back in, and their income would count towards a household they left.
function byggHusstander(personer, relasjoner) {
  const matrikkelId = (fnr) =>
    gjeldendeAdresse(personer.get(fnr)).adresseIdentifikatorFraMatrikkelen || `ukjent:${fnr}`;

  const besøkt = new Set();
  const husstander = [];
  for (const fnr of [...personer.keys()].sort()) {
    if (besøkt.has(fnr)) continue;
    const stabel = [fnr];
    const gruppe = new Set();
    while (stabel.length) {
      const denne = stabel.pop();
      if (gruppe.has(denne)) continue;
      gruppe.add(denne);
      besøkt.add(denne);
      for (const nabo of relasjoner.get(denne) || []) {
        if (!gruppe.has(nabo) && matrikkelId(nabo) === matrikkelId(denne)) stabel.push(nabo);
      }
    }
    husstander.push([...gruppe].sort());
  }

  // A household of only minors is an artefact of independent searches, not a
  // family. Their parents were not bosatt, or live somewhere else.
  return husstander.filter((gruppe) =>
    gruppe.some((fnr) => alderVed(personer.get(fnr).foedselsdato, REFERANSEDATO) >= MYNDIG)
  );
}

// Three related adults at one address with no children is an adult child living
// with parents, not a household across generations of a family with kids. Calling
// both FLERGENERASJON made the type contradict the scenario text.
function husstandstype(medlemmer, personer) {
  const voksne = medlemmer.filter((f) => alderVed(personer.get(f).foedselsdato, REFERANSEDATO) >= MYNDIG);
  const barn = medlemmer.length - voksne.length;
  const gift = voksne.some((f) => personer.get(f).sivilstand === "gift");
  if (voksne.length === 1) return barn > 0 ? "ENSLIG_FORSORGER" : "ENSLIG";
  if (voksne.length >= 3) return barn > 0 ? "FLERGENERASJON" : "VOKSNE_SAMMEN";
  if (barn === 0) return "PAR_UTEN_BARN";
  return gift ? "EKTEPAR" : "SAMBOERE";
}

const TYPETEKST = {
  ENSLIG: "Én voksen som bor alene.",
  ENSLIG_FORSORGER: "Én voksen med barn.",
  PAR_UTEN_BARN: "To voksne uten barn.",
  EKTEPAR: "Ektepar med barn.",
  SAMBOERE: "Samboere med barn.",
  FLERGENERASJON: "Flere generasjoner under samme tak.",
  VOKSNE_SAMMEN: "Flere voksne på samme adresse, uten barn i husstanden."
};

// --- income -----------------------------------------------------------------

// Tenor gives income for 6 of 120 main documents and none of the 224 parents, so
// it is authored here. That is the right call regardless: valider-data.js demands
// households on both sides of all five thresholds, and random income would not
// produce that coverage. The curated 18 keep owning the thresholds; these numbers
// exist so the wider population is usable at all.
//
// Deterministic from the fnr — no Math.random, so the output is reproducible.
function frøAv(fnr) {
  let h = 2166136261;
  for (const tegn of String(fnr)) {
    h ^= tegn.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function byggInntekt(fnr, harBarn) {
  const frø = frøAv(fnr);
  const loenn = 180000 + (frø % 71) * 10000;
  const poster = [
    {
      tekniskNavn: "loennsinntekt",
      visningstekst: "Lønnsinntekt",
      beloep: loenn,
      kilde: "SKATTEETATEN",
      medregnes: true
    }
  ];
  if (frø % 3 === 0) {
    poster.push({
      tekniskNavn: "renteinntekt",
      visningstekst: "Renteinntekt",
      beloep: 1000 + (frø % 40) * 500,
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
  const utkast = frø % 11 === 0;
  return {
    identifikator: fnr,
    inntektsaar: utkast ? 2026 : 2025,
    stadie: utkast ? "UTKAST" : "OPPGJOER",
    ...(utkast ? {} : { skatteoppgjoersdato: "2026-06-15" }),
    poster,
    syntetisk: true
  };
}

// --- mapping ----------------------------------------------------------------

function beskyttelse(dokument) {
  const nivå = dokument.adresseBeskyttelse;
  if (nivå === "strengtFortrolig") return "STRENGT_FORTROLIG";
  if (nivå === "fortrolig") return "FORTROLIG";
  return "UGRADERT";
}

function navnDeler(dokument) {
  return {
    fornavn: stedTittel(dokument.fornavn),
    mellomnavn: dokument.mellomnavn ? stedTittel(dokument.mellomnavn) : null,
    etternavn: stedTittel(dokument.etternavn)
  };
}

function sivilstandKode(dokument) {
  return String(dokument.sivilstand || "uoppgitt")
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toUpperCase();
}

async function kjoer() {
  const { filer, personer, relasjoner } = await lesUttrekk();
  const kommunenavn = await lesKommunenavn();
  const husstander = byggHusstander(personer, relasjoner);

  const eksisterendePersoner = await les(path.join(dataDir, "personer.json"));
  const eksisterendeHusstander = await les(path.join(dataDir, "husstander.json"));
  const eksisterendeInntekter = await les(path.join(dataDir, "inntekter.json"));
  const eksisterendeFreg = await les(path.join(dataDir, "folkeregister.seed.json"));

  // Curated fixtures are everything already in the files. They are kept verbatim.
  const kuraterteFnr = new Set(eksisterendePersoner.map((p) => p.syntetiskFodselsnummer));
  const kuraterteHusstandIder = new Set(eksisterendeHusstander.map((h) => h.husstandId));

  // Stable ids: reuse the personId a fnr already has, otherwise take the next free
  // number. This is what lets a later extract be dropped in without renumbering.
  const idForFnr = new Map(
    eksisterendePersoner.map((p) => [p.syntetiskFodselsnummer, p.personId])
  );
  const nummerAv = (id) => Number(String(id).split("-").pop());
  let nestePerson = Math.max(0, ...eksisterendePersoner.map((p) => nummerAv(p.personId))) + 1;
  let nesteHusstand = Math.max(0, ...eksisterendeHusstander.map((h) => nummerAv(h.husstandId))) + 1;

  const nyePersoner = [];
  const nyeFreg = [];
  const nyeHusstander = [];
  const nyeInntekter = [];

  // Sorted by the household's lowest fnr, so allocation order never depends on
  // Map iteration order.
  for (const medlemmer of husstander.sort((a, b) => a[0].localeCompare(b[0]))) {
    if (medlemmer.some((fnr) => kuraterteFnr.has(fnr))) continue;

    const husstandId = `household-${String(nesteHusstand++).padStart(3, "0")}`;
    if (kuraterteHusstandIder.has(husstandId)) {
      throw new Error(`${husstandId} finnes allerede. Id-tildelingen er ikke trygg.`);
    }

    const barnFnr = new Set(
      medlemmer.filter((f) => alderVed(personer.get(f).foedselsdato, REFERANSEDATO) < MYNDIG)
    );
    // Only a parent of a child in this household is `foresatt`, because that role
    // is what regler.ts sums income over. A grandparent under the same roof is
    // `voksen`, and the rule engine simply does not match them.
    const erForelder = (fnr) =>
      [...barnFnr].some((barn) => (relasjoner.get(barn) || new Set()).has(fnr));

    const rolleFor = (fnr) => {
      if (barnFnr.has(fnr)) return "barn";
      return erForelder(fnr) || barnFnr.size === 0 ? "foresatt" : "voksen";
    };

    // Ids for the whole household first. A child can sort before its parent, and
    // the relation lists reference ids, so they must all exist before any record
    // is built — otherwise a relation points at undefined.
    for (const fnr of medlemmer) {
      if (!idForFnr.has(fnr)) {
        idForFnr.set(fnr, `person-${String(nestePerson++).padStart(3, "0")}`);
      }
    }

    for (const fnr of medlemmer) {
      const dokument = personer.get(fnr);
      const personId = idForFnr.get(fnr);
      const adresse = tilBostedsadresse(dokument, kommunenavn);
      const gradering = beskyttelse(dokument);
      const rolle = rolleFor(fnr);
      const navn = navnDeler(dokument);
      const rå = gjeldendeAdresse(dokument);
      // Relations are filtered to people who made it into the dataset, otherwise
      // valider-data.js would report a relation to an unknown person.
      const foreldre = [...(relasjoner.get(fnr) || [])]
        .filter((annen) => medlemmer.includes(annen) && !barnFnr.has(annen))
        .filter(() => barnFnr.has(fnr))
        .sort();

      nyePersoner.push({
        personId,
        syntetiskFodselsnummer: fnr,
        navn,
        foedselsdato: dokument.foedselsdato,
        bostedsadresse: adresse,
        sivilstand: sivilstandKode(dokument),
        rolle,
        husstandId,
        skjermet: gradering !== "UGRADERT",
        adressebeskyttelse: gradering,
        foreldrebarnrelasjon: foreldre.map((f) => ({
          relatertPersonId: idForFnr.get(f),
          relasjon: "FORELDER"
        })),
        kontakt: {},
        kilde: "tenor",
        syntetisk: true
      });

      nyeFreg.push({
        foedselsEllerDNummer: fnr,
        personnavn: navn,
        foedselsdato: dokument.foedselsdato,
        kjoenn: String(dokument.kjoenn || "").toUpperCase() || null,
        sivilstand: sivilstandKode(dokument),
        bostedsadresse: adresse,
        kontaktadresse: null,
        forelderbarnrelasjon: foreldre.map((f) => ({
          relatertPersonsIdent: f,
          relatertPersonsRolle: "FORELDER",
          _sandboxRelatertPersonId: idForFnr.get(f)
        })),
        sivilstandDetalj: null,
        skjermet: gradering !== "UGRADERT",
        adressebeskyttelse: gradering,
        adressegradering: rå.adressegradering || null,
        harBostedsadresseHistorikk: Boolean(dokument.harBostedsadresseHistorikk),
        vergemaalType: dokument.vergemaalType || null,
        // The join keys that were missing entirely: a property id the matrikkel
        // knows, and the school district the hjertesone case needs.
        adresseIdentifikatorFraMatrikkelen: rå.adresseIdentifikatorFraMatrikkelen || null,
        skolekrets: rå.skolekrets ?? null,
        grunnkrets: rå.grunnkrets ?? null,
        kontakt: {},
        _sandbox: {
          personId,
          husstandId,
          rolle,
          visningsnavn: [navn.fornavn, navn.mellomnavn, navn.etternavn].filter(Boolean).join(" ")
        },
        kilde: "tenor",
        syntetisk: true
      });

      if (rolle === "foresatt") nyeInntekter.push(byggInntekt(fnr, barnFnr.size > 0));
    }

    const første = personer.get(medlemmer[0]);
    const adresse = tilBostedsadresse(første, kommunenavn);
    const type = husstandstype(medlemmer, personer);
    nyeHusstander.push({
      husstandId,
      type,
      adresse: [adresse.adressenavn, adresse.husnummer].filter((x) => x !== null).join(" ") +
        (adresse.husbokstav || ""),
      kommune: adresse.kommune,
      kommunenummer: adresse.kommunenummer,
      medlemmer: medlemmer.map((fnr) => ({ personId: idForFnr.get(fnr), rolle: rolleFor(fnr) })),
      kilde: "tenor",
      syntetisk: true,
      scenario: byggScenario(type, medlemmer, personer, barnFnr.size)
    });
  }

  const personerUt = [...eksisterendePersoner, ...nyePersoner]
    .sort((a, b) => a.personId.localeCompare(b.personId));
  const husstanderUt = [...eksisterendeHusstander, ...nyeHusstander]
    .sort((a, b) => a.husstandId.localeCompare(b.husstandId));
  const inntekterUt = [...eksisterendeInntekter, ...nyeInntekter];
  const fregUt = {
    ...eksisterendeFreg,
    antall: eksisterendeFreg.personer.length + nyeFreg.length,
    personer: [...eksisterendeFreg.personer, ...nyeFreg]
      .sort((a, b) => a._sandbox.personId.localeCompare(b._sandbox.personId))
  };

  const sammendrag =
    `${filer.length} uttrekk lest. ${nyePersoner.length} nye personer i ` +
    `${nyeHusstander.length} nye husstander, ${nyeInntekter.length} inntektsrader. ` +
    `Totalt ${personerUt.length} personer og ${husstanderUt.length} husstander.`;

  if (tørrkjør) {
    console.log(`[tørrkjør] ${sammendrag}`);
    return;
  }

  await skriv(path.join(dataDir, "personer.json"), personerUt);
  await skriv(path.join(dataDir, "husstander.json"), husstanderUt);
  await skriv(path.join(dataDir, "inntekter.json"), inntekterUt);
  await skriv(path.join(dataDir, "folkeregister.seed.json"), fregUt);
  console.log(sammendrag);
}

// Scenario text describes what the household is, not what it demonstrates. The
// curated 18 own the threshold claims; these are breadth, and valider-data.js only
// cross-checks a text against an ordning when it names one.
// Derived from the type, so the two can never contradict each other.
function byggScenario(type, medlemmer, personer, antallBarn) {
  const barnAldre = medlemmer
    .map((f) => alderVed(personer.get(f).foedselsdato, REFERANSEDATO))
    .filter((a) => a < MYNDIG)
    .sort((a, b) => b - a);
  const deler = [TYPETEKST[type] || "Husstand."];
  if (antallBarn > 0) {
    deler.push(`Barn på ${barnAldre.join(", ")} år.`);
  }
  if (medlemmer.some((f) => (personer.get(f) || {}).adresseBeskyttelse)) {
    deler.push("Én person har adressebeskyttelse.");
  }
  deler.push("Fra Tenor, for bredde.");
  return deler.join(" ");
}

kjoer().catch((feil) => {
  console.error(`Tenor-import feilet: ${feil.message}`);
  process.exit(1);
});
