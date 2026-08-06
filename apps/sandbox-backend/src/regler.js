import { fiksBaseUrl, fiksRolleId } from "./konfig.js";
import {
  finnGate,
  finnPerson,
  hentBarnehageForPerson,
  hentHusstandForPerson,
  hentSfoForPerson
} from "./tilstand.js";

// Henter inntektsgrunnlaget fra Fiks-simulatoren for hele husholdningen.
// Ektefeller, registrerte partnere og samboere regnes som én husholdning,
// jf. forskrift om foreldrebetaling.
async function hentInntektsgrunnlag(tilstand, personId, inntektsaar) {
  const husstand = hentHusstandForPerson(tilstand, personId);
  const personer = husstand.medlemmer
    .filter((medlem) => medlem.rolle === "foresatt")
    .map((medlem) => {
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

function sisteInntektsaar(tilstand, personId) {
  const husstand = hentHusstandForPerson(tilstand, personId);
  const identer = husstand.medlemmer
    .filter((medlem) => medlem.rolle === "foresatt")
    .map((medlem) => finnPerson(tilstand, medlem.personId)?.syntetiskFodselsnummer);
  const aar = tilstand.inntekter
    .filter((rad) => identer.includes(rad.identifikator))
    .map((rad) => rad.inntektsaar);
  return aar.length ? Math.max(...aar) : new Date().getFullYear() - 1;
}

export async function hentInntektForPerson(tilstand, personId) {
  return hentInntektsgrunnlag(tilstand, personId, sisteInntektsaar(tilstand, personId));
}

function formaterBelop(belop) {
  return new Intl.NumberFormat("nb-NO").format(Math.round(belop));
}

// Vurderer én ordning i data/satser.json mot inntektsgrunnlaget fra Fiks.
// Beregningen er deterministisk og skjer her, ikke i KI-laget — jf.
// regelen ai-no-decisions i policies/ai-policy.yaml.
export async function vurderOrdning(tilstand, personId, ordningId) {
  const satser = tilstand.satser;
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

  if (ordning.regel === "INNTEKTSGRENSE") {
    const godkjent = grunnlag < ordning.inntektsgrense;
    return {
      godkjent,
      melding: godkjent
        ? `Husholdningens inntektsgrunnlag er ${formaterBelop(grunnlag)} kr, under grensen på ${formaterBelop(ordning.inntektsgrense)} kr for ${ordning.navn}.${forbehold}`
        : `Husholdningens inntektsgrunnlag er ${formaterBelop(grunnlag)} kr, over grensen på ${formaterBelop(ordning.inntektsgrense)} kr for ${ordning.navn}.${forbehold}`,
      grunnlag: { ...felles, inntektsgrense: ordning.inntektsgrense }
    };
  }

  if (ordning.regel === "MAKS_ANDEL_AV_INNTEKT") {
    const plasser = ordning.tjeneste === "sfo"
      ? hentSfoForPerson(tilstand, personId)
      : hentBarnehageForPerson(tilstand, personId);
    if (plasser.length === 0) {
      return {
        godkjent: false,
        melding: `Fant ingen ${ordning.tjeneste}-plass registrert på husstanden.`,
        grunnlag: felles
      };
    }
    const aarspris = plasser.reduce((sum, p) => sum + p.manedspris, 0) * satser.maanederMedBetaling;
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

  throw new Error(`Ukjent regeltype: ${ordning.regel}.`);
}

// SJEKK-steg slår opp her på sti. Nye sjekker legges til i tabellen uten at
// stegutførelsen må røres. Hver håndterer returnerer { godkjent, melding }
// og kan legge ved et grunnlag som forklarer utfallet.
export const sjekkHandtere = {
  "/api/matrikkel/sjekk/eierforhold": async (params, oekt, tilstand, steg) => {
    const gateNavn = decodeURIComponent(params.get("gate") || "");
    const sjekkerPersonId = decodeURIComponent(params.get("personId") || oekt.personId);
    const gateData = finnGate(tilstand, gateNavn);
    if (!gateData) {
      return { godkjent: false, melding: `Fant ikke gaten "${gateNavn}" i matrikkelen.` };
    }
    const harEiendom = gateData.eiendommer.some(
      (e) => Array.isArray(e.eiere) && e.eiere.includes(sjekkerPersonId)
    );
    return harEiendom
      ? { godkjent: true, melding: `Eierforhold i ${gateData.adressenavn} bekreftet.` }
      : {
          godkjent: false,
          melding: steg.feilmelding || `Du har ingen registrert eiendom i ${gateData.adressenavn}. Søknad om fartsdempende tiltak kan bare sendes av eiere i gaten.`
        };
  },

  "/api/regler/sjekk/foreldrebetaling": async (params, oekt, tilstand) => {
    const personId = decodeURIComponent(params.get("personId") || oekt.personId);
    const ordning = params.get("ordning");
    return vurderOrdning(tilstand, personId, ordning);
  }
};

export function harGyldigSamtykke(tilstand, personId, datakilde) {
  return tilstand.samtykker.find((samtykke) =>
    samtykke.personId === personId &&
    samtykke.status === "SAMTYKKET" &&
    Array.isArray(samtykke.dataKilder) &&
    samtykke.dataKilder.includes(datakilde)
  ) || null;
}
