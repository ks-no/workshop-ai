import { CredentialDefinition, CredentialId, Person } from "../types";

export const CREDENTIAL_DEFINITIONS: Record<CredentialId, CredentialDefinition> = {
  pid: {
    id: "pid",
    tittel: "Norsk ID-bevis (PID)",
    beskrivelse: "Offisielt digitalt identitetsbevis iht. eIDAS 2.0-standarden med fødselsnummer, navn og alder.",
    utstederNavn: "Digitaliseringsdirektoratet / Skatteetaten",
    format: "dc+sd-jwt",
    vct: "urn:eudi:pid:1",
    credentialConfigurationId: "no.digdir.eudiw.pid_sd_jwt_vc",
    defaultIssuerUrl: "https://utsteder.test.eidas2sandkasse.net/pid",
    claims: [
      { path: "personal_administrative_number", label: "Fødselsnummer", required: true },
      { path: "family_name", label: "Etternavn", required: true },
      { path: "given_name", label: "Fornavn", required: true },
      { path: "birth_date", label: "Fødselsdato", required: true },
      { path: "issuing_country", label: "Utstederland" },
      { path: "issuing_authority", label: "Utsteder" }
    ],
    lagEksempelData: (person: Person) => ({
      personal_administrative_number: person.syntetiskFodselsnummer,
      given_name: person.navn.fornavn,
      family_name: person.navn.etternavn,
      birth_date: person.foedselsdato,
      issuing_country: "NO",
      issuing_authority: "Skatteetaten / Digdir",
      issuance_date: "2026-09-08",
      expiry_date: "2031-09-08"
    }),
    lagDcqlQuery: () => ({
      credentials: [
        {
          id: "pid-bevis",
          format: "dc+sd-jwt",
          meta: {
            vct_values: ["urn:eudi:pid:1"]
          },
          claims: [
            { path: ["personal_administrative_number"] },
            { path: ["given_name"] },
            { path: ["family_name"] },
            { path: ["birth_date"] }
          ]
        }
      ]
    })
  },

  krr: {
    id: "krr",
    tittel: "Digital kontaktinformasjon (KRR)",
    beskrivelse: "Bevis for verifisert e-postadresse og mobiltelefonnummer fra Kontakt- og reservasjonsregisteret.",
    utstederNavn: "Kontakt- og reservasjonsregisteret (Digdir)",
    format: "dc+sd-jwt",
    vct: "no:kontaktregisteret:kontaktinformasjon:1",
    credentialConfigurationId: "no.kontaktregisteret.kontaktinformasjon_sd_jwt_vc",
    defaultIssuerUrl: "https://utsteder.test.eidas2sandkasse.net/bevisgenerator",
    claims: [
      { path: "personidentifikator", label: "Personidentifikator", required: true },
      { path: "epostadresse", label: "E-postadresse", required: true },
      { path: "mobiltelefonnummer", label: "Mobiltelefonnummer", required: true },
      { path: "reservert", label: "Reservert mot digital post" },
      { path: "status", label: "Status i KRR" }
    ],
    lagEksempelData: (person: Person) => ({
      personidentifikator: person.syntetiskFodselsnummer,
      epostadresse: person.kontakt?.epost || `${person.navn.fornavn.toLowerCase()}@example.test`,
      mobiltelefonnummer: person.kontakt?.telefon || "+4799990001",
      reservert: false,
      status: "AKTIV",
      gyldig_fra: "2026-01-01"
    }),
    lagDcqlQuery: () => ({
      credentials: [
        {
          id: "krr-bevis",
          format: "dc+sd-jwt",
          meta: {
            vct_values: ["no:kontaktregisteret:kontaktinformasjon:1"]
          },
          claims: [
            { path: ["personidentifikator"] },
            { path: ["epostadresse"] },
            { path: ["mobiltelefonnummer"] }
          ]
        }
      ]
    })
  },

  barnehage: {
    id: "barnehage",
    tittel: "Barnehageplass",
    beskrivelse: "Kommunalt bevis som dokumenterer tildelt barnehageplass, plassprosent og barnehage.",
    utstederNavn: "KS Kommunal Barnehagetjeneste",
    format: "dc+sd-jwt",
    vct: "no:ks:barnehageplass:1",
    credentialConfigurationId: "no.ks.barnehageplass_sd_jwt_vc",
    defaultIssuerUrl: "https://utsteder.test.eidas2sandkasse.net/bevisgenerator",
    claims: [
      { path: "foresatt_identifikator", label: "Foresatt (FNR)", required: true },
      { path: "barnehagenavn", label: "Barnehagens navn", required: true },
      { path: "kommune", label: "Kommune", required: true },
      { path: "plassprosent", label: "Plassprosent", required: true },
      { path: "status", label: "Status" }
    ],
    lagEksempelData: (person: Person) => {
      const kommune = person.bostedsadresse?.kommune || "Bergen";
      return {
        foresatt_identifikator: person.syntetiskFodselsnummer,
        foresatt_navn: `${person.navn.fornavn} ${person.navn.etternavn}`,
        barnehagenavn: `${kommune} kommunale barnehage`,
        kommune: kommune,
        plassprosent: 100,
        status: "AKTIV_PLASS",
        gyldig_fra: "2026-08-15"
      };
    },
    lagDcqlQuery: () => ({
      credentials: [
        {
          id: "barnehage-bevis",
          format: "dc+sd-jwt",
          meta: {
            vct_values: ["no:ks:barnehageplass:1"]
          },
          claims: [
            { path: ["foresatt_identifikator"] },
            { path: ["barnehagenavn"] },
            { path: ["kommune"] },
            { path: ["plassprosent"] }
          ]
        }
      ]
    })
  },

  politiattest: {
    id: "politiattest",
    tittel: "Politiattest (Vandel)",
    beskrivelse: "Attest for vandel uten anmerkninger, til bruk i barnehage, skole og helse/frivillighet.",
    utstederNavn: "Politiet (Enhet for vandelskontroll)",
    format: "dc+sd-jwt",
    vct: "net.eidas2sandkasse:politi_attest",
    credentialConfigurationId: "net.eidas2sandkasse:politi_attest_sd_jwt_vc",
    defaultIssuerUrl: "https://utsteder.test.eidas2sandkasse.net/bevisgenerator",
    claims: [
      { path: "personidentifikator", label: "Fødselsnummer", required: true },
      { path: "attesttype", label: "Type attest", required: true },
      { path: "formaal", label: "Formål", required: true },
      { path: "status", label: "Status / Vandelsresultat", required: true },
      { path: "utstedt_dato", label: "Utstedt dato" }
    ],
    lagEksempelData: (person: Person) => ({
      personidentifikator: person.syntetiskFodselsnummer,
      fullt_navn: `${person.navn.fornavn} ${person.navn.etternavn}`,
      attesttype: "barneomsorgsattest",
      formaal: "barnehage og frivillighet",
      hjemmel: "politiregisterloven § 39 første ledd",
      status: "INTET_Å_BEMERKE",
      utstedt_dato: "2026-08-01",
      gyldig_til: "2026-11-01",
      is_verified: true,
      anmerkninger: []
    }),
    lagDcqlQuery: () => ({
      credentials: [
        {
          id: "politiattest-bevis",
          format: "dc+sd-jwt",
          meta: {
            vct_values: ["net.eidas2sandkasse:politi_attest", "no:ks:politiattest:1"]
          },
          claims: [
            { path: ["is_verified"] }
          ]
        }
      ]
    })
  }
};
