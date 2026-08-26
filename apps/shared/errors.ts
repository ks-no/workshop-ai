// Narrowing for caught errors.
//
// `catch (feil)` gives `unknown` under strict mode, so `feil.message` and
// `feil.code` do not compile. Both helpers answer the question the call site
// actually asks without spreading `instanceof Error` checks across nine services.

export function feilmelding(feil: unknown): string {
  return feil instanceof Error ? feil.message : String(feil);
}

/**
 * The `code` Node puts on filesystem and network errors — "ENOENT", "ECONNREFUSED".
 * It is not part of the `Error` interface, so it needs its own narrowing.
 * Returns undefined when the error carries no code, which is the common case for
 * errors we threw ourselves.
 */
export function feilkode(feil: unknown): string | undefined {
  if (feil instanceof Error && "code" in feil) {
    const kode = (feil as { code?: unknown }).code;
    return typeof kode === "string" ? kode : undefined;
  }
  return undefined;
}
