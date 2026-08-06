// Lar domenekoden si fra om hvilken HTTP-status en feil skal gi, uten å kjenne
// til request eller response. Ruteren og prosessmotoren mapper den samme veien,
// slik at et manglende samtykke gir 403 uansett hvilken vei kallet kom inn.
//
// `ekstra` finnes fordi noen svar bærer felter utover `feil` — det gjelder blant
// annet `syntetisk: true` på 403 for inntekt, som klientene allerede ser.
export class FeilMedStatus extends Error {
  status: number;
  ekstra: Record<string, unknown>;

  constructor(melding: string, status = 400, ekstra: Record<string, unknown> = {}) {
    super(melding);
    this.name = "FeilMedStatus";
    this.status = status;
    this.ekstra = ekstra;
  }
}

export function statusFor(feil: unknown): number {
  return feil instanceof FeilMedStatus ? feil.status : 500;
}

export function feilKropp(feil: unknown): Record<string, unknown> {
  if (feil instanceof FeilMedStatus) {
    return { feil: feil.message, ...feil.ekstra };
  }
  return {
    feil: "Intern feil i sandbox-backend.",
    detalj: feil instanceof Error ? feil.message : String(feil),
    syntetisk: true
  };
}
