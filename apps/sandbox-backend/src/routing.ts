// Minimal path-pattern matcher, so we need neither a framework nor the duplicated
// regexes the router used to carry. "/api/personer/:personId/husstand" is compiled
// once at module load.
//
// Parameter values are decoded with decodeURIComponent, so "Fj%C3%B8sangerveien"
// reaches the handler as "Fjøsangerveien".

export type PathPattern = {
  pattern: string;
  regex: RegExp;
  paramNames: string[];
};

export type PathParams = Record<string, string>;

export function compilePathPattern(pattern: string): PathPattern {
  const paramNames: string[] = [];
  const regexSource = pattern
    .split("/")
    .map((segment) => {
      if (!segment.startsWith(":")) {
        // Anything that is not a parameter must match literally.
        return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
      paramNames.push(segment.slice(1));
      return "([^/]+)";
    })
    .join("/");

  return { pattern, regex: new RegExp(`^${regexSource}$`), paramNames };
}

export function matchPath(pathPattern: PathPattern, path: string): PathParams | null {
  const match = path.match(pathPattern.regex);
  if (!match) {
    return null;
  }
  const values: PathParams = {};
  pathPattern.paramNames.forEach((name, index) => {
    values[name] = decodeURIComponent(match[index + 1]!);
  });
  return values;
}
