// Lets domain code declare which HTTP status an error should produce without
// knowing about request or response. The router and the process engine map it the
// same way, so a missing samtykke yields 403 whichever path the call came in.
//
// `extra` exists because some responses carry fields beyond `feil` — notably
// `syntetisk: true` on the 403 for inntekt, which clients already read.
//
// `headers` is separate from `extra` on purpose: errorBody() spreads `extra` into
// the response body, so a header put there would be published as a field instead
// of sent as a header. A 401 needs WWW-Authenticate (RFC 6750), which is the only
// reason this exists.
export class HttpError extends Error {
  status: number;
  extra: Record<string, unknown>;
  headers: Record<string, string>;

  constructor(
    melding: string,
    status = 400,
    extra: Record<string, unknown> = {},
    headers: Record<string, string> = {}
  ) {
    super(melding);
    this.name = "FeilMedStatus";
    this.status = status;
    this.extra = extra;
    this.headers = headers;
  }
}

export function statusFor(feil: unknown): number {
  return feil instanceof HttpError ? feil.status : 500;
}

export function headersFor(feil: unknown): Record<string, string> {
  return feil instanceof HttpError ? feil.headers : {};
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
