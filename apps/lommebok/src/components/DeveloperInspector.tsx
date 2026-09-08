import React, { useState } from "react";
import { ApiCallTrace } from "../types";

interface Props {
  traces: ApiCallTrace[];
  onClear: () => void;
}

export const DeveloperInspector: React.FC<Props> = ({ traces, onClear }) => {
  const [apent, setApent] = useState<boolean>(true);
  const [kopiertId, setKopiertId] = useState<string | null>(null);

  const kopierCurl = (trace: ApiCallTrace) => {
    navigator.clipboard.writeText(trace.curl);
    setKopiertId(trace.id);
    setTimeout(() => setKopiertId(null), 2000);
  };

  return (
    <aside className="dev-panel">
      <div className="dev-header">
        <div className="dev-title">
          <span className="dev-icon">⚡</span>
          <strong>Utviklerpanel & API-inspeksjon</strong>
          <span className="api-key-badge">X-API-KEY: KS-HACKATHON</span>
        </div>
        <div className="dev-actions">
          {traces.length > 0 && (
            <button type="button" className="btn-small" onClick={onClear}>
              Tøm logg ({traces.length})
            </button>
          )}
          <button
            type="button"
            className="btn-small"
            onClick={() => setApent(!apent)}
          >
            {apent ? "Minimer ▲" : "Åpne ▼"}
          </button>
        </div>
      </div>

      {apent && (
        <div className="dev-body">
          <p className="dev-intro">
            Her vises de underliggende API-kallene i sanntid. Alle deltakere kan kopiere <code>curl</code>-kommandoene direkte for å integrere mot de samme endepunktene i egne tjenester:
          </p>

          {traces.length === 0 ? (
            <div className="dev-empty">
              Ingen API-kall utført ennå. Klikk «Utsted bevis» eller «Start verifiseringsflyt» for å se kallene.
            </div>
          ) : (
            <div className="trace-list">
              {traces.map((trace) => (
                <div key={trace.id} className="trace-item">
                  <div className="trace-top">
                    <span className={`method-badge ${trace.metode.toLowerCase()}`}>
                      {trace.metode}
                    </span>
                    <span className="trace-url">{trace.url}</span>
                    <span className="trace-time">{trace.tidspunkt}</span>
                  </div>

                  <div className="trace-desc">{trace.tittel}</div>

                  <div className="curl-section">
                    <div className="curl-header">
                      <span>cURL (kjør i terminalen):</span>
                      <button
                        type="button"
                        className="btn-copy"
                        onClick={() => kopierCurl(trace)}
                      >
                        {kopiertId === trace.id ? "✓ Kopiert!" : "Kopier curl"}
                      </button>
                    </div>
                    <pre className="curl-box">{trace.curl}</pre>
                  </div>

                  {trace.responseBody && (
                    <details className="response-details">
                      <summary>Vis API-respons ({trace.responseStatus || 200})</summary>
                      <pre className="json-box">
                        {JSON.stringify(trace.responseBody, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
};
