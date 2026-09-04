// Age has three callers that must agree: the rules that decide a vedtak, the gate
// that validates the seed, and the importer that generates it. When each carried
// its own copy, the producer could classify a person as a child while the rule
// classified them as an adult, and nothing in CI could see it.
//
// Age is computed at the rates' effective date, not at call time, so the same test
// person yields the same outcome whenever the demo runs.
// Tall, ikke Date: en ISO-dato parses som UTC-midnatt mens getMonth og getDate
// svarer lokalt, og den rundturen ga et annet vedtak vest for Greenwich.
function delerAv(isodato: string): [number, number, number] {
  const [aar, maaned, dag] = isodato.slice(0, 10).split("-").map(Number);
  return [aar!, maaned!, dag!];
}

export function alderVed(foedselsdato: string, referansedato: string): number {
  const [foedtAar, foedtMaaned, foedtDag] = delerAv(foedselsdato);
  const [refAar, refMaaned, refDag] = delerAv(referansedato);
  const alder = refAar - foedtAar;
  const foerBursdag =
    refMaaned < foedtMaaned || (refMaaned === foedtMaaned && refDag < foedtDag);
  return foerBursdag ? alder - 1 : alder;
}

/**
 * Datoen `antall` måneder fram fra en ISO-dato, som ISO-dato.
 *
 * Klemmer til siste dag i målmåneden framfor å rulle over slik `setMonth` gjør:
 * 30. november pluss tre måneder er 28. februar, ikke 2. mars.
 */
export function maanederEtter(isodato: string, antall: number): string {
  const [aar, maaned, dag] = delerAv(isodato);
  const total = (maaned - 1) + antall;
  const nyttAar = aar + Math.floor(total / 12);
  const nyMaaned = (total % 12) + 1;
  const sisteDag = new Date(Date.UTC(nyttAar, nyMaaned, 0)).getUTCDate();
  const nyDag = Math.min(dag, sisteDag);
  const to = (tall: number) => String(tall).padStart(2, "0");
  return `${nyttAar}-${to(nyMaaned)}-${to(nyDag)}`;
}
