import { CredentialDefinition, CredentialId, Person } from "../types";

export const CREDENTIAL_DEFINITIONS: Record<CredentialId, CredentialDefinition> = {
  pid: {
    id: "pid",
    tittel: "Norsk ID-bevis (PID)",
    beskrivelse: "Offisielt digitalt identitetsbevis iht. eIDAS 2.0-standarden med fødselsnummer, navn og alder.",
    utstederNavn: "Digitaliseringsdirektoratet / Skatteetaten",
    format: "dc+sd-jwt",
    vct: "net.eidas2sandkasse:test_pid_sdjwt_alder",
    credentialConfigurationId: "net.eidas2sandkasse:test_pid_sdjwt_alder_sd_jwt_vc",
    defaultIssuerUrl: "https://utsteder.test.eidas2sandkasse.net/bevisgenerator",
    claims: [
      { path: "personal_administrative_number", label: "Fødselsnummer", required: true },
      { path: "family_name", label: "Etternavn", required: true },
      { path: "given_name", label: "Fornavn", required: true },
      { path: "birth_date", label: "Fødselsdato", required: true },
      { path: "age_over_18", label: "Over 18 år" },
      { path: "age_over_16", label: "Over 16 år" }
    ],
    lagEksempelData: (person: Person) => {
      const birthYear = parseInt(person.foedselsdato?.substring(0, 4) || "1990", 10);
      const age = new Date().getFullYear() - birthYear;
      return {
        personal_administrative_number: person.syntetiskFodselsnummer,
        given_name: person.navn.fornavn,
        family_name: person.navn.etternavn,
        birth_date: person.foedselsdato,
        age_over_18: age >= 18,
        age_over_16: age >= 16
      };
    },
    lagDcqlQuery: () => ({
      credentials: [
        {
          id: "pid-bevis",
          format: "dc+sd-jwt",
          meta: {
            vct_values: ["urn:eudi:pid:1", "net.eidas2sandkasse:test_pid_sdjwt_alder"]
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

  ledsagerbevis: {
    id: "ledsagerbevis",
    tittel: "Kommunalt ledsagerbevis",
    beskrivelse: "Kommunalt bevis for personer som har behov for ledsager til arrangementer og offentlige tjenester.",
    utstederNavn: "Kommunen (KS-sandkasse / Digdir)",
    format: "dc+sd-jwt",
    vct: "net.eidas2sandkasse:ledsagerbevis",
    credentialConfigurationId: "net.eidas2sandkasse:ledsagerbevis_sd_jwt_vc",
    defaultIssuerUrl: "https://utsteder.test.eidas2sandkasse.net/bevisgenerator",
    claims: [
      { path: "navn", label: "Kortholders navn", required: true },
      { path: "kommune_navn", label: "Kommune", required: true },
      { path: "utlopsdato", label: "Utløpsdato", required: true },
      { path: "antall_ledsagere", label: "Antall ledsagere", required: true }
    ],
    lagEksempelData: (person: Person) => ({
      bilde: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2P4v5ThPwAG7wKklwQ/bwAAABBkZUJHMUUwNjcxN0FCMUFFMUU5OLCZt84AAAAASUVORK5CYII=",
      navn: person.visningsnavn,
      kommune_nr: "4601",
      kommune_navn: `${person.bostedsadresse?.kommune || "Bergen"} kommune`,
      utlopsdato: "2028-01-01",
      antall_ledsagere: "1"
    }),
    lagDcqlQuery: () => ({
      credentials: [
        {
          id: "ledsagerbevis-query",
          format: "dc+sd-jwt",
          meta: {
            vct_values: ["net.eidas2sandkasse:ledsagerbevis"]
          },
          claims: [
            { path: ["navn"] },
            { path: ["kommune_navn"] },
            { path: ["antall_ledsagere"] }
          ]
        }
      ]
    })
  },

  politiattest: {
    id: "politiattest",
    tittel: "Politiattest (Vandel)",
    beskrivelse: "Attest for vandel uten anmerkninger, til bruk i barnehage, skole og frivillighet.",
    utstederNavn: "Politiet (Enhet for vandelskontroll)",
    format: "dc+sd-jwt",
    vct: "net.eidas2sandkasse:politi_attest",
    credentialConfigurationId: "net.eidas2sandkasse:politi_attest_sd_jwt_vc",
    defaultIssuerUrl: "https://utsteder.test.eidas2sandkasse.net/bevisgenerator",
    claims: [
      { path: "is_verified", label: "Vandel bekreftet (1 = OK)", required: true },
      { path: "status", label: "Status" }
    ],
    lagEksempelData: () => ({
      is_verified: "1"
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
  },

  barnehage: {
    id: "barnehage",
    tittel: "Barnehageplass",
    beskrivelse: "Kommunalt bevis som dokumenterer tildelt barnehageplass, plassprosent og barnehage.",
    utstederNavn: "KS Kommunal Barnehagetjeneste (Lokal)",
    format: "dc+sd-jwt",
    vct: "no:ks:barnehageplass:1",
    credentialConfigurationId: "no.ks.barnehageplass_sd_jwt_vc",
    defaultIssuerUrl: "http://localhost:8080/bevisgenerator",
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
  }
};
