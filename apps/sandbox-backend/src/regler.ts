import { fiksBaseUrl, fiksRolleId } from "./konfig.ts";
import {
  finnPerson,
  hentHusstandForPerson,
  hentPlasserForTjeneste
} from "./tilstand.ts";
import type { Ordning, Plass, Regeltype, Satser, SjekkResultat, Tilstand } from "./typer.ts";

// Henter inntektsgrunnlaget fra Fiks-simulatoren for hele husholdningen.
// Ektefeller, registrerte partnere og samboere regnes som én husholdning,
// jf. forskrift om foreldrebetaling.
// Returtypen er any inntil Fiks-responsen er modellert i typer.ts.
async function hentInntektsgrunnlag(tilstand: Tilstand, personId: string, inntektsaar: number): Promise<any> {
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

function sisteInntektsaar(tilstand: Tilstand, personId: string) {
  const husstand = hentHusstandForPerson(tilstand, personId);
  const identer = husstand.medlemmer
    .filter((medlem: any) => medlem.rolle === "foresatt")
    .map((medlem: any) => finnPerson(tilstand, medlem.personId)?.syntetiskFodselsnummer);
  const aar = tilstand.inntekter
    .filter((rad: any) => identer.includes(rad.identifikator))
    .map((rad: any) => rad.inntektsaar);
  return aar.length ? Math.max(...aar) : new Date().getFullYear() - 1;
}

export async function hentInntektForPerson(tilstand: Tilstand, personId: string) {
  return hentInntektsgrunnlag(tilstand, personId, sisteInntektsaar(tilstand, personId));
}

function formaterBelop(belop: number) {
  return new Intl.NumberFormat("nb-NO").format(Math.round(belop));
}

// Alder regnes ved satsenes ikrafttredelse, ikke ved kalltidspunktet, slik at
// samme testperson gir samme utfall uansett når demoen kjøres.
function alderVed(foedselsdato: string, referansedato: string): number {
  const foedt = new Date(foedselsdato);
  const referanse = new Date(referansedato);
  const alder = referanse.getFullYear() - foedt.getFullYear();
  const foerBursdag =
    referanse.getMonth() < foedt.getMonth() ||
    (referanse.getMonth() === foedt.getMonth() && referanse.getDate() < foedt.getDate());
  return foerBursdag ? alder - 1 : alder;
}

// Ordningene i data/satser.json avgrenser hvilke barn de gjelder for, med
// trinnFra/trinnTil for SFO og alderFraAar/alderTilAar for barnehage. Feltene
// lå ubrukt til nå, så en husstand kunne få innvilget en ordning på grunnlag av
// et barn som falt utenfor målgruppen.
function plasserSomKvalifiserer(tilstand: Tilstand, personId: string, ordning: Ordning, satser: Satser) {
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
  tilstand: Tilstand;
  personId: string;
  ordning: Ordning;
  satser: Satser;
  /** Husholdningens beregningsbeløp fra Fiks-simulatoren. */
  grunnlag: number;
  /** Feltene alle vurderinger legger ved som forklaring. */
  felles: Record<string, unknown>;
  /** Tilføyelse om at skatteoppgjøret ikke er ferdig, eller tom streng. */
  forbehold: string;
};

// Én håndterer per regeltype i data/satser.json. Ny regeltype = én oppføring
// her, på samme måte som en ny ressurs er én oppføring i ressurser.ts.
// Record<Regeltype, ...> gjør at kompilatoren krever en håndterer så snart
// en ny regeltype legges til i typer.ts.
export const regelHandtere: Record<Regeltype, (k: RegelKontekst) => SjekkResultat> = {
  INNTEKTSGRENSE: ({ tilstand, personId, ordning, satser, grunnlag, felles, forbehold }) => {
    const kvalifiserte = plasserSomKvalifiserer(tilstand, personId, ordning, satser);
    if (kvalifiserte.length === 0) {
      return {
        godkjent: false,
        melding: `Fant ingen ${ordning.tjeneste}-plass${kriterieTekst(ordning)} registrert på husstanden.`,
        grunnlag: felles
      };
    }
    const grense = ordning.inntektsgrense!;
    const godkjent = grunnlag < grense;
    return {
      godkjent,
      melding: godkjent
        ? `Husholdningens inntektsgrunnlag er ${formaterBelop(grunnlag)} kr, under grensen på ${formaterBelop(grense)} kr for ${ordning.navn}.${forbehold}`
        : `Husholdningens inntektsgrunnlag er ${formaterBelop(grunnlag)} kr, over grensen på ${formaterBelop(grense)} kr for ${ordning.navn}.${forbehold}`,
      grunnlag: { ...felles, inntektsgrense: grense, antallKvalifiserendePlasser: kvalifiserte.length }
    };
  },

  MAKS_ANDEL_AV_INNTEKT: ({ tilstand, personId, ordning, satser, grunnlag, felles, forbehold }) => {
    const plasser = plasserSomKvalifiserer(tilstand, personId, ordning, satser);
    if (plasser.length === 0) {
      return {
        godkjent: false,
        melding: `Fant ingen ${ordning.tjeneste}-plass${kriterieTekst(ordning)} registrert på husstanden.`,
        grunnlag: felles
      };
    }
    const aarspris = plasser.reduce((sum: number, p: any) => sum + p.manedspris, 0) * satser.maanederMedBetaling;
    const tak = satser.maksAndelAvInntekt * grunnlag;
    const godkjent = aarspris > tak;
    return {
      godkjent,
      melding: godkjent
        ? `Full pris er ${formaterBelop(aarspris)} kr i året, mer enn ${Math.round(satser.maksAndelAvInntekt * 100)} % av inntektsgrunnlaget på ${formaterBelop(grunnlag)} kr (${formaterBelop(tak)} kr). Du har rett til redusert betaling.${forbehold}`
        : `Full pris er ${formaterBelop(aarspris)} kr i året, som er under ${Math.round(satser.maksAndelAvInntekt * 100)} % av inntektsgrunnlaget på ${formaterBelop(grunnlag)} kr (${formaterBelop(tak)} kr). Du har ikke rett til redusert betaling.${forbehold}`,
      grunnlag: { ...felles, aarspris, maksAndelAvInntekt: satser.maksAndelAvInntekt, tak: Math.round(tak) }
    };
  }
};

// Vurderer én ordning i data/satser.json mot inntektsgrunnlaget fra Fiks.
// Beregningen er deterministisk og skjer her, ikke i KI-laget — jf.
// regelen ai-no-decisions i policies/ai-policy.yaml.
export async function vurderOrdning(tilstand: Tilstand, personId: string, ordningId: string | null): Promise<SjekkResultat> {
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

export function harGyldigSamtykke(tilstand: Tilstand, personId: string, datakilde: string) {
  return tilstand.samtykker.find((samtykke: any) =>
    samtykke.personId === personId &&
    samtykke.status === "SAMTYKKET" &&
    Array.isArray(samtykke.dataKilder) &&
    samtykke.dataKilder.includes(datakilde)
  ) || null;
}
