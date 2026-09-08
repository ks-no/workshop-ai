import { CredentialDefinition, CredentialId, Person } from "../types";

export const CREDENTIAL_DEFINITIONS: Record<CredentialId, CredentialDefinition> = {
  pid: {
    id: "pid",
    tittel: "Norsk ID-bevis (PID)",
    beskrivelse: "Offisielt digitalt identitetsbevis iht. eIDAS 2.0-standarden med fødselsnummer, navn, alder og bosted.",
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
      { path: "age_over_16", label: "Over 16 år" },
      { path: "issuing_country", label: "Utstederland" },
      { path: "issuing_authority", label: "Utsteder" },
      { path: "resident_city", label: "Bostedskommune" }
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
        age_over_16: age >= 16,
        issuing_country: "NO",
        issuing_authority: "Skatteetaten / Digdir",
        resident_postal_code: person.bostedsadresse?.postnummer || "5003",
        resident_city: person.bostedsadresse?.poststed || person.bostedsadresse?.kommune || "Bergen"
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
      { path: "status", label: "Status i KRR" },
      { path: "sist_verifisert", label: "Sist verifisert" }
    ],
    lagEksempelData: (person: Person) => {
      const epost = person.krr?.epost?.adresse || person.kontakt?.epost || `${person.navn.fornavn.toLowerCase()}@example.test`;
      const tlf = person.krr?.tlf?.nummer || person.kontakt?.telefon || "+4799990001";
      const reservert = person.krr ? person.krr.reservert : false;
      const status = person.krr?.status || "AKTIV";
      const sistVerifisert = person.krr?.epost?.sistVerifisert || "2025-11-03";

      return {
        personidentifikator: person.syntetiskFodselsnummer,
        epostadresse: epost,
        mobiltelefonnummer: tlf,
        reservert: reservert,
        status: status,
        sist_verifisert: sistVerifisert,
        gyldig_fra: "2026-01-01"
      };
    },
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
    beskrivelse: "Kommunalt bevis som dokumenterer tildelt barnehageplass, plassprosent, månedspris og barnets data.",
    utstederNavn: "KS Kommunal Barnehagetjeneste",
    format: "dc+sd-jwt",
    vct: "no:ks:barnehageplass:1",
    credentialConfigurationId: "no.ks.barnehageplass_sd_jwt_vc",
    defaultIssuerUrl: "http://localhost:8080/bevisgenerator",
    claims: [
      { path: "foresatt_identifikator", label: "Foresatt (FNR)", required: true },
      { path: "foresatt_navn", label: "Foresattes navn", required: true },
      { path: "barn_identifikator", label: "Barnets FNR", required: true },
      { path: "barn_navn", label: "Barnets navn", required: true },
      { path: "barnehagenavn", label: "Barnehagens navn", required: true },
      { path: "kommune", label: "Kommune", required: true },
      { path: "plassprosent", label: "Plassprosent", required: true },
      { path: "manedspris", label: "Månedspris (NOK)" },
      { path: "status", label: "Status" }
    ],
    lagEksempelData: (person: Person) => {
      const bhg = person.barnehageplass;
      const kommune = bhg?.kommune || person.bostedsadresse?.kommune || "Bergen";
      const bhgNavn = bhg?.barnehagenavn || `${kommune} kommunale barnehage`;
      const barnFnr = bhg?.barnFnr || "03842250055";
      const barnNavn = bhg?.barnNavn || "Ella Solberg";
      const prosent = bhg?.plassprosent ?? 100;
      const pris = bhg?.manedspris ?? 3200;

      return {
        foresatt_identifikator: person.syntetiskFodselsnummer,
        foresatt_navn: person.visningsnavn,
        barn_identifikator: barnFnr,
        barn_navn: barnNavn,
        barnehagenavn: bhgNavn,
        kommune: kommune,
        plassprosent: prosent,
        manedspris: pris,
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
            { path: ["barn_navn"] },
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
      { path: "fullt_navn", label: "Fullt navn", required: true },
      { path: "attesttype", label: "Type attest", required: true },
      { path: "formaal", label: "Formål", required: true },
      { path: "hjemmel", label: "Lovhjemmel", required: true },
      { path: "is_verified", label: "Vandel bekreftet (1 = OK)", required: true },
      { path: "status", label: "Status" },
      { path: "utstedt_dato", label: "Utstedt dato" }
    ],
    lagEksempelData: (person: Person) => {
      const attest = person.politiattest;
      const formaal = attest?.formaal || "barnehage";
      const hjemmel = attest?.hjemmel || "barnehageloven § 30, jf. politiregisterloven § 39 første ledd";
      const attesttype = attest?.attesttype || "barneomsorgsattest";
      const harAnmerkning = attest?.anmerkninger && attest.anmerkninger.length > 0;
      const status = harAnmerkning ? "HAR_ANMERKNING" : "INTET_Å_BEMERKE";
      const isVerified = harAnmerkning ? "0" : "1";
      const utstedt = attest?.utstedt || "2026-07-02";

      return {
        personidentifikator: person.syntetiskFodselsnummer,
        fullt_navn: person.visningsnavn,
        attesttype: attesttype,
        formaal: formaal,
        hjemmel: hjemmel,
        status: status,
        is_verified: isVerified,
        utstedt_dato: utstedt,
        utsteder: "Enhet for vandelskontroll og politiattester"
      };
    },
    lagDcqlQuery: () => ({
      credentials: [
        {
          id: "politiattest-bevis",
          format: "dc+sd-jwt",
          meta: {
            vct_values: ["net.eidas2sandkasse:politi_attest", "no:ks:politiattest:1"]
          },
          claims: [
            { path: ["is_verified"] },
            { path: ["formaal"] },
            { path: ["attesttype"] }
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
      { path: "kommune_nr", label: "Kommunenummer" },
      { path: "utlopsdato", label: "Utløpsdato", required: true },
      { path: "antall_ledsagere", label: "Antall ledsagere", required: true }
    ],
    lagEksempelData: (person: Person) => {
      const kommune = person.bostedsadresse?.kommune || "Bergen";
      const kommuneNr = person.bostedsadresse?.kommunenummer || "4601";
      return {
        bilde: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2P4v5ThPwAG7wKklwQ/bwAAABBkZUJHMUUwNjcxN0FCMUFFMUU5OLCZt84AAAAASUVORK5CYII=",
        navn: person.visningsnavn,
        kommune_nr: kommuneNr,
        kommune_navn: `${kommune} kommune`,
        utlopsdato: "2028-01-01",
        antall_ledsagere: "1"
      };
    },
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

  inntekt: {
    id: "inntekt",
    tittel: "Inntektsbevis (Skatteetaten)",
    beskrivelse: "Bevis for fastsatt skattbar årsinntekt fra Skatteetaten til bruk ved beregning av moderasjonsordninger.",
    utstederNavn: "Skatteetaten",
    format: "dc+sd-jwt",
    vct: "net.eidas2sandkasse:inntekts_bevis",
    credentialConfigurationId: "net.eidas2sandkasse:inntekts_bevis_sd_jwt_vc",
    defaultIssuerUrl: "https://utsteder.test.eidas2sandkasse.net/bevisgenerator",
    claims: [
      { path: "currency", label: "Valuta", required: true },
      { path: "annual_income", label: "Fastsatt årsinntekt (NOK)", required: true },
      { path: "inntektsaar", label: "Inntektsår" },
      { path: "skatteoppgjoersdato", label: "Skatteoppgjørsdato" }
    ],
    lagEksempelData: (person: Person) => {
      let totalInntekt = 0;
      if (person.inntekt?.poster && person.inntekt.poster.length > 0) {
        totalInntekt = person.inntekt.poster
          .filter((p) => p.medregnes)
          .reduce((sum, p) => sum + p.beloep, 0);
      }
      if (totalInntekt === 0) totalInntekt = 485000;

      return {
        currency: "NOK",
        annual_income: totalInntekt.toString(),
        inntektsaar: person.inntekt?.inntektsaar || 2025,
        skatteoppgjoersdato: person.inntekt?.skatteoppgjoersdato || "2026-06-15"
      };
    },
    lagDcqlQuery: () => ({
      credentials: [
        {
          id: "inntektsbevis-query",
          format: "dc+sd-jwt",
          meta: {
            vct_values: ["net.eidas2sandkasse:inntekts_bevis"]
          },
          claims: [
            { path: ["currency"] },
            { path: ["annual_income"] }
          ]
        }
      ]
    })
  }
};
