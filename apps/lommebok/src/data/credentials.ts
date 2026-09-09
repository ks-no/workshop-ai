import { CredentialDefinition, CredentialId, Person } from "../types";

const ISSUER_URL = "https://utsteder.test.eidas2sandkasse.net/bevisgenerator";

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
  "barnehageloven": "2005-06-17-64",
  "opplæringslova": "2023-06-09-30",
  "helse- og omsorgstjenesteloven": "2011-06-24-30",
  "politiregisterloven": "2010-05-28-16"
};

function hjemmelSomUri(hjemmel: string): string {
  const lovnavn = Object.keys(LOVDATA_IDER).find((navn) => hjemmel.startsWith(navn));
  const lovdataId = lovnavn ? LOVDATA_IDER[lovnavn] : undefined;
  return lovdataId
    ? `https://lovdata.no/dokument/NL/lov/${lovdataId}`
    : "https://lovdata.no";
}

function attestFor(person: Person) {
  const attest = person.politiattest;
  return {
    attestId: attest?.attestId || `att-${person.personId.replace(/\D/g, "").padStart(4, "0")}`,
    formaal: attest?.formaal || "barnehage",
    attesttype: attest?.attesttype || "barneomsorgsattest",
    hjemmel: attest?.hjemmel || "barnehageloven § 30, jf. politiregisterloven § 39 første ledd",
    anmerkninger: attest?.anmerkninger || [],
    utstedt: attest?.utstedt || todayIso(),
    utsteder: attest?.utsteder || {
      navn: "Politiet",
      enhet: "Enhet for vandelskontroll og politiattester",
      organisasjonsnummer: "889640782"
    }
  };
}

export const CREDENTIAL_DEFINITIONS: Record<CredentialId, CredentialDefinition> = {
  formalsbekreftelse: {
    id: "formalsbekreftelse",
    tittel: "Formålsbekreftelse (politiattest)",
    beskrivelse: "Kommunal bekreftelse på at personen skal legge fram politiattest.",
    utstederNavn: "Kommunen (KS-sandkasse)",
    format: "dc+sd-jwt",
    vct: "net.eidas2sandkasse:ks_hackathon_formalsbekreftelse",
    credentialConfigurationId: "net.eidas2sandkasse:ks_hackathon_formalsbekreftelse_sd_jwt_vc",
    defaultIssuerUrl: ISSUER_URL,
    claims: [
      { path: "issuance_date", label: "Utgivelsesdato", required: true },
      { path: "rolle", label: "Rolle", required: true },
      { path: "ordning", label: "Ordning", required: true },
      { path: "person", label: "Person", required: true },
      { path: "rettslig_grunnlag", label: "Rettslig grunnlag" },
      { path: "beskrivelse", label: "Beskrivelse" },
      { path: "instruksjoner", label: "Instruksjoner" }
    ],
    lagEksempelData: (person: Person) => {
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
        utsteder: { navn: `${person.bostedsadresse?.kommune || "Drammen"} kommune` },
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
    },
    lagDcqlQuery: () => ({
      credentials: [{
        id: "formalsbekreftelse-bevis",
        format: "dc+sd-jwt",
        meta: { vct_values: ["net.eidas2sandkasse:ks_hackathon_formalsbekreftelse"] },
        claims: [
          { path: ["rolle"] },
          { path: ["ordning"] },
          { path: ["person"] },
          { path: ["rettslig_grunnlag"] }
        ]
      }]
    })
  },

  politiattest: {
    id: "politiattest",
    tittel: "Politiattest",
    beskrivelse: "Politiattest med formål, attesttype, anmerkninger og utstedelsesdato fra sandkassedataene.",
    utstederNavn: "Politiet (Enhet for vandelskontroll og politiattester)",
    format: "dc+sd-jwt",
    vct: "net.eidas2sandkasse:ks_hackathon_politiattest",
    credentialConfigurationId: "net.eidas2sandkasse:ks_hackathon_politiattest_sd_jwt_vc",
    defaultIssuerUrl: ISSUER_URL,
    claims: [
      { path: "issuance_date", label: "Utgivelsesdato", required: true },
      { path: "attesttype", label: "Attesttype", required: true },
      { path: "attest_id", label: "Attest-ID", required: true },
      { path: "formaal", label: "Formål", required: true },
      { path: "antall_anmerkninger", label: "Antall anmerkninger", required: true },
      { path: "anmerkninger", label: "Anmerkninger" },
      { path: "expiry_date", label: "Utløpsdato", required: true },
      { path: "hjemmel", label: "Hjemmel" },
      { path: "utsteder", label: "Utsteder" },
      { path: "innehaver", label: "Innehaver", required: true }
    ],
    lagEksempelData: (person: Person) => {
      const attest = attestFor(person);
      const antallAnmerkninger = attest.anmerkninger.length;
      return {
        issuance_date: attest.utstedt,
        attest_id: attest.attestId,
        attesttype: attest.attesttype,
        formaal: attest.formaal,
        antall_anmerkninger: antallAnmerkninger,
        anmerkninger: attest.anmerkninger,
        expiry_date: maanedereEtter(attest.utstedt, 3),
        hjemmel: hjemmelSomUri(attest.hjemmel),
        utsteder: attest.utsteder,
        syntetisk: true,
        innehaver: {
          person_id: person.personId,
          foedselsnummer: person.syntetiskFodselsnummer,
          fornavn: person.navn.fornavn,
          etternavn: person.navn.etternavn
        }
      };
    },
    lagDcqlQuery: () => ({
      credentials: [{
        id: "politiattest-bevis",
        format: "dc+sd-jwt",
        meta: { vct_values: ["net.eidas2sandkasse:ks_hackathon_politiattest"] },
        claims: [
          { path: ["attesttype"] },
          { path: ["formaal"] },
          { path: ["antall_anmerkninger"] },
          { path: ["anmerkninger"] },
          { path: ["expiry_date"] },
          { path: ["innehaver"] }
        ]
      }]
    })
  }
};
