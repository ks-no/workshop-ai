/*
 * Unit tests for apps/shared/handleevne.ts.
 *
 * Pure functions, no stack, no port, no model - the same reason test-vilkaar.js
 * exists: an outcome can be pinned with a literal tilstand object.
 *
 * What this covers that nothing else can:
 *
 *  1. The order of the refusals. A dead two-year-old is refused for being dead,
 *     not for being two, and the message has to say so. Only fixtures reach the
 *     combinations - the seed has no dead minor with a living parent.
 *  2. foreldreansvar narrowing the representative set. `felles` means both
 *     parents; named to one it belongs to that one, and a father without parental
 *     responsibility is not a representative however present he is. The seed has
 *     218 `felles` and only 32 named, so the narrowing path is thin there.
 *  3. A dead parent is still the parent but cannot be the sender. The seed has
 *     exactly one such family (person-372), and its child is an adult.
 */

import {
  vurderHandleevne,
  kanHaEid,
  kanOpptreSelv,
  finnRepresentanter,
  representantPider,
  forklarHandleevne,
  ALDER_EID,
  ALDER_MYNDIG
} from "../apps/shared/handleevne.ts";

const REF = "2026-08-01";

let bestatt = 0;
const feil: string[] = [];

function check(navn: string, betingelse: unknown, detalj = ""): void {
  if (betingelse) {
    bestatt += 1;
    return;
  }
  feil.push(`${navn}${detalj ? ` - ${detalj}` : ""}`);
}

const person = (over: Record<string, unknown>) => ({
  personId: "p",
  foedselsdato: "1990-01-01",
  personstatus: "BOSATT",
  foreldrebarnrelasjon: [],
  foreldreansvar: null,
  syntetiskFodselsnummer: "00000000000",
  ...over
});

// --- the two thresholds ----------------------------------------------------
check("terskelen for eID er 13", ALDER_EID === 13);
check("terskelen for myndighet er 18", ALDER_MYNDIG === 18);

const treAar = person({ foedselsdato: "2023-06-01" });
const tolvAar = person({ foedselsdato: "2013-09-01" });   // 12 ved 2026-08-01
const trettenAar = person({ foedselsdato: "2013-06-01" }); // 13 ved 2026-08-01
const syttenAar = person({ foedselsdato: "2008-09-01" });  // 17 ved 2026-08-01
const attenAar = person({ foedselsdato: "2008-06-01" });   // 18 ved 2026-08-01

check("3 år kan ikke ha eID", !kanHaEid(treAar, REF));
check("3 år kan ikke opptre selv", !kanOpptreSelv(treAar, REF));
check("3 år gir grunn for_ung_for_eid", vurderHandleevne(treAar, REF).grunn === "for_ung_for_eid");
check("12 år kan ikke ha eID", !kanHaEid(tolvAar, REF), String(vurderHandleevne(tolvAar, REF).alder));
check("13 år kan ha eID", kanHaEid(trettenAar, REF), String(vurderHandleevne(trettenAar, REF).alder));
check("13 år kan ikke opptre selv", !kanOpptreSelv(trettenAar, REF));
check("13 år gir grunn mindreaarig", vurderHandleevne(trettenAar, REF).grunn === "mindreaarig");
check("17 år kan ha eID", kanHaEid(syttenAar, REF));
check("17 år kan ikke opptre selv", !kanOpptreSelv(syttenAar, REF));
check("18 år kan opptre selv", kanOpptreSelv(attenAar, REF), String(vurderHandleevne(attenAar, REF).alder));
check("18 år gir grunn kan_opptre_selv", vurderHandleevne(attenAar, REF).grunn === "kan_opptre_selv");

// --- death outranks age ----------------------------------------------------
const doedToAaring = person({ foedselsdato: "2024-06-01", personstatus: "DOED" });
check("død toåring avvises som død, ikke som for ung",
  vurderHandleevne(doedToAaring, REF).grunn === "doed");
check("død voksen kan ikke opptre selv",
  !kanOpptreSelv(person({ personstatus: "DOED" }), REF));
check("død voksen kan ikke ha eID", !kanHaEid(person({ personstatus: "DOED" }), REF));
check("forklaringen for død nevner død",
  forklarHandleevne(vurderHandleevne(doedToAaring, REF), []).includes("død"));

for (const status of ["UTFLYTTET", "INAKTIV", "MIDLERTIDIG"]) {
  const p = person({ personstatus: status });
  check(`${status} kan ikke opptre selv`, !kanOpptreSelv(p, REF));
  check(`${status} gir grunn ikke_bosatt`, vurderHandleevne(p, REF).grunn === "ikke_bosatt");
}

check("ukjent person avvises", vurderHandleevne(null, REF).grunn === "ukjent_person");
check("person uten fødselsdato avvises",
  vurderHandleevne(person({ foedselsdato: null }), REF).grunn === "ukjent_person");

// --- representatives -------------------------------------------------------
const mor = person({ personId: "mor", foedselsdato: "1985-01-01", syntetiskFodselsnummer: "11111111111" });
const far = person({ personId: "far", foedselsdato: "1983-01-01", syntetiskFodselsnummer: "22222222222" });
const barn = (ansvar: unknown) => person({
  personId: "barn",
  foedselsdato: "2020-01-01",
  foreldreansvar: ansvar,
  foreldrebarnrelasjon: [
    { relatertPersonId: "mor", relasjon: "MOR" },
    { relatertPersonId: "far", relasjon: "FAR" }
  ],
  syntetiskFodselsnummer: "33333333333"
});

const medFelles = { personer: [mor, far, barn("felles")] };
const representanterFelles = finnRepresentanter(medFelles, "barn", REF);
check("felles foreldreansvar gir to representanter", representanterFelles.length === 2,
  JSON.stringify(representanterFelles));
check("pid-ene er foreldrenes",
  JSON.stringify(representantPider(medFelles, "barn", REF).sort()) ===
  JSON.stringify(["11111111111", "22222222222"]));

const medMor = { personer: [mor, far, barn("mor")] };
const bareMor = finnRepresentanter(medMor, "barn", REF);
check("foreldreansvar mor gir bare mor", bareMor.length === 1 && bareMor[0].personId === "mor",
  JSON.stringify(bareMor));

const medFar = { personer: [mor, far, barn("far")] };
const bareFar = finnRepresentanter(medFar, "barn", REF);
check("foreldreansvar far gir bare far", bareFar.length === 1 && bareFar[0].personId === "far",
  JSON.stringify(bareFar));

// A dead parent is still the parent - the relation stands - but cannot be sender.
const doedMor = { ...mor, personstatus: "DOED" };
const medDoedMor = { personer: [doedMor, far, barn("felles")] };
const etterDoedsfall = finnRepresentanter(medDoedMor, "barn", REF);
check("død forelder er ikke representant",
  etterDoedsfall.length === 1 && etterDoedsfall[0].personId === "far",
  JSON.stringify(etterDoedsfall));

// A minor parent cannot represent either.
const ungMor = { ...mor, foedselsdato: "2012-01-01" };
check("mindreårig forelder er ikke representant",
  finnRepresentanter({ personer: [ungMor, far, barn("mor")] }, "barn", REF).length === 0);

check("en voksen uten foreldre har ingen representanter",
  finnRepresentanter({ personer: [mor] }, "mor", REF).length === 0);
check("ukjent personId gir ingen representanter",
  finnRepresentanter(medFelles, "finnes-ikke", REF).length === 0);

// The 403 has to name a way forward, not just a refusal.
const forklaring = forklarHandleevne(vurderHandleevne(barn("felles"), REF), representanterFelles);
check("forklaringen navngir representantene", forklaring.includes("mor") && forklaring.includes("far"),
  forklaring);
check("forklaringen sier hvorfor", forklaring.includes(String(ALDER_EID)), forklaring);
check("forklaringen uten representanter sier at ingen finnes",
  forklarHandleevne(vurderHandleevne(barn("felles"), REF), []).includes("Ingen registrert"));

// --- against the real seed -------------------------------------------------
const { readFile } = await import("node:fs/promises");
const personer = JSON.parse(await readFile("data/personer.json", "utf8"));
const satser = JSON.parse(await readFile("data/satser.json", "utf8"));
const register = { personer };

const mindreaarige = personer.filter(
  (p: any) => p.personstatus === "BOSATT" && !kanOpptreSelv(p, satser.gjelderFra)
);
const utenRepresentant = mindreaarige.filter(
  (p: any) => finnRepresentanter(register, p.personId, satser.gjelderFra).length === 0
);
check(
  `alle ${mindreaarige.length} mindreårige har minst én levende representant`,
  utenRepresentant.length === 0,
  utenRepresentant.slice(0, 5).map((p: any) => p.personId).join(", ")
);
const utenEid = personer.filter((p: any) => !kanHaEid(p, satser.gjelderFra));
check(
  "det finnes personer uten eID, så sperren har noe å nekte",
  utenEid.length > 0,
  String(utenEid.length)
);
const kanLoggeInn = personer.filter((p: any) => kanHaEid(p, satser.gjelderFra));
check(
  "og noen kan logge inn",
  kanLoggeInn.length > 100,
  String(kanLoggeInn.length)
);
console.log(
  `  merk: ${kanLoggeInn.length} av ${personer.length} kan ha eID. ` +
  `${mindreaarige.length} er mindreårige og kan bare være part, ` +
  `${utenEid.length} kan ikke logge inn i det hele tatt.`
);

// --- report ----------------------------------------------------------------
if (feil.length > 0) {
  console.error(`test-handleevne: ${feil.length} av ${bestatt + feil.length} sjekker feilet.`);
  for (const linje of feil) console.error(`  - ${linje}`);
  process.exit(1);
}
console.log(`test-handleevne ok. ${bestatt} sjekker, uten stack og uten modell.`);
