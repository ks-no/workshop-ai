// Who may act, and on whose behalf.
//
// The sandbox listed all 394 test people as ID-porten users, 65 of them under 13
// and 11 under 3. A three-year-old cannot log in to a Norwegian municipality and
// open a dialogue, and pretending otherwise is not a small inaccuracy: consent,
// audit and every purpose-limitation lesson in this repo rest on the idea that the
// person answering is the person who may answer.
//
// Two thresholds, both real:
//
//  - **13 years** is when an eID exists. MinID can be ordered from the year you
//    turn 13; BankID is issued from 12-13 with a parent's signature. Below that
//    there is no credential to log in with, so ID-porten has nothing to issue.
//  - **18 years** is rettslig handleevne - when you may act on your own behalf.
//    Between 13 and 18 a person can log in but cannot be the party to a case, so
//    the flow needs a guardian as sender while the minor stays the subject.
//
// Under 18 the route is foreldreansvar (data/folkeregister.seed.json) or
// vergemaal. That is why WP2 put foreldreansvar in the register: it is the legal
// basis this module reads, not something to derive at read time.
//
// Pure and synchronous, like vilkaar.ts and alder.ts, and for the same reason: an
// outcome can be pinned with a literal tilstand object and no running services.
// The arrow points one way, and pnpm test:vilkaar fails if regler.ts is imported
// here: that import would pull in state.ts and a 2048-bit RSA keygen, and the pure
// test would start paying for it.

import { alderVed } from "./alder.ts";

/** The year an eID can exist. Below this, ID-porten has nothing to issue. */
export const ALDER_EID = 13;
/** Rettslig handleevne. Below this, someone else must be the sender. */
export const ALDER_MYNDIG = 18;

export type Handleevnegrunn =
  | "kan_opptre_selv"
  | "for_ung_for_eid"
  | "mindreaarig"
  | "ikke_bosatt"
  | "doed"
  | "ukjent_person";

export type Handleevne = {
  /** True only when the person may act entirely on their own behalf. */
  kanOpptreSelv: boolean;
  /** True when an eID could exist for this person at all. */
  kanHaEid: boolean;
  grunn: Handleevnegrunn;
  alder: number | null;
};

type Personlignende = {
  personId?: string;
  foedselsdato?: string | null;
  personstatus?: string | null;
};

type Register = {
  /** data/personer.json */
  personer: Personlignende[];
};

/**
 * The whole decision, in one place, so the login mock and the process engine
 * cannot disagree about it.
 *
 * Order matters: death outranks age. A dead two-year-old is refused because they
 * are dead, and the message should say so.
 */
export function vurderHandleevne(
  person: Personlignende | null | undefined,
  referansedato: string
): Handleevne {
  if (!person || !person.foedselsdato) {
    return { kanOpptreSelv: false, kanHaEid: false, grunn: "ukjent_person", alder: null };
  }
  const alder = alderVed(person.foedselsdato, referansedato);
  if (person.personstatus === "DOED") {
    return { kanOpptreSelv: false, kanHaEid: false, grunn: "doed", alder };
  }
  if (person.personstatus !== "BOSATT") {
    // Utflyttet, inaktiv, midlertidig. A D-number holder has no Norwegian address
    // and no municipal residence, so there is no kommune to hold a dialogue with.
    return { kanOpptreSelv: false, kanHaEid: false, grunn: "ikke_bosatt", alder };
  }
  if (alder < ALDER_EID) {
    return { kanOpptreSelv: false, kanHaEid: false, grunn: "for_ung_for_eid", alder };
  }
  if (alder < ALDER_MYNDIG) {
    return { kanOpptreSelv: false, kanHaEid: true, grunn: "mindreaarig", alder };
  }
  return { kanOpptreSelv: true, kanHaEid: true, grunn: "kan_opptre_selv", alder };
}

export function kanHaEid(person: Personlignende | null | undefined, referansedato: string): boolean {
  return vurderHandleevne(person, referansedato).kanHaEid;
}

export function kanOpptreSelv(
  person: Personlignende | null | undefined,
  referansedato: string
): boolean {
  return vurderHandleevne(person, referansedato).kanOpptreSelv;
}

export type Representant = {
  personId: string;
  /** The role the register gives them: MOR, FAR, MEDMOR or VERGE. */
  rolle: string;
  /** felles, mor, far, medmor, andre, ukjent - or null for a verge. */
  foreldreansvar: string | null;
};

/**
 * Who may act for this person. Only living residents who can act on their own
 * behalf qualify - a dead mother is still the mother, but she cannot send anything.
 *
 * foreldreansvar comes from the register and is not derived from the parent list:
 * a father can be a father without holding parental responsibility, and the whole
 * point of reading the field is that the two are different questions.
 */
export function finnRepresentanter(
  register: Register,
  personId: string,
  referansedato: string
): Representant[] {
  const person = register.personer.find((p: any) => p.personId === personId) as any;
  if (!person) return [];

  // foreldreansvar sits on the person in data/personer.json, mirrored from the
  // register, so the engine reads one population file rather than loading the
  // 435 KB FREG mirror it otherwise never touches.
  const ansvar: string | null = person.foreldreansvar ?? null;

  const foreldre = (person.foreldrebarnrelasjon || [])
    .filter((rel: any) => rel.relasjon !== "BARN")
    .map((rel: any) => ({
      personId: rel.relatertPersonId,
      rolle: rel.relasjon,
      person: register.personer.find((p: any) => p.personId === rel.relatertPersonId)
    }))
    .filter((kandidat: any) => kandidat.person && kanOpptreSelv(kandidat.person, referansedato));

  // `felles` means both hold it. Named to one parent it belongs to that one, and a
  // father with no responsibility is not a representative however present he is.
  const kvalifiserte = foreldre.filter((kandidat: any) => {
    if (ansvar === null || ansvar === "felles" || ansvar === "ukjent" || ansvar === "andre") {
      return true;
    }
    return kandidat.rolle.toLowerCase() === ansvar;
  });

  return kvalifiserte.map((kandidat: any) => ({
    personId: kandidat.personId,
    rolle: kandidat.rolle,
    foreldreansvar: ansvar
  }));
}

/** The representatives' fødselsnummer, which is what a token's pid carries. */
export function representantPider(
  register: Register,
  personId: string,
  referansedato: string
): string[] {
  return finnRepresentanter(register, personId, referansedato)
    .map((representant) => {
      const person = register.personer.find(
        (p: any) => p.personId === representant.personId
      ) as any;
      return person?.syntetiskFodselsnummer ?? null;
    })
    .filter((pid): pid is string => Boolean(pid));
}

/** For a 403 that says what was refused and what would work instead. */
export function forklarHandleevne(
  handleevne: Handleevne,
  representanter: Representant[]
): string {
  const hvem = representanter.length
    ? `Registrerte representanter: ${representanter.map((r) => `${r.personId} (${r.rolle.toLowerCase()})`).join(", ")}.`
    : "Ingen registrert representant finnes i datasettet.";
  switch (handleevne.grunn) {
    case "doed":
      return "Personen er registrert som død og kan ikke være avsender.";
    case "ikke_bosatt":
      return "Personen er ikke bosatt og har ingen kommune å ha dialog med.";
    case "for_ung_for_eid":
      return (
        `Personen er ${handleevne.alder} år. En elektronisk ID finnes tidligst det året ` +
        `man fyller ${ALDER_EID}, så personen kan ikke opptre selv. ${hvem}`
      );
    case "mindreaarig":
      return (
        `Personen er ${handleevne.alder} år og har ikke rettslig handleevne. En foresatt ` +
        `eller verge må være avsender. ${hvem}`
      );
    case "ukjent_person":
      return "Fant ingen fødselsdato for personen, så handleevnen kan ikke vurderes.";
    default:
      return "Personen kan opptre selv.";
  }
}
