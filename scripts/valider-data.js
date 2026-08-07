import { readFile } from "node:fs/promises";

// Only seed data. Runtime datasets live in state/, are gitignored, and are
// created by the services on first write.
const filer = [
  "data/personer.json",
  "data/husstander.json",
  "data/inntekter.json",
  "data/barnehageplasser.json",
  "data/sfoplasser.json",
  "data/satser.json",
  "data/prosessdefinisjoner.json",
  "data/informasjonsmodeller.json",
  "data/matrikkel.seed.json"
];

async function les(fil) {
  return JSON.parse(await readFile(fil, "utf8"));
}

for (const fil of filer) {
  await les(fil);
}

const personer = await les("data/personer.json");
const husstander = await les("data/husstander.json");
const inntekter = await les("data/inntekter.json");
const satser = await les("data/satser.json");

if (personer.length < 20) {
  throw new Error("Det må finnes minst 20 personer.");
}

// --- Relations must hold together ------------------------------------------
const personIder = new Set(personer.map((p) => p.personId));
const husstandIder = new Set(husstander.map((h) => h.husstandId));

for (const person of personer) {
  if (!husstandIder.has(person.husstandId)) {
    throw new Error(`${person.personId} peker på ukjent husstand ${person.husstandId}.`);
  }
  for (const relasjon of person.foreldrebarnrelasjon || []) {
    if (!personIder.has(relasjon.relatertPersonId)) {
      throw new Error(`${person.personId} har relasjon til ukjent person ${relasjon.relatertPersonId}.`);
    }
  }
}

for (const husstand of husstander) {
  for (const medlem of husstand.medlemmer) {
    if (!personIder.has(medlem.personId)) {
      throw new Error(`${husstand.husstandId} har ukjent medlem ${medlem.personId}.`);
    }
  }
}

const identer = new Set(personer.map((p) => p.syntetiskFodselsnummer));
for (const rad of inntekter) {
  if (!identer.has(rad.identifikator)) {
    throw new Error(`Inntektsrad peker på ukjent identifikator ${rad.identifikator}.`);
  }
}

// --- Scenario coverage -----------------------------------------------------
// Without this test the variation rots away on the next data change: adjusting one
// person's income can remove the only case on one side of a threshold, and then
// every demo produces the same outcome again.
function husstandsgrunnlag(husstand) {
  let sum = 0;
  for (const medlem of husstand.medlemmer) {
    if (medlem.rolle !== "foresatt") continue;
    const person = personer.find((p) => p.personId === medlem.personId);
    const rader = inntekter.filter((i) => i.identifikator === person.syntetiskFodselsnummer);
    if (rader.length === 0) return null;
    const nyeste = rader.reduce((a, b) => (b.inntektsaar > a.inntektsaar ? b : a));
    sum += nyeste.poster.filter((p) => p.medregnes).reduce((t, p) => t + p.beloep, 0);
  }
  return sum;
}

const grunnlag = husstander.map(husstandsgrunnlag).filter((v) => v !== null);

for (const ordning of satser.ordninger) {
  if (ordning.regel !== "INNTEKTSGRENSE") continue;
  const under = grunnlag.filter((v) => v < ordning.inntektsgrense).length;
  const over = grunnlag.filter((v) => v >= ordning.inntektsgrense).length;
  if (under === 0 || over === 0) {
    throw new Error(
      `Mangler scenariodekning for ${ordning.id}: ${under} husstander under og ${over} over grensen på ${ordning.inntektsgrense}. Begge sider må finnes.`
    );
  }
}

// --- Target group coverage -------------------------------------------------
// The ordninger scope themselves by age (barnehage) or school year (SFO). Without
// this test an ordning can become impossible to grant because no husstand has a
// child in the target group — and then the rule looks like it works while it only
// ever says no.
const barnehageplasser = await les("data/barnehageplasser.json");
const sfoplasser = await les("data/sfoplasser.json");
const plasserPerTjeneste = { barnehage: barnehageplasser, sfo: sfoplasser };

function alderVed(foedselsdato, referansedato) {
  const foedt = new Date(foedselsdato);
  const referanse = new Date(referansedato);
  const alder = referanse.getFullYear() - foedt.getFullYear();
  const foerBursdag =
    referanse.getMonth() < foedt.getMonth() ||
    (referanse.getMonth() === foedt.getMonth() && referanse.getDate() < foedt.getDate());
  return foerBursdag ? alder - 1 : alder;
}

function kvalifiserer(plass, ordning) {
  if (ordning.trinnFra !== undefined) {
    const til = ordning.trinnTil ?? ordning.trinnFra;
    if (typeof plass.trinn !== "number" || plass.trinn < ordning.trinnFra || plass.trinn > til) {
      return false;
    }
  }
  if (ordning.alderFraAar !== undefined) {
    const til = ordning.alderTilAar ?? ordning.alderFraAar;
    const barn = personer.find((p) => p.personId === plass.personId);
    if (!barn?.foedselsdato) return false;
    const alder = alderVed(barn.foedselsdato, satser.gjelderFra);
    if (alder < ordning.alderFraAar || alder > til) return false;
  }
  return true;
}

for (const ordning of satser.ordninger) {
  const treff = (plasserPerTjeneste[ordning.tjeneste] || []).filter((plass) => kvalifiserer(plass, ordning));
  if (treff.length === 0) {
    throw new Error(
      `Ingen ${ordning.tjeneste}-plass i dataene er i målgruppen for ${ordning.id}. ` +
      `Ordningen kan da aldri innvilges. Juster data/${ordning.tjeneste}plasser.json eller ordningen i data/satser.json.`
    );
  }
}

// The edge cases from the Fiks model must exist in the data.
if (!inntekter.some((r) => r.stadie === "UTKAST")) {
  throw new Error("Mangler minst én inntektsrad med stadie UTKAST.");
}
if (!personer.some((p) => p.skjermet)) {
  throw new Error("Mangler minst én person med skjermet identitet.");
}
if (husstander.every(husstandsgrunnlag)) {
  throw new Error("Mangler minst én husstand uten inntektsopplysninger.");
}

console.log(
  `Validering ok. ${personer.length} personer, ${husstander.length} husstander, ` +
  `${satser.ordninger.length} ordninger, scenariodekning på alle inntektsgrenser ` +
  `og målgruppedekning på alle ordninger.`
);
