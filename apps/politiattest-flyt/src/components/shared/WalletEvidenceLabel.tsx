import React from "react";

interface Props {
  children: React.ReactNode;
}

export const WalletEvidenceLabel: React.FC<Props> = ({ children }) => (
  <div className="wallet-evidence-label">
    <span className="wallet-evidence-label__ikon" aria-hidden="true">L</span>
    <div>
      <strong>Digital lommebok</strong>
      <span>{children}</span>
    </div>
  </div>
);
