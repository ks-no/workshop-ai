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
  "ja da",
  "jada",
  "javisst",
  "ja det stemmer",
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

const FORTSETT_KJERNER = [
  ...JA_SVAR,
  "start",
  "fortsett",
  "neste",
  "klar",
  "kjør på",
  "kjor pa",
  "gå videre",
  "ga videre"
].map((uttrykk) => uttrykk.split(" "));

const FORTSETT_TILLEGG = new Set([
  "ja",
  "jada",
  "japp",
  "javisst",
  "yes",
  "takk",
  "da",
  "nå",
  "na",
  "gjerne",
  "klart",
  "greit",
  "okei",
  "ok"
]);

export function normalizeBrukersvar(text: string): string {
  return text
    .toLowerCase()
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

  if (erJa && erNei) return "ukjent";
  if (erJa) return "ja";
  if (erNei) return "nei";
  return "ukjent";
}

function matcherFortsettKjerne(ord: string[], kjerne: string[]): boolean {
  for (let start = 0; start <= ord.length - kjerne.length; start += 1) {
    const matcher = kjerne.every((del, forskyvning) => ord[start + forskyvning] === del);
    if (!matcher) continue;

    const tillegg = [...ord.slice(0, start), ...ord.slice(start + kjerne.length)];
    if (tillegg.every((del) => FORTSETT_TILLEGG.has(del))) return true;
  }
  return false;
}

export function erFortsettSignal(text: string): boolean {
  const ord = normalizeBrukersvar(text).split(" ").filter(Boolean);
  return FORTSETT_KJERNER.some((kjerne) => matcherFortsettKjerne(ord, kjerne));
}

export function skalSvareFramfor(text: string, nesteStegErSporsmaal: boolean): boolean {
  return nesteStegErSporsmaal && !erFortsettSignal(text);
}
