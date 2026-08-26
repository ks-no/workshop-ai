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
import { readSpec } from "../apps/shared/openapi.ts";

const printOnly = process.argv.includes("--vis");

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
 * enough and keeps the no-dependency rule; the alternative is a yaml parser.
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
   * English forms, because AGENTS.md and four app READMEs are written in English
   * and a claim there drifts exactly like a Norwegian one. Only digits count in
   * front of these - see WORD_NUMBER_NOUNS below.
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

/*
 * `git ls-files` reads the index, which can name a file the disk no longer has -
 * exactly the state a half-staged rename leaves behind. Reading it blind crashed
 * with ENOENT on apps/mcp-services/README.md mid-rename, which reads like a bug in
 * a doc rather than an unstaged `git mv`. Skip and say so.
 */
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
        `${file}:${i + 1}: CI-lista er ute av takt med .github/workflows/ci.yml ` +
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
 * Ten is the threshold because the distribution is bimodal - the two files that
 * mean to be the list name 25 and 19, and every file that merely mentions a tool
 * in passing names four or fewer. Below ten is a mention; at ten it is a claim.
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
      `${file}: verktøylista er ute av takt med apps/tools-api/src/server.ts ` +
      `(${toolNames.size} verktøy). Mangler: ${missing.join(", ")}. ` +
      `Rett lista, eller slett den og pek på GET /mcp/tools.`
    );
  }
}

// --- report ---------------------------------------------------------------

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
if (renamed.length > 0) {
  console.log(
    `Merk: ${renamed.length} fil(er) står i git-indeksen men ikke på disk, ` +
    `og er hoppet over - stage flyttingen: ${renamed.join(", ")}`
  );
}

if (failures.length > 0) {
  console.error(`\n${failures.length} påstand(er) i prosa som kilden motsier:`);
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log("Prosaen stemmer med kilden.");
