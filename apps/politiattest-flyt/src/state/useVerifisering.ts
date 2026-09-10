import { useEffect, useRef, useState } from "react";
import type { CredentialKind, Person } from "../types";
import {
  hentVerifiseringsresultat,
  hentVerifiseringsstatus,
  startVerifisering
} from "../integrations/lommebokApi";
import { sjekkFormalsbevisAksept, sjekkPolitiattestAksept } from "../integrations/credentialDefinitions";
import type { SakHandling } from "./caseReducer";

export interface VerifiseringController {
  start: () => Promise<void>;
  starter: boolean;
}

// Delt av PolitietPage (verifiserer formålsbekreftelse) og KommunePage (verifiserer
// politiattest) - selve OpenID4VP-mekanikken er identisk, bare hvilket bevis og
// hvilken akseptgate som brukes er ulikt.
export function useVerifisering(
  kind: CredentialKind,
  person: Person | null,
  dispatch: React.Dispatch<SakHandling>
): VerifiseringController {
  const [starter, setStarter] = useState(false);
  const pollingRef = useRef<number | null>(null);
  const gjeldendeTxRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (pollingRef.current) window.clearInterval(pollingRef.current);
    };
  }, []);

  function vurderOgAvgjor(claims: Record<string, unknown> | null) {
    if (!person) return;
    dispatch({ type: "VERIFISERING_MOTTATT", kind, claims: claims ?? {} });
    const resultat = kind === "formalsbekreftelse"
      ? sjekkFormalsbevisAksept(claims, person)
      : sjekkPolitiattestAksept(claims, person);
    if (resultat.ok) {
      dispatch({ type: "VERIFISERING_GODKJENT", kind });
    } else {
      dispatch({ type: "VERIFISERING_AVVIST", kind, aarsak: resultat.aarsak || "Ukjent avvisningsgrunn." });
    }
  }

  async function startPolling(transactionId: string) {
    if (pollingRef.current) window.clearInterval(pollingRef.current);
    gjeldendeTxRef.current = transactionId;

    pollingRef.current = window.setInterval(async () => {
      const status = await hentVerifiseringsstatus(transactionId);
      // Forkast svar fra en tidligere (avsluttet/nullstilt) transaksjon.
      if (gjeldendeTxRef.current !== transactionId) return;

      if (status === "AVAILABLE") {
        if (pollingRef.current) window.clearInterval(pollingRef.current);
        const resultat = await hentVerifiseringsresultat(transactionId, kind);
        if (gjeldendeTxRef.current !== transactionId) return;
        vurderOgAvgjor(resultat?.claims ?? null);
      } else if (status === "FAILED" || status === "EXPIRED") {
        if (pollingRef.current) window.clearInterval(pollingRef.current);
        dispatch({ type: "VERIFISERING_FEILET", kind });
      }
    }, 2000);
  }

  async function start() {
    setStarter(true);
    try {
      const resultat = await startVerifisering(kind);
      dispatch({
        type: "VERIFISERING_STARTET",
        kind,
        transactionId: resultat.transactionId,
        authorizationRequest: resultat.authorizationRequest,
        simulated: resultat.simulert
      });
      if (!resultat.simulert) {
        await startPolling(resultat.transactionId);
      } else {
        gjeldendeTxRef.current = resultat.transactionId;
      }
    } catch {
      dispatch({ type: "VERIFISERING_FEILET", kind });
    } finally {
      setStarter(false);
    }
  }

  return { start, starter };
}
