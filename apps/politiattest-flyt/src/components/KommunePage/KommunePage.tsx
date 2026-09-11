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
import { WalletEvidenceLabel } from "../shared/WalletEvidenceLabel";
import { LoadingIndicator } from "../shared/LoadingIndicator";
import { VandelVurderingskort } from "../shared/VandelVurderingskort";
import { hentVandelvurdering } from "../../integrations/sandboxApi";
import { stillingForRolle } from "../../utils/roller";
import { HjemmelsokKort } from "./HjemmelsokKort";

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

  const startVandelvurdering = React.useCallback(() => {
    if (!person || !sak.idPortenAccessToken || sak.politiattest.verification?.stage !== "godkjent") return;
    dispatch({ type: "VANDELVURDERING_STARTET" });
    void hentVandelvurdering(person, sak.idPortenAccessToken)
      .then((vurdering) => dispatch({ type: "VANDELVURDERING_FULLFORT", vurdering }))
      .catch((err) =>
        dispatch({
          type: "VANDELVURDERING_FEILET",
          feil: err instanceof Error ? err.message : "Vandelskontrollen feilet."
        })
      );
  }, [dispatch, person, sak.idPortenAccessToken, sak.politiattest.verification?.stage]);

  React.useEffect(() => {
    if (sak.vandelvurdering.status === "ikke_hentet") {
      startVandelvurdering();
    }
  }, [
    sak.vandelvurdering.status,
    startVandelvurdering
  ]);

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
      const resultat = await utstedBevis("formalsbekreftelse", person, sak.hjemmelvalg);
      const message: InboxMessage = {
        type: "utstedelse",
        id: `msg-formalsbevis-${Date.now()}`,
        kind: "formalsbekreftelse",
        title: "Formålsbeviset fra Drammen kommune er klart",
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
      dispatch({
        type: "UTSTEDELSE_FULLFORT",
        kind: "formalsbekreftelse",
        issuance: message.issuance,
        messages: [message]
      });
    } catch (err) {
      setUtstedelsesfeil(err instanceof Error ? err.message : "Ukjent feil ved utstedelse.");
    } finally {
      setUtstederLaster(false);
    }
  }

  const stilling = stillingForRolle(person.politiattest?.formaal || "");
  const politiattestGodkjent = sak.politiattest.verification?.stage === "godkjent";
  const sakErAvsluttet = sak.kommuneSaksstatus === "avsluttet";
  const claims = sak.politiattest.verification?.claims;
  const prosessSteg =
    sak.kommuneSaksstatus === "avsluttet"
      ? "Steg 3 av 3: saksbehandling fullført"
      : politiattestGodkjent
        ? "Steg 3 av 3: politiattest til vurdering"
        : sak.formalsbevis.issuance
          ? "Steg 2 av 3: venter på politiattest"
          : sak.hjemmelvalg
            ? "Steg 1 av 3: klargjør formålsbekreftelse"
            : "Steg 0: finn hjemmelen formålet krever";

  return (
    <main className="kommune-page">
      <header className="kommune-page__header">
        <span className="kommune-page__kommunevaapen" aria-hidden="true">DK</span>
        <div className="kommune-page__sakshode">
          <span className="kommune-page__etat">Drammen kommune</span>
          <h1>Politiattest i jobbtilbud</h1>
          <p className="kommune-page__stilling">Stilling: {stilling}</p>
          <div className="kommune-page__saksstatus">
            <span>{sakErAvsluttet ? "Avsluttet sak" : "Aktiv sak"}</span>
            <span>{prosessSteg}</span>
          </div>
        </div>
        <div className="kommune-page__innlogget">
          <span>Innlogget som</span>
          <strong>Nora Nordmann</strong>
          <small>Saksbehandler</small>
        </div>
      </header>

      <section className="kommune-page__saksinfo">
        <MetadataTable
          tittel="Jobbtilbud"
          rader={[
            { label: "Kandidat", verdi: person.visningsnavn },
            { label: "Tilbud sendt", verdi: sak.soknadsdato },
            {
              label: "Status",
              verdi:
                sak.kommuneSaksstatus === "avsluttet"
                  ? "Sak avsluttet - klar for ansettelse"
                  : sak.kommuneSaksstatus === "politiattest_mottatt"
                    ? "Politiattest mottatt - venter på saksbehandling"
                    : "Jobbtilbud sendt - venter på politiattest"
            }
          ]}
        />
      </section>

      <HjemmelsokKort
        person={person}
        hjemmelvalg={sak.hjemmelvalg}
        laast={sak.formalsbevis.issuance != null}
        dispatch={dispatch}
      />

      <section className="kommune-page__kort">
        <h2>Steg 1: Formålsbekreftelse for stillingen</h2>
        {sakErAvsluttet ? (
          <StatusBadge tekst="Formålsbekreftelse brukt i søknaden" tone="suksess" />
        ) : (
          <>
            <WalletEvidenceLabel>
              Kommunen utsteder formålsbeviset til kandidatens lommebok.
            </WalletEvidenceLabel>
            <p>
              Her er formålsbeviset kandidaten trenger for å søke om politiattest hos politiet.
              Når attesten er levert, kontrollerer du den før ansettelsen kan fullføres.
            </p>
            <MetadataTable
              tittel="Opplysninger kommunen legger i formålsbekreftelsen"
              rader={formalsbevisRader(person, sak.hjemmelvalg)}
            />
            {sak.formalsbevis.issuance == null && (
              <>
                {/* Hjemmelen blir en claim i beviset, så den må være valgt i steg 0
                    før beviset kan utstedes - ikke etterpå. */}
                {!sak.hjemmelvalg && (
                  <StatusBadge
                    tekst="Velg hjemmel i steg 0 før formålsbekreftelsen utstedes"
                    tone="venter"
                  />
                )}
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={utstedFormalsbevis}
                  disabled={utstederLaster || !sak.hjemmelvalg}
                >
                  Utsted formålsbekreftelse
                </button>
              </>
            )}
            {utstederLaster && (
              <LoadingIndicator tekst="Sender formålsbeviset til lommeboken…" />
            )}
            {utstedelsesfeil && <StatusBadge tekst={`Utstedelsen feilet: ${utstedelsesfeil}`} tone="feil" />}
            {sak.formalsbevis.issuance && (
              <>
                {sak.formalsbevis.issuance.status === "tilbud_klart" && (
                  <WalletEvidenceLabel>
                    Formålsbeviset ligger klart i kandidatens lommebok.
                  </WalletEvidenceLabel>
                )}
                <StatusBadge
                  tekst={
                    sak.formalsbevis.issuance.status === "tilbud_klart"
                      ? "Formålsbekreftelse sendt til kandidatens innboks"
                      : "Utstedelsen feilet"
                  }
                  tone={sak.formalsbevis.issuance.status === "tilbud_klart" ? "suksess" : "feil"}
                />
              </>
            )}
          </>
        )}
      </section>

      {sak.formalsbevis.issuance && (
        <section className="kommune-page__kort kommune-page__venteboks" aria-live="polite">
          <h2>{sakErAvsluttet ? "Steg 3: Saksbehandling" : "Steg 2: Politiattest for stillingen"}</h2>
          {!politiattestGodkjent ? (
            <StatusBadge tekst="Venter på politiattest fra kandidaten" tone="venter" />
          ) : sak.kommuneSaksstatus === "avsluttet" ? (
            <StatusBadge tekst="Saksbehandling fullført - kandidaten er klar for ansettelse" tone="suksess" />
          ) : (
            <StatusBadge tekst="Politiattest mottatt" tone="suksess" />
          )}
          {politiattestGodkjent && (
            <VandelVurderingskort
              vurdering={sak.vandelvurdering}
              onRetry={startVandelvurdering}
            />
          )}
          {politiattestGodkjent && claims && (
            <details className="kommune-page__teknisk">
              <summary>Mer teknisk: innholdet i beviset</summary>
              <WalletEvidenceLabel>
                Politiattesten er hentet fra kandidatens lommebok.
              </WalletEvidenceLabel>
              <MetadataTable
                tittel="Opplysninger kommunen hentet fra beviset"
                rader={politiattestRaderFraClaims(claims)}
              />
            </details>
          )}
          {politiattestGodkjent && sak.kommuneSaksstatus === "politiattest_mottatt" && (
            <div className="kommune-page__fullfor">
              <p>
                Kontroller at politiattesten gjelder riktig formål og vurder opplysningene
                før ansettelsen kan fullføres.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => dispatch({ type: "POLITIATTEST_KONTROLL_FULLFORT" })}
              >
                Registrer kontroll som fullført
              </button>
            </div>
          )}
        </section>
      )}
    </main>
  );
};
