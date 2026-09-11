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
import { WalletEvidenceLabel } from "../shared/WalletEvidenceLabel";
import { LoadingIndicator } from "../shared/LoadingIndicator";
import { ventMinst } from "../../utils/ventMinst";
import { loggInnIdPorten as hentIdPortenToken } from "../../integrations/idPortenApi";
import { navnForRolle } from "../../utils/roller";

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
  const [idPortenLoggerInn, setIdPortenLoggerInn] = React.useState(false);
  const [idPortenFeil, setIdPortenFeil] = React.useState<string | null>(null);
  const idPortenInnlogget = Boolean(sak.idPortenAccessToken);

  React.useEffect(() => {
    const stage = formalsbevis.verification?.stage ?? "ikke_startet";
    if (!idPortenInnlogget || !person || stage !== "ikke_startet" || automatiskStartet.current) return;

    automatiskStartet.current = true;
    void formalsverifisering.start().finally(() => {
      automatiskStartet.current = false;
    });
  }, [idPortenInnlogget, person?.personId, formalsbevis.verification?.stage]);

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
    const startet = Date.now();
    setUtstederLaster(true);
    setUtstedelsesfeil(null);
    try {
      const resultat = await utstedBevis("politiattest", person);
      await ventMinst(startet);
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
      await ventMinst(startet);
      setUtstedelsesfeil(err instanceof Error ? err.message : "Ukjent feil ved utstedelse.");
    } finally {
      setUtstederLaster(false);
    }
  }

  async function startIdPortenInnlogging() {
    if (!person) return;
    const startet = Date.now();
    setIdPortenLoggerInn(true);
    setIdPortenFeil(null);
    try {
      const accessToken = await hentIdPortenToken(person);
      await ventMinst(startet, 1200);
      dispatch({ type: "ID_PORTEN_INNLOGGET", accessToken });
    } catch (err) {
      await ventMinst(startet, 1200);
      setIdPortenFeil(err instanceof Error ? err.message : "ID-porten-innloggingen feilet.");
    } finally {
      setIdPortenLoggerInn(false);
    }
  }

  return (
    <main className="politiet-page">
      <header className="politiet-page__header">
        <span className="politiet-page__etat">POLITIET</span>
        <h1>Søknad om politiattest</h1>
        <p>Digital søknad (demo)</p>
      </header>

      {!idPortenInnlogget ? (
        <section className="politiet-page__kort idporten-kort">
          <div className="idporten-kort__topp">
            <span className="idporten-kort__logo" aria-hidden="true">ID</span>
            <div>
              <strong>ID-porten</strong>
              <span>Innlogging til offentlige tjenester</span>
            </div>
          </div>
          <h2>Logg inn for å søke om politiattest</h2>
          <p>Du sendes tilbake til Politiet etter innlogging.</p>
          <div className="idporten-kort__profil">
            <span className="idporten-kort__avatar" aria-hidden="true">
              {person.navn.fornavn.charAt(0)}{person.navn.etternavn.charAt(0)}
            </span>
            <div>
              <strong>{person.visningsnavn}</strong>
              <span>Testprofil</span>
            </div>
          </div>
          <dl className="idporten-kort__opplysninger">
            <div>
              <dt>Fødselsnummer</dt>
              <dd>{person.syntetiskFodselsnummer}</dd>
            </div>
            <div>
              <dt>Innloggingsnivå</dt>
              <dd>Betydelig</dd>
            </div>
          </dl>
          <div className="idporten-kort__trygghet">
            <span aria-hidden="true">✓</span>
            <span>Dette er en simulert ID-porten-innlogging med syntetiske data.</span>
          </div>
          {idPortenFeil && <StatusBadge tekst={idPortenFeil} tone="feil" />}
          {idPortenLoggerInn ? (
            <LoadingIndicator tekst="Logger inn med ID-porten…" />
          ) : (
            <button type="button" className="btn btn-primary" onClick={startIdPortenInnlogging}>
              Logg inn
            </button>
          )}
        </section>
      ) : (
        <section className="politiet-page__kort">
        <StatusBadge tekst={`Innlogget med ID-porten som ${person.visningsnavn}`} tone="suksess" />
        <h2>1. Bekreft formålet for søknaden</h2>
        <p>
          Vis formålsbeviset fra Drammen kommune for å søke om politiattest til{" "}
          {navnForRolle(person.politiattest?.formaal || "")}.
        </p>

        {formalsverifisering.starter && (
          <LoadingIndicator tekst="Henter formålsbeviset fra lommeboken…" />
        )}

        {formalsbevis.verification?.stage === "venter_paa_presentasjon" && formalsbevis.verification.transactionId && (
          <div className="verifisering-panel">
            <WalletEvidenceLabel>
              Politiet henter formålsbeviset fra kandidatens lommebok.
            </WalletEvidenceLabel>
            <LoadingIndicator tekst="Venter på at lommeboken presenterer beviset…" />
            <QrPanel
              verdi={formalsbevis.verification.authorizationRequest || ""}
            />
          </div>
        )}

        {formalsbevis.verification?.stage === "godkjent" && (
          <>
            <WalletEvidenceLabel>
              Formålsbeviset er hentet fra lommeboken.
            </WalletEvidenceLabel>
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
      )}

      {idPortenInnlogget && formalsbevis.verification?.stage === "godkjent" && (
        <section className="politiet-page__kort">
          <h2>Politiattesten din</h2>
          <StatusBadge tekst="Formålet er verifisert som gyldig" tone="suksess" />
          <WalletEvidenceLabel>
            Politiattesten legges i den digitale lommeboken.
          </WalletEvidenceLabel>
          <p>
            Formålet er godkjent. Legg politiattesten i lommeboken og vis den til Drammen kommune.
          </p>
          {utstederLaster && (
            <LoadingIndicator tekst="Lager politiattesten og legger den i lommeboken…" />
          )}
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
