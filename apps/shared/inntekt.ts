import { norskKalenderaar } from "./alder.ts";

export type Inntektspost = {
  tekniskNavn: string;
  visningstekst: string;
  beloep: number;
  kilde?: string;
  medregnes?: boolean;
  infotekst?: string;
  referanse?: string;
};

export type Inntekt = {
  personId?: string;
  identifikator: string;
  inntektsaar: number;
  stadie?: string;
  skatteoppgjoersdato?: string;
  poster: Inntektspost[];
};

// Fiks tar ett inntektsår for hele husstanden, aldri hvert medlems nyeste år.
export function sisteInntektsaar(inntekter: Inntekt[], identer: string[], now = Date.now()): number {
  const aar = inntekter.filter((rad) => identer.includes(rad.identifikator)).map((rad) => rad.inntektsaar);
  return aar.length ? Math.max(...aar) : norskKalenderaar(now) - 1;
}

export function findInntekt(inntekter: Inntekt[], identifikator: string, inntektsaar: number) {
  return inntekter.find((rad) => rad.identifikator === identifikator && rad.inntektsaar === inntektsaar);
}

export function sumInntektsgrunnlag(poster: Inntektspost[]) {
  const inntekt = poster.reduce((sum, post) => sum + post.beloep, 0);
  const fradrag = poster.filter((post) => !post.medregnes).reduce((sum, post) => sum + post.beloep, 0);
  return { inntekt, fradrag, beregningsbeloep: inntekt - fradrag };
}
