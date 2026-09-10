import React from "react";
import type { CaseState, IssuanceRecord } from "../../types";
import type { SakHandling } from "../../state/caseReducer";
import { useVerifisering } from "../../state/useVerifisering";
import type { VerifiseringController } from "../../state/useVerifisering";
import { utstedBevis } from "../../integrations/lommebokApi";
import {
  formalsbevisRaderFraClaims
} from "../../integrations/credentialPresentation";
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
  const formalsverifisering = useVerifisering(
    "formalsbekreftelse",
    person,
    dispatch,
    formalsbevis.verification
  );
  const automatiskStartet = React.useRef(false);
  const politiattestUtstedelseStartet = React.useRef(false);
  const [utstederLaster, setUtstederLaster] = React.useState(false);
  const [utstedelsesfeil, setUtstedelsesfeil] = React.useState<string | null>(null);

  React.useEffect(() => {
    const stage = formalsbevis.verification?.stage ?? "ikke_startet";
    if (!person || stage !== "ikke_startet" || automatiskStartet.current) return;

    automatiskStartet.current = true;
    void formalsverifisering.start().finally(() => {
      automatiskStartet.current = false;
    });
  }, [person?.personId, formalsbevis.verification?.stage]);

  React.useEffect(() => {
    if (
      !person ||
      formalsbevis.verification?.stage !== "godkjent" ||
      sak.politiattest.issuance ||
      politiattestUtstedelseStartet.current
    ) {
      return;
    }

    politiattestUtstedelseStartet.current = true;
    void utstedPolitiattest();
  }, [person?.personId, formalsbevis.verification?.stage, sak.politiattest.issuance]);

  if (!person) {
    return (
      <main className="politiet-page">
        <p>Ingen aktiv sak. Gå til Start for å velge en testperson.</p>
      </main>
    );
  }

  const kanProveFormalsverifiseringPaNytt = ["avvist", "feilet"].includes(
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
        <h1>Søknad om politiattest</h1>
        <p>Digital søknad (demo)</p>
      </header>

      <section className="politiet-page__kort">
        <h2>1. Bekreft formålet for søknaden</h2>
        <p>
          Du er i gang med å søke om politiattest for jobb i skolen. Før søknaden kan
          behandles, må du vise formålsbekreftelsen i den digitale lommeboken.
        </p>

        {formalsverifisering.starter && (
          <StatusBadge tekst="Gjør klar QR-koden…" tone="venter" />
        )}

        {formalsbevis.verification?.stage === "venter_paa_presentasjon" && formalsbevis.verification.transactionId && (
          <div className="verifisering-panel">
            <StatusBadge tekst="Venter på at søkeren viser formålsbekreftelsen for søknaden" tone="venter" />
            <QrPanel
              verdi={formalsbevis.verification.authorizationRequest || ""}
            />
          </div>
        )}

        {formalsbevis.verification?.stage === "godkjent" && (
          <>
            <MetadataTable
              tittel="Opplysninger Politiet hentet fra beviset"
              rader={formalsbevisRaderFraClaims(
                formalsbevis.verification.claims ?? {}
              )}
            />
          </>
        )}

        {formalsbevis.verification?.stage === "avvist" && (
          <StatusBadge tekst={`Avvist: ${formalsbevis.verification.rejectionReason}`} tone="feil" />
        )}
        {formalsbevis.verification?.stage === "feilet" && (
          <StatusBadge tekst="Verifiseringen feilet. Prøv igjen." tone="feil" />
        )}
        {kanProveFormalsverifiseringPaNytt && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={formalsverifisering.start}
            disabled={formalsverifisering.starter}
          >
            Opprett ny QR-kode
          </button>
        )}
      </section>

      {formalsbevis.verification?.stage === "godkjent" && (
        <section className="politiet-page__kort">
          <h2>Politiattesten din</h2>
          <StatusBadge tekst="Formålet er verifisert som gyldig" tone="suksess" />
          <p>
            Formålsbekreftelsen er kontrollert og godkjent. Legg politiattesten i den
            digitale lommeboken. Når den er lagret, kan du vise den til Drammen kommune.
          </p>
          {utstederLaster && <p>Gjør klar politiattesten…</p>}
          {utstedelsesfeil && <StatusBadge tekst={`Utstedelsen feilet: ${utstedelsesfeil}`} tone="feil" />}
          {sak.politiattest.issuance?.status === "tilbud_klart" &&
            sak.politiattest.issuance.credentialOfferUri && (
              <QrPanel
                verdi={sak.politiattest.issuance.credentialOfferUri}
                bildeUrl={sak.politiattest.issuance.qrCodeDataUri}
              />
            )}
        </section>
      )}

    </main>
  );
};
