import React from "react";
import type { CaseState, IssuanceRecord } from "../../types";
import type { SakHandling } from "../../state/caseReducer";
import { useVerifisering } from "../../state/useVerifisering";
import type { VerifiseringController } from "../../state/useVerifisering";
import { utstedBevis } from "../../integrations/lommebokApi";
import { StatusBadge } from "../shared/StatusBadge";
import { QrPanel } from "../shared/QrPanel";
import { MetadataTable } from "../shared/MetadataTable";

interface Props {
  sak: CaseState;
  dispatch: React.Dispatch<SakHandling>;
  politiattestVerifisering: VerifiseringController;
}

// Stilen her er inspirert av politiet.no sin fargebruk og struktur (mørkeblå
// myndighetsheader, saksspråk i kort) - ikke en pikselkopi. Se README for hvorfor.
export const PolitietPage: React.FC<Props> = ({ sak, dispatch, politiattestVerifisering }) => {
  const person = sak.person;
  const formalsbevis = sak.formalsbevis;
  const formalsverifisering = useVerifisering("formalsbekreftelse", person, dispatch);
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
      const issuance: IssuanceRecord = {
        status: resultat.suksess ? "tilbud_klart" : "feilet",
        transactionId: resultat.transactionId,
        credentialOfferUri: resultat.credentialOfferUri,
        qrCodeDataUri: resultat.qrCodeDataUri,
        issuedAt: new Date().toISOString(),
        simulated: resultat.simulert,
        feilmelding: resultat.feilmelding
      };
      dispatch({ type: "UTSTEDELSE_FULLFORT", kind: "politiattest", issuance, messages: [] });
      await politiattestVerifisering.start();
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
          <button type="button" className="btn btn-primary" onClick={formalsverifisering.start} disabled={formalsverifisering.starter}>
            {formalsverifisering.starter
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
            />
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
            <>
              <StatusBadge
                tekst={
                  sak.politiattest.issuance.status === "tilbud_klart"
                    ? "Politiattesten er klar til henting"
                    : "Utstedelsen feilet"
                }
                tone={sak.politiattest.issuance.status === "tilbud_klart" ? "suksess" : "feil"}
              />
              {sak.politiattest.issuance.status === "tilbud_klart" &&
                sak.politiattest.issuance.credentialOfferUri && (
                  <div className="verifisering-panel">
                    <p>Skann QR-koden med lommeboken for å hente politiattesten.</p>
                    <QrPanel
                      verdi={sak.politiattest.issuance.credentialOfferUri}
                      bildeUrl={sak.politiattest.issuance.qrCodeDataUri}
                    />
                    <a
                      href={sak.politiattest.issuance.credentialOfferUri}
                      className="btn btn-secondary"
                    >
                      Åpne i lommebok på denne enheten
                    </a>
                  </div>
                )}
            </>
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
