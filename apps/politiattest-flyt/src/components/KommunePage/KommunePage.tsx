import React from "react";
import type { CaseState, InboxMessage } from "../../types";
import type { SakHandling } from "../../state/caseReducer";
import { useVerifisering } from "../../state/useVerifisering";
import { utstedBevis } from "../../integrations/lommebokApi";
import { StatusBadge } from "../shared/StatusBadge";
import { QrPanel } from "../shared/QrPanel";
import { MetadataTable } from "../shared/MetadataTable";

interface Props {
  sak: CaseState;
  dispatch: React.Dispatch<SakHandling>;
}

// Stilen her er inspirert av drammen.kommune.no (saksbehandlerkort, journalkolonne,
// dato for søknaden) - ikke en pikselkopi. Se README for hvorfor.
export const KommunePage: React.FC<Props> = ({ sak, dispatch }) => {
  const person = sak.person;
  const verifisering = useVerifisering("politiattest", person, dispatch);
  const [utstederLaster, setUtstederLaster] = React.useState(false);

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
    try {
      const resultat = await utstedBevis("formalsbekreftelse", person);
      const message: InboxMessage = {
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
      dispatch({ type: "UTSTEDELSE_FULLFORT", kind: "formalsbekreftelse", issuance: message.issuance, message });
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
          <h1>Saksbehandling - ansettelse i skole</h1>
        </div>
      </header>

      <section className="kommune-page__saksinfo">
        <MetadataTable
          rader={[
            { label: "Søker", verdi: person.visningsnavn },
            { label: "Søknadsdato", verdi: sak.soknadsdato },
            { label: "Stilling", verdi: "Skoleassistent (demo)" },
            {
              label: "Saksstatus",
              verdi:
                sak.kommuneSaksstatus === "politiattest_mottatt"
                  ? "Politiattest mottatt og kontrollert"
                  : "Venter på politiattest"
            }
          ]}
        />
      </section>

      <section className="kommune-page__kort">
        <h2>1. Utsted formålsbekreftelse</h2>
        <p>
          Før søkeren kan bestille politiattest hos politiet, må kommunen bekrefte formålet med
          attesten - denne bekreftelsen sendes til søkerens digitale lommebok.
        </p>
        {sak.formalsbevis.issuance == null && (
          <button type="button" className="btn btn-primary" onClick={utstedFormalsbevis} disabled={utstederLaster}>
            {utstederLaster ? "Utsteder…" : "Utsted formålsbevis"}
          </button>
        )}
        {sak.formalsbevis.issuance && (
          <StatusBadge
            tekst={
              sak.formalsbevis.issuance.status === "tilbud_klart"
                ? "Formålsbevis sendt til søkerens innboks"
                : "Utstedelsen feilet"
            }
            tone={sak.formalsbevis.issuance.status === "tilbud_klart" ? "suksess" : "feil"}
          />
        )}
      </section>

      {sak.formalsbevis.issuance && (
        <section className="kommune-page__kort kommune-page__venteboks" aria-live="polite">
          <h2>2. Venter på innsendt politiattest</h2>
          {!politiattestGodkjent ? (
            <StatusBadge tekst="Venter på innsendt politiattest" tone="venter" />
          ) : (
            <StatusBadge tekst="Politiattest mottatt og godkjent" tone="suksess" />
          )}
        </section>
      )}

      {sak.politiattest.issuance && !politiattestGodkjent && (
        <section className="kommune-page__kort">
          <h2>3. Kontroll av innsendt politiattest</h2>
          <p>Søkeren har fått politiattesten fra politiet og kan nå legge den fram for kommunen.</p>

          {sak.politiattest.verification?.stage === "ikke_startet" && (
            <button type="button" className="btn btn-primary" onClick={verifisering.start} disabled={verifisering.starter}>
              {verifisering.starter ? "Starter…" : "Be om å få se politiattesten"}
            </button>
          )}

          {sak.politiattest.verification?.stage === "venter_paa_presentasjon" &&
            sak.politiattest.verification.transactionId && (
              <div className="verifisering-panel">
                <StatusBadge tekst="Venter på at søkeren viser fram attesten" tone="venter" />
                <QrPanel
                  verdi={sak.politiattest.verification.authorizationRequest || ""}
                  simulert={sak.politiattest.verification.simulated}
                />
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => verifisering.simuler(sak.politiattest.verification!.transactionId!)}
                >
                  Simuler at søkeren viser fram attesten
                </button>
              </div>
            )}

          {sak.politiattest.verification?.stage === "avvist" && (
            <StatusBadge tekst={`Avvist: ${sak.politiattest.verification.rejectionReason}`} tone="feil" />
          )}
          {sak.politiattest.verification?.stage === "feilet" && (
            <StatusBadge tekst="Verifiseringen feilet. Prøv igjen." tone="feil" />
          )}
        </section>
      )}

      {politiattestGodkjent && claims && (
        <section className="kommune-page__kort">
          <h2>Verifisert politiattest</h2>
          <MetadataTable
            rader={[
              { label: "Attesttype", verdi: String(claims["attesttype"]) },
              { label: "Formål", verdi: String(claims["formaal"]) },
              { label: "Utstedt", verdi: String(claims["issuance_date"]) },
              { label: "Utløper", verdi: String(claims["expiry_date"]) },
              { label: "Antall anmerkninger", verdi: String(claims["antall_anmerkninger"]) }
            ]}
          />
        </section>
      )}
    </main>
  );
};
