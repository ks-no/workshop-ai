// Legeerklæringen til søknad om TT-kort: formen den har på tvers av tjenestene.
//
// Her fordi to lesere trenger den. pasientjournal-mock serverer erklæringene og
// scripts/valider-data.ts holder seeden mot kodeverkene, og en form som lever to
// steder er to former som kan gå fra hverandre.

/**
 * Funksjonsnedsettingene skjemaet krysser av for, og hjelpemidlene det spør om.
 * Unioner og ikke `string`: en skrivefeil i «rullestolbrukar» ville flyttet søkeren
 * til en annen kvote uten at noe ble rødt.
 */
export const FUNKSJONSNEDSETTINGER = [
  "blind-eller-sterkt-svaksynt",
  "terminal-fase",
  "kunstig-surstofftilfoersel",
  "rullestolbrukar",
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
