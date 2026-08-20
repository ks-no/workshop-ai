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

// Which seed files are currently shadowed by a copy in state/.
//
// The shadowing itself is by design — it is what keeps a demo run from dirtying
// the work tree. The trap is that it is silent: the moment anyone saves in the
// process builder, state/prosessdefinisjoner.json appears, and every later hand
// edit to data/prosessdefinisjoner.json is ignored with no signal at all. People
// lose a lot of time to that.
export async function findShadowedSeeds(): Promise<string[]> {
  const skygget: string[] = [];
  for (const filnavn of ["prosessdefinisjoner.json", "personer.json", "satser.json"]) {
    try {
      await readFile(path.join(stateDir, filnavn), "utf8");
      await readFile(path.join(seedDir, filnavn), "utf8");
      skygget.push(filnavn);
    } catch {
      // Missing in either place means no shadowing. Nothing to report.
    }
  }
  return skygget;
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
    satser,
    sfoplasser,
    fritidsdeltakelse,
    fritidsaktiviteter
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
    readJson("satser.json"),
    readJson("sfoplasser.json"),
    readJson("fritidsdeltakelse.json"),
    readJson("fritidsaktiviteter.json")
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
    satser,
    sfoplasser,
    fritidsdeltakelse,
    fritidsaktiviteter
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
  sfo: "sfoplasser",
  fritid: "fritidsdeltakelse"
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
