export type Adresse = {
  adressenavn: string;
  husnummer: number;
  husbokstav: string;
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
  const match = text.match(/^([\p{L}\d][\p{L}\d .'-]*?)\s+([1-9]\d*)\s*([\p{L}]?)(?:(?:\s*,\s*|\s+)(\d{4})(?:\s+([\p{L}][\p{L} .'-]*))?)?$/iu);
  if (!match || !/\p{L}/u.test(match[1]) || !Number.isSafeInteger(Number(match[2]))) return null;
  return {
    adressenavn: match[1].replace(/\s+/gu, " ").trim(),
    husnummer: Number(match[2]),
    husbokstav: match[3].toUpperCase(),
    postnummer: match[4],
    poststed: match[5]?.trim()
  };
}

export function adressekjerne(adresse: Adresse): string {
  return `${adresse.adressenavn} ${adresse.husnummer}${adresse.husbokstav}`;
}

export function matchesAdresse(
  query: Adresse,
  candidate: unknown,
  postnummer?: string,
  poststed?: string
): boolean {
  const parsed = parseAdresse(candidate);
  return parsed !== null
    && normalize(query.adressenavn) === normalize(parsed.adressenavn)
    && query.husnummer === parsed.husnummer
    && query.husbokstav === parsed.husbokstav
    && (!query.postnummer || query.postnummer === (postnummer || parsed.postnummer))
    && (!query.poststed || normalize(query.poststed) === normalize(poststed || parsed.poststed || ""));
}
