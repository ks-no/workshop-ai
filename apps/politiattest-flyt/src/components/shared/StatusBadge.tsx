import React from "react";

interface Props {
  tekst: string;
  tone?: "noytral" | "venter" | "suksess" | "advarsel" | "feil";
}

export const StatusBadge: React.FC<Props> = ({ tekst, tone = "noytral" }) => (
  <span className={`status-badge status-badge--${tone}`} role="status" aria-live="polite">
    {tekst}
  </span>
);
