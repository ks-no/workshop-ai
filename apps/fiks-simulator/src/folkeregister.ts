/**
 * Fiks Folkeregister: the roles and what each of them may read.
 *
 * Real FREG access is role-scoped: every call happens in a rollekontekst that
 * bounds the legal basis, and the role decides which informasjonsdeler come
 * back. That is what this surface demonstrates — data minimisation as API
 * behaviour, not as prose. Asking for a part outside the role is a 403, not an
 * empty field: the refusal is the lesson.
 *
 * The map is closed on purpose, like the maskeringsregler in skjerming.ts: an
 * unknown rolleId is refused with the valid ones in the message, so the three
 * roles stay decision-bearing examples rather than a default anyone can invent
 * around.
 */

import type { FolkeregisterPerson } from "../../shared/registerdata.ts";

/**
 * Every informasjonsdel this surface serves, in the order the seed writes them.
 * The response and the audit grunnlag both list parts in this order, so two
 * lookups with the same hjemmel are byte-comparable.
 */
export const INFORMASJONSDELER = [
  "personnavn",
  "foedselsdato",
  "kjoenn",
  "personstatus",
  "doedsfall",
  "sivilstand",
  "bostedsadresse",
  "kontaktadresse",
  "forelderbarnrelasjon",
  "familierelasjon",
  "foreldreansvar",
  "adressebeskyttelse"
] as const;

export type Informasjonsdel = (typeof INFORMASJONSDELER)[number];

export function isInformasjonsdel(verdi: string): verdi is Informasjonsdel {
  return (INFORMASJONSDELER as readonly string[]).includes(verdi);
}

export type Folkeregisterrolle = {
  rolleId: string;
  navn: string;
  deler: readonly Informasjonsdel[];
};

export const FOLKEREGISTERROLLER: readonly Folkeregisterrolle[] = [
  {
    // Same rolleId sandbox-backend already sends on the beregning path
    // (fiksRolleId in its config.ts), so the machine the sandbox runs as holds
    // the oppvekst hjemmel without new configuration.
    rolleId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    navn: "oppvekst",
    deler: [
      "personnavn",
      "foedselsdato",
      "kjoenn",
      "personstatus",
      "doedsfall",
      "bostedsadresse",
      "adressebeskyttelse",
      "forelderbarnrelasjon",
      "familierelasjon",
      "foreldreansvar"
    ]
  },
  {
    rolleId: "5e7a0500-91d6-4519-a898-3dbb4bfc8a61",
    navn: "helse-omsorg",
    deler: [
      "personnavn",
      "foedselsdato",
      "personstatus",
      "doedsfall",
      "bostedsadresse",
      "kontaktadresse",
      "sivilstand",
      "adressebeskyttelse",
      "familierelasjon"
    ]
  },
  {
    // No name, no address: the narrowest role exists to make the minimisation
    // visible, not to be useful for casework.
    rolleId: "09b21eb2-c0cb-4a87-9cb0-f5405040faa3",
    navn: "folkehelse",
    deler: ["foedselsdato", "kjoenn", "personstatus"]
  }
];

export function findFolkeregisterrolle(rolleId: string): Folkeregisterrolle | undefined {
  return FOLKEREGISTERROLLER.find((rolle) => rolle.rolleId === rolleId);
}

// The seed carries the sandbox's own bookkeeping (_sandbox, and
// _sandboxRelatertPersonId inside the relations). None of it is Folkeregister
// data, so none of it leaves this service.
function stripSandboxFelter(verdi: unknown): unknown {
  if (Array.isArray(verdi)) {
    return verdi.map(stripSandboxFelter);
  }
  if (verdi && typeof verdi === "object") {
    return Object.fromEntries(
      Object.entries(verdi)
        .filter(([nokkel]) => !nokkel.startsWith("_sandbox"))
        .map(([nokkel, indre]) => [nokkel, stripSandboxFelter(indre)])
    );
  }
  return verdi;
}

/**
 * The lookup response: the requested informasjonsdeler in canonical order,
 * nothing else. Mask the person *before* building — this function decides which
 * parts leave, skjerming.ts decides what a protected person's parts contain.
 *
 * Every requested part is present in the answer, as null when the register
 * holds nothing — an absent key would make "not asked for" and "empty" look
 * the same on the wire.
 */
export function buildFregPersonSvar(
  person: FolkeregisterPerson,
  deler: readonly Informasjonsdel[]
): Record<string, unknown> {
  const svar: Record<string, unknown> = { foedselsEllerDNummer: person.foedselsEllerDNummer };
  for (const del of INFORMASJONSDELER) {
    if (!deler.includes(del)) continue;
    svar[del] = stripSandboxFelter((person as Record<string, unknown>)[del] ?? null);
  }
  svar.syntetisk = true;
  return svar;
}
