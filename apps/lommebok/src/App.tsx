import { useState } from "react";
import { Utsteder } from "./components/Utsteder";
import { Verifiserer } from "./components/Verifiserer";
import { DeveloperInspector } from "./components/DeveloperInspector";
import { ApiCallTrace } from "./types";
import "./index.css";

export function App() {
  const [aktivFane, setAktivFane] = useState<"utsted" | "verifiser">("utsted");
  const [apiTraces, setApiTraces] = useState<ApiCallTrace[]>([]);

  const handleLogApiCall = (trace: ApiCallTrace) => {
    setApiTraces((prev) => [trace, ...prev]);
  };

  const handleClearTraces = () => {
    setApiTraces([]);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <div className="brand">
            <span className="brand-badge">EUDI WALLET</span>
            <span className="env-badge" title="Tilkoblet *.test.eidas2sandkasse.net">TESTMILJØ</span>
            <h1>Digital Lommebok - Sandkasse</h1>
          </div>
          <div className="header-links">
            <a href="http://localhost:3001/" className="nav-link">
              ← Tilbake til KS-dashboard
            </a>
          </div>
        </div>
      </header>

      <div className="tab-bar-container">
        <nav className="tab-bar" aria-label="Hovedvalg">
          <button
            type="button"
            className={`tab-btn ${aktivFane === "utsted" ? "active" : ""}`}
            onClick={() => setAktivFane("utsted")}
          >
            <span className="tab-num">1</span>
            <strong>Utsted bevis</strong>
            <span className="tab-sub">Fyll inn KS-data og generer QR</span>
          </button>
          <button
            type="button"
            className={`tab-btn ${aktivFane === "verifiser" ? "active" : ""}`}
            onClick={() => setAktivFane("verifiser")}
          >
            <span className="tab-num">2</span>
            <strong>Verifiser bevis</strong>
            <span className="tab-sub">DCQL-spørring & åpent API</span>
          </button>
        </nav>
      </div>

      <main className="app-content">
        <aside className="testflight-banner" aria-label="TestFlight EUDI Wallet">
          <div className="testflight-banner-content">
            <span className="testflight-banner-icon" aria-hidden="true">📲</span>
            <div>
              <div className="testflight-banner-title">TestFlight EUDI Wallet (iOS)</div>
              <div className="testflight-banner-desc">
                For å skanne QR-kodene og motta eller vise bevis på mobil, installer testversjonen av lommeboken via Apple TestFlight.
              </div>
            </div>
          </div>
          <a
            href="https://testflight.apple.com/join/2FKCUj1J"
            target="_blank"
            rel="noreferrer noopener"
            className="testflight-btn"
          >
            Installer i TestFlight ↗
          </a>
        </aside>

        {aktivFane === "utsted" ? (
          <Utsteder onLogApiCall={handleLogApiCall} />
        ) : (
          <Verifiserer onLogApiCall={handleLogApiCall} />
        )}

        <DeveloperInspector traces={apiTraces} onClear={handleClearTraces} />
      </main>

      <footer className="app-footer">
        <p>
          KS Hackathon 2026 · Integrert mot KS-sandkassedata og EUDIW Verifier Service (OpenID4VP / OpenID4VCI)
        </p>
      </footer>
    </div>
  );
}

export default App;
