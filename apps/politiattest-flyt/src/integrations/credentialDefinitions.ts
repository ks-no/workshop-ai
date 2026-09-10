// Denne filen speiler bevisbyggingen i apps/lommebok/src/data/credentials.ts med vilje,
// istedenfor å importere den: de to appene er separate Vite-prosjekter uten delt
// buildsteg, og et forsøk på å importere over app-grensen ville krevd at Vites
// dev-server fikk lov til å lese filer utenfor sin egen rot. Denne filen er derfor en
// bevisst, testet og minimal kopi - begrenset til akkurat de to bevisene denne
// demoen bruker (formålsbekreftelse og politiattest for formål "skole"), ikke hele
// katalogen fra lommebok. Endres claim-formen i lommebok, må denne oppdateres i takt.
//
// Én forskjell fra originalen: utsteder på formålsbekreftelsen er alltid
// "Drammen kommune" her, uavhengig av personens faktiske bostedskommune - se
// planpunktet om at Drammen er et overstyrt saksbehandler-claim, ikke et faktum
// om personen.

import type { Person } from "../types";
import { anmerkningerForLommebok } from "../../../shared/lommebokbevis";

export const CREDENTIAL_CONFIGURATION_IDS = {
  formalsbekreftelse: "net.eidas2sandkasse:ks_hackathon_formalsbekreftelse_sd_jwt_vc",
  politiattest: "net.eidas2sandkasse:ks_hackathon_politiattest_sd_jwt_vc"
} as const;

export const CREDENTIAL_VCT = {
  formalsbekreftelse: "net.eidas2sandkasse:ks_hackathon_formalsbekreftelse",
  politiattest: "net.eidas2sandkasse:ks_hackathon_politiattest"
} as const;

const DRAMMEN_KOMMUNE_NAVN = "Drammen kommune";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function maanedereEtter(isodato: string, antall: number): string {
  const [aar, maaned, dag] = isodato.split("-").map(Number);
  const totalMaaneder = aar * 12 + maaned - 1 + antall;
  const nyttAar = Math.floor(totalMaaneder / 12);
  const nyMaaned = (totalMaaneder % 12) + 1;
  const sisteDag = new Date(Date.UTC(nyttAar, nyMaaned, 0)).getUTCDate();
  const nyDag = Math.min(dag, sisteDag);
  return `${String(nyttAar).padStart(4, "0")}-${String(nyMaaned).padStart(2, "0")}-${String(nyDag).padStart(2, "0")}`;
}

const LOVDATA_IDER: Record<string, string> = {
  "opplæringslova": "2023-06-09-30",
  "politiregisterloven": "2010-05-28-16"
};

function hjemmelSomUri(hjemmel: string): string {
  const lovnavn = Object.keys(LOVDATA_IDER).find((navn) => hjemmel.startsWith(navn));
  const lovdataId = lovnavn ? LOVDATA_IDER[lovnavn] : undefined;
  return lovdataId ? `https://lovdata.no/dokument/NL/lov/${lovdataId}` : "https://lovdata.no";
}

function attestFor(person: Person) {
  const attest = person.politiattest;
  return {
    attestId: attest?.attestId || `att-${person.personId.replace(/\D/g, "").padStart(4, "0")}`,
    formaal: attest?.formaal || "skole",
    attesttype: attest?.attesttype || "barneomsorgsattest",
    hjemmel: attest?.hjemmel || "opplæringslova § 17-11, jf. politiregisterloven § 39 første ledd",
    anmerkninger: attest?.anmerkninger || [],
    utstedt: attest?.utstedt || todayIso()
  };
}

export function byggFormalsbevisClaims(person: Person): Record<string, unknown> {
  const attest = attestFor(person);
  return {
    issuance_date: todayIso(),
    rolle: attest.formaal,
    ordning: `politiattest-${attest.formaal}`,
    person: {
      person_id: person.personId,
      foedselsnummer: person.syntetiskFodselsnummer,
      fornavn: person.navn.fornavn,
      etternavn: person.navn.etternavn
    },
    utsteder: { navn: DRAMMEN_KOMMUNE_NAVN },
    maks_alder_maaneder: 3,
    syntetisk: true,
    rettslig_grunnlag: {
      formaal: attest.formaal,
      attesttype: attest.attesttype,
      hjemmel: attest.hjemmel
    },
    beskrivelse: "Kommunen bekrefter formålet med politiattesten som skal legges fram.",
    instruksjoner: [
      "Du søker selv hos politiet med denne bekreftelsen som vedlegg.",
      "Kommunen registrerer at kontrollen er gjort og beholder ikke attesten."
    ]
  };
}

export function byggFormalsbevisDcqlQuery() {
  return {
    credentials: [{
      id: "formalsbekreftelse-bevis",
      format: "dc+sd-jwt",
      meta: { vct_values: [CREDENTIAL_VCT.formalsbekreftelse] },
      claims: [
        { path: ["rolle"] },
        { path: ["ordning"] },
        { path: ["person"] },
        { path: ["rettslig_grunnlag"] }
      ]
    }]
  };
}

export function byggPolitiattestClaims(person: Person): Record<string, unknown> {
  const attest = attestFor(person);
  const antallAnmerkninger = attest.anmerkninger.length;
  return {
    issuance_date: attest.utstedt,
    attest_id: attest.attestId,
    attesttype: attest.attesttype,
    formaal: attest.formaal,
    antall_anmerkninger: antallAnmerkninger,
    anmerkninger: anmerkningerForLommebok(antallAnmerkninger),
    expiry_date: maanedereEtter(attest.utstedt, 3),
    hjemmel: hjemmelSomUri(attest.hjemmel),
    utsteder: {
      navn: "Politiet",
      enhet: "Enhet for vandelskontroll og politiattester",
      organisasjonsnummer: "889640782"
    },
    syntetisk: true,
    innehaver: {
      person_id: person.personId,
      foedselsnummer: person.syntetiskFodselsnummer,
      fornavn: person.navn.fornavn,
      etternavn: person.navn.etternavn
    }
  };
}

export function byggPolitiattestDcqlQuery() {
  return {
    credentials: [{
      id: "politiattest-bevis",
      format: "dc+sd-jwt",
      meta: { vct_values: [CREDENTIAL_VCT.politiattest] },
      claims: [
        { path: ["attest_id"] },
        { path: ["attesttype"] },
        { path: ["formaal"] },
        { path: ["issuance_date"] },
        { path: ["antall_anmerkninger"] },
        { path: ["expiry_date"] },
        { path: ["innehaver"] }
      ]
    }]
  };
}

// Akseptgaten: en vellykket verifisering er ikke nok alene. Vi sjekker at beviset
// faktisk gjelder formål "skole", at det tilhører personen saken gjelder, og at det
// ikke er utløpt - før flyten får lov til å gå videre til neste steg.
export interface AksepttestResultat {
  ok: boolean;
  aarsak: string | null;
}

export function sjekkFormalsbevisAksept(
  claims: Record<string, unknown> | null,
  forventetPerson: Person
): AksepttestResultat {
  if (!claims) return { ok: false, aarsak: "Ingen data mottatt fra beviset." };
  if (claims["rolle"] !== "skole") {
    return { ok: false, aarsak: `Feil formål på beviset: forventet «skole», fikk «${String(claims["rolle"])}».` };
  }
  const person = claims["person"] as Record<string, unknown> | undefined;
  if (!person || person["foedselsnummer"] !== forventetPerson.syntetiskFodselsnummer) {
    return { ok: false, aarsak: "Beviset tilhører ikke personen saken gjelder." };
  }
  return { ok: true, aarsak: null };
}

export function sjekkPolitiattestAksept(
  claims: Record<string, unknown> | null,
  forventetPerson: Person
): AksepttestResultat {
  if (!claims) return { ok: false, aarsak: "Ingen data mottatt fra beviset." };
  if (claims["formaal"] !== "skole") {
    return { ok: false, aarsak: `Feil formål på attesten: forventet «skole», fikk «${String(claims["formaal"])}».` };
  }
  const innehaver = claims["innehaver"] as Record<string, unknown> | undefined;
  if (!innehaver || innehaver["foedselsnummer"] !== forventetPerson.syntetiskFodselsnummer) {
    return { ok: false, aarsak: "Attesten tilhører ikke personen saken gjelder." };
  }
  const utlopsdato = claims["expiry_date"];
  if (typeof utlopsdato === "string" && utlopsdato < todayIso()) {
    return { ok: false, aarsak: `Attesten er utløpt (${utlopsdato}).` };
  }
  return { ok: true, aarsak: null };
}
