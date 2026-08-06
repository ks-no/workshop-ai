// Minimal path-pattern matcher, so we need neither a framework nor the duplicated
// regexes the router used to carry. "/api/personer/:personId/husstand" is compiled
// once at module load.
//
// Parameter values are decoded with decodeURIComponent, so "Fj%C3%B8sangerveien"
// reaches the handler as "Fjøsangerveien".

export type PathPattern = {
  monster: string;
  regex: RegExp;
  parametere: string[];
};

export type PathParams = Record<string, string>;

export function compilePathPattern(monster: string): PathPattern {
  const parametere: string[] = [];
  const regexSource = monster
    .split("/")
    .map((del) => {
      if (!del.startsWith(":")) {
        // Anything that is not a parameter must match literally.
        return del.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
      parametere.push(del.slice(1));
      return "([^/]+)";
    })
    .join("/");

  return { monster, regex: new RegExp(`^${regexSource}$`), parametere };
}

export function matchPath(pathPattern: PathPattern, sti: string): PathParams | null {
  const treff = sti.match(pathPattern.regex);
  if (!treff) {
    return null;
  }
  const values: PathParams = {};
  pathPattern.parametere.forEach((navn, index) => {
    values[navn] = decodeURIComponent(treff[index + 1]!);
  });
  return values;
}
