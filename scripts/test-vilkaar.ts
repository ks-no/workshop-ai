/*
 * Unit tests for the vedtak in apps/sandbox-backend/src/vilkaar.ts.
 *
 * These need neither the stack, nor a port, nor a model: vilkaar.ts is pure and
 * takes the income basis as a parameter, so every outcome can be pinned with a
 * literal tilstand object. Importing it costs two Node builtins and no crypto -
 * regler.ts, the I/O half, builds a 2048-chunk RSA keypair at module load, and this
 * file deliberately never touches it.
 *
 * What this covers that nothing else can:
 *
 *  1. Ordning shapes with only ONE bound. Every ordning in data/satser.json sets
 *     both bounds or neither, so the seed cannot reach these paths - fixtures,
 *     not seed data, are the only way to hold that line.
 *  2. TJENESTEBEHOV's rejection branches. The seed reaches two of them; the other
 *     two are dead as far as any other test knows.
 *  3. `forbehold` - the UTKAST caveat. The contract dump never sees it: every
 *     household it touches has an OPPGJOER income year, so the concatenation
 *     `...for ${ordning.navn}.${forbehold}`, where forbehold supplies its own
 *     leading space, is invisible there. Someone "fixing" that missing space would
 *     break every UTKAST message silently.
 *
 * Assertions are on `godkjent` and on the counted plasser. Where a message is
 * asserted it is because the message IS the contract for that branch.
 */

import { readFile } from "node:fs/promises";
import {
  plasserSomKvalifiserer,
  regelBehov,
  samtykkekilderFor,
  selectOrdningForTjeneste,
  evaluateVilkaar,
  VANDELSUTFALL
} from "../apps/sandbox-backend/src/vilkaar.ts";
import { feilmelding } from "../apps/shared/errors.ts";
import type { Regeltype } from "../apps/sandbox-backend/src/types.ts";
import type { Legeerklaering } from "../apps/shared/legeerklaering.ts";
import { byggAttestbevis } from "../apps/shared/politiattest.ts";
import type { Politiattest } from "../apps/shared/politiattest.ts";

let bestatt = 0;
const feil: string[] = [];

function check(navn: string, betingelse: unknown, detalj = ""): void {
  if (betingelse) {
    bestatt += 1;
    return;
  }
  feil.push(`${navn}${detalj ? ` - ${detalj}` : ""}`);
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
function medHusstand(tilstand: any) {
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

function countPlasser(ordning: any, plasser: any) {
  const tilstand = medHusstand(tilstandMed(plasser));
  return plasserSomKvalifiserer(tilstand, "p-voksen", ordning, satser).length;
}

// --- 1. Single-bound ordning shapes -----------------------------------------
// The rule treats a missing bound as unbounded. The gate's old mirror closed it
// (trinnTil ?? trinnFra) and ignored a trinnTil with no trinnFra entirely. These
// six assertions are the whole reason this file exists.
check(
  "trinnTil alene: alt til og med 4. trinn kvalifiserer",
  countPlasser({ tjeneste: "sfo", regel: "INNTEKTSGRENSE", trinnTil: 4 }, { sfoplasser: SFO_PLASSER }) === 2,
  `fikk ${countPlasser({ tjeneste: "sfo", regel: "INNTEKTSGRENSE", trinnTil: 4 }, { sfoplasser: SFO_PLASSER })}`
);
check(
  "trinnTil alene ekskluderer over grensen",
  countPlasser({ tjeneste: "sfo", regel: "INNTEKTSGRENSE", trinnTil: 0 }, { sfoplasser: SFO_PLASSER }) === 1
);
check(
  "trinnFra alene: ingen øvre grense",
  countPlasser({ tjeneste: "sfo", regel: "INNTEKTSGRENSE", trinnFra: 1 }, { sfoplasser: SFO_PLASSER }) === 1
);
check(
  "alderTilAar alene: alt til og med 5 år kvalifiserer",
  countPlasser({ tjeneste: "barnehage", regel: "INNTEKTSGRENSE", alderTilAar: 5 }, { barnehageplasser: BHG_PLASSER }) === 2
);
check(
  "alderTilAar alene ekskluderer over grensen",
  countPlasser({ tjeneste: "barnehage", regel: "INNTEKTSGRENSE", alderTilAar: 2 }, { barnehageplasser: BHG_PLASSER }) === 1
);
check(
  "alderFraAar alene: ingen øvre grense",
  countPlasser({ tjeneste: "barnehage", regel: "INNTEKTSGRENSE", alderFraAar: 2 }, { barnehageplasser: BHG_PLASSER }) === 1
);
check(
  "ingen grenser: alle plasser i husstanden kvalifiserer",
  countPlasser({ tjeneste: "sfo", regel: "INNTEKTSGRENSE" }, { sfoplasser: SFO_PLASSER }) === 2
);
check(
  "en plass som ikke tilhører et barn i husstanden teller ikke",
  countPlasser({ tjeneste: "sfo", regel: "INNTEKTSGRENSE" }, { sfoplasser: [{ personId: "p-fremmed", manedspris: 3000, trinn: 1 }] }) === 0
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

function vurder(ordning: any, grunnlag: any, opts: Record<string, any> = {}) {
  const tilstand = medHusstand(tilstandMed(opts.plasser ?? { sfoplasser: SFO_PLASSER }));
  return evaluateVilkaar(ordning.regel, {
    tilstand,
    personId: opts.personId ?? "p-voksen",
    ordning,
    satser,
    grunnlag,
    legeerklaering: opts.legeerklaering ?? null,
    politiattest: opts.politiattest ?? null,
    felles: {},
    forbehold: opts.forbehold ?? ""
  });
}

check("under grensen innvilges", vurder(ORDNING_INNTEKT, 499999).godkjent === true);
check("over grensen avslås", vurder(ORDNING_INNTEKT, 500001).godkjent === false);
// The boundary is strict: grunnlag < grense. Equal means over.
check("på grensen avslås - sammenligningen er streng", vurder(ORDNING_INNTEKT, 500000).godkjent === false);
check(
  "ingen kvalifiserende plass gir avslag, ikke null",
  vurder(ORDNING_INNTEKT, 1, { plasser: { sfoplasser: [] } }).godkjent === false
);
check(
  "ingen kvalifiserende plass forklares som nettopp det",
  vurder(ORDNING_INNTEKT, 1, { plasser: { sfoplasser: [] } }).melding.startsWith("Fant ingen SFO-plass")
);

// --- 3. forbehold: the UTKAST caveat the contract dump never reaches --------
const UTKAST = " Merk at skatteoppgjøret ikke er ferdig, så grunnlaget kan endre seg.";
const medForbehold = vurder(ORDNING_INNTEKT, 499999, { forbehold: UTKAST });
check("forbeholdet henges på meldingen", medForbehold.melding.endsWith(UTKAST));
// The template is `...for ${ordning.navn}.${forbehold}` with no separator, so
// forbehold must supply its own leading space. Assert the join, not just the tail.
check(
  "forbeholdet får akkurat ett mellomrom mot punktumet",
  medForbehold.melding.includes("Testordning. Merk at skatteoppgjøret"),
  medForbehold.melding
);
check("uten forbehold slutter meldingen på punktum", vurder(ORDNING_INNTEKT, 499999).melding.endsWith("Testordning."));

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
check("full pris over taket gir rett til redusert betaling", vurder(ORDNING_ANDEL, 1000000).godkjent === true);
check("full pris under taket gir ikke rett", vurder(ORDNING_ANDEL, 1200000).godkjent === false);
check("prosenten rendres som heltall med mellomrom", vurder(ORDNING_ANDEL, 1000000).melding.includes("6 %"));
check(
  "aarspris havner i grunnlaget",
  vurder(ORDNING_ANDEL, 1000000).grunnlag?.aarspris === 66000,
  String(vurder(ORDNING_ANDEL, 1000000).grunnlag?.aarspris)
);

// --- 5. TJENESTEBEHOV: all four outcomes -----------------------------------
const ORDNING_BEHOV = {
  id: "test-tjenestebehov",
  navn: "Støttekontakt",
  tjeneste: "stottekontakt",
  regel: "TJENESTEBEHOV",
  tilbudsdatasett: "tjenestetilbud"
};

function vurderBehov(tjenestetilbud: any, person: Record<string, unknown> = {}) {
  const tilstand = medHusstand(tilstandMed({ tjenestetilbud, person }));
  return evaluateVilkaar("TJENESTEBEHOV", {
    tilstand,
    personId: "p-voksen",
    ordning: ORDNING_BEHOV as any,
    satser,
    grunnlag: null,
    legeerklaering: null,
    politiattest: null,
    felles: {},
    forbehold: ""
  });
}

const TILBUD = { tilbudId: "t-1", navn: "Bergen støttekontakt", tjeneste: "stottekontakt", kommunenummer: "4601", malgruppeFraAar: 18, malgruppeTilAar: 67, ledigePlasser: 2 };

check("innvilget når tilbudet passer og har ledig plass", vurderBehov([TILBUD]).godkjent === true);
check("ledigePlasser havner i grunnlaget", vurderBehov([TILBUD]).grunnlag?.ledigePlasser === 2);
check(
  "ingen tilbud i kommunen",
  vurderBehov([{ ...TILBUD, kommunenummer: "0301" }]).melding.includes("har ikke registrert et tilbud")
);
check(
  "utenfor målgruppen nevner søkerens alder",
  vurderBehov([{ ...TILBUD, malgruppeFraAar: 70, malgruppeTilAar: 80 }]).melding.includes("Søkeren er 36 år"),
  vurderBehov([{ ...TILBUD, malgruppeFraAar: 70, malgruppeTilAar: 80 }]).melding
);
check(
  "passer men ingen ledige plasser",
  vurderBehov([{ ...TILBUD, ledigePlasser: 0 }]).melding.includes("ingen ledige plasser")
);
check("ingen ledige plasser er et avslag", vurderBehov([{ ...TILBUD, ledigePlasser: 0 }]).godkjent === false);
check(
  "manglende fødselsdato avvises, ikke antas",
  vurderBehov([TILBUD], { foedselsdato: undefined }).melding === "Fant ikke fødselsdato for søkeren."
);

const ORDNING_TT = {
  id: "tt-kort",
  navn: "TT-kort (tilrettelagt transport)",
  tjeneste: "transport",
  regel: "TRANSPORTBEHOV",
  soekerAlderFraAar: 10,
  varighetMinstAar: 2,
  fylkesnummer: "46",
  visusgrense: 0.33,
  kvoter: { ordinaer: 6500, "blind-eller-rullestol": 47150, "elektrisk-rullestol": 49750, "saerskilde-behov": 11050 }
};

// --- 6. Picking an ordning within a tjeneste -------------------------------
function velgOrdning(tjeneste: string) {
  const tilstand = medHusstand(tilstandMed({ sfoplasser: SFO_PLASSER as any })) as any;
  return selectOrdningForTjeneste(
    { ...tilstand, satser: { ...satser, ordninger: [ORDNING_INNTEKT, ORDNING_BEHOV, ORDNING_TT] } } as any,
    "p-voksen",
    tjeneste
  );
}

check("tjeneste uten plass-datasett velger sin ene ordning", velgOrdning("stottekontakt") === "test-tjenestebehov");
check("TT-kort velges uten å slå opp en plass", velgOrdning("transport") === "tt-kort");
check("plass-tjeneste velger fortsatt på plassen", velgOrdning("sfo") === "test-inntektsgrense");

// --- 7. TRANSPORTBEHOV: TT-kort ---------------------------------------------
// Vurderes bare på søkeren og journalutdraget. Ingen plass, ingen inntekt, ingen
// husstand - derfor kan hvert utfall pinnes med to literal-objekter.

function erklaeringMed(overstyr: Partial<Legeerklaering> = {}): Legeerklaering {
  return {
    erklaeringId: "legeerkl-test",
    dokumenttype: "legeerklaering-tt",
    fnr: "01019012345",
    personId: "p-voksen",
    utstedt: "2026-05-14",
    signert: "2026-05-14",
    gyldigTil: "2026-11-14",
    diagnose: { kode: "N86", kodeverk: "ICPC-2", tekst: "Multippel sklerose" },
    funksjonsnedsetting: "anna",
    varighetAar: 5,
    funn: { visus: null, mmsScore: null, fev1Prosent: null },
    hjelpemiddel: [],
    kanNytteKollektiv: false,
    vurdering: "Test",
    lege: {
      hprNummer: "9000000",
      navn: "Test Lege",
      legekontor: "Testlegesenter",
      organisasjonsnummer: "999999999",
      herId: "900000"
    },
    syntetisk: true,
    ...overstyr
  };
}

function vurderTt(erklaering: Legeerklaering | null, person: Record<string, any> = {}) {
  return evaluateVilkaar("TRANSPORTBEHOV", {
    tilstand: medHusstand(tilstandMed({ person })) as any,
    personId: "p-voksen",
    ordning: ORDNING_TT as any,
    satser,
    grunnlag: null,
    legeerklaering: erklaering,
    politiattest: null,
    felles: {},
    forbehold: ""
  });
}

check("TT-kort innvilges med gyldig erklæring", vurderTt(erklaeringMed()).godkjent === true);
check(
  "TT-kort avslås når søkeren er under aldersgrensen",
  vurderTt(erklaeringMed(), { foedselsdato: "2020-01-10" }).godkjent === false
);
check(
  "TT-kort avslås utenfor fylket",
  vurderTt(erklaeringMed(), { bostedsadresse: { kommunenummer: "0301", kommune: "Oslo" } }).godkjent === false
);
check("TT-kort avslås uten erklæring", vurderTt(null).godkjent === false);
check(
  "TT-kort avslås på utløpt erklæring",
  vurderTt(erklaeringMed({ utstedt: "2025-11-20", gyldigTil: "2026-05-20" })).godkjent === false
);
check(
  "TT-kort avslås når varigheten er under to år",
  vurderTt(erklaeringMed({ varighetAar: 1 })).godkjent === false
);
// Visus er definisjonen av kategorien, ikke et vilkår ved siden av. En erklæring
// som krysser av for syn uten å nå 0,33 dokumenterer ikke det den påberoper seg.
check(
  "TT-kort avslås når visus er over grensen",
  vurderTt(erklaeringMed({
    funksjonsnedsetting: "blind-eller-sterkt-svaksynt",
    funn: { visus: 0.5, mmsScore: null, fev1Prosent: null }
  })).godkjent === false
);
check(
  "blind innenfor grensen gir kvoten for blinde og rullestolbrukere",
  vurderTt(erklaeringMed({
    funksjonsnedsetting: "blind-eller-sterkt-svaksynt",
    funn: { visus: 0.15, mmsScore: null, fev1Prosent: null }
  })).grunnlag?.kvotekategori === "blind-eller-rullestol"
);
check(
  "elektrisk rullestol slår ut foran de andre kategoriene",
  vurderTt(erklaeringMed({
    funksjonsnedsetting: "rullestolbrukar",
    hjelpemiddel: ["manuell-rullestol", "elektrisk-rullestol"]
  })).grunnlag?.kvotekategori === "elektrisk-rullestol"
);
check(
  "terminal fase gir kvoten for særskilte behov",
  vurderTt(erklaeringMed({ funksjonsnedsetting: "terminal-fase" })).grunnlag?.kvotekategori === "saerskilde-behov"
);
check(
  "uten hjelpemiddel eller kategori blir kvoten ordinær",
  vurderTt(erklaeringMed()).grunnlag?.kvotekategori === "ordinaer"
);
check(
  "kvotebeløpet rapporteres som referanse",
  vurderTt(erklaeringMed()).grunnlag?.kvoteReferanse === 6500
);

// --- 8. The interface's own contract ---------------------------------------
// Én tabell over hva hver regel forbruker. Kompilatoren krever en rad per
// regeltype og et svar per kolonne; antallet sjekkes her fordi det er den ene
// måten en regeltype uten rad blir synlig i en test.
const antallRegeltyper = 5;
check("regelBehov dekker alle regeltypene", Object.keys(regelBehov).length === antallRegeltyper);
check("TJENESTEBEHOV krever ikke inntekt", regelBehov.TJENESTEBEHOV.inntekt === false);
check("INNTEKTSGRENSE krever inntekt", regelBehov.INNTEKTSGRENSE.inntekt === true);
check("MAKS_ANDEL_AV_INNTEKT krever inntekt", regelBehov.MAKS_ANDEL_AV_INNTEKT.inntekt === true);
check("TRANSPORTBEHOV krever ikke inntekt", regelBehov.TRANSPORTBEHOV.inntekt === false);
check("TRANSPORTBEHOV krever legeerklæring", regelBehov.TRANSPORTBEHOV.legeerklaering === true);
check("bare TRANSPORTBEHOV krever legeerklæring",
  Object.values(regelBehov).filter((b) => b.legeerklaering).length === 1);
check("VANDELSKONTROLL krever politiattest", regelBehov.VANDELSKONTROLL.politiattest === true);
check("bare VANDELSKONTROLL krever politiattest",
  Object.values(regelBehov).filter((b) => b.politiattest).length === 1);
check("VANDELSKONTROLL krever verken inntekt eller legeerklæring",
  regelBehov.VANDELSKONTROLL.inntekt === false && regelBehov.VANDELSKONTROLL.legeerklaering === false);
check("TRANSPORTBEHOV vurderes ikke mot en plass", regelBehov.TRANSPORTBEHOV.plass === false);
check("TJENESTEBEHOV vurderes ikke mot en plass", regelBehov.TJENESTEBEHOV.plass === false);
check("INNTEKTSGRENSE vurderes mot en plass", regelBehov.INNTEKTSGRENSE.plass === true);

// Samtykkeporten i ressurser.ts leser samtykkekilderFor. Kobles en inngang fra
// datakilden sin, blir SJEKK-ruten en vei rundt porten - det var nettopp det som
// skjedde da bare inntekt var koblet.
check("inntektsregler krever samtykke til inntekt",
  samtykkekilderFor("INNTEKTSGRENSE").includes("inntekt"));
check("TT-kort krever samtykke til helseopplysninger",
  samtykkekilderFor("TRANSPORTBEHOV").includes("helseopplysninger"));
check("behovsavklaring krever ingen samtykke",
  samtykkekilderFor("TJENESTEBEHOV").length === 0);
check("vandelskontroll krever samtykke til politiattesten",
  samtykkekilderFor("VANDELSKONTROLL").includes("politiattest"));
// samtykkeForOrdningssjekk returnerer én kode. Trenger en regel to, må den og
// samtykkeblokken i runRessurs utvides sammen - denne feiler i det øyeblikket.
check("ingen regel trenger mer enn én datakilde",
  (Object.keys(regelBehov) as Regeltype[]).every((r) => samtykkekilderFor(r).length <= 1));

// An unknown regeltype must throw rather than silently pass. `regel` arrives from
// JSON, so the type system cannot be the guard here.
let kastet = false;
try {
  evaluateVilkaar("FINNES_IKKE" as Regeltype, { tilstand: medHusstand(tilstandMed()), personId: "p-voksen", ordning: ORDNING_INNTEKT as any, satser, grunnlag: 1, legeerklaering: null, politiattest: null, felles: {}, forbehold: "" });
} catch (error) {
  kastet = feilmelding(error).startsWith("Ukjent regeltype: FINNES_IKKE. Gyldige: ");
}
check("ukjent regeltype kaster med de gyldige listet opp", kastet);

// --- 9. VANDELSKONTROLL: politiattest --------------------------------------
// Vurderes bare på ordningen og attesten. Ingen plass, ingen inntekt, ingen
// husstand - derfor kan hvert utfall pinnes med to literal-objekter.
//
// satser.gjelderFra er referansedatoen, som i TT-kort-blokken over.

const ORDNING_VANDEL_BARNEHAGE = {
  id: "politiattest-barnehage",
  navn: "Vandelskontroll - barnehage",
  tjeneste: "vandel",
  regel: "VANDELSKONTROLL",
  formaal: "barnehage",
  hjemmel: "barnehageloven § 30, jf. politiregisterloven § 39 første ledd",
  attesttype: "barneomsorgsattest",
  maksAlderMaaneder: 3,
  absoluttUtelukkelse: ["seksuallovbrudd-mot-mindreaarig"]
};

const ORDNING_VANDEL_STOTTEKONTAKT = {
  ...ORDNING_VANDEL_BARNEHAGE,
  id: "politiattest-stottekontakt",
  navn: "Vandelskontroll - støttekontakt",
  formaal: "stottekontakt",
  hjemmel: "helse- og omsorgstjenesteloven § 5-4",
  attesttype: "helse-og-omsorgsattest",
  // Ingen absolutt utelukkelse: loven overlater hver merknad til skjønn.
  absoluttUtelukkelse: []
};

// Beviset bygges av byggAttestbevis, ikke skrevet av hånd: en kopi her gikk ut av
// takt med attesten uten at noe klaget.
function attestMed(overstyr: Partial<Politiattest> = {}): Politiattest {
  const rad = {
    attestId: "att-test",
    dokumenttype: "Politiattest",
    fnr: "01019012345",
    personId: "p-voksen",
    formaal: "barnehage",
    hjemmel: "barnehageloven § 30, jf. politiregisterloven § 39 første ledd",
    attesttype: "barneomsorgsattest",
    utstedt: "2026-06-15",
    utsteder: { navn: "Politiet", enhet: "Enhet for vandelskontroll", organisasjonsnummer: "889640782" },
    anmerkninger: [],
    syntetisk: true,
    ...overstyr
  } as Omit<Politiattest, "bevis">;
  return { ...rad, bevis: byggAttestbevis(rad) };
}

// VANDELSKONTROLL leser bare ordningen og attesten, så tilstanden er den samme for
// hvert utfall og bygges én gang.
const VANDELSTILSTAND = medHusstand(tilstandMed()) as any;

function vurderVandel(attest: Politiattest | null, ordning: any = ORDNING_VANDEL_BARNEHAGE) {
  return evaluateVilkaar("VANDELSKONTROLL", {
    tilstand: VANDELSTILSTAND,
    personId: "p-voksen",
    ordning: ordning as any,
    satser,
    grunnlag: null,
    legeerklaering: null,
    politiattest: attest,
    felles: {},
    forbehold: ""
  });
}

// Utfallet er det som pinnes, og godkjent følger av det: vandel() leser
// SLIPPER_GJENNOM, så de to kan ikke gå fra hverandre. Tabellen under er stedet
// den koblingen sjekkes, framfor ved hvert utfall.
const utenMerknad = vurderVandel(attestMed());
check("attest uten merknad godkjennes", utenMerknad.grunnlag?.vandelsutfall === "godkjent");
check("uten attest navngis grenen",
  vurderVandel(null).grunnlag?.vandelsutfall === "mangler_attest");
const feilAttesttype = vurderVandel(attestMed({ attesttype: "ordinaer" }));
check("feil attesttype navngis", feilAttesttype.grunnlag?.vandelsutfall === "feil_attesttype");

// Tremånedersgrensen er mottakerens regel: attesten har ingen utløpsdato.
const forGammel = vurderVandel(attestMed({ utstedt: "2026-02-10" }));
check("for gammel attest navngis", forGammel.grunnlag?.vandelsutfall === "attest_for_gammel");
check("meldingen oppgir datoen attesten kunne brukes til", forGammel.melding.includes("2026-05-10"));

const paaGrensen = vurderVandel(attestMed({ utstedt: "2026-05-01" }));
check("grensen er ikke strengere enn tre måneder", paaGrensen.grunnlag?.vandelsutfall === "godkjent");
// ... og ikke slappere heller: hele måneder slapp gjennom en attest på tre måneder
// og tretti dager, mens beviset den bar alt var utløpt.
const knapptForGammel = vurderVandel(attestMed({ utstedt: "2026-04-02" }));
check("en attest eldre enn tre måneder slipper ikke gjennom på avrunding",
  knapptForGammel.grunnlag?.vandelsutfall === "attest_for_gammel",
  String(knapptForGammel.grunnlag?.vandelsutfall));
// Regelen og beviset måler mot den samme datoen, så de kan ikke gå fra hverandre.
check("regelen godtar nøyaktig så lenge beviset er gyldig",
  attestMed({ utstedt: "2026-05-01" }).bevis.expirationDate.startsWith(satser.gjelderFra),
  attestMed({ utstedt: "2026-05-01" }).bevis.expirationDate);

const overgrep = attestMed({
  anmerkninger: [
    { kategori: "seksuallovbrudd-mot-mindreaarig", hjemmel: "straffeloven § 302", reaksjon: "dom", dato: "2019-04-11" }
  ]
});
const utelukket = vurderVandel(overgrep);
check("absolutt utelukkelse navngis", utelukket.grunnlag?.vandelsutfall === "absolutt_utelukkelse");
check("absolutt utelukkelse oppgir hjemmelen den følger av",
  utelukket.melding.includes("barnehageloven § 30"));

// Samme anmerkning, annen hjemmel: helse- og omsorgstjenesteloven utelukker ingen
// direkte, så den samme raden blir en egnethetsvurdering. Det er hele forskjellen
// mellom en hjemmel som avgjør og en som overlater til skjønn.
const tilSkjonn = vurderVandel(
  { ...overgrep, formaal: "stottekontakt", attesttype: "helse-og-omsorgsattest" } as Politiattest,
  ORDNING_VANDEL_STOTTEKONTAKT
);
check("samme anmerkning uten absolutt hjemmel går til skjønn",
  tilSkjonn.grunnlag?.vandelsutfall === "krever_manuell_vurdering");
check("skjønnsutfallet sier at et menneske avgjør",
  tilSkjonn.melding.includes("saksbehandler"));

// Reaksjonen avgjør, ikke bare kategorien. Straffebudet er det samme i alle fire
// radene under; det som skiller dem er om påtalemyndigheten er ferdig. Bare dommen
// utelukker - resten er en anmerkning et menneske må vurdere.
for (const reaksjon of ["siktet", "tiltalt", "forelegg"] as const) {
  const svar = vurderVandel(attestMed({
    anmerkninger: [
      { kategori: "seksuallovbrudd-mot-mindreaarig", hjemmel: "straffeloven § 302", reaksjon, dato: "2019-04-11" }
    ]
  }));
  check(`${reaksjon} er ikke en dom og utelukker ikke automatisk`,
    svar.grunnlag?.vandelsutfall === "krever_manuell_vurdering",
    String(svar.grunnlag?.vandelsutfall));
}
check("dommen utelukker fortsatt",
  vurderVandel(attestMed({
    anmerkninger: [
      { kategori: "seksuallovbrudd-mot-mindreaarig", hjemmel: "straffeloven § 302", reaksjon: "dom", dato: "2019-04-11" }
    ]
  })).grunnlag?.vandelsutfall === "absolutt_utelukkelse");

// Koblingen mellom utfall og godkjent, sjekket én gang for alle seks. To av dem
// slipper gjennom, og krever_manuell_vurdering er den ene som overrasker.
const SLIPPER: Record<string, boolean> = {
  godkjent: true,
  krever_manuell_vurdering: true,
  mangler_attest: false,
  feil_attesttype: false,
  attest_for_gammel: false,
  absolutt_utelukkelse: false
};
for (const svar of [utenMerknad, vurderVandel(null), forGammel, utelukket, tilSkjonn, feilAttesttype]) {
  const gren = String(svar.grunnlag?.vandelsutfall);
  check(`${gren} slipper gjennom bare når det skal`, svar.godkjent === SLIPPER[gren]);
  // Arten er det kvitteringen tegner. «Godkjent» på et utfall ingen har avgjort er
  // feil ord, og det ordet velges her framfor på hvert kallsted.
  const forventetArt = gren === "krever_manuell_vurdering" ? "til_manuell" : SLIPPER[gren] ? "godkjent" : "avvist";
  check(`${gren} navngir arten sin`, svar.utfall === forventetArt, String(svar.utfall));
}
// Medlemskap og ikke bare antall: en omdøpt gren holder antallet og ville sluppet unna.
check("tabellen dekker unionen nøyaktig",
  VANDELSUTFALL.every((gren) => gren in SLIPPER) && Object.keys(SLIPPER).length === VANDELSUTFALL.length);

// Minimering: grunnlaget går inn i oppsummeringen, og oppsummeringen går til
// modellen. Hva anmerkningen gjelder skal ikke dit.
for (const svar of [utelukket, tilSkjonn]) {
  const somTekst = JSON.stringify(svar);
  check("grunnlaget bærer ikke hva anmerkningen gjelder",
    !somTekst.includes("seksuallovbrudd") && !somTekst.includes("straffeloven"));
}
check("grunnlaget teller anmerkningene", tilSkjonn.grunnlag?.antallAnmerkninger === 1);

// --- the import direction -------------------------------------------------
//
// vilkaar.ts is pure and synchronous so an outcome can be pinned with a literal
// tilstand object and no running services. That only holds while the arrow points
// one way: regler.ts does the I/O and imports the rules, never the reverse. An
// import added by accident would cost this file its whole premise - importing
// regler.ts pulls in state.ts and a 2048-bit RSA keygen, and the pure test would
// quietly start paying for it.
//
// This is the case pnpm test:imports cannot see: vilkaar.ts and regler.ts are
// siblings inside the same app, and the graph check only watches arrows between
// apps and out of apps/shared.
{
  const forbidden = [
    // state.ts is allowed and intended: vilkaar.ts needs finnPerson and
    // hentPlasserForTjeneste, and state.ts costs ~18 ms to import. What must stay
    // out is regler.ts, which reaches klient.ts and its 2048-bit RSA keygen.
    { file: "apps/sandbox-backend/src/vilkaar.ts", mustNotImport: ["regler.ts", "klient.ts"] }
  ];
  for (const { file, mustNotImport } of forbidden) {
    const source = await readFile(file, "utf8");
    const imported = [...source.matchAll(/^\s*import[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
    for (const unwanted of mustNotImport) {
      check(
        `${file.split("/").pop()} importerer ikke ${unwanted}`,
        !imported.some((importPath) => importPath.endsWith(unwanted)),
        `importene er ${JSON.stringify(imported)}`
      );
    }
  }
}

// --- report ----------------------------------------------------------------
if (feil.length > 0) {
  console.error(`test-vilkaar: ${feil.length} av ${bestatt + feil.length} sjekker feilet.`);
  for (const linje of feil) console.error(`  - ${linje}`);
  process.exit(1);
}
console.log(`test-vilkaar ok. ${bestatt} sjekker, uten stack og uten modell.`);
