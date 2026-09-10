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

// Digipost-inspirert postkasse for demoformål, uten å kopiere den ekte tjenesten.
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
  const antallUlest = sak.inboxMessages.filter((melding) => melding.status === "ulest").length;
  const initialer = sak.person.navn.fornavn.charAt(0) + sak.person.navn.etternavn.charAt(0);

  function velgMelding(melding: InboxMessage) {
    setValgtMeldingId(melding.id);
    if (melding.status === "ulest") {
      dispatch({ type: "MELDING_LEST", messageId: melding.id });
    }
  }

  return (
    <main className="innboks-page">
      <header className="innboks-page__header">
        <div className="innboks-page__merke" aria-label="Digipost demo">
          <span className="innboks-page__logo">digipost</span>
          <span className="innboks-page__demo">Demo</span>
        </div>
        <div className="innboks-page__bruker">
          <span className="innboks-page__brukerinitialer" aria-hidden="true">{initialer}</span>
          <span>
            <strong>{sak.person.visningsnavn}</strong>
            <small>Sikker digital post</small>
          </span>
        </div>
      </header>

      <div className="innboks-page__layout">
        <aside className="innboks-page__mapper">
          <h2>Postkasse</h2>
          <ul>
            <li className="innboks-page__mappe innboks-page__mappe--aktiv" aria-current="page">
              Innboks
              {antallUlest > 0 && <span className="innboks-page__telling">{antallUlest}</span>}
            </li>
            <li className="innboks-page__mappe">Arkiv</li>
            <li className="innboks-page__mappe">Papirkurv</li>
          </ul>
          <p className="innboks-page__sikkerhet">
            Posten er kryptert og kommer fra en bekreftet avsender.
          </p>
        </aside>

        <div className="innboks-page__post">
          <section className="innboks-page__meldingsliste" aria-label="Meldinger">
            <div className="innboks-page__listehode">
              <h1>Innboks</h1>
              <span>{sak.inboxMessages.length} meldinger</span>
            </div>
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
                <span className="innboks-page__meldingshode">
                  <span className="innboks-page__avsender">Drammen kommune</span>
                  {melding.status === "ulest" && (
                    <span className="innboks-page__ulest" aria-label="Ulest melding" />
                  )}
                  <span className="innboks-page__tid">
                    {new Date(melding.createdAt).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </span>
                <span className="innboks-page__emne">{melding.title}</span>
                <span className="innboks-page__forhandsvisning">
                  {melding.type === "utstedelse"
                    ? "Formålsbeviset ditt er klart for den digitale lommeboken."
                    : "Vi venter på politiattesten før ansettelsen kan fullføres."}
                </span>
              </button>
            ))}
          </section>

          <article className="innboks-page__meldingsvisning" aria-live="polite">
            {!valgtMelding && <p>Velg en melding for å se innholdet.</p>}
            {valgtMelding && (
              <>
                <header className="innboks-page__brevhode">
                  <span className="innboks-page__avsendermerke" aria-hidden="true">DK</span>
                  <div>
                    <span className="innboks-page__bekreftet">Bekreftet avsender</span>
                    <strong>Drammen kommune</strong>
                    <h2>{valgtMelding.title}</h2>
                    <time dateTime={valgtMelding.createdAt}>
                      {new Date(valgtMelding.createdAt).toLocaleString("nb-NO", {
                        dateStyle: "long",
                        timeStyle: "short"
                      })}
                    </time>
                  </div>
                </header>
                <div className="innboks-page__brevinnhold">
                  <p>Hei {sak.person.navn.fornavn},</p>
                  <p className="innboks-page__meldingstekst">
                    {valgtMelding.type === "utstedelse"
                      ? "Du har fått et formålsbevis fra Drammen kommune. Beviset brukes når du søker om politiattest for jobb i skolen."
                      : "Vi venter fortsatt på politiattesten din. Når du har hentet den fra Politiet, kan du dele de nødvendige opplysningene med Drammen kommune ved å bruke QR-koden under."}
                  </p>

                  {valgtMelding.type === "utstedelse" && valgtMelding.issuance.status === "tilbud_klart" ? (
                    <>
                      <StatusBadge tekst="Klart for digital lommebok" tone="venter" />
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
                    <StatusBadge tekst="Venter på at Politiet utsteder attesten" tone="venter" />
                  )}
                </div>
              </>
            )}
          </article>
        </div>
      </div>
    </main>
  );
};
