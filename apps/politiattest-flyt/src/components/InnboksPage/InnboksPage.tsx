import React, { useState } from "react";
import type { CaseState, InboxMessage } from "../../types";
import type { SakHandling } from "../../state/caseReducer";
import type { VerifiseringController } from "../../state/useVerifisering";
import {
  formalsbevisRader,
  politiattestRader,
  politiattestRaderFraClaims
} from "../../integrations/credentialPresentation";
import { QrPanel } from "../shared/QrPanel";
import { StatusBadge } from "../shared/StatusBadge";
import { MetadataTable } from "../shared/MetadataTable";

interface Props {
  sak: CaseState;
  dispatch: React.Dispatch<SakHandling>;
  politiattestVerifisering: VerifiseringController;
}

// Forenklet, Gmail-inspirert kontovisning - mappeliste, meldingsliste, meldingsvisning.
// Poenget er ikke å etterligne Gmail nøyaktig, men å gjøre det gjenkjennelig som "en
// e-postkonto" for demoformål.
export const InnboksPage: React.FC<Props> = ({ sak, dispatch, politiattestVerifisering }) => {
  const [valgtMeldingId, setValgtMeldingId] = useState<string | null>(sak.inboxMessages[0]?.id ?? null);

  if (!sak.person) {
    return (
      <main className="innboks-page">
        <p>Ingen aktiv sak. Gå til Start for å velge en testperson.</p>
      </main>
    );
  }

  const valgtMelding = sak.inboxMessages.find((m) => m.id === valgtMeldingId) || null;

  function velgMelding(melding: InboxMessage) {
    setValgtMeldingId(melding.id);
    if (melding.status === "ulest") {
      dispatch({ type: "MELDING_LEST", messageId: melding.id });
    }
  }

  return (
    <main className="innboks-page">
      <header className="innboks-page__header">
        <h1>Innboks</h1>
        <span>{sak.person.visningsnavn} - digital lommebok</span>
      </header>

      <div className="innboks-page__layout">
        <aside className="innboks-page__mapper">
          <ul>
            <li className="innboks-page__mappe innboks-page__mappe--aktiv">
              Innboks
              <span className="innboks-page__telling">{sak.inboxMessages.filter((m) => m.status === "ulest").length}</span>
            </li>
            <li className="innboks-page__mappe">Arkiv</li>
            <li className="innboks-page__mappe">Søppelpost</li>
          </ul>
        </aside>

        <section className="innboks-page__meldingsliste" aria-label="Meldinger">
          {sak.inboxMessages.length === 0 && <p className="innboks-page__tom">Ingen meldinger ennå.</p>}
          {sak.inboxMessages.map((melding) => (
            <button
              type="button"
              key={melding.id}
              className={[
                "innboks-page__melding",
                melding.status === "ulest" ? "innboks-page__melding--ulest" : "",
                melding.id === valgtMeldingId ? "innboks-page__melding--valgt" : ""
              ].join(" ").trim()}
              onClick={() => velgMelding(melding)}
            >
              <span className="innboks-page__avsender">Drammen kommune</span>
              <span className="innboks-page__emne">{melding.title}</span>
              <span className="innboks-page__tid">
                {new Date(melding.createdAt).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </button>
          ))}
        </section>

        <section className="innboks-page__meldingsvisning" aria-live="polite">
          {!valgtMelding && <p>Velg en melding for å se innholdet.</p>}
          {valgtMelding && (
            <>
              <h2>{valgtMelding.title}</h2>
              <p className="innboks-page__meldingstekst">
                {valgtMelding.type === "utstedelse"
                  ? "Vedlagt finner du en formålsbekreftelse du kan vise fram til politiet når du søker om politiattest."
                  : "Vi venter fortsatt på politiattesten din. Når du har hentet den fra politiet, kan du vise den fram til Drammen kommune med QR-koden under."}
              </p>

              {valgtMelding.type === "utstedelse" && valgtMelding.issuance.status === "tilbud_klart" ? (
                <>
                  <StatusBadge tekst="Tilbud klart - ikke bekreftet mottatt i lommebok" tone="venter" />
                  <MetadataTable
                    tittel="Opplysninger som lagres i lommeboken"
                    rader={formalsbevisRader(sak.person)}
                  />
                  <QrPanel
                    verdi={valgtMelding.issuance.credentialOfferUri || ""}
                    bildeUrl={valgtMelding.issuance.qrCodeDataUri}
                    simulert={valgtMelding.issuance.simulated}
                  />
                  {valgtMelding.issuance.credentialOfferUri && (
                    <a href={valgtMelding.issuance.credentialOfferUri} className="btn btn-secondary">
                      Åpne i lommebok på denne enheten
                    </a>
                  )}
                </>
              ) : valgtMelding.type === "utstedelse" ? (
                <StatusBadge tekst={`Utstedelsen feilet: ${valgtMelding.issuance.feilmelding ?? "ukjent feil"}`} tone="feil" />
              ) : sak.politiattest.verification?.stage === "venter_paa_presentasjon" &&
                sak.politiattest.verification.transactionId ? (
                <>
                  <StatusBadge tekst="Venter på at du viser fram politiattesten" tone="venter" />
                  <MetadataTable
                    tittel="Opplysninger du deler med Drammen kommune"
                    rader={politiattestRader(sak.person)}
                  />
                  <QrPanel
                    verdi={sak.politiattest.verification.authorizationRequest || ""}
                  />
                  {sak.politiattest.verification.authorizationRequest && (
                    <a
                      href={sak.politiattest.verification.authorizationRequest}
                      className="btn btn-secondary"
                    >
                      Åpne i lommebok på denne enheten
                    </a>
                  )}
                </>
              ) : sak.politiattest.verification?.stage === "godkjent" ? (
                <>
                  <StatusBadge tekst="Politiattesten er mottatt av Drammen kommune" tone="suksess" />
                  <MetadataTable
                    tittel="Opplysninger kommunen hentet fra beviset"
                    rader={politiattestRaderFraClaims(
                      sak.politiattest.verification.claims ?? {}
                    )}
                  />
                </>
              ) : sak.politiattest.verification?.stage === "avvist" ||
                sak.politiattest.verification?.stage === "feilet" ? (
                <>
                  <StatusBadge
                    tekst={
                      sak.politiattest.verification.stage === "avvist"
                        ? `Kunne ikke godkjenne attesten: ${sak.politiattest.verification.rejectionReason}`
                        : "Verifiseringen feilet."
                    }
                    tone="feil"
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={politiattestVerifisering.start}
                    disabled={politiattestVerifisering.starter}
                  >
                    {politiattestVerifisering.starter ? "Starter…" : "Prøv verifisering på nytt"}
                  </button>
                </>
              ) : (
                <StatusBadge tekst="Venter på at politiet utsteder attesten" tone="venter" />
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
};
