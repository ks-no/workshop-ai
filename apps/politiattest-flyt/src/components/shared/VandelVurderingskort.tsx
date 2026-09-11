import React from "react";
import type { Vandelvurdering } from "../../types";
import { navnForRolle } from "../../utils/roller";
import { LoadingIndicator } from "./LoadingIndicator";
import { MetadataTable } from "./MetadataTable";
import { StatusBadge } from "./StatusBadge";
import { WalletEvidenceLabel } from "./WalletEvidenceLabel";

interface Props {
  vurdering: Vandelvurdering;
  onRetry: () => void;
}

function utfallstekst(vurdering: Vandelvurdering): string {
  if (vurdering.utfall === "godkjent") return "Godkjent av regelkontrollen";
  if (vurdering.utfall === "krever_manuell_vurdering") return "Krever manuell vurdering";
  if (vurdering.utfall === "avvist") return "Avvist av regelkontrollen";
  return "Vurdering ikke ferdig";
}

function utfallTone(vurdering: Vandelvurdering): "suksess" | "advarsel" | "feil" {
  if (vurdering.utfall === "godkjent") return "suksess";
  if (vurdering.utfall === "krever_manuell_vurdering") return "advarsel";
  return "feil";
}

function nesteHandling(vurdering: Vandelvurdering): string {
  if (vurdering.utfall === "godkjent") {
    return "Registrer kontrollen som fullført når formål og attest er kontrollert.";
  }
  if (vurdering.utfall === "krever_manuell_vurdering") {
    return "Vurder egnetheten manuelt. Regelkontrollen har ikke avgjort saken.";
  }
  return "Ikke gå videre med ansettelsen. Regelen utelukker saken direkte.";
}

export const VandelVurderingskort: React.FC<Props> = ({ vurdering, onRetry }) => (
  <section className="kommune-page__vurderingskort" aria-live="polite">
    <div className="kommune-page__vurderingskort-header">
      <div>
        <span className="kommune-page__kortmerke">REGELKONTROLL</span>
        <h2>Vurderingskort</h2>
      </div>
      <span className="kommune-page__regelikon" aria-hidden="true">✓</span>
    </div>

    <WalletEvidenceLabel>
      Regelkontrollen bruker det minimerte politiattestbeviset fra kandidatens lommebok.
    </WalletEvidenceLabel>

    {vurdering.status === "laster" && (
      <LoadingIndicator tekst="Kjører vandelskontrollen i sandkassen…" />
    )}

    {vurdering.status === "ikke_hentet" && (
      <>
        <StatusBadge tekst="Vandelskontroll ikke kjørt" tone="advarsel" />
        <p className="kommune-page__ki-merknad">
          Denne visningen er simulert og inneholder ikke en ny regelvurdering.
        </p>
      </>
    )}

    {vurdering.status === "feil" && (
      <>
        <StatusBadge tekst={`Vandelskontrollen feilet: ${vurdering.feil || "ukjent feil"}`} tone="feil" />
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          Prøv igjen
        </button>
      </>
    )}

    {vurdering.status === "hentet" && vurdering.formaal && (
      <>
        <StatusBadge tekst={utfallstekst(vurdering)} tone={utfallTone(vurdering)} />
        <MetadataTable
          tittel="Grunnlag"
          rader={[
            { label: "Formål", verdi: navnForRolle(vurdering.formaal.rolle) },
            { label: "Hjemmel", verdi: vurdering.formaal.hjemmel },
            { label: "Attesttype", verdi: vurdering.formaal.attesttype },
            { label: "Regelutfall", verdi: vurdering.regelutfall || "ukjent" },
            { label: "Datakilde", verdi: "Digital lommebok" }
          ]}
        />
        <p className="kommune-page__nestehandling">
          <strong>Neste handling:</strong> {nesteHandling(vurdering)}
        </p>
        <p className="kommune-page__ki-merknad">
          KI avgjør ikke saken. Regelen avgjør utfallet; KI kan bare formulere en forklaring.
        </p>
      </>
    )}
  </section>
);
