import { matrikkelBaseUrl } from "./config.ts";
import { callUpstream } from "./upstream.ts";

// MATRIKKEL CLIENT
//
// The backend used to read data/matrikkel.seed.json straight off disk, in
// parallel with matrikkel-mock reading the same file. Two read paths meant two
// copies of the same post-processing, and they had to be kept in step by hand —
// the universal owner and the injected Bønesheien street existed twice, in
// state.ts and in the mock. Going over HTTP leaves one matrikkel in the sandbox,
// the one that also speaks SOAP, and the seed becomes the mock's business alone.

export type Gate = {
  gateId: string;
  adressenavn: string;
  kommunenummer?: string;
  kommune: string;
  postnummer?: string;
  poststed?: string;
  antallEiendommer: number;
  antallBoligeiendommer: number;
};

export type Eiendom = {
  matrikkelId: string;
  gnr: number;
  bnr: number;
  adresse: string;
  bruksenhetstype?: string;
  eiere?: string[];
  // Denormalised onto every eiendom by the mock, so a lookup that spans streets
  // does not have to resolve the gate separately. See leggTilEiendom there.
  adressenavn?: string;
  kommune?: string;
  kommunenummer?: string;
  gateId?: string;
};

// 404 is a real answer here — "no such street" — so it maps to null rather than
// an error. Everything else means the matrikkel is unreachable or broken, and
// that must not be mistaken for "the street does not exist". `emptyOn` is the only
// thing this call needs on top of upstream.ts, and no `relayStatus`: a matrikkel
// that judges our request is a matrikkel that is broken from here, not a verdict
// to hand the citizen. The reading of every other status is now shared with the
// Fiks and KI calls, and used not to be.
async function hent(sti: string): Promise<any> {
  return callUpstream<any>(
    {
      service: "matrikkeltjenesten",
      action: `Oppslaget mot ${sti}`,
      emptyOn: [404],
      hintWhenDown: `Kjører matrikkel-mock på ${matrikkelBaseUrl}?`
    },
    () => fetch(`${matrikkelBaseUrl}${sti}`)
  );
}

export async function getGater(): Promise<Gate[]> {
  return (await hent("/mock/matrikkel/gater")) || [];
}

// treff[0] and not a kommune match: the caller has a street name and nothing else,
// because that is all the participant typed. "Storgata" exists twice in the register
// — Bergen 4601 with 10 eiendommer and Tromsø 5501 with 171 — and the documented
// "Storgata gives an approval" for person-001 holds because Bergen happens to be
// seeded first. Filtering on the applicant's own kommunenummer would be the honest
// fix; until then the seed order is load-bearing.
export async function findGate(gateNavn: string | null): Promise<Gate | null> {
  if (!gateNavn) return null;
  const treff = await hent(`/mock/matrikkel/gater?gate=${encodeURIComponent(gateNavn)}`);
  return Array.isArray(treff) && treff.length > 0 ? treff[0] : null;
}

// The mock filters on owner server-side, so the owner lists of everyone else in
// the street never reach the backend at all. The projection that used to happen
// here is now a property of the request.
export async function eiendommerForPersonIGate(
  gateNavn: string,
  personId: string
): Promise<Eiendom[]> {
  const treff = await hent(
    `/mock/matrikkel/eiendommer?gate=${encodeURIComponent(gateNavn)}` +
    `&personId=${encodeURIComponent(personId)}`
  );
  return Array.isArray(treff) ? treff : [];
}

// Same server-side owner filter as eiendommerForPersonIGate, without the street
// bound. Asking the matrikkel is what keeps this from being a second read path:
// the seed is the mock's business, and the owner lists of everyone else never
// reach the backend either way.
export async function eiendommerForPerson(personId: string): Promise<Eiendom[]> {
  const treff = await hent(
    `/mock/matrikkel/eiendommer?personId=${encodeURIComponent(personId)}`
  );
  return Array.isArray(treff) ? treff : [];
}
