import type { CaseState, CredentialKind, InboxMessage, IssuanceRecord, Person, VerificationRecord } from "../types";

const LAGRINGSNOEKKEL = "politiattest-flyt-case-v2";

const TOM_VERIFIKASJON: VerificationRecord = {
  stage: "ikke_startet",
  transactionId: null,
  authorizationRequest: null,
  claims: null,
  simulated: false,
  rejectionReason: null,
  verifiedAt: null
};

export function tomSak(): CaseState {
  return {
    person: null,
    soknadsdato: null,
    kommuneSaksstatus: "ingen_sak",
    formalsbevis: { issuance: null, verification: { ...TOM_VERIFIKASJON } },
    politiattest: { issuance: null, verification: { ...TOM_VERIFIKASJON } },
    inboxMessages: []
  };
}

export function lastLagretSak(): CaseState {
  try {
    const raw = sessionStorage.getItem(LAGRINGSNOEKKEL);
    if (!raw) return tomSak();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("kommuneSaksstatus" in parsed)) return tomSak();
    return parsed as CaseState;
  } catch {
    return tomSak();
  }
}

export function lagreSak(state: CaseState): void {
  try {
    sessionStorage.setItem(LAGRINGSNOEKKEL, JSON.stringify(state));
  } catch {
    // sessionStorage kan være utilgjengelig (privat modus e.l.) - da mister vi bare
    // persistering ved refresh, resten av demoen fungerer fortsatt.
  }
}

export type SakHandling =
  | { type: "VELG_PERSON"; person: Person }
  | { type: "UTSTEDELSE_STARTET"; kind: CredentialKind }
  | { type: "UTSTEDELSE_FULLFORT"; kind: CredentialKind; issuance: IssuanceRecord; messages: InboxMessage[] }
  | { type: "MELDING_LEST"; messageId: string }
  | { type: "VERIFISERING_STARTET"; kind: CredentialKind; transactionId: string; authorizationRequest: string; simulated: boolean }
  | { type: "VERIFISERING_MOTTATT"; kind: CredentialKind; claims: Record<string, unknown> }
  | { type: "VERIFISERING_GODKJENT"; kind: CredentialKind }
  | { type: "VERIFISERING_AVVIST"; kind: CredentialKind; aarsak: string }
  | { type: "VERIFISERING_FEILET"; kind: CredentialKind }
  | { type: "NULLSTILL" };

function bevisNoekkel(kind: CredentialKind): "formalsbevis" | "politiattest" {
  return kind === "formalsbekreftelse" ? "formalsbevis" : "politiattest";
}

export function sakReducer(state: CaseState, handling: SakHandling): CaseState {
  switch (handling.type) {
    case "VELG_PERSON": {
      const neste = tomSak();
      neste.person = handling.person;
      neste.soknadsdato = new Date().toISOString().slice(0, 10);
      neste.kommuneSaksstatus = "venter_paa_politiattest";
      return neste;
    }

    case "UTSTEDELSE_FULLFORT": {
      const noekkel = bevisNoekkel(handling.kind);
      return {
        ...state,
        [noekkel]: { ...state[noekkel], issuance: handling.issuance },
        inboxMessages: [...handling.messages, ...state.inboxMessages]
      };
    }

    case "MELDING_LEST": {
      return {
        ...state,
        inboxMessages: state.inboxMessages.map((m) =>
          m.id === handling.messageId ? { ...m, status: "lest" } : m
        )
      };
    }

    case "VERIFISERING_STARTET": {
      const noekkel = bevisNoekkel(handling.kind);
      return {
        ...state,
        [noekkel]: {
          ...state[noekkel],
          verification: {
            ...TOM_VERIFIKASJON,
            stage: "venter_paa_presentasjon",
            transactionId: handling.transactionId,
            authorizationRequest: handling.authorizationRequest,
            simulated: handling.simulated
          }
        }
      };
    }

    case "VERIFISERING_MOTTATT": {
      const noekkel = bevisNoekkel(handling.kind);
      return {
        ...state,
        [noekkel]: {
          ...state[noekkel],
          verification: {
            ...state[noekkel].verification!,
            stage: "mottatt_ikke_godkjent",
            claims: handling.claims
          }
        }
      };
    }

    case "VERIFISERING_GODKJENT": {
      const noekkel = bevisNoekkel(handling.kind);
      const oppdatertSak: CaseState = {
        ...state,
        [noekkel]: {
          ...state[noekkel],
          verification: {
            ...state[noekkel].verification!,
            stage: "godkjent",
            rejectionReason: null,
            verifiedAt: new Date().toISOString()
          }
        }
      };
      if (handling.kind === "politiattest") {
        oppdatertSak.kommuneSaksstatus = "politiattest_mottatt";
      }
      return oppdatertSak;
    }

    case "VERIFISERING_AVVIST": {
      const noekkel = bevisNoekkel(handling.kind);
      return {
        ...state,
        [noekkel]: {
          ...state[noekkel],
          verification: {
            ...state[noekkel].verification!,
            stage: "avvist",
            rejectionReason: handling.aarsak
          }
        }
      };
    }

    case "VERIFISERING_FEILET": {
      const noekkel = bevisNoekkel(handling.kind);
      return {
        ...state,
        [noekkel]: {
          ...state[noekkel],
          verification: { ...state[noekkel].verification!, stage: "feilet" }
        }
      };
    }

    case "NULLSTILL":
      return tomSak();

    default:
      return state;
  }
}
