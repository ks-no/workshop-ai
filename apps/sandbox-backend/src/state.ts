import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { seedDir, stateDir } from "./config.ts";

type State = any;

// Reads from state/ once something has been written there, and falls back to
// the seed in data/. Pure seed files are never written, so they always come
// from data/.
//
// Datasets that only exist at runtime have no seed at all, so they pass a
// default. Anything called without one is required, and a missing file fails
// loudly rather than quietly looking empty.
export async function readJson(filnavn: string, standardverdi?: unknown): Promise<any> {
  for (const mappe of [stateDir, seedDir]) {
    try {
      return JSON.parse(await readFile(path.join(mappe, filnavn), "utf8"));
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (standardverdi !== undefined) {
    return standardverdi;
  }
  throw new Error(`Fant ikke ${filnavn} i verken state/ eller data/.`);
}

export async function writeJson(filnavn: string, data: unknown) {
  await mkdir(stateDir, { recursive: true });
  await writeFile(path.join(stateDir, filnavn), JSON.stringify(data, null, 2) + "\n");
}

export function normaliserProsess(prosess: any) {
  return {
    ...prosess,
    steg: Array.isArray(prosess?.steg) ? prosess.steg : [],
    redigering: {
      status: "publisert",
      ...prosess?.redigering
    }
  };
}

function parseProsessDefinisjoner(data: any) {
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

export function erMalProsess(prosess: any) {
  return prosess?.redigering?.mal === true || prosess?.redigering?.status === "template";
}

export function hentProsesserForVisning(tilstand: State, inkluderMaler = false) {
  if (inkluderMaler) {
    return [...tilstand.prosesser, ...tilstand.prosessMaler];
  }
  return tilstand.prosesser;
}

export async function lagreProsessdefinisjoner(tilstand: State) {
  await writeJson("prosessdefinisjoner.json", {
    ...tilstand.prosessKatalogMeta,
    formatVersion: tilstand.prosessFormatVersion || "0.2.0",
    prosesser: tilstand.prosesser,
    maler: tilstand.prosessMaler
  });
}

export function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function finnGate(tilstand: State, gateNavn: string | null) {
  if (!gateNavn) return null;
  const norm = String(gateNavn).toLowerCase().trim();
  const gater = tilstand.matrikkel?.gater || [];
  return (
    gater.find((g: any) => g.adressenavn.toLowerCase() === norm) ||
    gater.find((g: any) => g.adressenavn.toLowerCase().includes(norm)) ||
    gater.find((g: any) => norm.includes(g.adressenavn.toLowerCase())) ||
    null
  );
}

export async function readState() {
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
    readJson("personer.json"),
    readJson("husstander.json"),
    readJson("inntekter.json"),
    readJson("barnehageplasser.json"),
    readJson("soknader.json", []),
    readJson("prosessdefinisjoner.json"),
    readJson("informasjonsmodeller.json"),
    readJson("samtykker.json", []),
    readJson("revisjonslogg.json", []),
    readJson("prosessoekter.json", []),
    readJson("matrikkel.json"),
    readJson("satser.json"),
    readJson("sfoplasser.json")
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

export function finnPerson(tilstand: State, personId: string) {
  return tilstand.personer.find((person: any) => person.personId === personId) || null;
}

export function finnProsess(tilstand: State, prosessId: string) {
  return hentProsesserForVisning(tilstand, true).find((prosess: any) => prosess.id === prosessId) || null;
}

export function finnProsessoekt(tilstand: State, oektsId: string) {
  return tilstand.prosessoekter.find((oekt: any) => oekt.oektsId === oektsId) || null;
}

export async function lagreProsessoekter(prosessoekter: unknown) {
  await writeJson("prosessoekter.json", prosessoekter);
}

export function hentHusstandForPerson(tilstand: State, personId: string) {
  const person = finnPerson(tilstand, personId);
  if (!person) {
    throw new Error("Fant ikke person.");
  }
  const husstand = tilstand.husstander.find((kandidat: any) => kandidat.husstandId === person.husstandId);
  if (!husstand) {
    throw new Error("Fant ikke husstand.");
  }
  return husstand;
}

// A new tjeneste is one line here. Barnehage and SFO used to do the exact same
// lookup in two separate functions, differing only in which dataset they filtered.
export const tjenesteDatasett = {
  barnehage: "barnehageplasser",
  sfo: "sfoplasser"
};

export function hentBarnaIHusstand(tilstand: State, personId: string): string[] {
  const person = finnPerson(tilstand, personId);
  if (!person) {
    throw new Error("Fant ikke person.");
  }
  const husstand = tilstand.husstander.find((kandidat: any) => kandidat.husstandId === person.husstandId);
  return husstand?.medlemmer
    .filter((medlem: any) => medlem.rolle === "barn")
    .map((medlem: any) => medlem.personId) || [person.personId];
}

export function hentPlasserForTjeneste(tilstand: State, personId: string, tjeneste: string) {
  const datasett = (tjenesteDatasett as Record<string, string>)[tjeneste];
  if (!datasett) {
    throw new Error(`Ukjent tjeneste: ${tjeneste}. Gyldige: ${Object.keys(tjenesteDatasett).join(", ")}.`);
  }
  const barnIds = hentBarnaIHusstand(tilstand, personId);
  return tilstand[datasett].filter((plass: any) => barnIds.includes(plass.personId));
}
