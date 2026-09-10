import { useEffect, useRef, useState } from "react";
import type { CredentialKind, Person, VerificationRecord } from "../types";
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
  dispatch: React.Dispatch<SakHandling>,
  verification: VerificationRecord | null
): VerifiseringController {
  const [starter, setStarter] = useState(false);
  const pollingRef = useRef<number | null>(null);
  const gjeldendeTxRef = useRef<string | null>(null);
  const statusfeilRef = useRef(0);

  useEffect(() => {
    return () => {
      if (pollingRef.current) window.clearInterval(pollingRef.current);
      pollingRef.current = null;
      gjeldendeTxRef.current = null;
      statusfeilRef.current = 0;
    };
  }, []);

  useEffect(() => {
    const transactionId =
      verification?.stage === "venter_paa_presentasjon"
        ? verification.transactionId
        : null;

    if (!transactionId) {
      if (pollingRef.current) window.clearInterval(pollingRef.current);
      pollingRef.current = null;
      gjeldendeTxRef.current = null;
      statusfeilRef.current = 0;
      return;
    }

    if (gjeldendeTxRef.current !== transactionId) {
      void startPolling(transactionId);
    }
  }, [verification?.stage, verification?.transactionId, person?.personId]);

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

      if (status == null) {
        statusfeilRef.current += 1;
        if (statusfeilRef.current >= 3) {
          if (pollingRef.current) window.clearInterval(pollingRef.current);
          pollingRef.current = null;
          dispatch({ type: "VERIFISERING_FEILET", kind });
        }
        return;
      }

      statusfeilRef.current = 0;
      if (status === "AVAILABLE") {
        if (pollingRef.current) window.clearInterval(pollingRef.current);
        pollingRef.current = null;
        const resultat = await hentVerifiseringsresultat(transactionId, kind);
        if (gjeldendeTxRef.current !== transactionId) return;
        if (resultat) {
          vurderOgAvgjor(resultat.claims);
        } else {
          dispatch({ type: "VERIFISERING_FEILET", kind });
        }
      } else if (status === "FAILED" || status === "EXPIRED") {
        if (pollingRef.current) window.clearInterval(pollingRef.current);
        pollingRef.current = null;
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
