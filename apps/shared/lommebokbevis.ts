export const INGEN_ANMERKNINGER_MARKOER = "ingen_anmerkninger" as const;

/**
 * Testutstederens politiattest-konfigurasjon krever en ikke-tom liste selv når
 * attesten ikke har anmerkninger. Antallet er fortsatt null; markøren finnes bare
 * for å representere den tomme listen i det eksterne bevisformatet.
 */
export function anmerkningerForLommebok<T>(
  anmerkninger: T[]
): Array<T | typeof INGEN_ANMERKNINGER_MARKOER> {
  return anmerkninger.length > 0 ? anmerkninger : [INGEN_ANMERKNINGER_MARKOER];
}
