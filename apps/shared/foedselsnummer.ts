// Synthetic fødselsnummer, the way Skatteetaten actually issues them.
//
// A test person from Tenor has 80 added to the birth month - a person "born"
// 01.11.2024 gets 011124 written as 019124 - and the two control digits are
// computed *after* that addition, so the number still satisfies modulus 11. That
// is what makes a synthetic number recognisable as synthetic while remaining a
// well-formed identifier. (NAV's variant adds 40 to the month instead; we use
// Skatt's, because our population comes from Tenor.)
//
// This module exists for the same reason as alder.ts: three callers must agree.
// The importer generates numbers, the gate validates them, and the services that
// accept one from the outside decide whether it is well formed. When each carried
// its own regex, the 51 curated fixtures ended up with neither valid control
// digits nor the +80 marker, and nothing could see it.
//
// There is no function here that turns a fnr into a birth date, because the
// individual number encodes the century ambiguously and every record already
// carries `foedselsdato` as its own field. Deriving the date would be a second
// source for something we have, so this module compares against `foedselsdato`.

const VEKTER_1 = [3, 7, 6, 1, 8, 9, 4, 5, 2];
const VEKTER_2 = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/** How much is added to the month, and by whom. */
export const SYNTETISK_MAANEDSPAALEGG = 80;
const NAV_MAANEDSPAALEGG = 40;
/** A D-number adds 40 to the day, not the month. */
const DNUMMER_DAGPAALEGG = 40;

export type Identifikatortype = "foedselsnummer" | "dNummer";

export type Fnrdeler = {
  /** Day of month, 1-31, with the D-number offset removed. */
  dag: number;
  /** Month, 1-12, with the synthetic offset removed. */
  maaned: number;
  /** The two year digits, as written. The century is not inferred - see above. */
  aar2: string;
  individnummer: string;
  type: Identifikatortype;
  /** True when the month carries Skatteetaten's +80 synthetic marker. */
  syntetisk: boolean;
};

function kontrollsiffer(sifre: number[], vekter: number[]): number | null {
  const sum = vekter.reduce((total, vekt, i) => total + vekt * sifre[i], 0);
  const rest = 11 - (sum % 11);
  if (rest === 11) return 0;
  // A rest of 10 has no valid control digit, so the individual number is skipped
  // rather than fudged. This is why generation loops instead of computing once.
  return rest === 10 ? null : rest;
}

/**
 * Splits a fødselsnummer into its parts, or returns null when the number is not
 * well formed: wrong length, non-digits, bad control digits, or a day/month that
 * cannot exist once the offsets are removed.
 */
export function lesFoedselsnummer(fnr: string): Fnrdeler | null {
  const tekst = String(fnr ?? "");
  if (!/^[0-9]{11}$/.test(tekst)) return null;

  const sifre = [...tekst].map(Number);
  if (kontrollsiffer(sifre.slice(0, 9), VEKTER_1) !== sifre[9]) return null;
  if (kontrollsiffer(sifre.slice(0, 10), VEKTER_2) !== sifre[10]) return null;

  const raaDag = Number(tekst.slice(0, 2));
  const raaMaaned = Number(tekst.slice(2, 4));

  const type: Identifikatortype = raaDag > DNUMMER_DAGPAALEGG ? "dNummer" : "foedselsnummer";
  const dag = type === "dNummer" ? raaDag - DNUMMER_DAGPAALEGG : raaDag;

  let maaned = raaMaaned;
  let syntetisk = false;
  if (raaMaaned > SYNTETISK_MAANEDSPAALEGG) {
    maaned = raaMaaned - SYNTETISK_MAANEDSPAALEGG;
    syntetisk = true;
  } else if (raaMaaned > NAV_MAANEDSPAALEGG) {
    // NAV's convention. Recognised so the error message can say which one it is,
    // never produced here.
    maaned = raaMaaned - NAV_MAANEDSPAALEGG;
    syntetisk = true;
  }

  if (dag < 1 || dag > 31 || maaned < 1 || maaned > 12) return null;

  return {
    dag,
    maaned,
    aar2: tekst.slice(4, 6),
    individnummer: tekst.slice(6, 9),
    type,
    syntetisk
  };
}

export function isGyldigFoedselsnummer(fnr: string): boolean {
  return lesFoedselsnummer(fnr) !== null;
}

/** True only for Skatteetaten's +80 form. NAV's +40 numbers are not ours. */
export function isSyntetiskFoedselsnummer(fnr: string): boolean {
  const deler = lesFoedselsnummer(fnr);
  return deler !== null && deler.syntetisk && Number(fnr.slice(2, 4)) > SYNTETISK_MAANEDSPAALEGG;
}

/**
 * Whether the date written into the identifier matches the record's own
 * `foedselsdato`. Compares the written parts, so no century has to be guessed.
 */
export function stemmerMedFoedselsdato(fnr: string, foedselsdato: string): boolean {
  const deler = lesFoedselsnummer(fnr);
  if (!deler || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(foedselsdato ?? ""))) return false;
  return (
    deler.dag === Number(foedselsdato.slice(8, 10)) &&
    deler.maaned === Number(foedselsdato.slice(5, 7)) &&
    deler.aar2 === foedselsdato.slice(2, 4)
  );
}

// The individual number also encodes the century in the real numbering scheme.
// 000-499 belongs to the 1900s and 500-999 to 2000-2039, so a synthetic number
// stays consistent with the birth date rather than merely passing modulus 11.
function individnummerStart(aar: number): number {
  return aar >= 2000 ? 500 : 0;
}

/**
 * The `forsoek`-th valid synthetic fødselsnummer for a birth date, counting from
 * zero. Deterministic: the same date and index always give the same number. Two
 * people born on the same day get distinct numbers by asking for a higher index,
 * which is the caller's job - this function knows nothing about who exists.
 */
export function lagSyntetiskFoedselsnummer(foedselsdato: string, forsoek = 0): string {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(foedselsdato ?? ""))) {
    throw new Error(`Ugyldig foedselsdato "${foedselsdato}". Forventet ISO-format.`);
  }
  const aar = Number(foedselsdato.slice(0, 4));
  const start = individnummerStart(aar);
  const prefiks =
    foedselsdato.slice(8, 10) +
    String(Number(foedselsdato.slice(5, 7)) + SYNTETISK_MAANEDSPAALEGG) +
    foedselsdato.slice(2, 4);

  let treff = 0;
  for (let individ = start; individ < start + 500; individ += 1) {
    const ni = prefiks + String(individ).padStart(3, "0");
    const sifre = [...ni].map(Number);
    const k1 = kontrollsiffer(sifre, VEKTER_1);
    if (k1 === null) continue;
    const k2 = kontrollsiffer([...sifre, k1], VEKTER_2);
    if (k2 === null) continue;
    if (treff === forsoek) return `${ni}${k1}${k2}`;
    treff += 1;
  }
  throw new Error(
    `Fant ikke syntetisk fødselsnummer nummer ${forsoek} for ${foedselsdato}. ` +
    `Bare ${treff} gyldige individnummer finnes for den datoen.`
  );
}
