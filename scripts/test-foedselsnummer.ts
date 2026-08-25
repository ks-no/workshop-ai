/*
 * Unit tests for apps/shared/foedselsnummer.ts.
 *
 * Pure functions, no stack, no port, no model.
 *
 * What this covers that the data gate cannot: the seed contains only the numbers
 * we generate, so the *rejections* have no examples in it. A number with a normal
 * month, a number whose control digits are wrong in the second position only, an
 * individual number whose modulus-11 rest is 10 — those exist here or nowhere.
 *
 * The three real numbers used as negative cases are structurally valid
 * fødselsnummer with an ordinary month, which is exactly what must be refused:
 * they are the shape a real person's identifier has, and the sandbox must never
 * accept one as synthetic.
 */

import {
  lesFoedselsnummer,
  isGyldigFoedselsnummer,
  isSyntetiskFoedselsnummer,
  stemmerMedFoedselsdato,
  lagSyntetiskFoedselsnummer,
  SYNTETISK_MAANEDSPAALEGG
} from "../apps/shared/foedselsnummer.ts";
import { feilmelding } from "../apps/shared/errors.ts";

let bestatt = 0;
const feil: string[] = [];

function check(navn: string, betingelse: unknown, detalj = ""): void {
  if (betingelse) {
    bestatt += 1;
    return;
  }
  feil.push(`${navn}${detalj ? ` — ${detalj}` : ""}`);
}

// --- form ------------------------------------------------------------------
for (const daarlig of ["", "1234567890", "123456789012", "1203899000a", "abcdefghijk", null, undefined]) {
  check(`avviser ${JSON.stringify(daarlig)}`, lesFoedselsnummer(String(daarlig)) === null);
}

// --- generation is deterministic and valid ---------------------------------
const datoer = ["1913-01-01", "1975-05-18", "1987-03-30", "1999-12-31", "2000-01-01", "2024-11-01", "2026-02-28"];
for (const dato of datoer) {
  const fnr = lagSyntetiskFoedselsnummer(dato);
  check(`${dato} gir 11 siffer`, /^[0-9]{11}$/.test(fnr), fnr);
  check(`${dato} er mod11-gyldig`, isGyldigFoedselsnummer(fnr), fnr);
  check(`${dato} er syntetisk`, isSyntetiskFoedselsnummer(fnr), fnr);
  check(`${dato} stemmer med foedselsdato`, stemmerMedFoedselsdato(fnr, dato), fnr);
  check(
    `${dato} har maaned i 81-92`,
    Number(fnr.slice(2, 4)) >= 81 && Number(fnr.slice(2, 4)) <= 92,
    fnr.slice(2, 4)
  );
  check(`${dato} gir samme svar to ganger`, lagSyntetiskFoedselsnummer(dato) === fnr);
}

// The century belongs in the individual number, not only in the control digits.
check(
  "1900-tallet gir individnummer under 500",
  Number(lagSyntetiskFoedselsnummer("1987-03-30").slice(6, 9)) < 500
);
check(
  "2000-tallet gir individnummer fra 500",
  Number(lagSyntetiskFoedselsnummer("2024-11-01").slice(6, 9)) >= 500
);

// --- distinct numbers for the same day ------------------------------------
const samme = [0, 1, 2, 3, 4].map((i) => lagSyntetiskFoedselsnummer("1990-06-15", i));
check("fem forsoek gir fem ulike numre", new Set(samme).size === 5, samme.join(", "));
check("alle fem er gyldige", samme.every(isGyldigFoedselsnummer));
check("alle fem stemmer med datoen", samme.every((f) => stemmerMedFoedselsdato(f, "1990-06-15")));

let kastetForMange = false;
try {
  lagSyntetiskFoedselsnummer("1990-06-15", 10000);
} catch (error) {
  kastetForMange = feilmelding(error).includes("Fant ikke syntetisk fødselsnummer");
}
check("for hoey forsoeksteller kaster", kastetForMange);

let kastetDato = false;
try {
  lagSyntetiskFoedselsnummer("15.06.1990");
} catch (error) {
  kastetDato = feilmelding(error).includes("Ugyldig foedselsdato");
}
check("ugyldig datoformat kaster", kastetDato);

// --- control digits are actually checked ----------------------------------
const gyldig = lagSyntetiskFoedselsnummer("1987-03-30");
const bytt = (fnr: any, i: any, siffer: any) => fnr.slice(0, i) + siffer + fnr.slice(i + 1);
check(
  "endret foerste kontrollsiffer avvises",
  !isGyldigFoedselsnummer(bytt(gyldig, 9, String((Number(gyldig[9]) + 1) % 10)))
);
check(
  "endret andre kontrollsiffer avvises",
  !isGyldigFoedselsnummer(bytt(gyldig, 10, String((Number(gyldig[10]) + 1) % 10)))
);
check(
  "endret individnummer avvises",
  !isGyldigFoedselsnummer(bytt(gyldig, 8, String((Number(gyldig[8]) + 1) % 10)))
);

// --- a real-shaped number is not synthetic -------------------------------
// Valid modulus 11, ordinary month. This is the shape the sandbox must refuse to
// treat as one of ours, and the shape the 51 curated fixtures used to have.
const ekteform = (() => {
  const syntetisk = lagSyntetiskFoedselsnummer("1987-03-30");
  // Same date without the +80, control digits recomputed by brute force.
  for (let individ = 0; individ < 500; individ += 1) {
    for (let k1 = 0; k1 < 10; k1 += 1) {
      for (let k2 = 0; k2 < 10; k2 += 1) {
        const kandidat = `3003${syntetisk.slice(4, 6)}${String(individ).padStart(3, "0")}${k1}${k2}`;
        if (isGyldigFoedselsnummer(kandidat)) return kandidat;
      }
    }
  }
  return null;
})();
check("fant et gyldig nummer med vanlig maaned", ekteform !== null);
if (ekteform) {
  check("nummer med vanlig maaned er gyldig", isGyldigFoedselsnummer(ekteform), ekteform);
  check("nummer med vanlig maaned er IKKE syntetisk", !isSyntetiskFoedselsnummer(ekteform), ekteform);
  check("nummer med vanlig maaned leses som foedselsnummer", lesFoedselsnummer(ekteform)?.type === "foedselsnummer");
}

// The old curated pattern: personId encoded in the tail, no +80, wrong digits.
check("det gamle kuraterte moensteret avvises", !isGyldigFoedselsnummer("12018890001"));
check("det gamle kuraterte moensteret er ikke syntetisk", !isSyntetiskFoedselsnummer("12018890001"));

// --- D-numbers -------------------------------------------------------------
// No D-number exists in the seed, so this branch has no other cover. The day
// carries +40 and the month still carries +80 for a synthetic one.
const dnummer = (() => {
  for (let individ = 500; individ < 1000; individ += 1) {
    for (let k1 = 0; k1 < 10; k1 += 1) {
      for (let k2 = 0; k2 < 10; k2 += 1) {
        const kandidat = `55${11 + SYNTETISK_MAANEDSPAALEGG}24${String(individ).padStart(3, "0")}${k1}${k2}`;
        if (kandidat.length === 11 && isGyldigFoedselsnummer(kandidat)) return kandidat;
      }
    }
  }
  return null;
})();
check("fant et gyldig syntetisk d-nummer", dnummer !== null, String(dnummer));
if (dnummer) {
  const deler = lesFoedselsnummer(dnummer);
  check("d-nummer kan leses", deler !== null);
  check("d-nummer gjenkjennes som d-nummer", deler?.type === "dNummer");
  check("d-nummerets dag er 15", deler?.dag === 15, String(deler?.dag));
  check("d-nummerets maaned er 11", deler?.maaned === 11, String(deler?.maaned));
  check("d-nummer er syntetisk", isSyntetiskFoedselsnummer(dnummer));
  check("d-nummer stemmer med 2024-11-15", stemmerMedFoedselsdato(dnummer, "2024-11-15"));
}

// --- date comparison ------------------------------------------------------
check("feil dag avvises", !stemmerMedFoedselsdato(gyldig, "1987-03-29"));
check("feil maaned avvises", !stemmerMedFoedselsdato(gyldig, "1987-04-30"));
check("feil aar avvises", !stemmerMedFoedselsdato(gyldig, "1988-03-30"));
check("feil datoformat avvises", !stemmerMedFoedselsdato(gyldig, "30.03.1987"));

// --- the whole seed --------------------------------------------------------
// Cheap, and it means this file fails loudly if the population is regenerated
// with an invalid number even before pnpm test runs.
const { readFile } = await import("node:fs/promises");
const personer = JSON.parse(await readFile("data/personer.json", "utf8"));
const ugyldige = personer.filter((p: any) => !isSyntetiskFoedselsnummer(p.syntetiskFodselsnummer));
check(
  `alle ${personer.length} personer har syntetisk, gyldig fnr`,
  ugyldige.length === 0,
  ugyldige.slice(0, 5).map((p: any) => `${p.personId}=${p.syntetiskFodselsnummer}`).join(", ")
);
// The date inside the identifier is NOT required to equal `foedselsdato`. Real
// Folkeregisteret allows the two to differ — a corrected birth date keeps the
// original number — and Tenor ships two such people (person-055 and person-160,
// both off by a few days). What is required is that we never *generate* a
// mismatch, so the rule applies to the curated fixtures, which are the only
// numbers this repo produces.
const kuratert = JSON.parse(await readFile("data/kuratert.json", "utf8"));
const kuraterteIder = new Set(kuratert.personer.map((p: any) => p.personId));
const stemmerIkke = personer
  .filter((p: any) => kuraterteIder.has(p.personId))
  .filter((p: any) => !stemmerMedFoedselsdato(p.syntetiskFodselsnummer, p.foedselsdato));
check(
  `alle ${kuraterteIder.size} genererte fnr stemmer med foedselsdato`,
  stemmerIkke.length === 0,
  stemmerIkke.slice(0, 5).map((p: any) => `${p.personId}=${p.syntetiskFodselsnummer}/${p.foedselsdato}`).join(", ")
);
// Every remaining mismatch must come from Tenor, never from us. The count is
// informational and printed, because it grows with each new extract; that a
// generated number is never among them is the actual invariant.
const avvik = personer.filter((p: any) => !stemmerMedFoedselsdato(p.syntetiskFodselsnummer, p.foedselsdato));
check(
  "hvert dato-avvik er en Tenor-person, ingen genererte",
  avvik.every((p: any) => p.kilde === "tenor"),
  avvik.filter((p: any) => p.kilde !== "tenor").map((p: any) => p.personId).join(", ")
);
console.log(
  `  merk: ${avvik.length} Tenor-personer har et fnr som beskriver en annen dato enn ` +
  `foedselsdato (${avvik.map((p: any) => p.personId).join(", ")}). Det er lovlig i ` +
  `Folkeregisteret og kommer fra kilden.`
);

// --- report ----------------------------------------------------------------
if (feil.length > 0) {
  console.error(`test-foedselsnummer: ${feil.length} av ${bestatt + feil.length} sjekker feilet.`);
  for (const linje of feil) console.error(`  - ${linje}`);
  process.exit(1);
}
console.log(`test-foedselsnummer ok. ${bestatt} sjekker, uten stack og uten modell.`);
