import React from "react";
import type { SystemPage } from "../../types/page";

interface Props {
  aktivSide: SystemPage;
  onNaviger: (side: SystemPage) => void;
  antallUlest: number;
  onNullstill: () => void;
  harAktivSak: boolean;
}

const SIDER: Array<{ id: SystemPage; label: string }> = [
  { id: "start", label: "Start" },
  { id: "kommune", label: "Drammen kommune (saksbehandler)" },
  { id: "politiet", label: "Politiet (bruker)" },
  { id: "innboks", label: "Innboks (bruker)" }
];

// Denne navigasjonen er kun til test/demo-formål - i virkeligheten er dette fire
// separate systemer som aldri ville delt navigasjon. Se planen: manuell navigering
// mellom sidene er poenget, ikke noe å bygge bort.
export const AdminNavigation: React.FC<Props> = ({ aktivSide, onNaviger, antallUlest, onNullstill, harAktivSak }) => (
  <nav className="admin-nav" aria-label="Demo-navigasjon mellom systemer">
    <span className="admin-nav__merkelapp">Demo-navigasjon</span>
    <ul className="admin-nav__liste">
      {SIDER.map((side) => (
        <li key={side.id}>
          <button
            type="button"
            className={`admin-nav__lenke ${aktivSide === side.id ? "admin-nav__lenke--aktiv" : ""}`}
            onClick={() => onNaviger(side.id)}
            aria-current={aktivSide === side.id ? "page" : undefined}
            disabled={side.id !== "start" && !harAktivSak}
          >
            {side.label}
            {side.id === "innboks" && antallUlest > 0 && (
              <span className="admin-nav__badge" aria-label={`${antallUlest} uleste meldinger`}>
                {antallUlest}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
    <button type="button" className="admin-nav__nullstill" onClick={onNullstill}>
      Nullstill sak
    </button>
  </nav>
);
