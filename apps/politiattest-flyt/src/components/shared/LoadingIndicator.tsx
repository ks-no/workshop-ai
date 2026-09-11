import React from "react";

interface Props {
  tekst: string;
}

export const LoadingIndicator: React.FC<Props> = ({ tekst }) => (
  <div className="loading-indicator" role="status" aria-live="polite">
    <span className="loading-indicator__spinner" aria-hidden="true" />
    <span>{tekst}</span>
  </div>
);
