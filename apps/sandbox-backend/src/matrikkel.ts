import { matrikkelBaseUrl } from "./config.ts";
import { HttpError } from "./errors.ts";

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
};

// 404 is a real answer here — "no such street" — so it maps to null rather than
// an error. Everything else means the matrikkel is unreachable or broken, and
// that must not be mistaken for "the street does not exist".
async function hent(sti: string): Promise<any> {
  let svar: Response;
  try {
    svar = await fetch(`${matrikkelBaseUrl}${sti}`);
  } catch (feil) {
    throw new HttpError(
      `Fikk ikke kontakt med matrikkeltjenesten på ${matrikkelBaseUrl}. ` +
      `Kjører matrikkel-mock?`,
      502,
      { detalj: feil instanceof Error ? feil.message : String(feil), syntetisk: true }
    );
  }
  if (svar.status === 404) return null;
  if (!svar.ok) {
    throw new HttpError(
      `Matrikkeltjenesten svarte ${svar.status} på ${sti}.`,
      502,
      { syntetisk: true }
    );
  }
  return svar.json();
}

export async function hentGater(): Promise<Gate[]> {
  return (await hent("/mock/matrikkel/gater")) || [];
}

export async function finnGate(gateNavn: string | null): Promise<Gate | null> {
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
