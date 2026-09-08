export type LokalSvarintensjon = "ja" | "nei" | "ukjent";

// These strings are user-input patterns, not prose. Keep both Norwegian spellings
// where the input normalizer does not fold letters.
const JA_SVAR = new Set([
  "ja",
  "japp",
  "yes",
  "klart",
  "greit",
  "okei",
  "ok",
  "gjerne",
  "ja takk",
  "ja gjerne",
  "send inn",
  "ja send inn",
  "det går fint",
  "ja det går fint",
  "det er greit",
  "ja det er greit"
]);

const NEI_SVAR = new Set([
  "nei",
  "ikke",
  "stopp",
  "senere",
  "ikke nå",
  "nei takk",
  "nei ikke nå",
  "ikke ennå",
  "nei ikke ennå",
  "ikke greit",
  "ikke ok",
  "ikke okei",
  "det er ikke greit",
  "det går ikke fint"
]);

const FORTSETT_SIGNALLER = new Set([
  ...JA_SVAR,
  "start",
  "fortsett",
  "neste",
  "klar",
  "kjør på",
  "kjor pa",
  "gå videre",
  "ga videre"
]);

export function normalizeBrukersvar(text: string): string {
  return text
    .toLowerCase()
    .replace(/ /g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseSvarPrefiks(text: string): { harSvarPrefiks: boolean; tekst: string } {
  const trimmet = text.trim();
  const harSvarPrefiks = trimmet.toLowerCase().startsWith("svar:");
  return {
    harSvarPrefiks,
    tekst: harSvarPrefiks ? trimmet.slice("svar:".length).trim() : text
  };
}

export function tolkLokaltSvar(text: string): LokalSvarintensjon {
  const normalisert = normalizeBrukersvar(text);
  const erJa = JA_SVAR.has(normalisert);
  const erNei = NEI_SVAR.has(normalisert);

  if (erJa === erNei) return "ukjent";
  return erJa ? "ja" : "nei";
}

export function erEksaktFortsettSignal(text: string): boolean {
  return FORTSETT_SIGNALLER.has(normalizeBrukersvar(text));
}
