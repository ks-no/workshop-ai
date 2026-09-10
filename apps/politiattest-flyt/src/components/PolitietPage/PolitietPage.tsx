import React from "react";
import type { CaseState, IssuanceRecord } from "../../types";
import type { SakHandling } from "../../state/caseReducer";
import { useVerifisering } from "../../state/useVerifisering";
import type { VerifiseringController } from "../../state/useVerifisering";
import { utstedBevis } from "../../integrations/lommebokApi";
import {
  formalsbevisRaderFraClaims,
  politiattestInnholdRader
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
  const formalsverifisering = useVerifisering("formalsbekreftelse", person, dispatch);
  const automatiskStartet = React.useRef(false);
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
        <h2>Kontroll av formålsbekreftelse</h2>
        <p>
          Skann QR-koden med den digitale lommeboken for å vise formålsbekreftelsen fra
          Drammen kommune.
        </p>

        {formalsverifisering.starter && (
          <StatusBadge tekst="Gjør klar QR-koden…" tone="venter" />
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
          <h2>2. Utstedelse av politiattest</h2>
          <p>Vandelskontrollen er gjennomført. Politiattesten kan nå utstedes til søkerens lommebok.</p>
          <MetadataTable
            tittel="Opplysninger Politiet legger i politiattesten"
            rader={politiattestInnholdRader(person)}
          />
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

    </main>
  );
};
