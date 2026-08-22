#!/usr/bin/env node

// MATRIKKELUTTREKK
//
// data/matrikkel.json held 220 streets in Bergen and nothing else, while the
// population lives in 97 kommuner. Three of 171 street names matched, so
// adresseIdentifikatorFraMatrikkelen - the field that is supposed to join a
// person to a property - hit exactly zero of the 8202 properties.
//
// This script tops the file up: for every (kommunenummer, adressenavn) the
// population actually lives on, it fetches that street from Geonorge's public
// address API and appends it. The Bergen extract is left alone, byte for byte -
// it is dated 2026-08-06 and several pinned tests rest on it (person-001 owns
// matr-storg-003; Storgata grants and Fjøsangerveien refuses in the
// fartsdempende case). Re-fetching it would move data no test asked to move.
//
// Network is needed to run this, not to run the sandbox. The result is checked in
// with its provenance, the way the Bergen extract already was.
//
// Usage: node scripts/hent-matrikkel.js [--tørrkjør] [--bare <kommunenummer>]

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(repoRoot, "data");
const dryRun = process.argv.includes("--tørrkjør") || process.argv.includes("--torrkjor");
const bareIndex = process.argv.indexOf("--bare");
const bareKommune = bareIndex === -1 ? null : process.argv[bareIndex + 1];

const API = process.env.GEONORGE_ADRESSE_API_BASE_URL || "https://ws.geonorge.no/adresser/v1";
const SIDESTOERRELSE = 1000;

const read = async (fil) => JSON.parse(await readFile(fil, "utf8"));

// Same normalisation matrikkel-mock uses for its street index, so a street this
// script considers "already there" is the same one the mock would find.
const normalize = (verdi) =>
  String(verdi || "")
    .toLowerCase()
    .replace(/[æ]/g, "ae")
    .replace(/[ø]/g, "o")
    .replace(/[å]/g, "a")
    .replace(/[^a-z0-9]/g, "");

const slug = (verdi) =>
  normalize(verdi).length > 0 ? normalize(verdi) : "ukjent";

async function hentGate(kommunenummer, adressenavn) {
  const adresser = [];
  for (let side = 0; ; side += 1) {
    const url =
      `${API}/sok?kommunenummer=${encodeURIComponent(kommunenummer)}` +
      `&adressenavn=${encodeURIComponent(adressenavn)}` +
      `&treffPerSide=${SIDESTOERRELSE}&side=${side}&asciiKompatibel=false`;
    const svar = await fetch(url, { headers: { Accept: "application/json" } });
    if (!svar.ok) {
      throw new Error(`Geonorge svarte ${svar.status} for ${adressenavn} i ${kommunenummer}.`);
    }
    const json = await svar.json();
    const treff = json.adresser || [];
    // The API matches on prefix, so "Fjellgata" also returns "Fjellgaten". Only
    // the exact street is wanted - otherwise a person's address would join to a
    // property in a different street with a similar name.
    adresser.push(...treff.filter((a) => normalize(a.adressenavn) === normalize(adressenavn)));
    if (treff.length < SIDESTOERRELSE) break;
  }
  return adresser;
}

// Mapped onto the shape the Bergen extract already has, field for field, so
// matrikkel-mock needs no change and the two halves of the file are one dataset.
function tilEiendom(adresse) {
  const bokstav = adresse.bokstav || null;
  return {
    matrikkelId:
      `matr-geo-${adresse.kommunenummer}-${adresse.adressekode}-${adresse.nummer}${bokstav || ""}`,
    gnr: adresse.gardsnummer,
    bnr: adresse.bruksnummer,
    festenummer: adresse.festenummer ?? 0,
    undernummer: adresse.undernummer ?? 0,
    adressekode: adresse.adressekode,
    husnummer: adresse.nummer,
    husbokstav: bokstav,
    adresse: adresse.adressetekst,
    postnummer: adresse.postnummer,
    poststed: adresse.poststed,
    adressetilleggsnavn: adresse.adressetilleggsnavn || null,
    objtype: adresse.objtype,
    oppdateringsdato: adresse.oppdateringsdato,
    koordinater: adresse.representasjonspunkt
      ? {
        lat: adresse.representasjonspunkt.lat,
        lon: adresse.representasjonspunkt.lon,
        epsg: adresse.representasjonspunkt.epsg
      }
      : null,
    // Geonorge's address register says nothing about what a building is used for.
    // Every property in the Bergen extract is a dwelling except three, so bolig is
    // the default here too - and it is what the ordninger care about.
    bruksenhetstype: "bolig"
    // No `eiere` here. Ownership is not in the matrikkel — it is in the grunnbok,
    // and in this repo it lives in data/eierforhold.json, merged in by
    // matrikkel-mock at load.
  };
}

// Where the population lives. Both files, because the curated fixtures' addresses
// are authored in kuratert.json and only appear in personer.json after an import.
async function adresserIBruk() {
  const personer = await read(path.join(dataDir, "personer.json"));
  const kuratert = await read(path.join(dataDir, "kuratert.json"));
  const par = new Map();
  const legg = (adresse) => {
    if (!adresse?.kommunenummer || !adresse?.adressenavn) return;
    const noekkel = `${adresse.kommunenummer}|${normalize(adresse.adressenavn)}`;
    if (!par.has(noekkel)) {
      par.set(noekkel, { kommunenummer: adresse.kommunenummer, adressenavn: adresse.adressenavn });
    }
  };
  for (const person of personer) legg(person.bostedsadresse);
  for (const person of kuratert.personer) legg(person.bostedsadresse);
  return [...par.values()].sort(
    (a, b) =>
      a.kommunenummer.localeCompare(b.kommunenummer) || a.adressenavn.localeCompare(b.adressenavn)
  );
}

async function run() {
  const matrikkel = await read(path.join(dataDir, "matrikkel.json"));
  const finnes = new Set(
    matrikkel.gater.map((gate) => `${gate.kommunenummer}|${normalize(gate.adressenavn)}`)
  );
  const kjenteMatrikkelIder = new Set(
    matrikkel.gater.flatMap((gate) => gate.eiendommer.map((e) => e.matrikkelId))
  );

  let oenskede = await adresserIBruk();
  if (bareKommune) {
    oenskede = oenskede.filter((p) => p.kommunenummer === bareKommune);
  }
  const mangler = oenskede.filter(
    (p) => !finnes.has(`${p.kommunenummer}|${normalize(p.adressenavn)}`)
  );

  console.log(
    `${oenskede.length} (kommune, gate)-par i befolkningen. ` +
    `${oenskede.length - mangler.length} finnes alt, ${mangler.length} skal hentes.`
  );
  if (dryRun) {
    for (const p of mangler) console.log(`  [tørrkjør] ${p.kommunenummer} ${p.adressenavn}`);
    return;
  }

  const nyeGater = [];
  const ikkeFunnet = [];
  for (const [i, par] of mangler.entries()) {
    const adresser = await hentGate(par.kommunenummer, par.adressenavn);
    if (adresser.length === 0) {
      ikkeFunnet.push(par);
      console.log(`  ${i + 1}/${mangler.length} ${par.kommunenummer} ${par.adressenavn}: 0 treff`);
      continue;
    }
    const foerste = adresser[0];
    const eiendommer = [];
    for (const adresse of adresser) {
      const eiendom = tilEiendom(adresse);
      // A street can be split across postnumre and repeat an address number, and
      // two runs must not append the same property twice.
      if (kjenteMatrikkelIder.has(eiendom.matrikkelId)) continue;
      kjenteMatrikkelIder.add(eiendom.matrikkelId);
      eiendommer.push(eiendom);
    }
    nyeGater.push({
      gateId: `gate-${slug(par.adressenavn)}-${slug(foerste.kommunenavn)}`,
      adressenavn: foerste.adressenavn,
      kommunenummer: foerste.kommunenummer,
      kommune: foerste.kommunenavn,
      postnummer: foerste.postnummer,
      poststed: foerste.poststed,
      eiendommer,
      antallEiendommer: eiendommer.length,
      antallBoligeiendommer: eiendommer.filter((e) => e.bruksenhetstype === "bolig").length
    });
    console.log(
      `  ${i + 1}/${mangler.length} ${par.kommunenummer} ${par.adressenavn}: ${eiendommer.length} eiendommer`
    );
  }

  // The counters lied on exactly the four hand-curated streets - Fjøsangerveien
  // said 32 where the array held 4 - because the Geonorge count was left standing
  // when the curated properties replaced the real ones. Recomputed for every
  // street, so the file says what it holds.
  let rettet = 0;
  for (const gate of matrikkel.gater) {
    const antall = gate.eiendommer.length;
    const bolig = gate.eiendommer.filter((e) => e.bruksenhetstype === "bolig").length;
    if (gate.antallEiendommer !== antall || gate.antallBoligeiendommer !== bolig) rettet += 1;
    gate.antallEiendommer = antall;
    gate.antallBoligeiendommer = bolig;
  }

  const alleGater = [...matrikkel.gater, ...nyeGater].sort((a, b) =>
    a.kommunenummer.localeCompare(b.kommunenummer) || a.gateId.localeCompare(b.gateId)
  );

  // Provenance per kommune, since the file is no longer one extract. The old
  // `kommunenummer: "4601"` is replaced rather than kept beside this: two fields
  // answering the same question is how the file started lying in the first place.
  const perKommune = new Map();
  for (const kilde of matrikkel.kilde?.kommuner || []) perKommune.set(kilde.kommunenummer, kilde);
  if (matrikkel.kilde?.kommunenummer && !perKommune.has(matrikkel.kilde.kommunenummer)) {
    perKommune.set(matrikkel.kilde.kommunenummer, {
      kommunenummer: matrikkel.kilde.kommunenummer,
      hentet: matrikkel.kilde.hentet
    });
  }
  const hentetNaa = new Date().toISOString();
  for (const gate of nyeGater) {
    if (!perKommune.has(gate.kommunenummer)) {
      perKommune.set(gate.kommunenummer, { kommunenummer: gate.kommunenummer, hentet: hentetNaa });
    }
  }
  const kommuner = [...perKommune.values()]
    .map((kilde) => ({
      kommunenummer: kilde.kommunenummer,
      kommune: alleGater.find((g) => g.kommunenummer === kilde.kommunenummer)?.kommune ?? null,
      hentet: kilde.hentet,
      antallGater: alleGater.filter((g) => g.kommunenummer === kilde.kommunenummer).length
    }))
    .sort((a, b) => a.kommunenummer.localeCompare(b.kommunenummer));

  const ut = {
    kilde: {
      type: "syntetisk-med-offentlig-adressegrunnlag",
      kildeNavn: "Geonorge adresser v1",
      kommuner
    },
    syntetisk: true,
    gater: alleGater
  };
  await writeFile(path.join(dataDir, "matrikkel.json"), JSON.stringify(ut, null, 2) + "\n");

  const antallEiendommer = alleGater.reduce((sum, g) => sum + g.eiendommer.length, 0);
  console.log(
    `\n${alleGater.length} gater og ${antallEiendommer} eiendommer i ${kommuner.length} kommuner. ` +
    `${nyeGater.length} nye gater. ${rettet} gater hadde feil antallEiendommer.`
  );
  if (ikkeFunnet.length > 0) {
    // Named, never skipped in silence: a street Geonorge does not have means the
    // households on it cannot be bound to a property, and someone has to decide
    // what to do about that.
    console.log(`\n${ikkeFunnet.length} gater fant vi ikke i Geonorge:`);
    for (const p of ikkeFunnet) console.log(`  ${p.kommunenummer} ${p.adressenavn}`);
  }
}

run().catch((feil) => {
  console.error(`Matrikkeluttrekk feilet: ${feil.message}`);
  process.exit(1);
});
