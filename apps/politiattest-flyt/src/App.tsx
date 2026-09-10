import React, { useReducer } from "react";
import type { Person } from "./types";
import type { SystemPage } from "./types/page";
import { lagreSak, lastLagretSak, sakReducer, slettLagretSak } from "./state/caseReducer";
import type { SakHandling } from "./state/caseReducer";
import { useVerifisering } from "./state/useVerifisering";
import { AdminNavigation } from "./components/AdminNavigation/AdminNavigation";
import { StartPage } from "./components/StartPage/StartPage";
import { KommunePage } from "./components/KommunePage/KommunePage";
import { PolitietPage } from "./components/PolitietPage/PolitietPage";
import { InnboksPage } from "./components/InnboksPage/InnboksPage";

function initialSide(sak: ReturnType<typeof lastLagretSak>): SystemPage {
  if (window.location.pathname === "/verifisering-fullfort") {
    if (sak.politiattest.verification?.stage === "venter_paa_presentasjon") {
      return "innboks";
    }
    if (sak.formalsbevis.verification?.stage !== "ikke_startet") {
      return "politiet";
    }
  }
  return sak.person ? "kommune" : "start";
}

export default function App() {
  const [sak, rawDispatch] = useReducer(sakReducer, undefined, lastLagretSak);
  const [side, setSide] = React.useState<SystemPage>(() => initialSide(sak));
  const synkroniseringskanal = React.useRef<BroadcastChannel | null>(null);
  const dispatch = React.useCallback((handling: SakHandling) => {
    rawDispatch(handling);
    synkroniseringskanal.current?.postMessage(handling);
  }, []);
  const politiattestVerifisering = useVerifisering(
    "politiattest",
    sak.person,
    dispatch,
    sak.politiattest.verification
  );

  React.useEffect(() => {
    if (!("BroadcastChannel" in window)) return;
    const kanal = new BroadcastChannel("politiattest-flyt-case-v2");
    kanal.onmessage = (event: MessageEvent<SakHandling>) => {
      rawDispatch(event.data);
    };
    synkroniseringskanal.current = kanal;
    return () => {
      synkroniseringskanal.current = null;
      kanal.close();
    };
  }, []);

  React.useEffect(() => {
    lagreSak(sak);
  }, [sak]);

  React.useEffect(() => {
    if (window.location.pathname === "/verifisering-fullfort") {
      window.history.replaceState(null, "", "/");
    }
  }, []);

  function velgPerson(person: Person) {
    dispatch({ type: "VELG_PERSON", person });
    setSide("kommune");
  }

  function simulerFullfortSak(person: Person) {
    dispatch({ type: "SIMULER_FULLFORT_SAK", person });
    setSide("kommune");
  }

  function nullstill() {
    slettLagretSak();
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

      {side === "start" && <StartPage onVelgPerson={velgPerson} onSimulerFullfortSak={simulerFullfortSak} />}
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
        <InnboksPage sak={sak} dispatch={dispatch} />
      )}
    </div>
  );
}
