// Minimal stimønster-matcher, så vi slipper et rammeverk for å slippe unna
// regex-duplikatene i ruteren. "/api/personer/:personId/husstand" blir
// kompilert én gang ved modullasting.
//
// Parameterverdier dekodes med decodeURIComponent, slik at "Fj%C3%B8sangerveien"
// kommer fram som "Fjøsangerveien" hos håndtereren.

export type StiMonster = {
  monster: string;
  regex: RegExp;
  parametere: string[];
};

export type Parametere = Record<string, string>;

export function lagStiMonster(monster: string): StiMonster {
  const parametere: string[] = [];
  const regexKilde = monster
    .split("/")
    .map((del) => {
      if (!del.startsWith(":")) {
        // Alt som ikke er et parameter skal matche bokstavelig.
        return del.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
      parametere.push(del.slice(1));
      return "([^/]+)";
    })
    .join("/");

  return { monster, regex: new RegExp(`^${regexKilde}$`), parametere };
}

export function stiTreff(stiMonster: StiMonster, sti: string): Parametere | null {
  const treff = sti.match(stiMonster.regex);
  if (!treff) {
    return null;
  }
  const verdier: Parametere = {};
  stiMonster.parametere.forEach((navn, indeks) => {
    verdier[navn] = decodeURIComponent(treff[indeks + 1]!);
  });
  return verdier;
}
