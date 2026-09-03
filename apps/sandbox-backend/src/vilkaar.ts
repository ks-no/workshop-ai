// The deterministic vedtak. Everything here is pure and synchronous: the income
// basis arrives as a parameter, never as a fetch, so an outcome can be pinned with
// a literal tilstand object and no running services. That is what makes a vedtak
// etterprøvbar, and it is why scripts/valider-data.js imports this file instead of
// mirroring the rules by hand - it used to carry its own copy of every rule below,
// and a copy that cannot be executed by the gate is a copy that will drift.
//
// The I/O half - fetching the beregning from Fiks, and the samtykke predicates -
// stays in regler.ts. Nothing in this file may import it: the point of the split is
// that a caller can reach the rules without paying for regler.ts's dependency
// chain, which builds a 2048-chunk RSA keypair at module load.
import { alderVed, maanederMellom } from "../../shared/alder.ts";
import type { Datakilde } from "../../shared/samtykke.ts";
import { datasettFor, findPerson, getPlasserForTjeneste } from "./state.ts";
import type { Kvotekategori, Ordning, Regeltype, Satser, SjekkResultat, State } from "./types.ts";
import type { Legeerklaering } from "../../shared/legeerklaering.ts";
import type { Politiattest } from "../../shared/politiattest.ts";
import type { Plass } from "../../shared/innbyggerdata.ts";

function formatBelop(belop: number) {
  return new Intl.NumberFormat("nb-NO").format(Math.round(belop));
}

/**
 * Avslagsgrunnene TRANSPORTBEHOV kan svare med.
 *
 * Union og ikke `string`, av samme grunn som kodeverkene i legeerklaering.ts: en
 * skrivefeil her ville gitt en gren scripts/valider-data.ts ikke kjenner igjen,
 * og det ville vist seg først når en person nådde den.
 */
export const AVSLAGSGRUNNER = [
  "mangler_foedselsdato",
  "for_ung",
  "utenfor_fylket",
  "mangler_erklaering",
  "utloept_erklaering",
  "for_kort_varighet",
  "visus_over_grensen"
] as const;
export type Avslagsgrunn = (typeof AVSLAGSGRUNNER)[number];

/**
 * Utfallene VANDELSKONTROLL kan svare med, positive og negative i samme union.
 *
 * `krever_manuell_vurdering` er hele grunnen til at unionen dekker begge sider.
 * En anmerkning som ikke utelukker absolutt, er en egnethetsvurdering et menneske
 * skal gjøre - så søknaden skal gå inn, og utfallet er verken ja eller nei. Med
 * bare `godkjent: boolean` ville den blitt tvunget til å lyve i én av retningene.
 */
export const VANDELSUTFALL = [
  "godkjent",
  "krever_manuell_vurdering",
  "mangler_attest",
  "feil_attesttype",
  "attest_for_gammel",
  "absolutt_utelukkelse"
] as const;
export type Vandelsutfall = (typeof VANDELSUTFALL)[number];

/**
 * Utfallene som slipper søknaden gjennom. `krever_manuell_vurdering` er med fordi
 * en anmerkning ingen lov utelukker direkte skal til et menneske, og da må
 * søknaden inn - så dette er stedet den avgjørelsen bor, framfor på hvert kallsted.
 */
const SLIPPER_GJENNOM: readonly Vandelsutfall[] = ["godkjent", "krever_manuell_vurdering"];

/**
 * Et vandelsutfall, med utfallet navngitt i grunnlaget.
 *
 * `vandelsutfall` er wire, og finnes for at scripts/valider-data.ts skal kunne
 * telle grenene uten å bygge sin egen kopi av regelen.
 */
function vandel(
  vandelsutfall: Vandelsutfall,
  melding: string,
  grunnlag: Record<string, unknown>
): SjekkResultat {
  return {
    godkjent: SLIPPER_GJENNOM.includes(vandelsutfall),
    melding,
    grunnlag: { ...grunnlag, vandelsutfall }
  };
}

/**
 * Et avslag med grunnen navngitt i grunnlaget.
 *
 * `avslagsgrunn` er wire, og den finnes for at scripts/valider-data.ts skal kunne
 * telle hvilke grener befolkningen faktisk når uten å bygge sin egen kopi av
 * reglene. En gate som speiler regelen den vokter, kan bare bekrefte seg selv.
 */
function avslag(avslagsgrunn: Avslagsgrunn, melding: string, grunnlag: Record<string, unknown>): SjekkResultat {
  return { godkjent: false, melding, grunnlag: { ...grunnlag, avslagsgrunn } };
}

/**
 * Hvilken kvote søkeren havner i. Rekkefølgen er bærende - elektrisk rullestol
 * slår ut foran de andre - så den står som en flat kjede og ikke som nøsting.
 */
function kvotekategoriFor(erklaering: Legeerklaering): Kvotekategori {
  const hjelpemiddel = erklaering.hjelpemiddel || [];
  if (hjelpemiddel.includes("elektrisk-rullestol")) return "elektrisk-rullestol";
  if (erklaering.funksjonsnedsetting === "blind-eller-sterkt-svaksynt"
    || hjelpemiddel.includes("manuell-rullestol")
    || erklaering.funksjonsnedsetting === "rullestolbrukar") return "blind-eller-rullestol";
  if (["terminal-fase", "kunstig-surstofftilfoersel"].includes(erklaering.funksjonsnedsetting)) {
    return "saerskilde-behov";
  }
  return "ordinaer";
}

// The ordninger in data/satser.json scope which children they cover, via
// trinnFra/trinnTil for SFO and alderFraAar/alderTilAar for barnehage. These
// fields went unused, so a husstand could be granted an ordning on the basis of a
// child outside the target group.
export function plasserSomKvalifiserer(tilstand: State, personId: string, ordning: Ordning, satser: Satser) {
  return getPlasserForTjeneste(tilstand, personId, ordning.tjeneste).filter((plass: Plass) => {
    if (ordning.trinnFra !== undefined || ordning.trinnTil !== undefined) {
      if (typeof plass.trinn !== "number") return false;
      if (ordning.trinnFra !== undefined && plass.trinn < ordning.trinnFra) return false;
      if (ordning.trinnTil !== undefined && plass.trinn > ordning.trinnTil) return false;
    }
    if (ordning.alderFraAar !== undefined || ordning.alderTilAar !== undefined) {
      const barn = findPerson(tilstand, plass.personId);
      if (!barn?.foedselsdato) return false;
      const alder = alderVed(barn.foedselsdato, satser.gjelderFra);
      if (ordning.alderFraAar !== undefined && alder < ordning.alderFraAar) return false;
      if (ordning.alderTilAar !== undefined && alder > ordning.alderTilAar) return false;
    }
    return true;
  });
}

// "Fant ingen fritid-plass" is not Norwegian. The tjeneste key is an identifier;
// what the citizen reads needs its own word.
const plassbetegnelse: Record<string, string> = {
  barnehage: "barnehageplass",
  sfo: "SFO-plass",
  fritid: "fritidsaktivitet"
};

function betegnelse(ordning: Ordning): string {
  return plassbetegnelse[ordning.tjeneste] || `${ordning.tjeneste}-plass`;
}

function kriterieTekst(ordning: Ordning): string {
  if (ordning.trinnFra !== undefined) {
    return ordning.trinnTil !== undefined && ordning.trinnTil !== ordning.trinnFra
      ? ` på ${ordning.trinnFra}.–${ordning.trinnTil}. trinn`
      : ` på ${ordning.trinnFra}. trinn`;
  }
  if (ordning.alderFraAar !== undefined) {
    return ordning.alderTilAar !== undefined && ordning.alderTilAar !== ordning.alderFraAar
      ? ` for barn på ${ordning.alderFraAar}–${ordning.alderTilAar} år`
      : ` for barn på ${ordning.alderFraAar} år`;
  }
  return "";
}

export type RegelContext = {
  tilstand: State;
  personId: string;
  ordning: Ordning;
  satser: Satser;
  /** The household's beregningsbeloep from Fiks, or null for rules that do not use income. */
  grunnlag: number | null;
  /**
   * Journalutdraget fra pasientjournal-mock, eller null for reglene som ikke
   * bruker det. Kommer inn som parameter av samme grunn som grunnlag: I/O-en hører
   * i regler.ts, og et utfall skal kunne pinnes med et literal-objekt.
   */
  legeerklaering: Legeerklaering | null;
  /**
   * Attesten fra politiattest-mock, eller null for reglene som ikke bruker den.
   * Kommer inn som parameter av samme grunn som de to over.
   */
  politiattest: Politiattest | null;
  /** Fields every assessment attaches as its explanation. */
  felles: Record<string, unknown>;
  /** Note that the tax assessment is not final, or an empty string. */
  forbehold: string;
};

/**
 * What an assessment consumes, per rule type.
 *
 * One table rather than one per input: Record<Regeltype, …> demands a row for
 * every new rule type, and the named columns demand an answer for every input.
 * Separate maps let a new rule answer about one input and stay silent about the
 * rest, and an input nobody has answered for is an input with no consent gate.
 */
export type Regelbehov = {
  /** The household's income basis, fetched from Fiks. */
  inntekt: boolean;
  /** A legeerklæring, fetched from the pasientjournal. */
  legeerklaering: boolean;
  /** A plass in a tjeneste dataset. */
  plass: boolean;
  /** En politiattest, hentet fra politiattest-mock. */
  politiattest: boolean;
};

export const regelBehov: Record<Regeltype, Regelbehov> = {
  INNTEKTSGRENSE:        { inntekt: true,  legeerklaering: false, plass: true,  politiattest: false },
  MAKS_ANDEL_AV_INNTEKT: { inntekt: true,  legeerklaering: false, plass: true,  politiattest: false },
  TJENESTEBEHOV:         { inntekt: false, legeerklaering: false, plass: false, politiattest: false },
  TRANSPORTBEHOV:        { inntekt: false, legeerklaering: true,  plass: false, politiattest: false },
  VANDELSKONTROLL:       { inntekt: false, legeerklaering: false, plass: false, politiattest: true }
};

// Hvilken datakilde hver hentede inngang krever samtykke til. Samtykkeporten i
// ressurser.ts leser denne, slik at en regel som forbruker en inngang ikke kan
// vurderes uten samtykket for den. `plass` er null fordi en barnehageplass ikke
// er samtykkebelagt i sandkassen.
const samtykkeForBehov: Record<keyof Regelbehov, Datakilde | null> = {
  inntekt: "inntekt",
  legeerklaering: "helseopplysninger",
  plass: null,
  politiattest: "politiattest"
};

/** The data sources a rule type needs consent for, in table order. */
export function samtykkekilderFor(regeltype: Regeltype): Datakilde[] {
  const behov = regelBehov[regeltype];
  return (Object.keys(samtykkeForBehov) as (keyof Regelbehov)[])
    .filter((inngang) => behov[inngang])
    .map((inngang) => samtykkeForBehov[inngang])
    .filter((kilde): kilde is Datakilde => kilde !== null);
}

// One handler per rule type in data/satser.json. A new rule type is one entry
// here, the same way a new resource is one entry in ressurser.ts.
// Record<Regeltype, ...> makes the compiler demand a handler as soon as a new
// rule type is added to types.ts.
const regelHandlers: Record<Regeltype, (k: RegelContext) => SjekkResultat> = {
  // TT-kort. Vurderes bare på nedsatt funksjonsevne, aldri på inntekt: «Det er
  // berre nedsett funksjonsevne som vert lagt til grunn ved vurderinga, uavhengig
  // av den einskilde sin sosiale og økonomiske situasjon», sier Vestland sin
  // rettleiing for brukergodkjenning. Manglende rutetilbud og bratte bakker
  // vektlegges heller ikke, og det er derfor ingenting her leser hvor personen bor
  // utover hvilket fylke det er.
  //
  // Journalutdraget kommer inn som parameter. Det er regler.ts som henter det, bak
  // samtykkeporten, og den rekkefølgen er poenget: helseopplysninger er særlige
  // kategorier, og de leses ikke før innbyggeren har sagt ja.
  TRANSPORTBEHOV: ({ tilstand, personId, ordning, satser, legeerklaering, felles }) => {
    const person = findPerson(tilstand, personId);
    if (!person?.foedselsdato) {
      return avslag("mangler_foedselsdato", "Fant ikke fødselsdato for søkeren.", felles);
    }
    const alder = alderVed(person.foedselsdato, satser.gjelderFra);
    const kommunenummer = person.bostedsadresse?.kommunenummer || null;
    const grunn = { ...felles, alder, kommunenummer };

    const alderskrav = ordning.soekerAlderFraAar ?? 0;
    if (alder < alderskrav) {
      return avslag(
        "for_ung",
        `Søkeren er ${alder} år. Ordningen gjelder fra ${alderskrav} år.`,
        grunn
      );
    }

    if (ordning.fylkesnummer && !String(kommunenummer || "").startsWith(ordning.fylkesnummer)) {
      return avslag(
        "utenfor_fylket",
        `${person.bostedsadresse?.kommune || "Kommunen søkeren bor i"} ligger utenfor fylket som ` +
        "forvalter ordningen. Søk hos fylkeskommunen der du bor.",
        grunn
      );
    }

    if (!legeerklaering) {
      return avslag(
        "mangler_erklaering",
        "Vi fant ingen legeerklæring for søkeren. Erklæringen må fylles ut, stemples og " +
        "signeres av lege før søknaden kan vurderes.",
        grunn
      );
    }

    const erklaering = {
      ...grunn,
      erklaeringId: legeerklaering.erklaeringId,
      diagnose: legeerklaering.diagnose.kode,
      funksjonsnedsetting: legeerklaering.funksjonsnedsetting,
      varighetAar: legeerklaering.varighetAar,
      gyldigTil: legeerklaering.gyldigTil
    };

    if (legeerklaering.gyldigTil < satser.gjelderFra) {
      return avslag(
        "utloept_erklaering",
        `Legeerklæringen er datert ${legeerklaering.utstedt} og var gyldig til ` +
        `${legeerklaering.gyldigTil}. En stemplet og signert legeerklæring er gyldig i seks ` +
        "måneder, så du trenger en ny.",
        erklaering
      );
    }

    const varighetskrav = ordning.varighetMinstAar ?? 0;
    if (legeerklaering.varighetAar < varighetskrav) {
      return avslag(
        "for_kort_varighet",
        `Legeerklæringen sier at tilstanden varer ${legeerklaering.varighetAar} år. Ordningen ` +
        `krever at den som hovedregel varer i minst ${varighetskrav} år.`,
        erklaering
      );
    }

    // Rettleiingen definerer kategorien, og gjør det med et tall: visus med
    // korreksjon på begge øyne må være 0,33 eller lavere. En erklæring som krysser
    // av for syn uten å nå grensen dokumenterer ikke det den påberoper seg.
    const visusgrense = ordning.visusgrense ?? 0.33;
    const visus = legeerklaering.funn.visus;
    const oppgirSynstap = legeerklaering.funksjonsnedsetting === "blind-eller-sterkt-svaksynt";
    if (oppgirSynstap && !(typeof visus === "number" && visus <= visusgrense)) {
      return avslag(
        "visus_over_grensen",
        `Legeerklæringen oppgir visus ${visus ?? "ukjent"}. For å regnes som blind eller sterkt ` +
        `svaksynt må visus med korreksjon på begge øyne være ${visusgrense} eller lavere.`,
        erklaering
      );
    }

    const kvotekategori = kvotekategoriFor(legeerklaering);
    return {
      godkjent: true,
      melding:
        `Søkeren fyller vilkårene for ${ordning.navn}. Legeerklæringen er gyldig til ` +
        `${legeerklaering.gyldigTil} og sier at tilstanden varer ${legeerklaering.varighetAar} år.`,
      grunnlag: {
        ...erklaering,
        kvotekategori,
        // Referansebeløp, ikke et beregnet vedtak: de publiserte kronebeløpene lar
        // seg ikke avstemme mot multiplikatorene i forskriften, så beløpet vises
        // uten at regelen later som den har regnet det ut.
        kvoteReferanse: ordning.kvoter?.[kvotekategori] ?? null
      }
    };
  },

  // Vandelskontroll. Formålet er inngangen: rollen innbyggeren skal tre inn i
  // avgjør både hjemmelen og hvilken attesttype som gjelder, og de tre står på
  // ordningen i data/satser.json framfor i koden.
  //
  // Regelen avgjør bare det som er deterministisk. En anmerkning som treffer
  // absoluttUtelukkelse er et yrkesforbud loven har bestemt - barnehagelova § 30
  // utelukker den som er dømt for seksuelle overgrep mot mindreårige, uten skjønn.
  // Alt annet er en egnethetsvurdering, og den skal et menneske gjøre: da svarer
  // regelen `krever_manuell_vurdering` og lar søknaden gå inn.
  //
  // Grunnlaget bærer aldri hva anmerkningen gjelder. Det er ikke pedanteri:
  // grunnlaget havner i oppsummeringen, og oppsummeringen havner i modellprompten
  // og i state/ai-trace.jsonl. Straffedommer er artikkel 10-opplysninger, og de
  // trenger ikke gjennom en modell for å bli formulert. Antallet og hjemmelen er
  // nok til å begrunne utfallet; innbyggeren har attesten selv.
  VANDELSKONTROLL: ({ ordning, satser, politiattest, felles }) => {
    const krav = {
      ...felles,
      formaal: ordning.formaal ?? null,
      hjemmel: ordning.hjemmel ?? null,
      attesttypeKrevd: ordning.attesttype ?? null,
      maksAlderMaaneder: ordning.maksAlderMaaneder ?? null
    };

    if (!politiattest) {
      return vandel(
        "mangler_attest",
        "Vi fant ingen politiattest for dette formålet. Du søker selv hos politiet, med " +
        "bekreftelsen på formål fra kommunen som vedlegg. Behandlingstiden er rundt to uker.",
        krav
      );
    }

    const attest = {
      ...krav,
      attestId: politiattest.attestId,
      utstedt: politiattest.utstedt,
      attesttype: politiattest.attesttype,
      antallAnmerkninger: politiattest.anmerkninger.length
    };

    // Feil attesttype er ikke søkerens skyld alene: formålet velges i søknaden hos
    // politiet, og velger man feil formål der, kommer en attest som ikke dekker
    // rollen. Den kan ikke brukes, og meldingen sier hvorfor.
    if (ordning.attesttype && politiattest.attesttype !== ordning.attesttype) {
      return vandel(
        "feil_attesttype",
        `Attesten er en ${politiattest.attesttype}, men rollen krever en ` +
        `${ordning.attesttype} etter ${ordning.hjemmel}. Søk på nytt hos politiet med ` +
        "formålet som står i bekreftelsen fra kommunen.",
        attest
      );
    }

    // Tremånedersgrensen er mottakerens regel og ikke politiets: attesten har
    // ingen utløpsdato. Målt mot satser.gjelderFra, som er den pinnede
    // referansedatoen i denne sandkassen.
    const maksAlder = ordning.maksAlderMaaneder ?? 3;
    const alderIMaaneder = maanederMellom(politiattest.utstedt, satser.gjelderFra);
    if (alderIMaaneder > maksAlder) {
      return vandel(
        "attest_for_gammel",
        `Attesten er utstedt ${politiattest.utstedt} og er ${alderIMaaneder} måneder gammel. ` +
        `Den skal ikke være eldre enn ${maksAlder} måneder når den framvises, så du trenger en ny.`,
        { ...attest, alderIMaaneder }
      );
    }

    const absolutte = ordning.absoluttUtelukkelse ?? [];
    if (politiattest.anmerkninger.some((anmerkning) => absolutte.includes(anmerkning.kategori))) {
      return vandel(
        "absolutt_utelukkelse",
        "Attesten har en anmerkning som utelukker fra rollen etter " +
        `${ordning.hjemmel}. Utelukkelsen følger direkte av loven, og kommunen kan ikke ` +
        "gjøre unntak.",
        attest
      );
    }

    if (politiattest.anmerkninger.length > 0) {
      return vandel(
        "krever_manuell_vurdering",
        `Attesten har ${politiattest.anmerkninger.length} anmerkning(er) som ikke utelukker ` +
        "automatisk. En saksbehandler må vurdere egnetheten, og søknaden går videre til den " +
        "vurderingen. Kommunen avgjør ikke dette maskinelt.",
        attest
      );
    }

    return vandel(
      "godkjent",
      `Politiattesten er uten merknad, utstedt ${politiattest.utstedt}, og er den attesttypen ` +
      `rollen krever etter ${ordning.hjemmel}. Kommunen registrerer at kontrollen er gjort, ` +
      "og beholder ikke attesten.",
      attest
    );
  },

  // Need and capacity, not money. The applicant is assessed against the municipality's
  // own tilbud, so the answer depends on where they live and how old they are - never
  // on what they earn.
  TJENESTEBEHOV: ({ tilstand, personId, ordning, satser, felles }) => {
    const person = findPerson(tilstand, personId);
    if (!person?.foedselsdato) {
      return { godkjent: false, melding: "Fant ikke fødselsdato for søkeren.", grunnlag: felles };
    }
    const alder = alderVed(person.foedselsdato, satser.gjelderFra);
    const kommunenummer = person.bostedsadresse?.kommunenummer || null;
    const alle = datasettFor(tilstand, ordning.tilbudsdatasett || "tjenestetilbud");
    const iKommunen = alle.filter(
      (tilbud: any) => tilbud.tjeneste === ordning.tjeneste && tilbud.kommunenummer === kommunenummer
    );
    const felles2 = { ...felles, alder, kommunenummer };

    if (iKommunen.length === 0) {
      return {
        godkjent: false,
        melding: `${person.bostedsadresse?.kommune || "Kommunen din"} har ikke registrert et tilbud om ${ordning.navn.toLowerCase()} i denne sandkassen.`,
        grunnlag: felles2
      };
    }
    const iMaalgruppe = iKommunen.filter(
      (tilbud: any) => alder >= tilbud.malgruppeFraAar && alder <= tilbud.malgruppeTilAar
    );
    if (iMaalgruppe.length === 0) {
      const baand = iKommunen
        .map((t: any) => `${t.malgruppeFraAar}–${t.malgruppeTilAar} år`)
        .join(", ");
      return {
        godkjent: false,
        melding: `Søkeren er ${alder} år. Tilbudene i kommunen gjelder ${baand}.`,
        grunnlag: felles2
      };
    }
    const medLedig = iMaalgruppe.filter((tilbud: any) => tilbud.ledigePlasser > 0);
    if (medLedig.length === 0) {
      return {
        godkjent: false,
        melding: `${iMaalgruppe[0].navn} passer for søkeren, men har ingen ledige plasser nå.`,
        grunnlag: { ...felles2, tilbud: iMaalgruppe[0].tilbudId, ledigePlasser: 0 }
      };
    }
    const valgt = medLedig[0];
    return {
      godkjent: true,
      melding: `${valgt.navn} passer for søkeren på ${alder} år, og har ${valgt.ledigePlasser} ${valgt.ledigePlasser === 1 ? "ledig plass" : "ledige plasser"}.`,
      grunnlag: { ...felles2, tilbud: valgt.tilbudId, ledigePlasser: valgt.ledigePlasser }
    };
  },

  INNTEKTSGRENSE: ({ tilstand, personId, ordning, satser, grunnlag, felles, forbehold }) => {
    const kvalifiserte = plasserSomKvalifiserer(tilstand, personId, ordning, satser);
    if (kvalifiserte.length === 0) {
      return {
        godkjent: false,
        melding: `Fant ingen ${betegnelse(ordning)}${kriterieTekst(ordning)} registrert på husstanden.`,
        grunnlag: felles
      };
    }
    const grense = ordning.inntektsgrense!;
    const godkjent = grunnlag! < grense;
    return {
      godkjent,
      melding: godkjent
        ? `Husholdningens inntektsgrunnlag er ${formatBelop(grunnlag!)} kr, under grensen på ${formatBelop(grense)} kr for ${ordning.navn}.${forbehold}`
        : `Husholdningens inntektsgrunnlag er ${formatBelop(grunnlag!)} kr, over grensen på ${formatBelop(grense)} kr for ${ordning.navn}.${forbehold}`,
      grunnlag: { ...felles, inntektsgrense: grense, antallKvalifiserendePlasser: kvalifiserte.length }
    };
  },

  MAKS_ANDEL_AV_INNTEKT: ({ tilstand, personId, ordning, satser, grunnlag, felles, forbehold }) => {
    const plasser = plasserSomKvalifiserer(tilstand, personId, ordning, satser);
    if (plasser.length === 0) {
      return {
        godkjent: false,
        melding: `Fant ingen ${betegnelse(ordning)}${kriterieTekst(ordning)} registrert på husstanden.`,
        grunnlag: felles
      };
    }
    const aarspris = plasser.reduce((sum: number, p: any) => sum + p.manedspris, 0) * satser.maanederMedBetaling;
    const tak = satser.maksAndelAvInntekt * grunnlag!;
    const godkjent = aarspris > tak;
    return {
      godkjent,
      melding: godkjent
        ? `Full pris er ${formatBelop(aarspris)} kr i året, mer enn ${Math.round(satser.maksAndelAvInntekt * 100)} % av inntektsgrunnlaget på ${formatBelop(grunnlag!)} kr (${formatBelop(tak)} kr). Du har rett til redusert betaling.${forbehold}`
        : `Full pris er ${formatBelop(aarspris)} kr i året, som er under ${Math.round(satser.maksAndelAvInntekt * 100)} % av inntektsgrunnlaget på ${formatBelop(grunnlag!)} kr (${formatBelop(tak)} kr). Du har ikke rett til redusert betaling.${forbehold}`,
      grunnlag: { ...felles, aarspris, maksAndelAvInntekt: satser.maksAndelAvInntekt, tak: Math.round(tak) }
    };
  }
};

// Picks the ordning within a tjeneste that the household can actually be assessed
// for. Hardcoding one ordning would tell a household whose only child is in first
// or fourth grade "no SFO place in 2nd-3rd grade" - true, but it reads as a bug,
// and it hides that the child qualifies elsewhere.
/**
 * Ordningen som gjelder for et vandelsformål.
 *
 * Formålet er inngangen fordi det er formålet som avgjør hjemmelen og
 * attesttypen. Oppslaget står her og ikke i ressurser.ts, slik at prosessen kan
 * sende rollen innbyggeren valgte framfor en ordnings-id ingen innbygger skal se.
 *
 * Gir ordningen og ikke id-en: hvert kallsted trenger feltene, og en id de måtte
 * slå opp igjen var bare arvet fra selectOrdningForTjeneste.
 */
export function selectOrdningForFormaal(tilstand: State, formaal: string): Ordning {
  const satser: Satser = tilstand.satser;
  const kandidater = satser.ordninger.filter((ordning) => ordning.regel === "VANDELSKONTROLL");
  const treff = kandidater.find((ordning) => ordning.formaal === formaal);
  if (!treff) {
    const gyldige = kandidater.map((ordning) => ordning.formaal).join(", ");
    throw new Error(`Ingen vandelskontroll for formålet ${formaal}. Gyldige: ${gyldige}.`);
  }
  return treff;
}

export function selectOrdningForTjeneste(
  tilstand: State,
  personId: string,
  tjeneste: string
): string {
  const satser: Satser = tilstand.satser;
  const kandidater = satser.ordninger.filter((o) => o.tjeneste === tjeneste);
  if (kandidater.length === 0) {
    const gyldige = [...new Set(satser.ordninger.map((o) => o.tjeneste))].join(", ");
    throw new Error(`Ingen ordning for tjenesten ${tjeneste}. Gyldige: ${gyldige}.`);
  }
  const treff = kandidater.find(
    (ordning) => regelBehov[ordning.regel].plass
      && plasserSomKvalifiserer(tilstand, personId, ordning, satser).length > 0
  );
  // No match still returns an ordning, so the citizen gets the ordinary "no place in
  // the target group" message rather than a 400 about routing.
  return (treff || kandidater[0]).id;
}

// The one way in. regelHandlers stays private: it is the extension seam for a new
// rule type, not a surface for callers to index. Keeping it private means adding a
// rule type does not widen this module's interface, and the Record<Regeltype, ...>
// annotation still makes the compiler demand a handler for every type in the union.
export function evaluateVilkaar(regeltype: Regeltype, kontekst: RegelContext): SjekkResultat {
  const handterer = regelHandlers[regeltype];
  if (!handterer) {
    throw new Error(
      `Ukjent regeltype: ${regeltype}. Gyldige: ${Object.keys(regelHandlers).join(", ")}.`
    );
  }
  return handterer(kontekst);
}
