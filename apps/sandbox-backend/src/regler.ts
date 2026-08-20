import { fiksBaseUrl, fiksRolleId } from "./config.ts";
import {
  finnPerson,
  hentHusstandForPerson,
  hentPlasserForTjeneste
} from "./state.ts";
import type { Ordning, Plass, Regeltype, Satser, SjekkResultat, State } from "./types.ts";

// Fetches the household income basis from the Fiks simulator. Spouses, registered
// partners and cohabitants count as one household, per forskrift om
// foreldrebetaling. Return type stays any until the Fiks response is modelled in
// types.ts.
async function hentInntektsgrunnlag(tilstand: State, personId: string, inntektsaar: number): Promise<any> {
  const husstand = hentHusstandForPerson(tilstand, personId);
  const personer = husstand.medlemmer
    .filter((medlem: any) => medlem.rolle === "foresatt")
    .map((medlem: any) => {
      const person = finnPerson(tilstand, medlem.personId);
      return {
        identifikator: person.syntetiskFodselsnummer,
        type: medlem.personId === personId ? "SOEKER" : "ANNET"
      };
    });

  const svar = await fetch(
    `${fiksBaseUrl}/register/api/v1/ks/${fiksRolleId}/skatteoginntektsopplysninger/beregning/redusert-foreldrebetaling`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inntektsaar, personer })
    }
  );
  if (!svar.ok) {
    throw new Error(`Beregning i Fiks-simulatoren feilet med status ${svar.status}.`);
  }
  return svar.json();
}

function sisteInntektsaar(tilstand: State, personId: string) {
  const husstand = hentHusstandForPerson(tilstand, personId);
  const identer = husstand.medlemmer
    .filter((medlem: any) => medlem.rolle === "foresatt")
    .map((medlem: any) => finnPerson(tilstand, medlem.personId)?.syntetiskFodselsnummer);
  const aar = tilstand.inntekter
    .filter((rad: any) => identer.includes(rad.identifikator))
    .map((rad: any) => rad.inntektsaar);
  return aar.length ? Math.max(...aar) : new Date().getFullYear() - 1;
}

export async function hentInntektForPerson(tilstand: State, personId: string) {
  return hentInntektsgrunnlag(tilstand, personId, sisteInntektsaar(tilstand, personId));
}

function formatBelop(belop: number) {
  return new Intl.NumberFormat("nb-NO").format(Math.round(belop));
}

// Age is computed at the rates' effective date, not at call time, so the same test
// person yields the same outcome whenever the demo runs.
function alderVed(foedselsdato: string, referansedato: string): number {
  const foedt = new Date(foedselsdato);
  const referanse = new Date(referansedato);
  const alder = referanse.getFullYear() - foedt.getFullYear();
  const foerBursdag =
    referanse.getMonth() < foedt.getMonth() ||
    (referanse.getMonth() === foedt.getMonth() && referanse.getDate() < foedt.getDate());
  return foerBursdag ? alder - 1 : alder;
}

// The ordninger in data/satser.json scope which children they cover, via
// trinnFra/trinnTil for SFO and alderFraAar/alderTilAar for barnehage. These
// fields went unused, so a husstand could be granted an ordning on the basis of a
// child outside the target group.
function plasserSomKvalifiserer(tilstand: State, personId: string, ordning: Ordning, satser: Satser) {
  return hentPlasserForTjeneste(tilstand, personId, ordning.tjeneste).filter((plass: Plass) => {
    if (ordning.trinnFra !== undefined || ordning.trinnTil !== undefined) {
      if (typeof plass.trinn !== "number") return false;
      if (ordning.trinnFra !== undefined && plass.trinn < ordning.trinnFra) return false;
      if (ordning.trinnTil !== undefined && plass.trinn > ordning.trinnTil) return false;
    }
    if (ordning.alderFraAar !== undefined || ordning.alderTilAar !== undefined) {
      const barn = finnPerson(tilstand, plass.personId);
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

type RegelKontekst = {
  tilstand: State;
  personId: string;
  ordning: Ordning;
  satser: Satser;
  /** The household's beregningsbeloep from the Fiks simulator. */
  grunnlag: number;
  /** Fields every assessment attaches as its explanation. */
  felles: Record<string, unknown>;
  /** Note that the tax assessment is not final, or an empty string. */
  forbehold: string;
};

// One handler per rule type in data/satser.json. A new rule type is one entry
// here, the same way a new resource is one entry in ressurser.ts.
// Record<Regeltype, ...> makes the compiler demand a handler as soon as a new
// rule type is added to types.ts.
export const regelHandtere: Record<Regeltype, (k: RegelKontekst) => SjekkResultat> = {
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
    const godkjent = grunnlag < grense;
    return {
      godkjent,
      melding: godkjent
        ? `Husholdningens inntektsgrunnlag er ${formatBelop(grunnlag)} kr, under grensen på ${formatBelop(grense)} kr for ${ordning.navn}.${forbehold}`
        : `Husholdningens inntektsgrunnlag er ${formatBelop(grunnlag)} kr, over grensen på ${formatBelop(grense)} kr for ${ordning.navn}.${forbehold}`,
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
    const tak = satser.maksAndelAvInntekt * grunnlag;
    const godkjent = aarspris > tak;
    return {
      godkjent,
      melding: godkjent
        ? `Full pris er ${formatBelop(aarspris)} kr i året, mer enn ${Math.round(satser.maksAndelAvInntekt * 100)} % av inntektsgrunnlaget på ${formatBelop(grunnlag)} kr (${formatBelop(tak)} kr). Du har rett til redusert betaling.${forbehold}`
        : `Full pris er ${formatBelop(aarspris)} kr i året, som er under ${Math.round(satser.maksAndelAvInntekt * 100)} % av inntektsgrunnlaget på ${formatBelop(grunnlag)} kr (${formatBelop(tak)} kr). Du har ikke rett til redusert betaling.${forbehold}`,
      grunnlag: { ...felles, aarspris, maksAndelAvInntekt: satser.maksAndelAvInntekt, tak: Math.round(tak) }
    };
  }
};

// Picks the ordning within a tjeneste that the household can actually be assessed
// for. sfo-moderasjon used to hardcode redusert-sfo-2-3-trinn, so a household whose
// only child is in first or fourth grade was told "no SFO place in 2nd-3rd grade" —
// true, but it reads as a bug, and it hides that the child qualifies elsewhere.
export function velgOrdningForTjeneste(
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

// Assesses one ordning in data/satser.json against the income basis from Fiks.
// The calculation is deterministic and happens here, not in the AI layer — see
// ai-no-decisions in policies/ai-policy.yaml.
export async function vurderOrdning(tilstand: State, personId: string, ordningId: string | null): Promise<SjekkResultat> {
  const satser: Satser = tilstand.satser;
  const ordning = satser.ordninger.find((kandidat) => kandidat.id === ordningId);
  if (!ordning) {
    throw new Error(`Ukjent ordning: ${ordningId}. Gyldige: ${satser.ordninger.map((o) => o.id).join(", ")}.`);
  }

  const beregning = await hentInntektsgrunnlag(tilstand, personId, sisteInntektsaar(tilstand, personId));
  if (beregning.feilmeldinger.length > 0) {
    const feil = beregning.feilmeldinger[0];
    return {
      godkjent: false,
      melding: feil.melding,
      grunnlag: { ordning: ordning.id, feilkode: feil.kode, stadie: beregning.stadie }
    };
  }

  const grunnlag = beregning.beregningsbeloep;
  const felles = {
    ordning: ordning.id,
    ordningNavn: ordning.navn,
    beregningsbeloep: grunnlag,
    stadie: beregning.stadie,
    gjelderFra: satser.gjelderFra,
    kilde: satser.kilde
  };
  const forbehold = beregning.stadie === "UTKAST"
    ? " Merk at skatteoppgjøret ikke er ferdig, så grunnlaget kan endre seg."
    : "";

  const handterer = regelHandtere[ordning.regel as Regeltype];
  if (!handterer) {
    throw new Error(
      `Ukjent regeltype: ${ordning.regel}. Gyldige: ${Object.keys(regelHandtere).join(", ")}.`
    );
  }

  return handterer({ tilstand, personId, ordning, satser, grunnlag, felles, forbehold });
}

export function harGyldigSamtykke(tilstand: State, personId: string, datakilde: string) {
  return tilstand.samtykker.find((samtykke: any) =>
    samtykke.personId === personId &&
    samtykke.status === "SAMTYKKET" &&
    Array.isArray(samtykke.dataKilder) &&
    samtykke.dataKilder.includes(datakilde)
  ) || null;
}
