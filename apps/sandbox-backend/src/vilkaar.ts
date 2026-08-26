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
import { alderVed } from "../../shared/alder.ts";
import { datasettFor, findPerson, getPlasserForTjeneste } from "./state.ts";
import type { Ordning, Regeltype, Satser, SjekkResultat, State } from "./types.ts";
import type { Plass } from "../../shared/innbyggerdata.ts";

function formatBelop(belop: number) {
  return new Intl.NumberFormat("nb-NO").format(Math.round(belop));
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
  /** Fields every assessment attaches as its explanation. */
  felles: Record<string, unknown>;
  /** Note that the tax assessment is not final, or an empty string. */
  forbehold: string;
};

// Whether a rule type needs the income basis at all. Record<Regeltype, boolean>
// makes the compiler demand an answer for every new rule type, so nobody adds one
// that quietly triggers an income lookup it does not use.
export const regelKreverInntekt: Record<Regeltype, boolean> = {
  INNTEKTSGRENSE: true,
  MAKS_ANDEL_AV_INNTEKT: true,
  TJENESTEBEHOV: false
};

// One handler per rule type in data/satser.json. A new rule type is one entry
// here, the same way a new resource is one entry in ressurser.ts.
// Record<Regeltype, ...> makes the compiler demand a handler as soon as a new
// rule type is added to types.ts.
const regelHandlers: Record<Regeltype, (k: RegelContext) => SjekkResultat> = {
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
    (ordning) => plasserSomKvalifiserer(tilstand, personId, ordning, satser).length > 0
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
