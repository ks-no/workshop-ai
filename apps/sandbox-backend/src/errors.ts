// Lets domain code declare which HTTP status an error should produce without
// knowing about request or response. The router and the process engine map it the
// same way, so a missing samtykke yields 403 whichever path the call came in.
//
// `extra` exists because some responses carry fields beyond `feil` — notably
// `syntetisk: true` on the 403 for inntekt, which clients already read.
export class HttpError extends Error {
  status: number;
  extra: Record<string, unknown>;

  constructor(melding: string, status = 400, extra: Record<string, unknown> = {}) {
    super(melding);
    this.name = "FeilMedStatus";
    this.status = status;
    this.extra = extra;
  }
}

export function statusFor(feil: unknown): number {
  return feil instanceof HttpError ? feil.status : 500;
}

export function errorBody(feil: unknown): Record<string, unknown> {
  if (feil instanceof HttpError) {
    return { feil: feil.message, ...feil.extra };
  }
  return {
    feil: "Intern feil i sandbox-backend.",
    detalj: feil instanceof Error ? feil.message : String(feil),
    syntetisk: true
  };
}
