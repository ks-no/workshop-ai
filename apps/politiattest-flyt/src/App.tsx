import React, { useReducer } from "react";
import type { Person } from "./types";
import type { SystemPage } from "./types/page";
import { lagreSak, lastLagretSak, sakReducer } from "./state/caseReducer";
import { useVerifisering } from "./state/useVerifisering";
import { AdminNavigation } from "./components/AdminNavigation/AdminNavigation";
import { StartPage } from "./components/StartPage/StartPage";
import { KommunePage } from "./components/KommunePage/KommunePage";
import { PolitietPage } from "./components/PolitietPage/PolitietPage";
import { InnboksPage } from "./components/InnboksPage/InnboksPage";

export default function App() {
  const [sak, dispatch] = useReducer(sakReducer, undefined, lastLagretSak);
  const [side, setSide] = React.useState<SystemPage>(sak.person ? "kommune" : "start");
  const politiattestVerifisering = useVerifisering("politiattest", sak.person, dispatch);

  React.useEffect(() => {
    lagreSak(sak);
  }, [sak]);

  function velgPerson(person: Person) {
    dispatch({ type: "VELG_PERSON", person });
    setSide("kommune");
  }

  function nullstill() {
    dispatch({ type: "NULLSTILL" });
    setSide("start");
  }

  const antallUlest = sak.inboxMessages.filter((m) => m.status === "ulest").length;

  return (
    <div className="app-shell">
      <AdminNavigation
        aktivSide={side}
        onNaviger={setSide}
        antallUlest={antallUlest}
        onNullstill={nullstill}
        harAktivSak={sak.person != null}
      />

      {side === "start" && <StartPage onVelgPerson={velgPerson} />}
      {side === "kommune" && (
        <KommunePage
          sak={sak}
          dispatch={dispatch}
        />
      )}
      {side === "politiet" && (
        <PolitietPage
          sak={sak}
          dispatch={dispatch}
          politiattestVerifisering={politiattestVerifisering}
        />
      )}
      {side === "innboks" && (
        <InnboksPage
          sak={sak}
          dispatch={dispatch}
          politiattestVerifisering={politiattestVerifisering}
        />
      )}
    </div>
  );
}
