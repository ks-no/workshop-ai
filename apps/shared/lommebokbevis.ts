export const INGEN_ANMERKNINGER_MARKOER = "ingen_anmerkninger" as const;
export const HAR_ANMERKNING_MARKOER = "har_anmerkning" as const;

/**
 * Testutstederens politiattest-konfigurasjon krever en ikke-tom liste selv når
 * attesten ikke har anmerkninger, men lommeboken kan ikke utstede beviset når
 * listen inneholder strukturerte objekter. Antallet er autoritativt; markørene
 * representerer bare listen i det eksterne bevisformatet uten lovbruddsdetaljer.
 */
export function anmerkningerForLommebok(
  antallAnmerkninger: number
): Array<typeof INGEN_ANMERKNINGER_MARKOER | typeof HAR_ANMERKNING_MARKOER> {
  return antallAnmerkninger > 0
    ? Array.from({ length: antallAnmerkninger }, () => HAR_ANMERKNING_MARKOER)
    : [INGEN_ANMERKNINGER_MARKOER];
}
