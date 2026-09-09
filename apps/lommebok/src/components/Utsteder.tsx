import React, { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { CREDENTIAL_DEFINITIONS } from "../data/credentials";
import { CredentialId, IssuedCredentialData, Person, ApiCallTrace } from "../types";

interface Props {
  onLogApiCall: (trace: ApiCallTrace) => void;
}

export const Utsteder: React.FC<Props> = ({ onLogApiCall }) => {
  const [personer, setPersoner] = useState<Person[]>([]);
  const [sokeord, setSokeord] = useState<string>("");
  const [valgtPerson, setValgtPerson] = useState<Person | null>(null);
  const [fnrInput, setFnrInput] = useState<string>("");
  const [valgtBevisId, setValgtBevisId] = useState<CredentialId>("pid");
  const [lasterPersoner, setLasterPersoner] = useState<boolean>(true);
  const [feilmelding, setFeilmelding] = useState<string | null>(null);

  // Status for utstedelsesprosess
  const [lasterUtstedelse, setLasterUtstedelse] = useState<boolean>(false);
  const [utstederStatus, setUtstederStatus] = useState<string | null>(null);

  // Resultat etter utstedelse
  const [issuerUrl, setIssuerUrl] = useState<string>(
    CREDENTIAL_DEFINITIONS.pid.defaultIssuerUrl || "https://utsteder.test.eidas2sandkasse.net/bevisgenerator"
  );
  const [utstedtOfferUri, setUtstedtOfferUri] = useState<string | null>(null);
  const [utstedtData, setUtstedtData] = useState<IssuedCredentialData | null>(null);
  const [kopiert, setKopiert] = useState<boolean>(false);

  // Hent alle testpersoner fra KS-sandkassen
  useEffect(() => {
    async function hentPersoner() {
      try {
        setLasterPersoner(true);
        const res = await fetch("/api/personer");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: Person[] = await res.json();
        setPersoner(data);
        if (data.length > 0) {
          setValgtPerson(data[0]);
          setFnrInput(data[0].syntetiskFodselsnummer);
        }
      } catch (err: unknown) {
        console.error("Kunne ikke hente personer:", err);
        setFeilmelding("Fikk ikke kontakt med KS-sandkassedatabasen. Sørg for at sandbox-backend eller lommebok-api kjører.");
      } finally {
        setLasterPersoner(false);
      }
    }
    hentPersoner();
  }, []);

  // Håndter direkte inntasting av fødselsnummer
  const handleFnrChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fnr = e.target.value.trim();
    setFnrInput(fnr);
    const funnet = personer.find((p) => p.syntetiskFodselsnummer === fnr);
    if (funnet) {
      setValgtPerson(funnet);
    } else {
      setValgtPerson(null);
    }
    setUtstedtOfferUri(null);
  };

  // Filtrer personer til dropdown-søk
  const filtrertePersoner = personer.filter((p) => {
    const s = sokeord.toLowerCase();
    const navn = (p.visningsnavn || "").toLowerCase();
    const fnr = p.syntetiskFodselsnummer || "";
    const kommune = (p.bostedsadresse?.kommune || "").toLowerCase();
    return navn.includes(s) || fnr.includes(s) || kommune.includes(s);
  });

  const velgPersonFraSok = (p: Person) => {
    setValgtPerson(p);
    setFnrInput(p.syntetiskFodselsnummer);
    setSokeord("");
    setUtstedtOfferUri(null);
  };

  const valgtBevis = CREDENTIAL_DEFINITIONS[valgtBevisId];
  const eksempelData = valgtPerson ? valgtBevis.lagEksempelData(valgtPerson) : null;

  // Utsted bevis-funksjon: kaller /api/utsted som oppretter reell pre-authorization i testmiljøet
  const handleUtsted = async () => {
    if (!valgtPerson || !eksempelData) return;
    setLasterUtstedelse(true);
    setFeilmelding(null);
    setUtstederStatus("Oppretter gyldig issuance transaction i testmiljøet...");

    try {
      const res = await fetch("/api/utsted", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          credentialConfigurationId: valgtBevis.credentialConfigurationId,
          personIdentifier: valgtPerson.syntetiskFodselsnummer,
          credentialIssuer: issuerUrl,
          credentialData: eksempelData
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detaljer || data.error || `HTTP ${res.status}`);
      }

      setUtstedtOfferUri(data.credentialOfferUri);
      setUtstedtData({
        transactionId: data.issuanceTransactionId,
        bevisType: valgtBevis.tittel,
        mottaker: `${valgtPerson.visningsnavn} (${valgtPerson.syntetiskFodselsnummer})`,
        claims: eksempelData,
        credentialOffer: data.credentialOffer,
        preAuthorizedCode: data.preAuthorizedCode,
        txCode: data.txCode,
        qrCodeDataUri: data.qrCodeDataUri,
        statusEndpoint: data.statusEndpoint
      });

      const baseIssuer = issuerUrl.replace(/\/$/, "");
      const curl = `curl -X POST "${baseIssuer}/api/v1/credential/issuance-transaction" \\
  -H "Content-Type: application/json" \\
  -H "X-API-KEY: KS-HACKATHON" \\
  -d '${JSON.stringify({
    credential_issuer: baseIssuer,
    credential_configuration_id: valgtBevis.credentialConfigurationId,
    subject: { identifier: valgtPerson.syntetiskFodselsnummer },
    credential_data: eksempelData
  }, null, 2)}'`;

      onLogApiCall({
        id: data.issuanceTransactionId,
        tittel: `Utsted (Pre-auth): ${valgtBevis.tittel}`,
        tidspunkt: new Date().toLocaleTimeString("nb-NO"),
        metode: "POST",
        url: `${baseIssuer}/api/v1/credential/issuance-transaction`,
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": "KS-HACKATHON"
        },
        requestBody: {
          credential_issuer: baseIssuer,
          credential_configuration_id: valgtBevis.credentialConfigurationId,
          subject: { identifier: valgtPerson.syntetiskFodselsnummer },
          credential_data: eksempelData
        },
        responseStatus: 200,
        responseBody: {
          issuance_transaction_id: data.issuanceTransactionId,
          pre_authorized_code: data.preAuthorizedCode,
          credential_offer: data.credentialOffer
        },
        curl
      });
    } catch (err: unknown) {
      console.error("Feil ved utstedelse:", err);
      const message = err instanceof Error ? err.message : "Ukjent feil";
      setFeilmelding(`Kunne ikke opprette utstedelse i testmiljøet: ${message}`);
    } finally {
      setLasterUtstedelse(false);
      setUtstederStatus(null);
    }
  };

  const kopierLenke = () => {
    if (utstedtOfferUri) {
      navigator.clipboard.writeText(utstedtOfferUri);
      setKopiert(true);
      setTimeout(() => setKopiert(false), 2500);
    }
  };

  return (
    <div className="flow-container">
      <div className="card">
        <h2>1. Velg bevis</h2>
        <p className="description">
          Velg hvilken type bevis som skal utstedes med data fra KS-sandkassen:
        </p>

        <div className="badge-grid">
          {(Object.keys(CREDENTIAL_DEFINITIONS) as CredentialId[]).map((id) => {
            const def = CREDENTIAL_DEFINITIONS[id];
            const active = valgtBevisId === id;
            return (
              <button
                key={id}
                type="button"
                className={`choice-card ${active ? "active" : ""}`}
                onClick={() => {
                  setValgtBevisId(id);
                  if (def.defaultIssuerUrl) {
                    setIssuerUrl(def.defaultIssuerUrl);
                  }
                  setUtstedtOfferUri(null);
                }}
              >
                <div className="card-header">
                  <strong>{def.tittel}</strong>
                  <span className="pill">{def.format}</span>
                </div>
                <p className="card-desc">{def.beskrivelse}</p>
                <div className="card-meta">Utsteder: {def.utstederNavn}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h2>2. Velg eller tast inn personnummer</h2>
        <p className="description">
          Personnummeret må eksistere i KS-sandkassens database:
        </p>

        {feilmelding && <div className="alert alert-error">{feilmelding}</div>}

        <div className="form-row">
          <div className="form-group flex-1">
            <label htmlFor="fnrInput">Fødselsnummer (11 siffer):</label>
            <input
              id="fnrInput"
              type="text"
              className="text-input"
              value={fnrInput}
              onChange={handleFnrChange}
              placeholder="F.eks. 12818800078"
              maxLength={11}
            />
            {valgtPerson ? (
              <span className="feedback-ok">
                ✓ Funnet i KS-database: <strong>{valgtPerson.visningsnavn}</strong> ({valgtPerson.bostedsadresse?.kommune || "Ukjent kommune"})
              </span>
            ) : fnrInput.length === 11 ? (
              <span className="feedback-error">
                ✗ Fant ingen person med dette fødselsnummeret i KS-databasen.
              </span>
            ) : null}
          </div>

          <div className="form-group flex-1">
            <label htmlFor="sokPerson">Søk i KS-testpersoner:</label>
            <input
              id="sokPerson"
              type="text"
              className="text-input"
              value={sokeord}
              onChange={(e) => setSokeord(e.target.value)}
              placeholder="Søk etter navn, fødselsnummer eller kommune…"
            />
          </div>
        </div>

        {sokeord.trim() && (
          <div className="search-results">
            <div className="search-header">Treff i KS-databasen ({filtrertePersoner.length}):</div>
            <ul className="results-list">
              {filtrertePersoner.slice(0, 8).map((p) => (
                <li key={p.personId}>
                  <button
                    type="button"
                    className="result-btn"
                    onClick={() => velgPersonFraSok(p)}
                  >
                    <strong>{p.visningsnavn}</strong>
                    <span>{p.syntetiskFodselsnummer}</span>
                    <span className="muted">{p.bostedsadresse?.kommune}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {valgtPerson && eksempelData && (
          <div className="preview-box">
            <div className="preview-header">
              <strong>Forhåndsvisning av bevisdata for {valgtPerson.visningsnavn}:</strong>
            </div>
            <pre className="json-preview">{JSON.stringify(eksempelData, null, 2)}</pre>
          </div>
        )}

        <div className="form-row" style={{ marginTop: "1rem" }}>
          <div className="form-group flex-1">
            <label htmlFor="issuerUrlInput">Issuer Server URL (testmiljø):</label>
            <input
              id="issuerUrlInput"
              type="text"
              className="text-input"
              value={issuerUrl}
              onChange={(e) => {
                setIssuerUrl(e.target.value);
                setUtstedtOfferUri(null);
              }}
              placeholder="https://utsteder.test.eidas2sandkasse.net/bevisgenerator"
            />
            <small style={{ color: "#666", display: "block", marginTop: "0.25rem" }}>
              Standard i testmiljøet: <code>https://utsteder.test.eidas2sandkasse.net/bevisgenerator</code>.
            </small>
          </div>
        </div>

        <div className="action-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleUtsted}
            disabled={!valgtPerson || lasterPersoner || lasterUtstedelse}
          >
            {lasterUtstedelse ? (utstederStatus || "Oppretter utstedelse...") : "Utsted bevis til lommebok"}
          </button>
        </div>
      </div>

      {utstedtOfferUri && utstedtData && (
        <div className="card result-card">
          <h2>3. Skann QR-kode med lommeboken</h2>
          <p className="description">
            QR-koden er registrert hos testmiljøets autorisasjonsserver med en gyldig <code>pre-authorized_code</code>. Åpne din EUDI Wallet / digitale lommebok og skann koden for å motta beviset:
          </p>

          {utstedtData.txCode && (
            <div className="alert alert-info" style={{ marginBottom: "1rem" }}>
              ℹ️ <strong>PIN/SMS-kode:</strong> Hvis lommeboken ber om en 4-sifret kode, tast inn en vilkårlig 4-sifret kode (f.eks. <code>1234</code>) ettersom testmiljøet godtar alle koder.
            </div>
          )}

          <div className="qr-container">
            <div className="qr-box">
              {utstedtData.qrCodeDataUri ? (
                <img
                  src={utstedtData.qrCodeDataUri}
                  alt="QR-kode for bevis"
                  style={{ width: 240, height: 240, display: "block" }}
                />
              ) : (
                <QRCodeSVG
                  value={utstedtOfferUri}
                  size={240}
                  level="M"
                  includeMargin={true}
                />
              )}
            </div>
            <div className="qr-details">
              <div className="detail-line">
                <span className="detail-label">Bevis:</span>
                <strong>{utstedtData.bevisType}</strong>
              </div>
              <div className="detail-line">
                <span className="detail-label">Mottaker:</span>
                <span>{utstedtData.mottaker}</span>
              </div>
              <div className="detail-line">
                <span className="detail-label">Transaksjon:</span>
                <code>{utstedtData.transactionId}</code>
              </div>
              <div className="detail-line">
                <span className="detail-label">Pre-auth kode:</span>
                <code style={{ wordBreak: "break-all" }}>{utstedtData.preAuthorizedCode || "Aktiv"}</code>
              </div>
              <div className="detail-line">
                <span className="detail-label">Protokoll:</span>
                <span>OpenID4VCI (Pre-authorized Code Flow)</span>
              </div>

              <div className="btn-group">
                <a href={utstedtOfferUri} className="btn btn-secondary">
                  Åpne direkte i lommebok (samme enhet)
                </a>
                <button type="button" className="btn btn-ghost" onClick={kopierLenke}>
                  {kopiert ? "Kopiert!" : "Kopier lenke"}
                </button>
              </div>

              <div style={{ marginTop: "1rem", fontSize: "0.85rem", color: "#64748b" }}>
                📱 Har du ikke installert lommebok på telefonen?{" "}
                <a
                  href="https://testflight.apple.com/join/2FKCUj1J"
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#2563eb", textDecoration: "underline" }}
                >
                  Last ned testversjonen via Apple TestFlight
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
