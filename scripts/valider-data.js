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
  "data/matrikkel.seed.json",
  "data/matrikkel.json",
  "data/forventet-utfall.json"
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

// --- Cross coverage: the intersection, not the two sides separately ---------
// The checks above ask two separate questions: does every threshold have
// households on both sides, and does every ordning have some child in its target
// group. Neither notices when those two sets never overlap — a household can be
// under the SFO threshold while its only child is in barnehage. Five scenario
// texts described themselves wrongly for exactly that reason, and four of six
// ordninger could only ever produce one outcome.
function plasserIMaalgruppe(husstand, ordning) {
  const barn = new Set(
    husstand.medlemmer.filter((m) => m.rolle === "barn").map((m) => m.personId)
  );
  return (plasserPerTjeneste[ordning.tjeneste] || [])
    .filter((plass) => barn.has(plass.personId) && kvalifiserer(plass, ordning));
}

// Mirrors regelHandtere in apps/sandbox-backend/src/regler.ts. Returns null when
// the ordning cannot be assessed at all for this husstand.
function vurder(husstand, ordning) {
  const plasser = plasserIMaalgruppe(husstand, ordning);
  if (plasser.length === 0) return null;
  const g = husstandsgrunnlag(husstand);
  if (g === null) return null;
  if (ordning.regel === "INNTEKTSGRENSE") return g < ordning.inntektsgrense;
  const aarspris = plasser.reduce((s, p) => s + p.manedspris, 0) * satser.maanederMedBetaling;
  return aarspris > satser.maksAndelAvInntekt * g;
}

for (const ordning of satser.ordninger) {
  const utfall = husstander
    .map((h) => ({ id: h.husstandId, godkjent: vurder(h, ordning) }))
    .filter((r) => r.godkjent !== null);
  const ja = utfall.filter((r) => r.godkjent);
  const nei = utfall.filter((r) => !r.godkjent);
  if (ja.length === 0 || nei.length === 0) {
    throw new Error(
      `${ordning.id} kan bare gi ett utfall: ${ja.length} husstander innvilget og ` +
      `${nei.length} avslått, blant husstander som faktisk har barn i målgruppen. ` +
      `Begge utfall må finnes, ellers ser regelen ut til å virke mens den alltid svarer likt.`
    );
  }
}

// --- Pinned outcomes --------------------------------------------------------
// forventetUtfall records what each husstand is supposed to demonstrate. Pinning
// it means a changed income or a moved trinn breaks the build here, instead of
// silently turning a case into something the scenario text no longer describes.
const pinnet = await les("data/forventet-utfall.json");
const pinnetPerHusstand = new Map(pinnet.husstander.map((r) => [r.husstandId, r.utfall]));

for (const husstand of husstander) {
  const forventet = pinnetPerHusstand.get(husstand.husstandId) || [];
  for (const rad of forventet) {
    const ordning = satser.ordninger.find((o) => o.id === rad.ordning);
    if (!ordning) {
      throw new Error(`${husstand.husstandId} forventer ukjent ordning ${rad.ordning}.`);
    }
    const faktisk = vurder(husstand, ordning);
    if (faktisk === null) {
      throw new Error(
        `${husstand.husstandId} forventer et utfall for ${rad.ordning}, men har ingen ` +
        `${ordning.tjeneste}-plass i målgruppen for den ordningen.`
      );
    }
    if (faktisk !== rad.godkjent) {
      throw new Error(
        `${husstand.husstandId}: forventet ${rad.godkjent ? "innvilget" : "avslag"} for ` +
        `${rad.ordning}, men dataene gir ${faktisk ? "innvilget" : "avslag"}.`
      );
    }
  }
  const faktiske = satser.ordninger
    .filter((o) => vurder(husstand, o) !== null)
    .map((o) => o.id);
  const utelatt = faktiske.filter((id) => !forventet.some((r) => r.ordning === id));
  if (utelatt.length > 0) {
    throw new Error(
      `${husstand.husstandId} treffer ${utelatt.join(", ")} uten at det står i ` +
      `data/forventet-utfall.json. Legg det inn, ellers er utfallet upinnet.`
    );
  }
}

// --- Scenario text must match the pinned outcomes ---------------------------
// Participants pick a husstand by its scenario text and expect a specific result.
// Longest phrase first: "gratis kjernetid 2–5 år" must win over "gratis kjernetid".
const ORDNINGSNAVN = [
  ["gratis kjernetid for 1-åringer", "gratis-kjernetid-barnehage-1"],
  ["gratis kjernetid 1 år", "gratis-kjernetid-barnehage-1"],
  ["gratis kjernetid 2–5 år", "gratis-kjernetid-barnehage-2-5"],
  ["gratis kjernetid", "gratis-kjernetid-barnehage-2-5"],
  ["gratis sfo 1. trinn", "gratis-sfo-1-trinn"],
  ["redusert sfo 2.–3. trinn", "redusert-sfo-2-3-trinn"],
  ["redusert sfo 4. trinn", "redusert-sfo-4-trinn"],
  ["sfo 4. trinn", "redusert-sfo-4-trinn"],
  ["redusert foreldrebetaling", "redusert-foreldrebetaling-barnehage"],
  ["6 %-regelen", "redusert-foreldrebetaling-barnehage"]
];

for (const husstand of husstander) {
  if (!husstand.scenario) {
    throw new Error(`${husstand.husstandId} mangler scenario-tekst.`);
  }
  let rest = husstand.scenario.toLowerCase();
  const forventet = pinnetPerHusstand.get(husstand.husstandId) || [];
  for (const [frase, ordningId] of ORDNINGSNAVN) {
    let i = rest.indexOf(frase);
    while (i !== -1) {
      const rad = forventet.find((r) => r.ordning === ordningId);
      if (!rad) {
        throw new Error(
          `${husstand.husstandId} nevner «${frase}» i scenario-teksten, men husstanden ` +
          `har ingen forventet utfall for ${ordningId} i data/forventet-utfall.json. ` +
          `Enten er teksten feil, eller så ` +
          `mangler husstanden barn i målgruppen.`
        );
      }
      // The direction word sits just before "grensen for <ordning>". Only assert
      // when one is actually there — many texts name an ordning without claiming a side.
      const foran = rest.slice(Math.max(0, i - 40), i);
      const paastandUnder = /\bunder grensen for $/.test(foran);
      const paastandOver = /\bover grensen for $/.test(foran);
      if ((paastandUnder || paastandOver) && paastandUnder !== rad.godkjent) {
        throw new Error(
          `${husstand.husstandId} sier «${paastandUnder ? "under" : "over"} grensen for ${frase}», ` +
          `men dataene gir ${rad.godkjent ? "innvilget" : "avslag"} for ${ordningId}.`
        );
      }
      rest = rest.slice(0, i) + " ".repeat(frase.length) + rest.slice(i + frase.length);
      i = rest.indexOf(frase);
    }
  }
}

// --- Trinn must follow age --------------------------------------------------
// A seven-year-old in fourth grade puts the household in an ordning it could
// never belong to in real life, and the target-group check happily accepts it.
for (const plass of sfoplasser) {
  const barn = personer.find((p) => p.personId === plass.personId);
  if (!barn) throw new Error(`SFO-plass peker på ukjent person ${plass.personId}.`);
  const forventetTrinn = alderVed(barn.foedselsdato, satser.gjelderFra) - 5;
  if (plass.trinn !== forventetTrinn) {
    throw new Error(
      `${plass.personId} er ${alderVed(barn.foedselsdato, satser.gjelderFra)} år ved ` +
      `${satser.gjelderFra} og skal da gå på ${forventetTrinn}. trinn, ikke ${plass.trinn}.`
    );
  }
}

// --- Every SJEKK step must point at an ordning that exists ------------------
// fritidskort-stotte fetched income for a long time without an ordning to measure
// it against. Nothing caught it, because the coverage checks only iterate over
// ordninger that exist.
const prosesskatalog = await les("data/prosessdefinisjoner.json");
const alleProsesser = [
  ...(prosesskatalog.prosesser || []),
  ...(prosesskatalog.maler || [])
];
const ordningIder = new Set(satser.ordninger.map((o) => o.id));
for (const prosess of alleProsesser) {
  for (const steg of prosess.steg || []) {
    if (steg.type !== "SJEKK") continue;
    const url = steg.api?.url || steg.ressurs || "";
    const ordning = steg.ordning || new URLSearchParams(url.split("?")[1] || "").get("ordning");
    if (!ordning || ordning.startsWith("{")) continue;
    if (!ordningIder.has(ordning)) {
      throw new Error(
        `Prosessen ${prosess.id}, steg ${steg.id}, sjekker mot ordningen ${ordning}, ` +
        `som ikke finnes i data/satser.json.`
      );
    }
  }
}

console.log(
  `Validering ok. ${personer.length} personer, ${husstander.length} husstander, ` +
  `${satser.ordninger.length} ordninger. Alle ordninger gir begge utfall blant husstander ` +
  `med barn i målgruppen, alle 18 scenariotekster stemmer med pinnede utfall, ` +
  `og trinn følger alder.`
);
