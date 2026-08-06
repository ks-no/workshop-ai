import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { seedMappe, stateMappe } from "./konfig.js";

// Reads from state/ once something has been written there, and falls back to
// the seed in data/. Pure seed files are never written, so they always come
// from data/.
//
// Datasets that only exist at runtime have no seed at all, so they pass a
// default. Anything called without one is required, and a missing file fails
// loudly rather than quietly looking empty.
export async function lesJson(filnavn, standardverdi) {
  for (const mappe of [stateMappe, seedMappe]) {
    try {
      return JSON.parse(await readFile(path.join(mappe, filnavn), "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (standardverdi !== undefined) {
    return standardverdi;
  }
  throw new Error(`Fant ikke ${filnavn} i verken state/ eller data/.`);
}

export async function skrivJson(filnavn, data) {
  await mkdir(stateMappe, { recursive: true });
  await writeFile(path.join(stateMappe, filnavn), JSON.stringify(data, null, 2) + "\n");
}

export function normaliserProsess(prosess) {
  return {
    ...prosess,
    steg: Array.isArray(prosess?.steg) ? prosess.steg : [],
    redigering: {
      status: "publisert",
      ...prosess?.redigering
    }
  };
}

function parseProsessDefinisjoner(data) {
  if (Array.isArray(data)) {
    return {
      formatVersion: "0.1.0",
      prosesser: data.map(normaliserProsess),
      maler: [],
      meta: {}
    };
  }

  const { prosesser, maler, formatVersion, ...meta } = data || {};

  return {
    formatVersion: formatVersion || "0.2.0",
    prosesser: Array.isArray(prosesser) ? prosesser.map(normaliserProsess) : [],
    maler: Array.isArray(maler) ? maler.map(normaliserProsess) : [],
    meta
  };
}

export function erMalProsess(prosess) {
  return prosess?.redigering?.mal === true || prosess?.redigering?.status === "template";
}

export function hentProsesserForVisning(tilstand, inkluderMaler = false) {
  if (inkluderMaler) {
    return [...tilstand.prosesser, ...tilstand.prosessMaler];
  }
  return tilstand.prosesser;
}

export async function lagreProsessdefinisjoner(tilstand) {
  await skrivJson("prosessdefinisjoner.json", {
    ...tilstand.prosessKatalogMeta,
    formatVersion: tilstand.prosessFormatVersion || "0.2.0",
    prosesser: tilstand.prosesser,
    maler: tilstand.prosessMaler
  });
}

export function nyttId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function finnGate(tilstand, gateNavn) {
  if (!gateNavn) return null;
  const norm = String(gateNavn).toLowerCase().trim();
  const gater = tilstand.matrikkel?.gater || [];
  return (
    gater.find((g) => g.adressenavn.toLowerCase() === norm) ||
    gater.find((g) => g.adressenavn.toLowerCase().includes(norm)) ||
    gater.find((g) => norm.includes(g.adressenavn.toLowerCase())) ||
    null
  );
}

export async function lesTilstand() {
  const [
    personer,
    husstander,
    inntekter,
    barnehageplasser,
    soknader,
    prosesser,
    informasjonsmodeller,
    samtykker,
    revisjonslogg,
    prosessoekter,
    matrikkel,
    satser,
    sfoplasser
  ] = await Promise.all([
    lesJson("personer.json"),
    lesJson("husstander.json"),
    lesJson("inntekter.json"),
    lesJson("barnehageplasser.json"),
    lesJson("soknader.json", []),
    lesJson("prosessdefinisjoner.json"),
    lesJson("informasjonsmodeller.json"),
    lesJson("samtykker.json", []),
    lesJson("revisjonslogg.json", []),
    lesJson("prosessoekter.json", []),
    lesJson("matrikkel.json"),
    lesJson("satser.json"),
    lesJson("sfoplasser.json")
  ]);

  const prosesskatalog = parseProsessDefinisjoner(prosesser);

  return {
    personer,
    husstander,
    inntekter,
    barnehageplasser,
    soknader,
    prosesser: prosesskatalog.prosesser,
    prosessMaler: prosesskatalog.maler,
    prosessFormatVersion: prosesskatalog.formatVersion,
    prosessKatalogMeta: prosesskatalog.meta,
    informasjonsmodeller,
    samtykker,
    revisjonslogg,
    prosessoekter,
    matrikkel,
    satser,
    sfoplasser
  };
}

export function finnPerson(tilstand, personId) {
  return tilstand.personer.find((person) => person.personId === personId) || null;
}

export function finnProsess(tilstand, prosessId) {
  return hentProsesserForVisning(tilstand, true).find((prosess) => prosess.id === prosessId) || null;
}

export function finnProsessoekt(tilstand, oektsId) {
  return tilstand.prosessoekter.find((oekt) => oekt.oektsId === oektsId) || null;
}

export async function lagreProsessoekter(prosessoekter) {
  await skrivJson("prosessoekter.json", prosessoekter);
}

export function hentHusstandForPerson(tilstand, personId) {
  const person = finnPerson(tilstand, personId);
  if (!person) {
    throw new Error("Fant ikke person.");
  }
  const husstand = tilstand.husstander.find((kandidat) => kandidat.husstandId === person.husstandId);
  if (!husstand) {
    throw new Error("Fant ikke husstand.");
  }
  return husstand;
}

export function hentBarnehageForPerson(tilstand, personId) {
  const person = finnPerson(tilstand, personId);
  if (!person) {
    throw new Error("Fant ikke person.");
  }
  const husstand = tilstand.husstander.find((kandidat) => kandidat.husstandId === person.husstandId);
  const barnIds = husstand?.medlemmer.filter((medlem) => medlem.rolle === "barn").map((medlem) => medlem.personId) || [person.personId];
  return tilstand.barnehageplasser.filter((plass) => barnIds.includes(plass.personId));
}

export function hentSfoForPerson(tilstand, personId) {
  const person = finnPerson(tilstand, personId);
  const husstand = tilstand.husstander.find((kandidat) => kandidat.husstandId === person?.husstandId);
  const barnIds = husstand?.medlemmer.filter((m) => m.rolle === "barn").map((m) => m.personId) || [];
  return tilstand.sfoplasser.filter((plass) => barnIds.includes(plass.personId));
}
