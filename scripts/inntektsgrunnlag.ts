import { findInntekt, sisteInntektsaar, sumInntektsgrunnlag } from "../apps/shared/inntekt.ts";
import type { Inntekt } from "../apps/shared/inntekt.ts";

export function validateHusstandsgrunnlag(inntekter: Inntekt[], identer: string[], husstandId: string): number | null {
  // Husstanden uten opplysninger er en tilsiktet fixture. Delvis grunnlag er det
  // ikke: en sum av ulike år ville skjult at Fiks svarer med manglende data.
  if (!inntekter.some((rad) => identer.includes(rad.identifikator))) return null;
  const aar = sisteInntektsaar(inntekter, identer);
  const rader = identer.map((identifikator) => {
    const rad = findInntekt(inntekter, identifikator, aar);
    if (!rad) {
      throw new Error(
        `${husstandId}: mangler inntektsopplysninger for ${identifikator} i ${aar}. ` +
        "Fiks krever samme inntektsår for alle foresatte; ulike år kan ikke summeres."
      );
    }
    return rad;
  });
  return sumInntektsgrunnlag(rader.flatMap((rad) => rad.poster)).beregningsbeloep;
}
