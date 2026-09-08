import React, { useState, useEffect, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { CREDENTIAL_DEFINITIONS } from "../data/credentials";
import { CredentialId, ApiCallTrace, VerificationStartResponse } from "../types";

interface Props {
  onLogApiCall: (trace: ApiCallTrace) => void;
}

export const Verifiserer: React.FC<Props> = ({ onLogApiCall }) => {
  const [valgtBevisId, setValgtBevisId] = useState<CredentialId>("pid");
  const [laster, setLaster] = useState<boolean>(false);
  const [feil, setFeil] = useState<string | null>(null);

  // Verifiseringstilstand
  const [transaksjon, setTransaksjon] = useState<VerificationStartResponse | null>(null);
  const [status, setStatus] = useState<string>("INITIAL"); // INITIAL, WAIT, AVAILABLE, ERROR
  const [verifisertResultat, setVerifisertResultat] = useState<any | null>(null);

  const pollingRef = useRef<number | null>(null);

  const valgtBevis = CREDENTIAL_DEFINITIONS[valgtBevisId];
  const dcqlQuery = valgtBevis.lagDcqlQuery();

  // Rydd opp polling ved unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  // 1. Start verifisering
  const handleStartVerifisering = async () => {
    setLaster(true);
    setFeil(null);
    setVerifisertResultat(null);
    setStatus("WAIT");

    const verifierBase = "https://verifier-service.test.eidas2sandkasse.net";
    const clientApp = "bevisgenerator-login";
    const redirectUri = `${window.location.origin}/verifisering-fullfort`;
    const requestBody = {
      dcql_query: dcqlQuery,
      redirect_uri: redirectUri
    };

    const startCurl = `curl -X POST "${verifierBase}/api/v1/${clientApp}/verify/start/" \\
  -H "Content-Type: application/json" \\
  -H "X-API-KEY: KS-HACKATHON" \\
  -d '${JSON.stringify(requestBody, null, 2)}'`;

    try {
      const res = await fetch(`/api/v1/${clientApp}/verify/start/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": "KS-HACKATHON"
        },
        body: JSON.stringify(requestBody)
      });

      if (!res.ok) {
        throw new Error(`Verifier-service svarte med HTTP ${res.status}: ${res.statusText}`);
      }

      const data: VerificationStartResponse = await res.json();
      setTransaksjon(data);

      onLogApiCall({
        id: `tx-start-${Date.now()}`,
        tittel: `1. Start verifisering (${valgtBevis.tittel})`,
        tidspunkt: new Date().toLocaleTimeString("nb-NO"),
        metode: "POST",
        url: `${verifierBase}/api/v1/${clientApp}/verify/start/`,
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": "KS-HACKATHON"
        },
        requestBody,
        responseStatus: res.status,
        responseBody: data,
        curl: startCurl
      });

      // Start polling for status
      startStatusPolling(data.verifier_transaction_id, clientApp);
    } catch (err: any) {
      console.warn("Klarte ikke koble til verifier-service i testmiljøet:", err.message);
      // Generer en mock/fallback transaksjon for testing dersom eudiw-verifier-service ikke svarer
      const fallbackTxId = `tx-demo-${Date.now().toString(36)}`;
      const fallbackAuthRequest = `eudi-openid4vp://${verifierBase.replace(/^https?:\/\//, "")}?client_id=abr.vc.local&request_uri=${verifierBase}/api/v1/${clientApp}/openid4vp/${fallbackTxId}`;

      const fallbackData: VerificationStartResponse = {
        verifier_transaction_id: fallbackTxId,
        authorization_request: fallbackAuthRequest
      };

      setTransaksjon(fallbackData);
      setFeil("Merknad: Kunne ikke koble til verifier-service i testmiljøet. Viser simulert visning slik at du kan teste flyten.");

      onLogApiCall({
        id: `tx-start-${Date.now()}`,
        tittel: `1. Start verifisering (simulert): ${valgtBevis.tittel}`,
        tidspunkt: new Date().toLocaleTimeString("nb-NO"),
        metode: "POST",
        url: `${verifierBase}/api/v1/${clientApp}/verify/start/`,
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": "KS-HACKATHON"
        },
        requestBody,
        responseStatus: 200,
        responseBody: fallbackData,
        curl: startCurl
      });
    } finally {
      setLaster(false);
    }
  };

  // 2. Status-polling mot verifier-service
  const startStatusPolling = (txId: string, clientApp: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);

    pollingRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/${clientApp}/verify/status/${txId}`, {
          headers: {
            "Accept": "application/json",
            "X-API-KEY": "KS-HACKATHON"
          }
        });

        if (res.ok) {
          const statusData = await res.json();
          const currentStatus = statusData.status;

          if (currentStatus === "AVAILABLE") {
            if (pollingRef.current) clearInterval(pollingRef.current);
            setStatus("AVAILABLE");
            // Hent resultatet
            await hentResultat(txId, clientApp);
          } else if (currentStatus === "FAILED" || currentStatus === "EXPIRED") {
            if (pollingRef.current) clearInterval(pollingRef.current);
            setStatus(currentStatus);
            setFeil(`Verifiseringen ble avbrutt eller feilet med status: ${currentStatus}`);
          }
        }
      } catch (err) {
        console.error("Feil under statuspolling:", err);
      }
    }, 2000);
  };

  // 3. Hent verifisert resultat
  const hentResultat = async (txId: string, clientApp: string) => {
    const verifierBase = "https://verifier-service.test.eidas2sandkasse.net";
    const resultCurl = `curl -X GET "${verifierBase}/api/v1/${clientApp}/verify/result/${txId}" \\
  -H "Accept: application/json" \\
  -H "X-API-KEY: KS-HACKATHON"`;

    try {
      const res = await fetch(`/api/v1/${clientApp}/verify/result/${txId}`, {
        headers: {
          "Accept": "application/json",
          "X-API-KEY": "KS-HACKATHON"
        }
      });

      if (res.ok) {
        const resultData = await res.json();
        setVerifisertResultat(resultData);

        // Lagre i API-serveren vår slik at deltakere kan hente via GET /api/verifikasjon/:id
        await fetch("/api/verifikasjon/lagre", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactionId: txId, result: resultData })
        });

        onLogApiCall({
          id: `tx-res-${Date.now()}`,
          tittel: `3. Hent verifisert resultat`,
          tidspunkt: new Date().toLocaleTimeString("nb-NO"),
          metode: "GET",
          url: `${verifierBase}/api/v1/${clientApp}/verify/result/${txId}`,
          headers: {
            "Accept": "application/json",
            "X-API-KEY": "KS-HACKATHON"
          },
          responseStatus: res.status,
          responseBody: resultData,
          curl: resultCurl
        });
      }
    } catch (err: any) {
      console.error("Kunne ikke hente verifiseringsresultat:", err);
    }
  };

  // Simuler fullført skanning (for testing og hackathon-bruk uten ekte lommebok)
  const handleSimulerFullfort = async () => {
    if (!transaksjon) return;
    if (pollingRef.current) clearInterval(pollingRef.current);

    setStatus("AVAILABLE");

    // Lag et realistisk verifisert datasett basert på valgt bevis
    const simulertResultat = {
      status: "SUCCESS",
      verifier_transaction_id: transaksjon.verifier_transaction_id,
      verified_at: new Date().toISOString(),
      credential_configuration_id: valgtBevis.credentialConfigurationId,
      format: valgtBevis.format,
      claims: {
        personal_administrative_number: "12818800078",
        family_name: "Solberg",
        given_name: "Maja",
        birth_date: "1988-01-12",
        ...(valgtBevisId === "barnehage" ? {
          barnehagenavn: "Solsiden kommunale barnehage",
          kommune: "Bergen",
          plassprosent: 100,
          status: "AKTIV_PLASS"
        } : {}),
        ...(valgtBevisId === "politiattest" ? {
          attesttype: "barneomsorgsattest",
          formaal: "barnehage og frivillighet",
          status: "INTET_Å_BEMERKE"
        } : {}),
        ...(valgtBevisId === "krr" ? {
          epostadresse: "maja.solberg@example.test",
          mobiltelefonnummer: "+4799990001",
          reservert: false
        } : {})
      }
    };

    setVerifisertResultat(simulertResultat);

    // Lagre i api-serveren vår
    await fetch("/api/verifikasjon/lagre", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transactionId: transaksjon.verifier_transaction_id,
        result: simulertResultat
      })
    });

    const apiCurl = `curl -X GET "http://localhost:3002/api/verifikasjon/${transaksjon.verifier_transaction_id}" \\
  -H "X-API-KEY: KS-HACKATHON"`;

    onLogApiCall({
      id: `tx-sim-${Date.now()}`,
      tittel: `Simulert verifisering & API-output`,
      tidspunkt: new Date().toLocaleTimeString("nb-NO"),
      metode: "GET",
      url: `http://localhost:3002/api/verifikasjon/${transaksjon.verifier_transaction_id}`,
      headers: {
        "X-API-KEY": "KS-HACKATHON"
      },
      responseStatus: 200,
      responseBody: simulertResultat,
      curl: apiCurl
    });
  };

  return (
    <div className="flow-container">
      <div className="card">
        <h2>1. Velg bevis som skal verifiseres</h2>
        <p className="description">
          Velg bevis for å generere DCQL-forespørsel mot verifier-tjenesten:
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
                  setTransaksjon(null);
                  setVerifisertResultat(null);
                }}
              >
                <div className="card-header">
                  <strong>{def.tittel}</strong>
                  <span className="pill">{def.format}</span>
                </div>
                <p className="card-desc">{def.beskrivelse}</p>
              </button>
            );
          })}
        </div>

        <div className="preview-box">
          <div className="preview-header">
            <strong>Generert DCQL Query (Digital Credentials Query Language):</strong>
          </div>
          <pre className="json-preview">{JSON.stringify(dcqlQuery, null, 2)}</pre>
        </div>

        <div className="action-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleStartVerifisering}
            disabled={laster}
          >
            {laster ? "Starter verifisering…" : "Start verifiseringsflyt"}
          </button>
        </div>
      </div>

      {feil && <div className="alert alert-info">{feil}</div>}

      {transaksjon && (
        <div className="card result-card">
          <h2>2. Skann QR-kode for å presentere bevis</h2>
          <p className="description">
            Skann QR-koden med din digitale lommebok for å godkjenne deling av etterspurte data:
          </p>

          <div className="qr-container">
            <div className="qr-box">
              {transaksjon.authorization_request_qr_code ? (
                <img
                  src={transaksjon.authorization_request_qr_code}
                  alt="Presentasjons-QR-kode"
                  style={{ width: 240, height: 240 }}
                />
              ) : (
                <QRCodeSVG
                  value={transaksjon.authorization_request || `eudi-openid4vp://mock?id=${transaksjon.verifier_transaction_id}`}
                  size={240}
                  level="M"
                  includeMargin={true}
                />
              )}
            </div>

            <div className="qr-details">
              <div className="detail-line">
                <span className="detail-label">Status:</span>
                <span className={`status-tag ${status.toLowerCase()}`}>
                  {status === "WAIT" ? "⏳ Venter på skanning…" : status === "AVAILABLE" ? "✓ Fullført" : status}
                </span>
              </div>
              <div className="detail-line">
                <span className="detail-label">Transaksjons-ID:</span>
                <code>{transaksjon.verifier_transaction_id}</code>
              </div>
              <div className="detail-line">
                <span className="detail-label">Protokoll:</span>
                <span>OpenID4VP (DCQL Presentation)</span>
              </div>

              <div className="btn-group">
                {transaksjon.authorization_request && (
                  <a href={transaksjon.authorization_request} className="btn btn-secondary">
                    Åpne i lommebok på denne enheten
                  </a>
                )}
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handleSimulerFullfort}
                  title="Simulerer at brukeren har skannet og godkjent i lommeboken"
                >
                  ⚡ Simuler fullført skanning
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {verifisertResultat && (
        <div className="card verified-data-card">
          <h2>3. Verifisert data mottatt</h2>
          <p className="description">
            Dataene under ble kryptografisk verifisert av verifier-tjenesten og er nå tilgjengelige både her og via vårt åpne REST-API for hackathon-deltakere:
          </p>

          <div className="api-callout">
            <div className="api-callout-title">
              🌐 <strong>Bruk dataene i din egen løsning:</strong>
            </div>
            <p className="api-callout-text">
              Deltakere kan hente ut dette resultatet i sanntid via vårt åpne API-endepunkt:
            </p>
            <code className="api-code">
              curl -X GET "http://localhost:3002/api/verifikasjon/{transaksjon?.verifier_transaction_id}" -H "X-API-KEY: KS-HACKATHON"
            </code>
          </div>

          <div className="claims-table-wrapper">
            <table className="claims-table">
              <thead>
                <tr>
                  <th>Felt / Claim</th>
                  <th>Verifisert verdi</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(verifisertResultat.claims || {}).map(([key, val]) => (
                  <tr key={key}>
                    <td><code>{key}</code></td>
                    <td>
                      <strong>
                        {typeof val === "object" ? JSON.stringify(val) : String(val)}
                      </strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="preview-box" style={{ marginTop: "1rem" }}>
            <div className="preview-header">
              <strong>Full rå JSON fra Verifier API:</strong>
            </div>
            <pre className="json-preview">{JSON.stringify(verifisertResultat, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
};
