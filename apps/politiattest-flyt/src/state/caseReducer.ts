import type {
  CaseState,
  CredentialKind,
  InboxMessage,
  IssuanceRecord,
  Person,
  Vandelvurdering,
  VerificationRecord
} from "../types";
import { byggFormalsbevisClaims, byggPolitiattestClaims } from "../integrations/credentialDefinitions";

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

const TOM_VANDELVURDERING: Vandelvurdering = {
  status: "ikke_hentet",
  utfall: null,
  regelutfall: null,
  godkjent: null,
  melding: null,
  formaal: null,
  feil: null
};

export function tomSak(): CaseState {
  return {
    person: null,
    soknadsdato: null,
    idPortenAccessToken: null,
    kommuneSaksstatus: "ingen_sak",
    formalsbevis: { issuance: null, verification: { ...TOM_VERIFIKASJON } },
    politiattest: { issuance: null, verification: { ...TOM_VERIFIKASJON } },
    vandelvurdering: { ...TOM_VANDELVURDERING },
    inboxMessages: []
  };
}

export function lastLagretSak(): CaseState {
  try {
    const erVerifiseringsretur = window.location.pathname === "/verifisering-fullfort";
    const raw =
      sessionStorage.getItem(LAGRINGSNOEKKEL) ??
      (erVerifiseringsretur ? localStorage.getItem(LAGRINGSNOEKKEL) : null);
    if (!raw) return tomSak();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("kommuneSaksstatus" in parsed)) return tomSak();
    const normalisert: CaseState = {
      ...parsed,
      idPortenAccessToken: parsed.idPortenAccessToken ?? null,
      vandelvurdering: parsed.vandelvurdering ?? { ...TOM_VANDELVURDERING }
    };
    sessionStorage.setItem(LAGRINGSNOEKKEL, JSON.stringify(normalisert));
    if (erVerifiseringsretur) {
      localStorage.removeItem(LAGRINGSNOEKKEL);
    }
    return normalisert;
  } catch {
    return tomSak();
  }
}

export function lagreSak(state: CaseState): void {
  try {
    const serialized = JSON.stringify(state);
    sessionStorage.setItem(LAGRINGSNOEKKEL, serialized);
    const venterPaaRetur =
      state.formalsbevis.verification?.stage === "venter_paa_presentasjon" ||
      state.politiattest.verification?.stage === "venter_paa_presentasjon";
    if (venterPaaRetur) {
      localStorage.setItem(LAGRINGSNOEKKEL, serialized);
    } else {
      localStorage.removeItem(LAGRINGSNOEKKEL);
    }
  } catch {
    // Nettleserlagring kan være utilgjengelig (privat modus e.l.) - da mister vi bare
    // persistering ved refresh, resten av demoen fungerer fortsatt.
  }
}

export function slettLagretSak(): void {
  sessionStorage.removeItem(LAGRINGSNOEKKEL);
  localStorage.removeItem(LAGRINGSNOEKKEL);
}

export type SakHandling =
  | { type: "VELG_PERSON"; person: Person }
  | { type: "ID_PORTEN_INNLOGGET"; accessToken: string }
  | { type: "UTSTEDELSE_STARTET"; kind: CredentialKind }
  | { type: "UTSTEDELSE_FULLFORT"; kind: CredentialKind; issuance: IssuanceRecord; messages: InboxMessage[] }
  | { type: "MELDING_LEST"; messageId: string }
  | { type: "VERIFISERING_STARTET"; kind: CredentialKind; transactionId: string; authorizationRequest: string; simulated: boolean }
  | { type: "VERIFISERING_MOTTATT"; kind: CredentialKind; claims: Record<string, unknown> }
  | { type: "VERIFISERING_GODKJENT"; kind: CredentialKind }
  | { type: "VERIFISERING_AVVIST"; kind: CredentialKind; aarsak: string }
  | { type: "VERIFISERING_FEILET"; kind: CredentialKind }
  | { type: "VANDELVURDERING_STARTET" }
  | { type: "VANDELVURDERING_FULLFORT"; vurdering: Vandelvurdering }
  | { type: "VANDELVURDERING_FEILET"; feil: string }
  | { type: "POLITIATTEST_KONTROLL_FULLFORT" }
  | { type: "SIMULER_FULLFORT_SAK"; person: Person }
  | { type: "NULLSTILL" };

function bevisNoekkel(kind: CredentialKind): "formalsbevis" | "politiattest" {
  return kind === "formalsbekreftelse" ? "formalsbevis" : "politiattest";
}

function leggTilPolitiattestEttersporsel(state: CaseState): CaseState {
  if (
    state.inboxMessages.some(
      (melding) => melding.type === "ettersporsel" && melding.kind === "politiattest"
    )
  ) {
    return state;
  }

  return {
    ...state,
    inboxMessages: [
      ...state.inboxMessages,
      {
        type: "ettersporsel",
        id: `msg-ettersporsel-${state.person?.personId || "sak"}`,
        kind: "politiattest",
        title: "Vi venter fortsatt på politiattesten din",
        createdAt: new Date().toISOString(),
        status: "ulest"
      }
    ]
  };
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

    case "ID_PORTEN_INNLOGGET":
      return { ...state, idPortenAccessToken: handling.accessToken };

    case "SIMULER_FULLFORT_SAK": {
      const tidspunkt = new Date().toISOString();
      const formalsClaims = byggFormalsbevisClaims(handling.person);
      const politiattestClaims = byggPolitiattestClaims(handling.person);
      const utstedtBevis: IssuanceRecord = {
        status: "tilbud_klart",
        transactionId: null,
        credentialOfferUri: null,
        qrCodeDataUri: null,
        issuedAt: tidspunkt,
        simulated: true
      };
      return {
        ...tomSak(),
        person: handling.person,
        soknadsdato: tidspunkt.slice(0, 10),
        kommuneSaksstatus: "avsluttet",
        formalsbevis: {
          issuance: utstedtBevis,
          verification: {
            ...TOM_VERIFIKASJON,
            stage: "godkjent",
            claims: formalsClaims,
            simulated: true,
            verifiedAt: tidspunkt
          }
        },
        politiattest: {
          issuance: utstedtBevis,
          verification: {
            ...TOM_VERIFIKASJON,
            stage: "godkjent",
            claims: politiattestClaims,
            simulated: true,
            verifiedAt: tidspunkt
          }
        },
        vandelvurdering: { ...TOM_VANDELVURDERING }
      };
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
      if (handling.kind === "formalsbekreftelse") {
        return leggTilPolitiattestEttersporsel(oppdatertSak);
      }
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

    case "VANDELVURDERING_STARTET":
      return {
        ...state,
        vandelvurdering: {
          ...TOM_VANDELVURDERING,
          status: "laster"
        }
      };

    case "VANDELVURDERING_FULLFORT":
      return {
        ...state,
        vandelvurdering: {
          ...handling.vurdering,
          status: "hentet",
          feil: null
        }
      };

    case "VANDELVURDERING_FEILET":
      return {
        ...state,
        vandelvurdering: {
          ...TOM_VANDELVURDERING,
          status: "feil",
          feil: handling.feil
        }
      };

    case "POLITIATTEST_KONTROLL_FULLFORT":
      if (
        state.kommuneSaksstatus !== "politiattest_mottatt" ||
        state.politiattest.verification?.stage !== "godkjent"
      ) {
        return state;
      }
      return { ...state, kommuneSaksstatus: "avsluttet" };

    case "NULLSTILL":
      return tomSak();

    default:
      return state;
  }
}
