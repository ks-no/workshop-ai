#!/usr/bin/env node

/**
 * Keeps the prose honest about numbers the code already knows.
 *
 * Every service list, tool count, route count and population figure in this repo
 * exists in a machine-readable source - apps/shared/tjenester.json, data/satser.json,
 * the toolDefs table in tools-api, the paths in openapi/*.yaml, ci.yml itself.
 * The markdown carries
 * hand-typed copies of all of them, and a measured mismatch sits in a copy,
 * never in the source - so the copies are compared against the sources here.
 *
 * It fails on:
 *
 *   1. a number in markdown that disagrees with the source it describes
 *   2. a "CI kjører …" list that has drifted from .github/workflows/ci.yml
 *   3. a hand-copied tool list that has drifted from tools-api
 *   4. an anchor link that hits no heading
 *   5. an "## Innhold" list that disagrees with the file's own headings
 *   6. a relative markdown link whose target is not tracked, or whose visible text
 *      names a different path than the one it points at
 *   7. a mermaid label without quotes, or a service diagram missing a service
 *
 * Checks 4 to 7 guard navigation rather than numbers, and they exist for the same
 * reason: a table of contents and an index are hand-typed copies of something the
 * repo already knows.
 *
 * Check 1 scans for `<tall> [ord] <substantiv>` over the nouns where a global
 * count is meaningful. Norwegian number words count as numbers, because that is
 * how the prose writes them ("Åtte kjørende tjenester"). Some hits legitimately
 * mean something local rather than the global total - "søsken i to ordninger" is
 * about one household, not about data/satser.json - so those are listed in
 * EXCEPTIONS, keyed by text rather than by line so they survive an edit above them.
 *
 * Adding a number to a doc therefore costs one of two things: being right, or
 * saying here why the number means something else. That is the point.
 *
 * The keys of `sources`, `NOUNS` and `NUMBER_WORDS` are Norwegian because they are
 * the vocabulary the prose uses - they are data, not identifiers.
 *
 * Usage:
 *   node scripts/check-dokumentasjon.ts
 *   node scripts/check-dokumentasjon.ts --vis    # print the sources and stop
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { readSpec } from "../apps/shared/openapi.ts";

const printOnly = process.argv.includes("--vis");
const tocFor = process.argv[process.argv.indexOf("--innhold") + 1];

// --- the sources -----------------------------------------------------------

function readJson(filePath: string): any {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

/**
 * Counts the array at `key`, or the file itself when it is a bare array. The
 * key is named rather than guessed: data/satser.json has nine top-level keys and
 * only one of them is the list.
 */
function count(filePath: string, key?: string): number {
  const content = readJson(filePath);
  const list = key === undefined ? content : content[key];
  if (!Array.isArray(list)) {
    throw new Error(`${filePath}: ${key ?? "roten"} er ikke et array`);
  }
  return list.length;
}

const toolsSource = readFileSync("apps/tools-api/src/server.ts", "utf8");

/**
 * The CI job names its checks as `run: pnpm <name>`. Parsing the yaml as text is
 * enough and keeps the rule against adding dependencies; the alternative is a yaml parser.
 */
function ciChecks(): string[] {
  const yaml = readFileSync(".github/workflows/ci.yml", "utf8");
  return [...yaml.matchAll(/^\s*run:\s*pnpm\s+([\w:]+)/gm)].map((m) => m[1]);
}

const sources = {
  tjenester: {
    count: count("apps/shared/tjenester.json"),
    source: "apps/shared/tjenester.json"
  },
  spesifikasjoner: {
    count: readdirSync("openapi").filter((f) => f.endsWith(".yaml")).length,
    source: "openapi/*.yaml"
  },
  verktøy: {
    // toolDefs and invokeTool live 470 lines apart; the names are the overlap.
    count: new Set([...toolsSource.matchAll(/name:\s*"([a-z_0-9]+)"/g)].map((m) => m[1])).size,
    source: "apps/tools-api/src/server.ts"
  },
  ordninger: { count: count("data/satser.json", "ordninger"), source: "data/satser.json" },
  personer: { count: count("data/personer.json"), source: "data/personer.json" },
  husstander: { count: count("data/husstander.json"), source: "data/husstander.json" },
  datasett: {
    count: readdirSync("data").filter((f) => f.endsWith(".json")).length,
    source: "data/*.json"
  },
  /*
   * Nine services run; seven of them carry an OpenAPI spec - demo-gui and
   * process-builder are pages, not APIs. Both numbers are true and the prose says
   * both, so "API-tjenester" resolves here and bare "tjenester" to the nine.
   */
  "api-tjenester": {
    count: (readJson("apps/shared/tjenester.json") as { spesifikasjon: boolean }[])
      .filter((service) => service.spesifikasjon).length,
    source: "apps/shared/tjenester.json (spesifikasjon: true)"
  }
} as const;

type Category = keyof typeof sources;

/*
 * Paths and routes are claims about one spec, not about the repo: sandbox-backend
 * has 36 paths where the seven specs together have 118. So these nouns do not get
 * a single global source. The spec a claim is about is resolved from context -
 * a `<name>.yaml` named on the same line, then in the same paragraph, then the
 * app directory the markdown file sits in. A claim none of those resolve is read
 * against the total across openapi/*.yaml, since that is the only global reading
 * left; the failure message says how to scope it.
 *
 * The vocabulary is the one apps/shared/openapi.ts already serves: a "sti" is a
 * path key, a "rute" (and an "endepunkt") is an operation - method plus path -
 * which is what routeOverview returns as `ruter`.
 */
const specCounts = new Map<string, { stier: number; ruter: number }>();
for (const file of readdirSync("openapi").filter((f) => f.endsWith(".yaml"))) {
  const spec = readSpec(readFileSync(`openapi/${file}`, "utf8"), `openapi/${file}`);
  specCounts.set(file.replace(/\.yaml$/, ""), {
    stier: spec.paths.length,
    ruter: spec.paths.reduce((sum, path) => sum + path.operations.length, 0)
  });
}
const specTotals = {
  stier: [...specCounts.values()].reduce((sum, c) => sum + c.stier, 0),
  ruter: [...specCounts.values()].reduce((sum, c) => sum + c.ruter, 0)
};

type SpecKind = keyof typeof specTotals;

/** Nouns counted per spec rather than against one global source. */
const SPEC_NOUNS: Record<string, SpecKind> = {
  stier: "stier",
  stiene: "stier",
  ruter: "ruter",
  rutene: "ruter",
  endepunkter: "ruter",
  endepunktene: "ruter",
  // English forms, digits only, like the English forms in NOUNS.
  paths: "stier",
  routes: "ruter",
  endpoints: "ruter"
};

/** The spec a claim is about: same line, then same paragraph, then app directory. */
function resolveSpec(file: string, lines: string[], lineIndex: number): string | undefined {
  const named = (text: string): string[] =>
    [...new Set([...text.matchAll(/([\w-]+)\.yaml/g)].map((m) => m[1]))]
      .filter((name) => specCounts.has(name));
  const onLine = named(lines[lineIndex]);
  if (onLine.length === 1) return onLine[0];
  let start = lineIndex;
  while (start > 0 && lines[start - 1].trim() !== "") start--;
  let end = lineIndex;
  while (end < lines.length - 1 && lines[end + 1].trim() !== "") end++;
  const inParagraph = named(lines.slice(start, end + 1).join("\n"));
  if (inParagraph.length === 1) return inParagraph[0];
  const app = file.match(/^apps\/([\w-]+)\//);
  if (app && specCounts.has(app[1])) return app[1];
  return undefined;
}

/** Plural forms as the prose actually writes them, mapped to their source. */
const NOUNS: Record<string, Category> = {
  tjenester: "tjenester",
  tjenestene: "tjenester",
  spesifikasjoner: "spesifikasjoner",
  spesifikasjonene: "spesifikasjoner",
  verktøy: "verktøy",
  ordninger: "ordninger",
  ordningene: "ordninger",
  personer: "personer",
  personene: "personer",
  husstander: "husstander",
  husstandene: "husstander",
  datasett: "datasett",
  /*
   * English forms, for the English files: AGENTS.md, CLAUDE.md and
   * .github/copilot-instructions.md. A count there drifts exactly like a Norwegian one.
   * The four app READMEs that used to be English are Norwegian now, so this is the
   * whole English surface, and it is small: the only claim that reaches these today is
   * "25 tool endpoints" in AGENTS.md, silenced in EXCEPTIONS below because it is right.
   * Only digits count in front of them - see WORD_NUMBER_NOUNS.
   */
  services: "tjenester",
  specifications: "spesifikasjoner",
  tools: "verktøy",
  schemes: "ordninger",
  people: "personer",
  households: "husstander",
  datasets: "datasett"
};

/*
 * A spelled-out number is only read as a count in front of a Norwegian noun.
 * "to" and "fire" are ordinary English words, so "proxies to services" and
 * "fire services" would otherwise be read as claims of 2 and 4. English prose
 * writes these counts as digits, and digits are unambiguous.
 */
const WORD_NUMBER_NOUNS = new Set([
  "tjenester", "tjenestene", "spesifikasjoner", "spesifikasjonene", "verktøy",
  "ordninger", "ordningene", "personer", "personene", "husstander",
  "husstandene", "datasett", "stier", "stiene", "ruter", "rutene",
  "endepunkter", "endepunktene"
]);

const NUMBER_WORDS: Record<string, number> = {
  én: 1, en: 1, ett: 1, to: 2, tre: 3, fire: 4, fem: 5, seks: 6, sju: 7, syv: 7,
  åtte: 8, ni: 9, ti: 10, elleve: 11, tolv: 12, tretten: 13, fjorten: 14,
  femten: 15, seksten: 16, sytten: 17, atten: 18, nitten: 19, tjue: 20
};

/**
 * Hits that mean something local rather than the global total. Matched on the
 * text so they survive edits above them; `file` narrows it so the same phrase
 * elsewhere is still checked.
 */
const EXCEPTIONS: { file: string; text: string; reason: string }[] = [
  { file: "README.md", text: "ett bestemt verktøy",
    reason: "om å ikke låse teamene til et valg, ikke om verktøykatalogen" },
  { file: "docs/syntetiske-data.md", text: "to ordninger",
    reason: "søsken i to ordninger - én husstand, ikke satstabellen" },
  { file: "docs/syntetiske-data.md", text: "Tre personer",
    reason: "de tre med avvikende fnr-dato" },
  { file: "docs/syntetiske-data.md", text: "Tolv personer",
    reason: "de tolv over 100 år, slik Tenor leverer dem" },
  { file: "docs/testpersoner.md", text: "Tre personer",
    reason: "generert fra samme delmengde som syntetiske-data.md" },
  { file: "docs/testpersoner.md", text: "Tolv personer",
    reason: "generert fra samme delmengde som syntetiske-data.md" },
  { file: "docs/syntetiske-data.md", text: "Sytten personer",
    reason: "de 17 med D-nummer - verifisert delmengde av de 394" },
  { file: "docs/syntetiske-data.md", text: "18 kuraterte husstandene",
    reason: "terskelfixturene i data/kuratert.json - verifisert delmengde av de 200" },
  { file: "AGENTS.md", text: "25 tool endpoints",
    reason: "verktøykatalogen i tools-api, ikke ruter i en spesifikasjon" }
];

// --- check 1: numbers in prose --------------------------------------------

// `git ls-files` reads the index, so it can name a file the disk no longer has -
// the state a half-staged rename leaves behind. Skip those and say so.
const tracked = execFileSync("git", ["ls-files", "*.md"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
const markdown = tracked.filter((file) => existsSync(file));
const renamed = tracked.filter((file) => !existsSync(file));

const numberPattern = Object.keys(NUMBER_WORDS).join("|");
const nounPattern = [...Object.keys(NOUNS), ...Object.keys(SPEC_NOUNS)].join("|");
/*
 * The leading boundary is a lookbehind, not \b: JavaScript's \b is ASCII, so
 * "Åtte" is both preceded by a non-word character and starts with one, so \bÅ
 * never matches. That silently hid every "Åtte kjørende tjenester" in the repo
 * until the gate was run against a claim it was known to contain.
 */
const claimPattern = new RegExp(
  `(?<![\\p{L}\\d])(\\d[\\d\\s ]*|${numberPattern})\\s+(?:\\p{L}+\\s+)?((?:API-)?(?:${nounPattern}))(?![\\p{L}])`,
  "giu"
);

const failures: string[] = [];
let checked = 0;
let skipped = 0;

for (const file of markdown) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const match of line.matchAll(claimPattern)) {
      const whole = match[0];
      const exception = EXCEPTIONS.find((e) => e.file === file && whole.includes(e.text));
      if (exception) {
        skipped++;
        continue;
      }
      const raw = match[1].replace(/[\s ]/g, "");
      const claimed = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[match[1].toLowerCase()];
      if (claimed === undefined) continue;
      const noun = match[2].toLowerCase();
      if (!/^\d/.test(raw) && !WORD_NUMBER_NOUNS.has(noun.replace(/^api-/, ""))) continue;
      const isApi = noun.startsWith("api-");
      const baseForm = isApi ? noun.slice(4) : noun;
      const specKind = SPEC_NOUNS[baseForm];
      if (specKind !== undefined) {
        const resolved = resolveSpec(file, lines, i);
        const expected = resolved ? specCounts.get(resolved)![specKind] : specTotals[specKind];
        const source = resolved ? `openapi/${resolved}.yaml` : "openapi/*.yaml samlet";
        checked++;
        if (claimed !== expected) {
          failures.push(
            `${file}:${i + 1}: «${whole.trim()}» - ${source} har ${expected}. ` +
            `Rett tallet` +
            (resolved
              ? ""
              : `, nevn <tjeneste>.yaml i samme avsnitt hvis påstanden gjelder én tjeneste`) +
            `, eller legg den i EXCEPTIONS med en grunn hvis den betyr noe annet.`
          );
        }
        continue;
      }
      const category: Category =
        isApi && NOUNS[baseForm] === "tjenester"
          ? "api-tjenester"
          : NOUNS[baseForm];
      const source = sources[category];
      checked++;
      if (claimed !== source.count) {
        failures.push(
          `${file}:${i + 1}: «${whole.trim()}» - ${source.source} har ${source.count}. ` +
          `Rett tallet, slett kopien og pek på kilden, eller legg den i EXCEPTIONS ` +
          `med en grunn hvis den betyr noe annet.`
        );
      }
    }
  });
}

// --- check 2: the CI list -------------------------------------------------

const inCi = ciChecks();

for (const file of markdown) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    // Both spellings occur: "CI kjører `pnpm lint`" and "`ci.yml` kjører `lint`".
    // `runs` is here because AGENTS.md is written in English, and it was the one
    // file whose CI list had actually drifted - matching only «kjører» let the
    // drift the check exists for walk straight past it.
    if (!/(\bCI\b|ci\.yml)/i.test(line) || !/(kj(ø|oe)rer|\bruns\b)/i.test(line)) return;
    // The list usually wraps, so read the sentence, not the line.
    const paragraph = lines.slice(i, i + 6).join(" ").split(/(?<=\.)\s/)[0];
    const mentioned = [...paragraph.matchAll(/`(?:pnpm )?((?:test:)?[\w:]+)`/g)]
      .map((m) => m[1])
      .filter((name) => name === "lint" || name === "test" || name.startsWith("test:"));
    // One name is a claim about that check ("test:sperrer, som kjører i CI") and is
    // true. Two or more is a claim to be *the* list, and that is what drifts.
    if (mentioned.length < 2) return;
    const missing = inCi.filter((c) => !mentioned.includes(c));
    const extra = mentioned.filter((c) => !inCi.includes(c));
    if (missing.length || extra.length) {
      failures.push(
        `${file}:${i + 1}: CI-listen er ute av takt med .github/workflows/ci.yml ` +
        `(${inCi.length} sjekker).` +
        (missing.length ? ` Mangler: ${missing.join(", ")}.` : "") +
        (extra.length ? ` Nevner som CI det ikke er: ${extra.join(", ")}.` : "")
      );
    }
  });
}

// --- check 3: hand-copied tool lists --------------------------------------

/*
 * A table of tool names is not a number claim, so check 1 could never see it:
 * apps/tools-api/README.md listed 18 of the 25 tools for months while every
 * count in the repo was right. Names are what drift here, not totals.
 *
 * Ten is the threshold because the distribution is bimodal. One file means to be the
 * list, docs/api-oversikt.md, and names all 25; every other file mentions a tool in
 * passing and names four or fewer. tools-api/README.md used to be a second list with
 * 19 until it was cut down to a pointer. Below ten is a mention; at ten it is a claim.
 */
const toolNames = new Set(
  [...toolsSource.matchAll(/name:\s*"([a-z_0-9]+)"/g)].map((m) => m[1])
);

for (const file of markdown) {
  const text = readFileSync(file, "utf8");
  const named = new Set(
    [...text.matchAll(/`([a-z_0-9]+)`/g)].map((m) => m[1]).filter((n) => toolNames.has(n))
  );
  if (named.size < 10) continue;
  const missing = [...toolNames].filter((n) => !named.has(n));
  if (missing.length > 0) {
    failures.push(
      `${file}: verktøylisten er ute av takt med apps/tools-api/src/server.ts ` +
      `(${toolNames.size} verktøy). Mangler: ${missing.join(", ")}. ` +
      `Rett listen, eller slett den og pek på GET /verktoy.`
    );
  }
}

// --- shared: headings, links and anchors ----------------------------------

/**
 * GitHub's heading anchor (github-slugger): lowercase, then *delete* every character
 * that is not a letter, mark, digit, space, hyphen or underscore, then turn each
 * remaining space into a hyphen.
 *
 * Delete, not replace, and that is the part worth getting right: `test:imports`
 * becomes `testimports`, not `test-imports`, because the colon leaves no gap behind.
 * There is no trim either, so a heading starting «§ 5» anchors as `-5` with a leading
 * hyphen. Marks are kept (\p{M}) so a decomposed å survives as å rather than a.
 *
 * Unicode letters survive, which is why README.md's `#på-windows` has worked all
 * along - so the class is \p{L}, not [a-z].
 */
function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N} _-]/gu, "")
    .replace(/ /g, "-");
}

/**
 * Blanks fenced code blocks, keeping the line count so a failure still names the
 * right line. Sixteen lines in this repo are read as ATX headings by a naive
 * `^#{1,6} ` and are shell comments: `# ...endre noe...` in README.md is one. A
 * markdown link inside an example is text, not navigation, for the same reason.
 */
function withoutCode(lines: string[]): string[] {
  let inFence = false;
  return lines.map((line) => {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      return "";
    }
    return inFence ? "" : line;
  });
}

type Heading = { level: number; text: string; slug: string; line: number };

function readHeadings(lines: string[]): Heading[] {
  const used = new Map<string, number>();
  const headings: Heading[] = [];
  withoutCode(lines).forEach((line, i) => {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!match) return;
    const base = slug(match[2]);
    /*
     * GitHub disambiguates a repeated anchor with -1, -2, from an occurrence table
     * rather than a counter: if a literal `## Foo-1` already took `foo-1`, the second
     * `## Foo` has to skip past it. No file here has a duplicate today, so this path
     * is untested by the content and has to be right by construction.
     */
    let candidate = base;
    while (used.has(candidate)) {
      const n = (used.get(base) ?? 0) + 1;
      used.set(base, n);
      candidate = `${base}-${n}`;
    }
    used.set(candidate, used.get(candidate) ?? 0);
    headings.push({ level: match[1].length, text: match[2], slug: candidate, line: i + 1 });
  });
  return headings;
}

/** Cache, because check 6 reads the headings of every file it links to. */
const headingCache = new Map<string, Heading[]>();

function headingsOf(file: string): Heading[] {
  let headings = headingCache.get(file);
  if (headings === undefined) {
    headings = readHeadings(readFileSync(file, "utf8").split("\n"));
    headingCache.set(file, headings);
  }
  return headings;
}

/** `](#slug)`, anywhere on a line. */
const ANCHOR_LINK = /\]\(#([^)\s]+)\)/g;

function anchorTarget(raw: string): string {
  // A slug with Norwegian letters survives an editor that percent-encodes it.
  if (!raw.includes("%")) return raw.toLowerCase();
  try {
    return decodeURIComponent(raw).toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

/** The section titles that mean "this is the table of contents for this file". */
const TOC_TITLES = new Set(["innhold", "contents"]);

/** The H2 list a file's `## Innhold` is supposed to be, so a failure is copy-paste. */
function buildToc(headings: Heading[]): string[] {
  return headings
    .filter((h) => h.level === 2 && !TOC_TITLES.has(slug(h.text)))
    .map((h) => `- [${h.text}](#${h.slug})`);
}

/*
 * Existence is tested against git, not the filesystem. macOS is case-insensitive by
 * default and github.com is not, so `](Deltakerstart.md)` passes existsSync on the
 * author's laptop and 404s for every participant. A lookup in the tracked set is
 * case-sensitive everywhere, and it also rejects a link into gitignored state/,
 * which is a link that works for one person only.
 */
const trackedPaths = new Set(
  execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean)
);

let anchorsChecked = 0;
let linksChecked = 0;
let tocsChecked = 0;
let diagramsChecked = 0;

// --- check 4: an anchor link hits a heading in the same file ---------------

/*
 * A renamed heading turns an anchor into a link that silently scrolls nowhere: no
 * 404, no warning, nothing to see in a diff. The heading is the source; the anchor
 * is the copy.
 */
for (const file of markdown) {
  const lines = readFileSync(file, "utf8").split("\n");
  const slugs = new Set(headingsOf(file).map((h) => h.slug));
  withoutCode(lines).forEach((line, i) => {
    for (const match of line.matchAll(ANCHOR_LINK)) {
      anchorsChecked++;
      const target = anchorTarget(match[1]);
      if (slugs.has(target)) continue;
      const near = [...slugs].find(
        (s) => s.startsWith(target.slice(0, 8)) || target.startsWith(s.slice(0, 8))
      );
      failures.push(
        `${file}:${i + 1}: ankeret «#${target}» treffer ingen overskrift i filen.` +
        (near ? ` Nærmeste er «#${near}».` : "") +
        ` Overskriften er kilden - rett ankeret, ikke overskriften.`
      );
    }
  });
}

// --- check 5: an "Innhold" section lists every section --------------------

/*
 * Check 4 catches a renamed heading. This catches an added or removed one, which
 * check 4 cannot see, because nothing points at a section that was never listed.
 *
 * The section runs from the `## Innhold` heading to the next heading at the same
 * level or above, so it does not matter whether the list sits in a <details>, a
 * table or a plain list - only that the anchors are in there, in document order.
 * `node scripts/check-dokumentasjon.ts --innhold <fil>` prints the list to paste.
 */
for (const file of markdown) {
  const lines = readFileSync(file, "utf8").split("\n");
  const headings = headingsOf(file);
  const toc = headings.find((h) => h.level === 2 && TOC_TITLES.has(slug(h.text)));
  if (toc === undefined) continue;
  tocsChecked++;
  const end = headings.find((h) => h.line > toc.line && h.level <= 2)?.line
    ?? lines.length + 1;
  const body = withoutCode(lines).slice(toc.line, end - 1).join("\n");
  const listed = [...body.matchAll(ANCHOR_LINK)].map((m) => anchorTarget(m[1]));
  const expected = headings
    .filter((h) => h.level === 2 && h.line !== toc.line)
    .map((h) => h.slug);
  const missing = expected.filter((s) => !listed.includes(s));
  const extra = listed.filter((s) => !expected.includes(s));
  if (missing.length > 0 || extra.length > 0) {
    failures.push(
      `${file}:${toc.line}: innholdsfortegnelsen er ikke enig med overskriftene ` +
      `(${expected.length} seksjoner i filen, ${listed.length} i listen).` +
      (missing.length ? ` Mangler: ${missing.map((s) => `#${s}`).join(", ")}.` : "") +
      (extra.length
        ? ` Peker på noe som ikke finnes: ${extra.map((s) => `#${s}`).join(", ")}.`
        : "") +
      ` Kjør «node scripts/check-dokumentasjon.ts --innhold ${file}» og bytt ut listen.`
    );
  } else if (listed.join("|") !== expected.join("|")) {
    failures.push(
      `${file}:${toc.line}: innholdsfortegnelsen har riktige seksjoner i gal ` +
      `rekkefølge. Kjør «node scripts/check-dokumentasjon.ts --innhold ${file}».`
    );
  }
}

// --- check 6: a relative markdown link resolves ---------------------------

/*
 * 49 relative links existed when this was written, and all 49 resolved - so it starts
 * green and stays cheap. It is here because the navigation added on top of them
 * multiplied that number, and a moved file breaks every link into it at once.
 *
 * The visible text is checked too. Every relative link in this repo is written
 * [`docs/bygg-selv.md`](bygg-selv.md): repo-root path as text, relative path as href.
 * Without the second half, a rename fixes the href and leaves the text a lie.
 * Only backticked text is judged - prose is free to name a link whatever reads best.
 */
const RELATIVE_LINK = /\[([^\]]*)\]\(([^)\s#]+\.md)(?:#([^)\s]*))?\)/g;

for (const file of markdown) {
  const lines = readFileSync(file, "utf8").split("\n");
  withoutCode(lines).forEach((line, i) => {
    for (const match of line.matchAll(RELATIVE_LINK)) {
      const [, text, href, anchor] = match;
      // An absolute URL that happens to end in .md is somebody else's file.
      if (href.includes("://") || href.startsWith("/")) continue;
      linksChecked++;
      const target = posix.normalize(posix.join(posix.dirname(file), href));
      if (!trackedPaths.has(target)) {
        failures.push(
          `${file}:${i + 1}: lenken «${href}» peker på ${target}, som ikke er sjekket ` +
          `inn i git. Rett stien - store og små bokstaver teller på github.com selv ` +
          `om de ikke gjør det på macOS.`
        );
        continue;
      }
      const shown = text.match(/^`(.+\.md)`$/);
      if (shown && shown[1] !== target) {
        failures.push(
          `${file}:${i + 1}: lenken viser «${shown[1]}» men peker på ${target}. ` +
          `Teksten skal være stien fra rota: \`${target}\`.`
        );
      }
      if (anchor === undefined || anchor === "") continue;
      const wanted = anchorTarget(anchor);
      if (!headingsOf(target).some((h) => h.slug === wanted)) {
        failures.push(
          `${file}:${i + 1}: «${href}#${wanted}» - ${target} har ingen overskrift ` +
          `med det ankeret. Rett ankeret, ikke overskriften i den andre filen.`
        );
      }
    }
  });
}

// --- check 7: mermaid diagrams ---------------------------------------------

/*
 * Two ways a mermaid block fails that no other check can see.
 *
 * First: an unquoted parenthesis in a node label is a parse error, and GitHub renders
 * a red error box instead of the diagram. `A[Sandbox Backend (8080)]` is the single
 * most common mermaid mistake, the fix is quoting the label, and nobody re-renders
 * every diagram in the repo after a wording change. So every label must be quoted -
 * a house rule rather than a mermaid rule, and mechanically checkable.
 *
 * Second: a diagram of the service map is a hand-typed copy of
 * apps/shared/tjenester.json. That is check 3's failure in another shape:
 * apps/tools-api/README.md carried 18 of 25 tool names for months while every count
 * in the repo was right. Names drift, and check 1 only sees numbers. Five is the
 * threshold - a diagram of one flow names two or three services, a diagram claiming
 * to be the map names them all.
 */
const serviceNames = (
  readJson("apps/shared/tjenester.json") as { navn: string }[]
).map((service) => service.navn);

/** `ID[`, `ID(` or `ID{` - the openers mermaid takes a node label after. */
const NODE_LABEL = /(?:^|[\s>|-])([A-Za-z_][\w-]*)\s*([[({]+)\s*([^"'\s\])}])/g;

for (const file of markdown) {
  const lines = readFileSync(file, "utf8").split("\n");
  let start = -1;
  lines.forEach((line, i) => {
    if (start < 0) {
      if (/^\s*```\s*mermaid\s*$/.test(line)) start = i;
      return;
    }
    if (!/^\s*```\s*$/.test(line)) return;
    const block = lines.slice(start + 1, i);
    diagramsChecked++;
    block.forEach((blockLine, offset) => {
      for (const match of blockLine.matchAll(NODE_LABEL)) {
        failures.push(
          `${file}:${start + 2 + offset}: mermaid-etiketten etter «${match[1]}${match[2]}» ` +
          `er ikke i hermetegn. En parentes i en etikett uten hermetegn er en ` +
          `parsefeil, og GitHub viser en rød boks i stedet for diagrammet. ` +
          `Skriv ${match[1]}["..."].`
        );
      }
    });
    const text = block.join("\n");
    const mentioned = serviceNames.filter((name) => text.includes(name));
    if (mentioned.length >= 5) {
      const missing = serviceNames.filter((name) => !mentioned.includes(name));
      if (missing.length > 0) {
        failures.push(
          `${file}:${start + 1}: diagrammet navngir ${mentioned.length} av ` +
          `${serviceNames.length} tjenester, og er dermed en påstand om å være kartet. ` +
          `Mangler: ${missing.join(", ")}. Legg dem inn, eller kutt diagrammet ned til ` +
          `én flyt. Kilden er apps/shared/tjenester.json.`
        );
      }
    }
    start = -1;
  });
}

// --- report ---------------------------------------------------------------

if (process.argv.includes("--innhold")) {
  if (!tocFor || !existsSync(tocFor)) {
    console.error("Bruk: node scripts/check-dokumentasjon.ts --innhold <fil.md>");
    process.exit(2);
  }
  console.log(buildToc(headingsOf(tocFor)).join("\n"));
  process.exit(0);
}

if (printOnly) {
  for (const [name, source] of Object.entries(sources)) {
    console.log(`${name.padEnd(16)} ${String(source.count).padStart(4)}  ${source.source}`);
  }
  for (const [name, counts] of specCounts) {
    console.log(
      `${name.padEnd(16)} ${String(counts.stier).padStart(4)} stier, ` +
      `${counts.ruter} ruter  openapi/${name}.yaml`
    );
  }
  console.log(
    `${"stier/ruter".padEnd(16)} ${String(specTotals.stier).padStart(4)} stier, ` +
    `${specTotals.ruter} ruter  openapi/*.yaml samlet`
  );
  console.log(`${"ci-sjekker".padEnd(16)} ${String(inCi.length).padStart(4)}  ${inCi.join(", ")}`);
  process.exit(0);
}

console.log(
  `${markdown.length} markdown-filer, ${checked} tallpåstander sjekket mot kilden, ` +
  `${skipped} unntatt.`
);
console.log(
  `${linksChecked} relative lenker, ${anchorsChecked} ankere, ` +
  `${tocsChecked} innholdsfortegnelse${tocsChecked === 1 ? "" : "r"} og ` +
  `${diagramsChecked} mermaid-diagram sjekket mot kilden sin.`
);
if (renamed.length > 0) {
  console.log(
    `Merk: ${renamed.length} fil(er) står i git-indeksen men ikke på disk, ` +
    `og er hoppet over - stage flyttingen: ${renamed.join(", ")}`
  );
}

if (failures.length > 0) {
  console.error(`\n${failures.length} ting dokumentasjonen ikke kan ha:`);
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log("Prosaen stemmer med kilden.");
