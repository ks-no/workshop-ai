import React, { useState } from "react";
import type { CaseState, InboxMessage } from "../../types";
import type { SakHandling } from "../../state/caseReducer";
import { QrPanel } from "../shared/QrPanel";
import { StatusBadge } from "../shared/StatusBadge";

interface Props {
  sak: CaseState;
  dispatch: React.Dispatch<SakHandling>;
}

// Digipost-inspirert postkasse for demoformål, uten å kopiere den ekte tjenesten.
export const InnboksPage: React.FC<Props> = ({ sak, dispatch }) => {
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
                    ? "Formålsbekreftelsen din er klar for den digitale lommeboken."
                    : "Vi venter på politiattesten før ansettelsen kan fullføres."}
                </span>
              </button>
            ))}
          </section>

          <article className="innboks-page__meldingsvisning" aria-live="polite">
            {!valgtMelding && (
              <p className="innboks-page__tom innboks-page__tom--visning">
                Velg en melding for å se innholdet.
              </p>
            )}
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
                  {valgtMelding.type === "utstedelse" && valgtMelding.issuance.status === "tilbud_klart" ? (
                    <>
                      <p>Du har fått tilbud om stilling som skoleassistent hos Drammen kommune. Før du kan ansettes, trenger vi politiattest. Her er formålsbekreftelsen du bruker når du går inn på politiet.no og søker om politiattest.</p>
                      <QrPanel
                      verdi={valgtMelding.issuance.credentialOfferUri || ""}
                      bildeUrl={valgtMelding.issuance.qrCodeDataUri}
                      simulert={valgtMelding.issuance.simulated}
                    />
                    </>
                  ) : valgtMelding.type === "ettersporsel" ? (
                    <>
                      <p>
                        Drammen kommune venter på politiattesten din i forbindelse med
                        søknaden på stillingen som skoleassistent. Frist for å levere
                        politiattesten er 20. september 2026.
                      </p>
                      {sak.politiattest.verification?.stage === "venter_paa_presentasjon" &&
                        sak.politiattest.verification.transactionId && (
                          <QrPanel verdi={sak.politiattest.verification.authorizationRequest || ""} />
                        )}
                      {sak.politiattest.verification?.stage === "godkjent" && (
                        <StatusBadge
                          tekst="Politiattesten er levert til Drammen kommune"
                          tone="suksess"
                        />
                      )}
                      {sak.politiattest.verification?.stage === "avvist" && (
                        <StatusBadge
                          tekst={`Politiattesten ble avvist: ${sak.politiattest.verification.rejectionReason}`}
                          tone="feil"
                        />
                      )}
                      {sak.politiattest.verification?.stage === "feilet" && (
                        <StatusBadge
                          tekst="Leveringen feilet. Opprett en ny forespørsel og prøv igjen."
                          tone="feil"
                        />
                      )}
                    </>
                  ) : null}
                </div>
              </>
            )}
          </article>
        </div>
      </div>
    </main>
  );
};
