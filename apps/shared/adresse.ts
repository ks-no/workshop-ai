export type Adresse = {
  adressenavn: string;
  husnummer: number;
  husbokstav: string;
  adressetilleggsnavn?: string;
  postnummer?: string;
  poststed?: string;
};

function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

export function parseAdresse(value: unknown): Adresse | null {
  if (typeof value !== "string") return null;
  const text = value.normalize("NFKC").replace(/\s+/gu, " ").trim()
    .replace(/(?:,\s*|\s+)(?:norge|norway)$/iu, "");
  const supplement = text.match(/^([^,]+),\s*(?=[\p{L}\d][\p{L}\d .'-]*?\s+[1-9]\d*)/u);
  const main = supplement ? text.slice(supplement[0].length) : text;
  const match = main.match(/^([\p{L}\d][\p{L}\d .'-]*?)\s+([1-9]\d*)\s*([\p{L}]?)(?:(?:\s*,\s*|\s+)(\d{4})(?:\s+([\p{L}][\p{L} .'-]*))?)?$/iu);
  if (!match || !/\p{L}/u.test(match[1]) || !Number.isSafeInteger(Number(match[2]))) return null;
  return {
    adressenavn: match[1].replace(/\s+/gu, " ").trim(),
    husnummer: Number(match[2]),
    husbokstav: match[3].toUpperCase(),
    adressetilleggsnavn: supplement?.[1].trim(),
    postnummer: match[4],
    poststed: match[5]?.trim()
  };
}

export function adressekjerne(adresse: Adresse): string {
  return `${adresse.adressenavn} ${adresse.husnummer}${adresse.husbokstav}`;
}

export function adresseSoek(adresse: Adresse): string {
  return [adresse.adressetilleggsnavn, adressekjerne(adresse),
    [adresse.postnummer, adresse.poststed].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

export function matchesAdresse(
  query: Adresse,
  candidate: unknown,
  postnummer?: string,
  poststed?: string,
  adressetilleggsnavn?: string
): boolean {
  const parsed = parseAdresse(candidate);
  return parsed !== null
    && normalize(query.adressenavn) === normalize(parsed.adressenavn)
    && query.husnummer === parsed.husnummer
    && query.husbokstav === parsed.husbokstav
    && (!query.adressetilleggsnavn || normalize(query.adressetilleggsnavn)
      === normalize(adressetilleggsnavn || parsed.adressetilleggsnavn || ""))
    && (!query.postnummer || query.postnummer === (postnummer || parsed.postnummer))
    && (!query.poststed || normalize(query.poststed) === normalize(poststed || parsed.poststed || ""));
}

type Adressefelter = {
  adressenavn?: unknown;
  husnummer?: unknown;
  husbokstav?: unknown;
  adresse?: unknown;
  adressetilleggsnavn?: unknown;
  postnummer?: unknown;
  poststed?: unknown;
};

export function matchesAdresseFields(query: Adresse, candidate: Adressefelter): boolean {
  if (!candidate || typeof candidate.adressenavn !== "string"
    || !Number.isInteger(candidate.husnummer) || Number(candidate.husnummer) <= 0
    || (candidate.husbokstav != null && typeof candidate.husbokstav !== "string")) return false;
  const display = parseAdresse(candidate.adresse);
  const supplement = typeof candidate.adressetilleggsnavn === "string"
    ? candidate.adressetilleggsnavn : display?.adressetilleggsnavn;
  const postnummer = typeof candidate.postnummer === "string" ? candidate.postnummer : undefined;
  const poststed = typeof candidate.poststed === "string" ? candidate.poststed : undefined;
  const core = `${candidate.adressenavn} ${candidate.husnummer}${candidate.husbokstav || ""}`;
  // Presentation text may include a building/farm name. The structured address is
  // authoritative; a parseable display must still agree about street and number.
  return matchesAdresse(query, core, postnummer, poststed, supplement)
    && (!display || matchesAdresse(
      { ...display, adressetilleggsnavn: undefined, postnummer: undefined, poststed: undefined }, core));
}
