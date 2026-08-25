/*
 * The import graph between apps, checked for cycles.
 *
 * sandbox-backend and fiks-simulator used to import each other: regler.ts took the
 * samtykke kodeverk from fiks, while fiks took masking, fødselsnummer validation
 * and its Person type from the backend. digdir-mock and sandbox-backend had the
 * same knot, one leaf wide. Every single arrow was locally right — importing the
 * rule beats keeping a second copy of it — and the aggregate was a pair of services
 * neither of which could be read, tested or moved without the other.
 *
 * That is the kind of defect no reviewer catches by reading a diff: each new import
 * looks like the correct choice, because it is, and the cycle only exists in the
 * sum. So it is checked here instead of remembered.
 *
 * Two rules, and they are different rules:
 *
 *  1. **No cycles between apps.** Not "no cross-app imports" — apps/digdir-mock
 *     owns the token protocol and four services get their client from it, which is
 *     one arrow pointing one way and exactly what a service boundary is for. What
 *     is banned is the arrow back.
 *  2. **apps/shared imports nothing from an app.** A shared layer that reaches back
 *     into a service is not below the services, it is beside them — and then it
 *     drags whichever service it touched into every test that imports it.
 *
 * Rule 1 subsumes the alder.ts and handleevne.ts guards that scripts/test-vilkaar.ts
 * used to carry: those two now live in apps/shared, so regler.ts and state.ts are
 * banned for them by construction rather than by a list someone has to maintain.
 *
 * Pure text analysis: nothing is imported, nothing is started, no port is bound.
 * That matters because importing sandbox-backend to inspect it would pay for
 * digdir-mock's 2048-bit RSA keygen, which is the cost test-vilkaar.ts exists to
 * avoid.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let bestatt = 0;
const feil: string[] = [];

function check(navn: string, betingelse: unknown, detalj = ""): void {
  if (betingelse) {
    bestatt += 1;
    return;
  }
  feil.push(`${navn}${detalj ? ` — ${detalj}` : ""}`);
}

// --- collecting the graph ---------------------------------------------------

/** Every .ts file under a directory, recursively. node_modules is never entered. */
async function tsFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      files.push(...(await tsFiles(full)));
    } else if (entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

// Static `from "..."` (which also covers `export ... from`), side-effect
// `import "..."` and dynamic `import("...")`. The quote is captured and
// backreferenced so a single-quoted specifier cannot slip past: this repo writes
// double quotes throughout, and a check that silently ignores the other form is a
// check whose coverage depends on a style nobody enforces.
//
// Only relative specifiers can cross an app boundary, so bare ones are ignored.
const SPECIFIERS = [
  /\bfrom\s+(["'])(\.[^"']*)\1/g,
  /\bimport\s+(["'])(\.[^"']*)\1/g,
  /\bimport\s*\(\s*(["'])(\.[^"']*)\1\s*\)/g
];

/**
 * Which node a path belongs to: the app directory under `apps/`, or `scripts`.
 * Returns null for anything else (data/, docs/, openapi/), which no import reaches.
 */
function nodeFor(absolute: string): string | null {
  const parts = path.relative(repoRoot, absolute).split(path.sep);
  if (parts[0] === "apps" && parts.length > 1) return `apps/${parts[1]}`;
  if (parts[0] === "scripts") return "scripts";
  return null;
}

const edges = new Map<string, Map<string, string[]>>();

/** Every import that takes `from` to `to`, as "file -> specifier" strings. */
function edgesBetween(from: string, to: string): string[] {
  return edges.get(from)?.get(to) ?? [];
}

function recordEdge(from: string, to: string, where: string): void {
  if (!edges.has(from)) edges.set(from, new Map());
  const outgoing = edges.get(from)!;
  if (!outgoing.has(to)) outgoing.set(to, []);
  outgoing.get(to)!.push(where);
}

const files = [
  ...(await tsFiles(path.join(repoRoot, "apps"))),
  ...(await tsFiles(path.join(repoRoot, "scripts")))
];

for (const file of files) {
  const fromNode = nodeFor(file);
  if (!fromNode) continue;
  const source = await readFile(file, "utf8");
  for (const pattern of SPECIFIERS) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[2];
      const toNode = nodeFor(path.resolve(path.dirname(file), specifier));
      if (!toNode || toNode === fromNode) continue;
      recordEdge(fromNode, toNode, `${path.relative(repoRoot, file)} -> ${specifier}`);
    }
  }
}

// --- rule 1: no cycles ------------------------------------------------------

// Plain DFS. `onPath` is the current recursion stack as a set, so meeting a node
// already on it is a back edge and the path from that node onwards is the cycle
// itself. Reported as the actual ring rather than a bare "cycle detected", because
// which arrow to remove is a judgement call and the reader needs to see all of them.
const cycles: string[][] = [];
const onPath = new Set<string>();
const visited = new Set<string>();
const currentPath: string[] = [];

function visit(node: string): void {
  onPath.add(node);
  currentPath.push(node);
  for (const neighbour of edges.get(node)?.keys() ?? []) {
    if (onPath.has(neighbour)) {
      cycles.push([...currentPath.slice(currentPath.indexOf(neighbour)), neighbour]);
    } else if (!visited.has(neighbour)) {
      visit(neighbour);
    }
  }
  currentPath.pop();
  onPath.delete(node);
  visited.add(node);
}

for (const node of [...edges.keys()].sort()) {
  if (!visited.has(node)) visit(node);
}

for (const cycle of cycles) {
  const [from, to] = cycle;
  feil.push(
    `syklisk avhengighet: ${cycle.join(" -> ")} — ` +
    `f.eks. ${edgesBetween(from, to).slice(0, 2).join(", ")}`
  );
}
check("ingen sykliske avhengigheter mellom apper", cycles.length === 0);

// The two services the issue names, stated separately so a failure says which
// contract broke rather than only that some ring exists.
for (const [from, to] of [
  ["apps/sandbox-backend", "apps/fiks-simulator"],
  ["apps/fiks-simulator", "apps/sandbox-backend"]
]) {
  const found = edgesBetween(from, to);
  check(`${from} importerer ikke fra ${to}`, found.length === 0, found.join(", "));
}

// --- rule 2: the shared layer points downwards only -------------------------

const fromShared = edges.get("apps/shared");
check(
  "apps/shared importerer ingenting fra en tjeneste",
  !fromShared || fromShared.size === 0,
  [...(fromShared?.values() ?? [])].flat().join(", ")
);

// --- report -----------------------------------------------------------------

if (feil.length > 0) {
  console.error(`test-imports: ${feil.length} av ${bestatt + feil.length} sjekker feilet.`);
  for (const linje of feil) console.error(`  - ${linje}`);
  process.exit(1);
}

const edgeCount = [...edges.values()].reduce((sum, outgoing) => sum + outgoing.size, 0);
console.log(
  `test-imports ok. ${bestatt} sjekker over ${files.length} filer, ` +
  `${edges.size} noder og ${edgeCount} kanter — asyklisk, uten stack og uten modell.`
);
for (const node of [...edges.keys()].sort()) {
  console.log(`  ${node} -> ${[...edges.get(node)!.keys()].sort().join(", ")}`);
}
