import { CredentialDefinition, CredentialId, Person } from "../types";

// Datoer er aritmetikk på ISO-strenger, aldri new Date() med lokale getters.
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function maanedereEtter(isodato: string, antall: number): string {
  const [aar, maaned, dag] = isodato.split("-").map(Number);
  const totalMaaneder = aar * 12 + (maaned - 1) + antall;
  const nyttAar = Math.floor(totalMaaneder / 12);
  const nyMaaned = (totalMaaneder % 12) + 1;
  const sisteDag = new Date(Date.UTC(nyttAar, nyMaaned, 0)).getUTCDate();
  const nyDag = Math.min(dag, sisteDag);
  return `${String(nyttAar).padStart(4, "0")}-${String(nyMaaned).padStart(2, "0")}-${String(nyDag).padStart(2, "0")}`;
}

export const CREDENTIAL_DEFINITIONS: Record<CredentialId, CredentialDefinition> = {
  formalsbekreftelse: {
    id: "formalsbekreftelse",
    tittel: "Formålsbekreftelse (politiattest)",
    beskrivelse: "Kommunal bekreftelse på at personen skal legge fram en politiattest. Inneholder formål, attesttype og rettslig grunnlag, og legges ved når personen søker hos politiet.",
    utstederNavn: "Kommunen (KS-sandkasse)",
    format: "dc+sd-jwt",
    vct: "net.eidas2sandkasse:ks_hackathon_formalsbekreftelse",
    credentialConfigurationId: "net.eidas2sandkasse:ks_hackathon_formalsbekreftelse_sd_jwt_vc",
    defaultIssuerUrl: "https://utsteder.test.eidas2sandkasse.net/bevisgenerator",
    claims: [
      { path: "issuance_date", label: "Utgivelsesdato", required: true },
      { path: "rolle", label: "Rolle", required: true },
      { path: "ordning", label: "Ordning", required: true },
      { path: "person", label: "Person", required: true },
      { path: "utsteder.navn", label: "Utsteder" },
      { path: "maks_alder_maaneder", label: "Maks alder (måneder)" },
      { path: "rettslig_grunnlag", label: "Rettslig grunnlag" },
      { path: "beskrivelse", label: "Beskrivelse" },
      { path: "instruksjoner", label: "Instruksjoner" }
    ],
    lagEksempelData: (person: Person) => ({
      issuance_date: todayIso(),
      rolle: "barnehage",
      ordning: "politiattest-barnehage",
      person: {
        person_id: person.personId,
        foedselsnummer: person.syntetiskFodselsnummer,
        fornavn: person.navn.fornavn,
        etternavn: person.navn.etternavn
      },
      utsteder: {
        navn: `${person.bostedsadresse?.kommune || "Drammen"} kommune`
      },
      maks_alder_maaneder: "3",
      syntetisk: "true",
      rettslig_grunnlag: {
        formaal: "barnehage",
        attesttype: "barneomsorgsattest",
        hjemmel: "barnehageloven § 30, jf. politiregisterloven § 39 første ledd"
      },
      beskrivelse: "Den som skal arbeide i barnehage må legge fram barneomsorgsattest. Den som er dømt for seksuelle overgrep mot mindreårige er utelukket. Andre anmerkninger må vurderes konkret.",
      instruksjoner: [
        "Du søker selv hos politiet, med denne bekreftelsen som vedlegg. Behandlingstiden er rundt to uker, og attesten kommer i din digitale postkasse.",
        "Kommunen ser attesten og registrerer at kontrollen er gjort. Forskriften krever at den makuleres straks den er brukt i tilsettingssaken."
      ]
    }),
    lagDcqlQuery: () => ({
      credentials: [
        {
          id: "formalsbekreftelse-bevis",
          format: "dc+sd-jwt",
          meta: {
            vct_values: ["net.eidas2sandkasse:ks_hackathon_formalsbekreftelse"]
          },
          claims: [
            { path: ["rolle"] },
            { path: ["ordning"] },
            { path: ["person"] },
            { path: ["rettslig_grunnlag"] },
            { path: ["maks_alder_maaneder"] }
          ]
        }
      ]
    })
  },

  politiattest: {
    id: "politiattest",
    tittel: "Politiattest (barneomsorgsattest)",
    beskrivelse: "Attest fra politiet for vandel, med formål, attesttype, anmerkninger og utløpsdato.",
    utstederNavn: "Politiet (Enhet for vandelskontroll og politiattester)",
    format: "dc+sd-jwt",
    vct: "net.eidas2sandkasse:ks_hackathon_politiattest",
    credentialConfigurationId: "net.eidas2sandkasse:ks_hackathon_politiattest_sd_jwt_vc",
    defaultIssuerUrl: "https://utsteder.test.eidas2sandkasse.net/bevisgenerator",
    claims: [
      { path: "issuance_date", label: "Utgivelsesdato", required: true },
      { path: "attesttype", label: "Attesttype", required: true },
      { path: "formaal", label: "Formål", required: true },
      { path: "antall_anmerkninger", label: "Antall anmerkninger", required: true },
      { path: "anmerkninger", label: "Anmerkninger" },
      { path: "expiry_date", label: "Utløpsdato" },
      { path: "hjemmel", label: "Hjemmel" },
      { path: "utsteder", label: "Utsteder" },
      { path: "innehaver", label: "Innehaver" }
    ],
    lagEksempelData: (person: Person) => {
      const utgivelsesdato = todayIso();
      const attestId = `att-${person.personId.replace(/\D/g, "").padStart(4, "0")}`;
      return {
        issuance_date: utgivelsesdato,
        antall_anmerkninger: "0",
        attesttype: "barneomsorgsattest",
        anmerkninger: [],
        hjemmel: "barnehageloven § 30, jf. politiregisterloven § 39 første ledd",
        formaal: "barnehage",
        expiry_date: maanedereEtter(utgivelsesdato, 3),
        utsteder: {
          navn: "Politiet",
          enhet: "Enhet for vandelskontroll og politiattester",
          organisasjonsnummer: "889640782"
        },
        syntetisk: "true",
        attest_id: attestId,
        innehaver: {
          person_id: person.personId,
          foedselsnummer: person.syntetiskFodselsnummer,
          fornavn: person.navn.fornavn,
          etternavn: person.navn.etternavn
        }
      };
    },
    lagDcqlQuery: () => ({
      credentials: [
        {
          id: "politiattest-bevis",
          format: "dc+sd-jwt",
          meta: {
            vct_values: ["net.eidas2sandkasse:ks_hackathon_politiattest"]
          },
          claims: [
            { path: ["attesttype"] },
            { path: ["formaal"] },
            { path: ["antall_anmerkninger"] },
            { path: ["anmerkninger"] },
            { path: ["expiry_date"] },
            { path: ["innehaver"] }
          ]
        }
      ]
    })
  }
};
