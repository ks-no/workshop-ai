type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The verifier API groups credentials by the id from the DCQL query. Simulated
// responses historically exposed claims at the top level, so accept both shapes.
export function extractVerifiedClaims(
  result: unknown,
  credentialQueryId: string
): JsonObject | null {
  if (!isJsonObject(result)) return null;

  if (isJsonObject(result.claims)) {
    return result.claims;
  }

  if (!isJsonObject(result.credentials)) return null;
  const candidates = result.credentials[credentialQueryId];
  if (!Array.isArray(candidates)) return null;

  const verifiedCredential = candidates.find(
    (candidate) =>
      isJsonObject(candidate) &&
      candidate.valid !== false &&
      isJsonObject(candidate.claims)
  );

  return isJsonObject(verifiedCredential) && isJsonObject(verifiedCredential.claims)
    ? verifiedCredential.claims
    : null;
}
