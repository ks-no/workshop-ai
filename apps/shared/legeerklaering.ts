// Legeerklæringen til søknad om TT-kort: formen, og valget av hvilken som gjelder.
//
// Her fordi to lesere trenger den. pasientjournal-mock serverer erklæringene,
// sandbox-backend vurderer dem, og scripts/valider-data.ts pinner utfallene - og
// et valg som lever tre steder er tre valg som kan gå fra hverandre.
//
// Rent og synkront, som alder.ts og vilkaar.ts, og av samme grunn: valget skal
// kunne pinnes med literal-data og ingen tjenester i gang.

/**
 * Funksjonsnedsettingene skjemaet krysser av for, og hjelpemidlene det spør om.
 * Unioner og ikke `string`: en skrivefeil i «rullestolbruker» ville flyttet søkeren
 * til en annen kvote uten at noe ble rødt.
 */
export const FUNKSJONSNEDSETTINGER = [
  "blind-eller-sterkt-svaksynt",
  "terminal-fase",
  "kunstig-surstofftilfoersel",
  "rullestolbruker",
  "anna"
] as const;
export type Funksjonsnedsetting = (typeof FUNKSJONSNEDSETTINGER)[number];

export const HJELPEMIDLER = [
  "krykke-eller-stokk",
  "manuell-rullestol",
  "elektrisk-rullestol",
  "rullator",
  "anna"
] as const;
export type Hjelpemiddel = (typeof HJELPEMIDLER)[number];

/**
 * Ett journalutdrag, slik pasientjournal-mock svarer med det. Hele raden, ikke bare
 * feltene en vurdering leser: en trimmet kopi ville latt et feltnavn endre seg i
 * seeden uten at noen av leserne stoppet på kompilering.
 */
export type Legeerklaering = {
  erklaeringId: string;
  dokumenttype: string;
  fnr: string;
  personId: string;
  utstedt: string;
  signert: string;
  /** Utstedelsesdato pluss seks måneder. Erklæringen er gyldig så lenge. */
  gyldigTil: string;
  diagnose: { kode: string; kodeverk: string; tekst: string };
  funksjonsnedsetting: Funksjonsnedsetting;
  varighetAar: number;
  /** De tre målingene rettleiingen for brukergodkjenning ber om. */
  funn: { visus: number | null; mmsScore: number | null; fev1Prosent: number | null };
  hjelpemiddel: Hjelpemiddel[];
  kanNytteKollektiv: boolean;
  vurdering: string;
  lege: {
    hprNummer: string;
    navn: string;
    legekontor: string;
    organisasjonsnummer: string;
    herId: string;
  };
  syntetisk: true;
};

/**
 * Den erklæringen en vurdering skal bygge på: den nyeste som fortsatt er gyldig, og
 * ellers den nyeste som finnes. At en utløpt erklæring kommer tilbake framfor null
 * er med vilje - da kan vedtaket si «erklæringen din gikk ut 12. mars» i stedet for
 * «vi fant ingenting». Datoene er ISO, så strengsammenlikning er datosammenlikning.
 */
export function velgGjeldendeLegeerklaering<T extends { utstedt: string; gyldigTil: string }>(
  alle: T[],
  paaDato: string
): T | null {
  if (alle.length === 0) return null;
  const nyesteFoerst = [...alle].sort((a, b) => b.utstedt.localeCompare(a.utstedt));
  return nyesteFoerst.find((erklaering) => erklaering.gyldigTil >= paaDato) || nyesteFoerst[0];
}
