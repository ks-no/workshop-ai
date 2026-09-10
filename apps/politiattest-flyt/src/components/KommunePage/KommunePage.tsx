import React from "react";
import type { CaseState, InboxMessage } from "../../types";
import type { SakHandling } from "../../state/caseReducer";
import { utstedBevis } from "../../integrations/lommebokApi";
import {
  formalsbevisRader,
  politiattestRaderFraClaims
} from "../../integrations/credentialPresentation";
import { StatusBadge } from "../shared/StatusBadge";
import { MetadataTable } from "../shared/MetadataTable";

interface Props {
  sak: CaseState;
  dispatch: React.Dispatch<SakHandling>;
}

// Stilen her er inspirert av drammen.kommune.no (saksbehandlerkort, journalkolonne,
// dato for søknaden) - ikke en pikselkopi. Se README for hvorfor.
export const KommunePage: React.FC<Props> = ({ sak, dispatch }) => {
  const person = sak.person;
  const [utstederLaster, setUtstederLaster] = React.useState(false);
  const [utstedelsesfeil, setUtstedelsesfeil] = React.useState<string | null>(null);

  if (!person) {
    return (
      <main className="kommune-page">
        <p>Ingen aktiv sak. Gå til Start for å velge en testperson.</p>
      </main>
    );
  }

  async function utstedFormalsbevis() {
    if (!person) return;
    setUtstederLaster(true);
    setUtstedelsesfeil(null);
    try {
      const resultat = await utstedBevis("formalsbekreftelse", person);
      const message: InboxMessage = {
        type: "utstedelse",
        id: `msg-formalsbevis-${Date.now()}`,
        kind: "formalsbekreftelse",
        title: "Formålsbekreftelsen din fra Drammen kommune er klar",
        createdAt: new Date().toISOString(),
        status: "ulest",
        issuance: {
          status: resultat.suksess ? "tilbud_klart" : "feilet",
          transactionId: resultat.transactionId,
          credentialOfferUri: resultat.credentialOfferUri,
          qrCodeDataUri: resultat.qrCodeDataUri,
          issuedAt: new Date().toISOString(),
          simulated: resultat.simulert,
          feilmelding: resultat.feilmelding
        }
      };
      const ettersporsel: InboxMessage = {
        type: "ettersporsel",
        id: `msg-ettersporsel-${Date.now()}`,
        kind: "politiattest",
        title: "Vi venter fortsatt på politiattesten din",
        createdAt: new Date().toISOString(),
        status: "ulest"
      };
      dispatch({
        type: "UTSTEDELSE_FULLFORT",
        kind: "formalsbekreftelse",
        issuance: message.issuance,
        messages: [message, ettersporsel]
      });
    } catch (err) {
      setUtstedelsesfeil(err instanceof Error ? err.message : "Ukjent feil ved utstedelse.");
    } finally {
      setUtstederLaster(false);
    }
  }

  const politiattestGodkjent = sak.politiattest.verification?.stage === "godkjent";
  const claims = sak.politiattest.verification?.claims;

  return (
    <main className="kommune-page">
      <header className="kommune-page__header">
        <span className="kommune-page__kommunevaapen" aria-hidden="true">DK</span>
        <div>
          <span className="kommune-page__etat">Drammen kommune</span>
          <h1>Jobbtilbud - skoleassistent</h1>
        </div>
      </header>

      <section className="kommune-page__saksinfo">
        <MetadataTable
          tittel="Jobbtilbud"
          rader={[
            { label: "Kandidat", verdi: person.visningsnavn },
            { label: "Tilbud sendt", verdi: sak.soknadsdato },
            { label: "Stilling", verdi: "Skoleassistent (demo)" },
            {
              label: "Status",
              verdi:
                sak.kommuneSaksstatus === "politiattest_mottatt"
                  ? "Politiattest kontrollert - klar for ansettelse"
                  : "Jobbtilbud sendt - venter på politiattest"
            }
          ]}
        />
      </section>

      <section className="kommune-page__kort">
        <h2>1. Politiattest før ansettelse</h2>
        <p>
          Kandidaten har fått tilbud om jobb som skoleassistent. Før kandidaten kan
          ansettes, må Drammen kommune kontrollere en gyldig politiattest. Kommunen
          utsteder derfor et formålsbevis som kandidaten bruker når politiattesten
          bestilles hos Politiet.
        </p>
        <MetadataTable
          tittel="Opplysninger kommunen legger i formålsbeviset"
          rader={formalsbevisRader(person)}
        />
        {sak.formalsbevis.issuance == null && (
          <button type="button" className="btn btn-primary" onClick={utstedFormalsbevis} disabled={utstederLaster}>
            {utstederLaster ? "Utsteder…" : "Utsted formålsbevis"}
          </button>
        )}
        {utstedelsesfeil && <StatusBadge tekst={`Utstedelsen feilet: ${utstedelsesfeil}`} tone="feil" />}
        {sak.formalsbevis.issuance && (
          <StatusBadge
            tekst={
              sak.formalsbevis.issuance.status === "tilbud_klart"
                ? "Formålsbevis sendt til kandidatens innboks"
                : "Utstedelsen feilet"
            }
            tone={sak.formalsbevis.issuance.status === "tilbud_klart" ? "suksess" : "feil"}
          />
        )}
      </section>

      {sak.formalsbevis.issuance && (
        <section className="kommune-page__kort kommune-page__venteboks" aria-live="polite">
          <h2>2. Kontroller politiattesten</h2>
          {!politiattestGodkjent ? (
            <StatusBadge tekst="Venter på politiattest fra kandidaten" tone="venter" />
          ) : (
            <StatusBadge tekst="Politiattest kontrollert - kandidaten kan ansettes" tone="suksess" />
          )}
        </section>
      )}

      {politiattestGodkjent && claims && (
        <section className="kommune-page__kort">
          <h2>Verifisert politiattest</h2>
          <MetadataTable
            tittel="Opplysninger kommunen hentet fra beviset"
            rader={politiattestRaderFraClaims(claims)}
          />
        </section>
      )}
    </main>
  );
};
