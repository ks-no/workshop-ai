/*
 * Unit tests for the vedtak in apps/sandbox-backend/src/vilkaar.ts.
 *
 * These need neither the stack, nor a port, nor a model: vilkaar.ts is pure and
 * takes the income basis as a parameter, so every outcome can be pinned with a
 * literal tilstand object. Importing it costs two Node builtins and no crypto —
 * regler.ts, the I/O half, builds a 2048-bit RSA keypair at module load, and this
 * file deliberately never touches it.
 *
 * What this covers that nothing else can:
 *
 *  1. Ordning shapes with only ONE bound. Every ordning in data/satser.json sets
 *     both bounds or neither, so the seed cannot reach these paths — and that is
 *     exactly why the gate's old hand-written mirror could disagree with the rule
 *     for years without anyone noticing. It counted 11 plasser where the rule
 *     counted 4. Fixtures, not seed data, are the only way to hold that line.
 *  2. TJENESTEBEHOV's rejection branches. The seed reaches two of them; the other
 *     two are dead as far as any other test knows.
 *  3. `forbehold` — the UTKAST caveat. The contract dump never sees it: every
 *     household it touches has an OPPGJOER income year, so the concatenation
 *     `...for ${ordning.navn}.${forbehold}`, where forbehold supplies its own
 *     leading space, is invisible there. Someone "fixing" that missing space would
 *     break every UTKAST message silently.
 *
 * Assertions are on `godkjent` and on the counted plasser. Where a message is
 * asserted it is because the message IS the contract for that branch.
 */

import { plasserSomKvalifiserer, regelKreverInntekt, vurderVilkaar } from "../apps/sandbox-backend/src/vilkaar.ts";

let bestatt = 0;
const feil = [];

function sjekk(navn, betingelse, detalj = "") {
  if (betingelse) {
    bestatt += 1;
    return;
  }
  feil.push(`${navn}${detalj ? ` — ${detalj}` : ""}`);
}

// --- fixtures ---------------------------------------------------------------
// One household, one foresatt, three children aged 1, 5 and 9 at the rates' date.
// Ages are stated as birthdates so alderVed is exercised, not bypassed.
const GJELDER_FRA = "2026-08-01";

const satser = {
  gjelderFra: GJELDER_FRA,
  kilde: "test-vilkaar",
  maksAndelAvInntekt: 0.06,
  maanederMedBetaling: 11,
  ordninger: []
};

function tilstandMed({ barnehageplasser = [], sfoplasser = [], fritidsdeltakelse = [], tjenestetilbud = [], person = {} } = {}) {
  return {
    personer: [
      { personId: "p-voksen", foedselsdato: "1990-03-15", bostedsadresse: { kommunenummer: "4601", kommune: "Bergen" }, ...person },
      { personId: "p-barn-1", foedselsdato: "2025-01-10" },
      { personId: "p-barn-5", foedselsdato: "2021-01-10" },
      { personId: "p-barn-9", foedselsdato: "2017-01-10" }
    ],
    husstander: [
      {
        husstandId: "h-1",
        medlemmer: [
          { personId: "p-voksen", rolle: "foresatt" },
          { personId: "p-barn-1", rolle: "barn" },
          { personId: "p-barn-5", rolle: "barn" },
          { personId: "p-barn-9", rolle: "barn" }
        ]
      }
    ],
    satser,
    barnehageplasser,
    sfoplasser,
    fritidsdeltakelse,
    tjenestetilbud
  };
}

// husstandId must resolve from the person, so give every person the household.
function medHusstand(tilstand) {
  for (const p of tilstand.personer) p.husstandId = "h-1";
  return tilstand;
}

const SFO_PLASSER = [
  { personId: "p-barn-5", manedspris: 3000, trinn: 0 },
  { personId: "p-barn-9", manedspris: 3000, trinn: 4 }
];
const BHG_PLASSER = [
  { personId: "p-barn-1", manedspris: 3000 },
  { personId: "p-barn-5", manedspris: 3000 }
];

function tellPlasser(ordning, plasser) {
  const tilstand = medHusstand(tilstandMed(plasser));
  return plasserSomKvalifiserer(tilstand, "p-voksen", ordning, satser).length;
}

// --- 1. Single-bound ordning shapes -----------------------------------------
// The rule treats a missing bound as unbounded. The gate's old mirror closed it
// (trinnTil ?? trinnFra) and ignored a trinnTil with no trinnFra entirely. These
// six assertions are the whole reason this file exists.
sjekk(
  "trinnTil alene: alt til og med 4. trinn kvalifiserer",
  tellPlasser({ tjeneste: "sfo", regel: "INNTEKTSGRENSE", trinnTil: 4 }, { sfoplasser: SFO_PLASSER }) === 2,
  `fikk ${tellPlasser({ tjeneste: "sfo", regel: "INNTEKTSGRENSE", trinnTil: 4 }, { sfoplasser: SFO_PLASSER })}`
);
sjekk(
  "trinnTil alene ekskluderer over grensen",
  tellPlasser({ tjeneste: "sfo", regel: "INNTEKTSGRENSE", trinnTil: 0 }, { sfoplasser: SFO_PLASSER }) === 1
);
sjekk(
  "trinnFra alene: ingen øvre grense",
  tellPlasser({ tjeneste: "sfo", regel: "INNTEKTSGRENSE", trinnFra: 1 }, { sfoplasser: SFO_PLASSER }) === 1
);
sjekk(
  "alderTilAar alene: alt til og med 5 år kvalifiserer",
  tellPlasser({ tjeneste: "barnehage", regel: "INNTEKTSGRENSE", alderTilAar: 5 }, { barnehageplasser: BHG_PLASSER }) === 2
);
sjekk(
  "alderTilAar alene ekskluderer over grensen",
  tellPlasser({ tjeneste: "barnehage", regel: "INNTEKTSGRENSE", alderTilAar: 2 }, { barnehageplasser: BHG_PLASSER }) === 1
);
sjekk(
  "alderFraAar alene: ingen øvre grense",
  tellPlasser({ tjeneste: "barnehage", regel: "INNTEKTSGRENSE", alderFraAar: 2 }, { barnehageplasser: BHG_PLASSER }) === 1
);
sjekk(
  "ingen grenser: alle plasser i husstanden kvalifiserer",
  tellPlasser({ tjeneste: "sfo", regel: "INNTEKTSGRENSE" }, { sfoplasser: SFO_PLASSER }) === 2
);
sjekk(
  "en plass som ikke tilhører et barn i husstanden teller ikke",
  tellPlasser({ tjeneste: "sfo", regel: "INNTEKTSGRENSE" }, { sfoplasser: [{ personId: "p-fremmed", manedspris: 3000, trinn: 1 }] }) === 0
);

// --- 2. INNTEKTSGRENSE ------------------------------------------------------
const ORDNING_INNTEKT = {
  id: "test-inntektsgrense",
  navn: "Testordning",
  tjeneste: "sfo",
  regel: "INNTEKTSGRENSE",
  inntektsgrense: 500000,
  trinnFra: 0,
  trinnTil: 4
};

function vurder(ordning, grunnlag, opts = {}) {
  const tilstand = medHusstand(tilstandMed(opts.plasser ?? { sfoplasser: SFO_PLASSER }));
  return vurderVilkaar(ordning.regel, {
    tilstand,
    personId: opts.personId ?? "p-voksen",
    ordning,
    satser,
    grunnlag,
    felles: {},
    forbehold: opts.forbehold ?? ""
  });
}

sjekk("under grensen innvilges", vurder(ORDNING_INNTEKT, 499999).godkjent === true);
sjekk("over grensen avslås", vurder(ORDNING_INNTEKT, 500001).godkjent === false);
// The boundary is strict: grunnlag < grense. Equal means over.
sjekk("på grensen avslås — sammenligningen er streng", vurder(ORDNING_INNTEKT, 500000).godkjent === false);
sjekk(
  "ingen kvalifiserende plass gir avslag, ikke null",
  vurder(ORDNING_INNTEKT, 1, { plasser: { sfoplasser: [] } }).godkjent === false
);
sjekk(
  "ingen kvalifiserende plass forklares som nettopp det",
  vurder(ORDNING_INNTEKT, 1, { plasser: { sfoplasser: [] } }).melding.startsWith("Fant ingen SFO-plass")
);

// --- 3. forbehold: the UTKAST caveat the contract dump never reaches --------
const UTKAST = " Merk at skatteoppgjøret ikke er ferdig, så grunnlaget kan endre seg.";
const medForbehold = vurder(ORDNING_INNTEKT, 499999, { forbehold: UTKAST });
sjekk("forbeholdet henges på meldingen", medForbehold.melding.endsWith(UTKAST));
// The template is `...for ${ordning.navn}.${forbehold}` with no separator, so
// forbehold must supply its own leading space. Assert the join, not just the tail.
sjekk(
  "forbeholdet får akkurat ett mellomrom mot punktumet",
  medForbehold.melding.includes("Testordning. Merk at skatteoppgjøret"),
  medForbehold.melding
);
sjekk("uten forbehold slutter meldingen på punktum", vurder(ORDNING_INNTEKT, 499999).melding.endsWith("Testordning."));

// --- 4. MAKS_ANDEL_AV_INNTEKT ----------------------------------------------
// Two SFO places at 3000/month over 11 months = 66000. The cap is 6 % of income.
const ORDNING_ANDEL = {
  id: "test-maks-andel",
  navn: "Andelsordning",
  tjeneste: "sfo",
  regel: "MAKS_ANDEL_AV_INNTEKT",
  trinnFra: 0,
  trinnTil: 4
};
sjekk("full pris over taket gir rett til redusert betaling", vurder(ORDNING_ANDEL, 1000000).godkjent === true);
sjekk("full pris under taket gir ikke rett", vurder(ORDNING_ANDEL, 1200000).godkjent === false);
sjekk("prosenten rendres som heltall med mellomrom", vurder(ORDNING_ANDEL, 1000000).melding.includes("6 %"));
sjekk(
  "aarspris havner i grunnlaget",
  vurder(ORDNING_ANDEL, 1000000).grunnlag.aarspris === 66000,
  String(vurder(ORDNING_ANDEL, 1000000).grunnlag.aarspris)
);

// --- 5. TJENESTEBEHOV: all four outcomes -----------------------------------
const ORDNING_BEHOV = {
  id: "test-tjenestebehov",
  navn: "Støttekontakt",
  tjeneste: "stottekontakt",
  regel: "TJENESTEBEHOV",
  tilbudsdatasett: "tjenestetilbud"
};

function vurderBehov(tjenestetilbud, person = {}) {
  const tilstand = medHusstand(tilstandMed({ tjenestetilbud, person }));
  return vurderVilkaar("TJENESTEBEHOV", {
    tilstand,
    personId: "p-voksen",
    ordning: ORDNING_BEHOV,
    satser,
    grunnlag: null,
    felles: {},
    forbehold: ""
  });
}

const TILBUD = { tilbudId: "t-1", navn: "Bergen støttekontakt", tjeneste: "stottekontakt", kommunenummer: "4601", malgruppeFraAar: 18, malgruppeTilAar: 67, ledigePlasser: 2 };

sjekk("innvilget når tilbudet passer og har ledig plass", vurderBehov([TILBUD]).godkjent === true);
sjekk("ledigePlasser havner i grunnlaget", vurderBehov([TILBUD]).grunnlag.ledigePlasser === 2);
sjekk(
  "ingen tilbud i kommunen",
  vurderBehov([{ ...TILBUD, kommunenummer: "0301" }]).melding.includes("har ikke registrert et tilbud")
);
sjekk(
  "utenfor målgruppen nevner søkerens alder",
  vurderBehov([{ ...TILBUD, malgruppeFraAar: 70, malgruppeTilAar: 80 }]).melding.includes("Søkeren er 36 år"),
  vurderBehov([{ ...TILBUD, malgruppeFraAar: 70, malgruppeTilAar: 80 }]).melding
);
sjekk(
  "passer men ingen ledige plasser",
  vurderBehov([{ ...TILBUD, ledigePlasser: 0 }]).melding.includes("ingen ledige plasser")
);
sjekk("ingen ledige plasser er et avslag", vurderBehov([{ ...TILBUD, ledigePlasser: 0 }]).godkjent === false);
sjekk(
  "manglende fødselsdato avvises, ikke antas",
  vurderBehov([TILBUD], { foedselsdato: undefined }).melding === "Fant ikke fødselsdato for søkeren."
);

// --- 6. The interface's own contract ---------------------------------------
sjekk("regelKreverInntekt dekker alle tre regeltypene", Object.keys(regelKreverInntekt).length === 3);
sjekk("TJENESTEBEHOV krever ikke inntekt", regelKreverInntekt.TJENESTEBEHOV === false);
sjekk("INNTEKTSGRENSE krever inntekt", regelKreverInntekt.INNTEKTSGRENSE === true);
sjekk("MAKS_ANDEL_AV_INNTEKT krever inntekt", regelKreverInntekt.MAKS_ANDEL_AV_INNTEKT === true);

// An unknown regeltype must throw rather than silently pass. `regel` arrives from
// JSON, so the type system cannot be the guard here.
let kastet = false;
try {
  vurderVilkaar("FINNES_IKKE", { tilstand: medHusstand(tilstandMed()), personId: "p-voksen", ordning: ORDNING_INNTEKT, satser, grunnlag: 1, felles: {}, forbehold: "" });
} catch (error) {
  kastet = error.message.startsWith("Ukjent regeltype: FINNES_IKKE. Gyldige: ");
}
sjekk("ukjent regeltype kaster med de gyldige listet opp", kastet);

// --- report ----------------------------------------------------------------
if (feil.length > 0) {
  console.error(`test-vilkaar: ${feil.length} av ${bestatt + feil.length} sjekker feilet.`);
  for (const linje of feil) console.error(`  - ${linje}`);
  process.exit(1);
}
console.log(`test-vilkaar ok. ${bestatt} sjekker, uten stack og uten modell.`);
