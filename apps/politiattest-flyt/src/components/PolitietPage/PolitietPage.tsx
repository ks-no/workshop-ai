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

// Stilen her er inspirert av politiet.no sin fargebruk og struktur (mørkeblå
// myndighetsheader, saksspråk i kort) - ikke en pikselkopi. Se README for hvorfor.
export const PolitietPage: React.FC<Props> = ({ sak, dispatch }) => {
  const person = sak.person;
  const formalsbevis = sak.formalsbevis;
  const verifisering = useVerifisering("formalsbekreftelse", person, dispatch);
  const [utstederLaster, setUtstederLaster] = React.useState(false);
  const [utstedelsesfeil, setUtstedelsesfeil] = React.useState<string | null>(null);

  if (!person) {
    return (
      <main className="politiet-page">
        <p>Ingen aktiv sak. Gå til Start for å velge en testperson.</p>
      </main>
    );
  }

  const kanUtstedePolitiattest =
    formalsbevis.verification?.stage === "godkjent" && sak.politiattest.issuance == null;
  const kanStarteFormalsverifisering = ["ikke_startet", "avvist", "feilet"].includes(
    formalsbevis.verification?.stage ?? "ikke_startet"
  );

  async function utstedPolitiattest() {
    if (!person) return;
    setUtstederLaster(true);
    setUtstedelsesfeil(null);
    try {
      const resultat = await utstedBevis("politiattest", person);
      const message: InboxMessage = {
        id: `msg-politiattest-${Date.now()}`,
        kind: "politiattest",
        title: "Politiattesten din er klar til henting",
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
      dispatch({ type: "UTSTEDELSE_FULLFORT", kind: "politiattest", issuance: message.issuance, message });
    } catch (err) {
      setUtstedelsesfeil(err instanceof Error ? err.message : "Ukjent feil ved utstedelse.");
    } finally {
      setUtstederLaster(false);
    }
  }

  return (
    <main className="politiet-page">
      <header className="politiet-page__header">
        <span className="politiet-page__etat">POLITIET</span>
        <h1>Vandelskontroll og politiattester</h1>
        <p>Enhet for vandelskontroll og politiattester - saksbehandling (demo)</p>
      </header>

      <section className="politiet-page__kort">
        <h2>1. Kontroll av formålsbekreftelse</h2>
        <p>
          Søkeren viser fram formålsbekreftelsen fra kommunen i sin digitale lommebok, slik at
          politiet kan bekrefte at forespørselen om politiattest faktisk gjelder skolejobb.
        </p>

        {kanStarteFormalsverifisering && (
          <button type="button" className="btn btn-primary" onClick={verifisering.start} disabled={verifisering.starter}>
            {verifisering.starter
              ? "Starter…"
              : formalsbevis.verification?.stage === "ikke_startet"
                ? "Be om å få se formålsbekreftelsen"
                : "Prøv verifisering på nytt"}
          </button>
        )}

        {formalsbevis.verification?.stage === "venter_paa_presentasjon" && formalsbevis.verification.transactionId && (
          <div className="verifisering-panel">
            <StatusBadge tekst="Venter på at søkeren viser fram beviset" tone="venter" />
            <QrPanel
              verdi={formalsbevis.verification.authorizationRequest || ""}
              simulert={formalsbevis.verification.simulated}
            />
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => verifisering.simuler(formalsbevis.verification!.transactionId!)}
            >
              Simuler at søkeren viser fram beviset
            </button>
          </div>
        )}

        {formalsbevis.verification?.stage === "godkjent" && (
          <>
            <StatusBadge tekst="Formål bekreftet: skole" tone="suksess" />
            <MetadataTable
              tittel="Verifiserte opplysninger"
              rader={[
                { label: "Formål", verdi: "Skole" },
                { label: "Utsteder", verdi: "Drammen kommune" },
                { label: "Innehaver", verdi: person.visningsnavn }
              ]}
            />
          </>
        )}

        {formalsbevis.verification?.stage === "avvist" && (
          <StatusBadge tekst={`Avvist: ${formalsbevis.verification.rejectionReason}`} tone="feil" />
        )}
        {formalsbevis.verification?.stage === "feilet" && (
          <StatusBadge tekst="Verifiseringen feilet. Prøv igjen." tone="feil" />
        )}
      </section>

      {formalsbevis.verification?.stage === "godkjent" && (
        <section className="politiet-page__kort">
          <h2>2. Utstedelse av politiattest</h2>
          <p>Vandelskontrollen er gjennomført. Politiattesten kan nå utstedes til søkerens lommebok.</p>
          {sak.politiattest.issuance == null && (
            <button type="button" className="btn btn-primary" onClick={utstedPolitiattest} disabled={utstederLaster}>
              {utstederLaster ? "Utsteder…" : "Utsted politiattest"}
            </button>
          )}
          {utstedelsesfeil && <StatusBadge tekst={`Utstedelsen feilet: ${utstedelsesfeil}`} tone="feil" />}
          {sak.politiattest.issuance && (
            <StatusBadge
              tekst={
                sak.politiattest.issuance.status === "tilbud_klart"
                  ? "Politiattest sendt til innboks - se der for QR-kode"
                  : "Utstedelsen feilet"
              }
              tone={sak.politiattest.issuance.status === "tilbud_klart" ? "suksess" : "feil"}
            />
          )}
        </section>
      )}

      {kanUtstedePolitiattest === false && formalsbevis.verification?.stage !== "godkjent" && (
        <p className="politiet-page__hjelpetekst">
          Politiattest kan først utstedes etter at formålsbekreftelsen er kontrollert og godkjent over.
        </p>
      )}
    </main>
  );
};
