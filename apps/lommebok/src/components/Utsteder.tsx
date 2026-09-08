import React, { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { CREDENTIAL_DEFINITIONS } from "../data/credentials";
import { CredentialId, Person, ApiCallTrace } from "../types";

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

  // Resultat etter utstedelse
  const [utstedtOfferUri, setUtstedtOfferUri] = useState<string | null>(null);
  const [utstedtData, setUtstedtData] = useState<any | null>(null);
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
      } catch (err: any) {
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
    // Nullstill tidligere utstedelse ved endring
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

  // Utsted bevis-funksjon
  const handleUtsted = () => {
    if (!valgtPerson) return;

    const transactionId = `tx-issue-${Date.now()}`;
    const preAuthCode = `code-${Math.random().toString(36).substring(2, 10)}`;

    const credentialOffer = {
      credential_issuer: "http://localhost:9240",
      credential_configuration_ids: [valgtBevis.credentialConfigurationId],
      grants: {
        "urn:ietf:params:oauth:grant-type:pre-authorized_code": {
          "pre-authorized_code": preAuthCode,
          user_pin_required: false
        }
      }
    };

    const offerEncoded = encodeURIComponent(JSON.stringify(credentialOffer));
    const offerUri = `openid-credential-offer://?credential_offer=${offerEncoded}`;

    setUtstedtOfferUri(offerUri);
    setUtstedtData({
      transactionId,
      bevisType: valgtBevis.tittel,
      mottaker: `${valgtPerson.visningsnavn} (${valgtPerson.syntetiskFodselsnummer})`,
      claims: eksempelData,
      credentialOffer
    });

    // Bygg API-kalltrace og curl for deltakere
    const requestBody = {
      credential_issuer: "http://localhost:9240",
      credential_configuration_id: valgtBevis.credentialConfigurationId,
      subject: {
        identifier: valgtPerson.syntetiskFodselsnummer
      },
      credential_data: eksempelData
    };

    const curl = `curl -X POST "http://localhost:9240/api/v1/credential/issuance-transaction" \\
  -H "Content-Type: application/json" \\
  -H "X-API-KEY: KS-HACKATHON" \\
  -d '${JSON.stringify(requestBody, null, 2)}'`;

    onLogApiCall({
      id: transactionId,
      tittel: `Utsted: ${valgtBevis.tittel}`,
      tidspunkt: new Date().toLocaleTimeString("nb-NO"),
      metode: "POST",
      url: "http://localhost:9240/api/v1/credential/issuance-transaction",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": "KS-HACKATHON"
      },
      requestBody,
      responseStatus: 202,
      responseBody: {
        issuance_transaction_id: transactionId,
        credential_offer: credentialOffer
      },
      curl
    });
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

        <div className="action-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleUtsted}
            disabled={!valgtPerson || lasterPersoner}
          >
            Utsted bevis til lommebok
          </button>
        </div>
      </div>

      {utstedtOfferUri && utstedtData && (
        <div className="card result-card">
          <h2>3. Skann QR-kode med lommeboken</h2>
          <p className="description">
            QR-koden er klar fra utsteder-tjenesten. Åpne din EUDI Wallet / digitale lommebok og skann koden for å motta beviset:
          </p>

          <div className="qr-container">
            <div className="qr-box">
              <QRCodeSVG
                value={utstedtOfferUri}
                size={240}
                level="M"
                includeMargin={true}
              />
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
