// Masking for address-protected people, applied once in the data layer.
//
// Six people in the seed carry a confidentiality code. Three other services hide
// them in their own way — folkeregister-mcp and tools-api refuse the lookup,
// fiks-simulator omits the name from a calculation — but each reads its own copy of
// the data, so none of them covered sandbox-backend. A team building its own
// frontend against the backend got the full name and address back in the same
// response that said STRENGT_FORTROLIG. That taught the wrong lesson: that the code
// is decoration.
//
// So masking happens here, on the way out of readState(), and every reader
// downstream — routes, ressurser, regler, prosess — sees the same person.
//
// What survives masking, and why. Remove any of these in good faith and the rules
// engine breaks quietly:
//
//   syntetiskFodselsnummer  regler.ts sends it to fiks-simulator for the income
//                           lookup. Fiks already returns skjermet: true with no
//                           name, so nothing is double-masked by keeping it.
//   foedselsdato            vilkaar.ts does age assessment against the ordning's
//                           target group.
//   bostedsadresse
//     .kommunenummer        TJENESTEBEHOV filters the municipality's own tilbud on
//     .kommune              it, and demo-gui reads .kommune with no guard. Real
//                           kode 6 hides the municipality too — that is a
//                           deliberate simplification here, not an oversight.
//   adressebeskyttelse      The code is the explanation for why the other fields
//   skjermet                are empty. Hiding it would leave the caller guessing.
//
// Values are nulled, never deleted. The wire format is frozen, and undefined
// disappears in JSON.stringify — which would change the key set, not just the
// values.

import type { Adressegradering, Husstand, Krr, Person, Personnavn } from "./innbyggerdata.ts";
import type { FolkeregisterPerson } from "./registerdata.ts";

const SKJERMET_NAVN: Personnavn = { fornavn: "Skjermet", mellomnavn: null, etternavn: "person" };

// The address fields that identify *where* someone lives. kommunenummer and
// kommune are deliberately absent from this list.
const SKJERMEDE_ADRESSEFELT = ["adressenavn", "husnummer", "husbokstav", "postnummer", "poststed"];

const SKJERMEDE_KONTAKTFELT = ["epost", "telefon"];

// Nulls the listed fields, but only the ones already present. Writing a field that
// was absent would grow the key set: Tenor-imported people carry `kontakt: {}` with
// no epost or telefon at all, and the frozen wire format means masking may change
// values, never shape.
function blankOut(objekt: Record<string, any>, felter: string[]): Record<string, any> {
  const kopi = { ...objekt };
  for (const felt of felter) {
    if (felt in kopi) kopi[felt] = null;
  }
  return kopi;
}

type Maskeringsregel = {
  /** Hide the name as well. Kode 6 does, kode 7 does not. */
  skjulNavn: boolean;
  /** Hide street address and contact details. */
  skjulAdresse: boolean;
};

// Record<Adressegradering, ...> is the point of the closed union: add a fourth
// grade to innbyggerdata.ts and the compiler demands a rule for it here, the same way
// regelHandlers in vilkaar.ts demands a handler for a new Regeltype.
const REGLER: Record<Adressegradering, Maskeringsregel> = {
  UGRADERT: { skjulNavn: false, skjulAdresse: false },
  // Kode 7: the address is protected, the name is not.
  FORTROLIG: { skjulNavn: false, skjulAdresse: true },
  // Kode 6: name and address both.
  STRENGT_FORTROLIG: { skjulNavn: true, skjulAdresse: true }
};

function regelFor(gradering: unknown): Maskeringsregel {
  // An unknown grade masks as strictly as we know how. Failing open here would
  // mean a typo in the seed silently publishes a protected person.
  return REGLER[gradering as Adressegradering] ?? REGLER.STRENGT_FORTROLIG;
}

export function isSkjermet(gradering: unknown): boolean {
  return gradering !== "UGRADERT";
}

export function maskPerson(person: Person): Person {
  const regel = regelFor(person.adressebeskyttelse);
  if (!regel.skjulNavn && !regel.skjulAdresse) {
    return person;
  }

  const maskert: Person = { ...person };

  if (regel.skjulNavn && person.navn) {
    maskert.navn = { ...SKJERMET_NAVN };
  }

  if (regel.skjulAdresse) {
    if (person.bostedsadresse) {
      maskert.bostedsadresse = blankOut(person.bostedsadresse, SKJERMEDE_ADRESSEFELT);
    }
    if (person.kontakt) {
      maskert.kontakt = blankOut(person.kontakt, SKJERMEDE_KONTAKTFELT);
    }
  }

  return maskert;
}

// A KRR row is contact info by definition, so both protection grades null it —
// same skjulAdresse rule as maskPerson, read from the same table. reservert,
// spraak and kanVarsles survive: they say whether the municipality may notify
// digitally, not where the person is, and the KRR spec keeps them for kode 6/7
// too. The whole objects go to null rather than their inner fields, matching how
// a person with no registered contact info looks — absent and protected must be
// indistinguishable on the wire.
export function maskKrr(rad: Krr, gradering: unknown): Krr {
  const regel = regelFor(gradering);
  if (!regel.skjulAdresse) {
    return rad;
  }
  return { ...rad, epost: null, tlf: null };
}

// The folkeregister seed row, masked by the same rule table as maskPerson.
// FORTROLIG nulls the fields that say where the person lives — the street
// address, the matrikkel identifier, the Tenor extract's grunnkrets and
// skolekrets — and the contact fields; STRENGT_FORTROLIG hides the name too.
// kommune and kommunenummer survive, the same deliberate simplification as
// maskPerson, and `adressebeskyttelse` always survives: the code is the
// explanation for why the other fields are empty.
const FREG_SKJERMEDE_ADRESSEFELT = [
  ...SKJERMEDE_ADRESSEFELT,
  "adresseIdentifikatorFraMatrikkelen"
];

export function maskFregPerson(person: FolkeregisterPerson): FolkeregisterPerson {
  const regel = regelFor(person.adressebeskyttelse);
  if (!regel.skjulAdresse) {
    return person;
  }

  // grunnkrets/skolekrets are top-level, so the person object itself goes
  // through blankOut — only keys already present are nulled, as everywhere.
  const maskert = blankOut(person, ["grunnkrets", "skolekrets"]) as FolkeregisterPerson;

  if (regel.skjulNavn && person.personnavn) {
    maskert.personnavn = { ...SKJERMET_NAVN };
  }
  if (person.bostedsadresse) {
    maskert.bostedsadresse = blankOut(person.bostedsadresse, FREG_SKJERMEDE_ADRESSEFELT);
  }
  if ("kontaktadresse" in maskert) {
    maskert.kontaktadresse = null;
  }
  if (person.kontakt) {
    maskert.kontakt = blankOut(person.kontakt, SKJERMEDE_KONTAKTFELT);
  }

  return maskert;
}

// The household address is masked only when *every* member is protected.
//
// household-083, -093 and -157 consist solely of protected people, so there the
// household address simply is the protected person's address and it leaked in
// full. household-013 is different: one parent has kode 6, but three unprotected
// people live at the same address and GET /api/personer/person-030 returns it
// regardless. Masking there hides nothing and degrades a curated SFO case.
//
// This is a real limit of field-level masking, not a gap to plug later: you cannot
// hide an address someone shares with a person who is not protected.
export function maskHusstand(
  husstand: Husstand,
  graderingPerPersonId: Map<string, unknown>
): Husstand {
  const medlemmer = husstand.medlemmer || [];
  if (medlemmer.length === 0) {
    return husstand;
  }
  const allSkjermet = medlemmer.every((medlem) =>
    isSkjermet(graderingPerPersonId.get(medlem.personId))
  );
  if (!allSkjermet) {
    return husstand;
  }
  return { ...husstand, adresse: null };
}

// The one call readState() needs. Builds the personId -> grade index once, so the
// household pass does not scan the population per household.
export function maskBefolkning(personer: Person[], husstander: Husstand[]) {
  const graderingPerPersonId = new Map<string, unknown>(
    personer.map((person) => [person.personId, person.adressebeskyttelse])
  );
  return {
    personer: personer.map(maskPerson),
    husstander: husstander.map((husstand) => maskHusstand(husstand, graderingPerPersonId))
  };
}
