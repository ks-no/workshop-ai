#!/usr/bin/env node

/**
 * Pulls every hackathon team's work out of its fork and into this repo, one branch
 * per team.
 *
 * Teams work in forks, and a fork can be deleted or made private the day after the
 * event. A pull request from the fork would also do it, but GitHub proposes upstream
 * `main` as the base of every fork PR and four teams hit it on day one, so the
 * direction is reversed: the organiser fetches. Nothing a participant has to click.
 *
 * Sources, in order of preference:
 *
 *   (default)       open issues with the label `innlevering`, filled in through
 *                   .github/ISSUE_TEMPLATE/innlevering.yml. The rendered body is
 *                   parsed by field label, so the labels in that form are identifiers.
 *   --liste f.json  the same records from a file: [{ team, fork, branch?, andreRepoer? }]
 *   --alle-forker   every fork on GitHub whose default branch has commits ahead of
 *                   main, pushed as fork/<owner>. The safety net for the evening of
 *                   day one, before anyone has registered.
 *
 * Each source is fetched into a local ref under refs/innleveringer/ first, so a run
 * with --ikke-push still leaves a copy on the organiser's machine, and then pushed
 * with `+` to team/<slug> on the remote. Force is right here: the branches belong to
 * the organiser, and the run at the deadline must overwrite the backup from day one.
 *
 * Usage:
 *   node scripts/hent-innleveringer.ts [--ikke-push] [--liste fil.json | --alle-forker]
 *                                      [--repo ks-no/workshop-ai] [--remote origin]
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { feilmelding } from "../apps/shared/errors.ts";

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(name);
const option = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const pushEnabled = !flag("--ikke-push");
const fromAllForks = flag("--alle-forker");
const listFile = option("--liste");
const repo = option("--repo") ?? "ks-no/workshop-ai";
const remote = option("--remote") ?? "origin";

/** Files above this size are reported: they become permanent history for every clone. */
const LARGE_FILE_BYTES = 5 * 1024 * 1024;
const LABEL = "innlevering";
/** Field labels in .github/ISSUE_TEMPLATE/innlevering.yml. Renaming one there breaks this. */
const FIELDS = { team: "Teamnavn", fork: "Fork", branch: "Branch", andreRepoer: "Andre repoer" };

type Registrering = {
  team: string;
  fork: string;
  branch: string;
  andreRepoer: string[];
  issue?: number;
};

type Kilde = {
  /** Branch name on the remote, without refs/heads/. */
  branch: string;
  url: string;
  ref: string;
  team: string;
};

type Rapport = {
  team: string;
  branch: string;
  commit: string;
  foranMain: number;
  harInnlevering: boolean;
  storeFiler: string[];
  feil?: string;
};

function run(cmd: string, cmdArgs: string[]): string {
  return execFileSync(cmd, cmdArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function gh(path: string): unknown {
  return JSON.parse(run("gh", ["api", "--paginate", "--slurp", path]));
}

// --- names ------------------------------------------------------------------

/** Team name to a branch segment: ascii, lowercase, hyphens. A leading «team» is noise. */
function slug(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "oe")
    .replace(/å/g, "aa")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const stripped = ascii.replace(/^team-?/, "").replace(/^-+/, "");
  return stripped || ascii || "uten-navn";
}

/** Accepts `owner/repo`, a github.com URL, with or without .git or /tree/<branch>. */
function parseRepoUrl(text: string): { owner: string; name: string; branch?: string } {
  const trimmed = text.trim().replace(/^<|>$/g, "");
  const match = trimmed.match(
    /^(?:https?:\/\/github\.com\/|git@github\.com:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^\s]+))?\/?$/
  );
  if (!match) throw new Error(`«${text}» er ikke en GitHub-repo-URL eller eier/repo`);
  return { owner: match[1], name: match[2], branch: match[3] };
}

function cloneUrl(owner: string, name: string): string {
  return `https://github.com/${owner}/${name}.git`;
}

// --- registrations ----------------------------------------------------------

/** GitHub renders an issue form as `### <label>` followed by the value, one block per field. */
function parseIssueBody(body: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const block of body.replace(/\r\n/g, "\n").split(/^###\s+/m).slice(1)) {
    const newline = block.indexOf("\n");
    const label = (newline < 0 ? block : block.slice(0, newline)).trim();
    const value = (newline < 0 ? "" : block.slice(newline + 1)).trim();
    fields.set(label, value === "_No response_" ? "" : value);
  }
  return fields;
}

function fromIssues(): Registrering[] {
  const pages = gh(`repos/${repo}/issues?labels=${LABEL}&state=open&per_page=100`) as unknown[][];
  const issues = pages.flat() as { number: number; body: string | null; pull_request?: unknown }[];
  const result: Registrering[] = [];
  for (const issue of issues) {
    if (issue.pull_request) continue;
    const fields = parseIssueBody(issue.body ?? "");
    const team = fields.get(FIELDS.team);
    const fork = fields.get(FIELDS.fork);
    if (!team || !fork) {
      console.warn(`  Issue #${issue.number} mangler «${FIELDS.team}» eller «${FIELDS.fork}», hoppet over.`);
      continue;
    }
    result.push({
      team,
      fork,
      branch: fields.get(FIELDS.branch) || "main",
      andreRepoer: (fields.get(FIELDS.andreRepoer) ?? "").split("\n").map((l) => l.trim()).filter(Boolean),
      issue: issue.number
    });
  }
  return result;
}

function fromFile(file: string): Registrering[] {
  const rows = JSON.parse(readFileSync(file, "utf8")) as Partial<Registrering>[];
  if (!Array.isArray(rows)) throw new Error(`${file}: roten må være en liste`);
  return rows.map((row, i) => {
    if (!row.team || !row.fork) throw new Error(`${file}: rad ${i + 1} mangler team eller fork`);
    return {
      team: row.team,
      fork: row.fork,
      branch: row.branch || "main",
      andreRepoer: row.andreRepoer ?? []
    };
  });
}

function kilderFor(reg: Registrering): Kilde[] {
  const teamSlug = slug(reg.team);
  const fork = parseRepoUrl(reg.fork);
  const kilder: Kilde[] = [{
    team: reg.team,
    branch: `team/${teamSlug}`,
    url: cloneUrl(fork.owner, fork.name),
    ref: fork.branch ?? reg.branch
  }];
  for (const extra of reg.andreRepoer) {
    const other = parseRepoUrl(extra);
    kilder.push({
      team: reg.team,
      // A slash would make team/<slug> both a branch and a directory, which git refuses.
      branch: `team/${teamSlug}-${slug(other.name)}`,
      url: cloneUrl(other.owner, other.name),
      ref: other.branch ?? "HEAD"
    });
  }
  return kilder;
}

function fromAllForksOnGitHub(): Kilde[] {
  const pages = gh(`repos/${repo}/forks?per_page=100`) as unknown[][];
  const forks = pages.flat() as { full_name: string; default_branch: string; owner: { login: string } }[];
  return forks.map((fork) => ({
    team: fork.full_name,
    branch: `fork/${slug(fork.owner.login)}`,
    url: `https://github.com/${fork.full_name}.git`,
    ref: fork.default_branch
  }));
}

// --- git --------------------------------------------------------------------

function localRef(kilde: Kilde): string {
  return `refs/innleveringer/${kilde.branch.replace(/^(team|fork)\//, "")}`;
}

function fetchKilde(kilde: Kilde): string {
  const ref = localRef(kilde);
  run("git", ["fetch", "--no-tags", "--quiet", kilde.url, `+${kilde.ref}:${ref}`]);
  return run("git", ["rev-parse", "--short", ref]);
}

function commitsAheadOfMain(ref: string): number {
  return Number(run("git", ["rev-list", "--count", `refs/remotes/${remote}/main..${ref}`]));
}

function hasFile(ref: string, path: string): boolean {
  try {
    run("git", ["cat-file", "-e", `${ref}:${path}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Large files the team added or changed. Files already in main (data/matrikkel.json is
 * 12 MB) are the sandbox's own weight, not the team's, so the diff is against main
 * rather than the whole tree. Two-tree diff, so it works for an unrelated history too.
 */
function largeFiles(ref: string): string[] {
  const changed = new Set(
    run("git", ["diff", "--name-only", "--diff-filter=AM", `refs/remotes/${remote}/main`, ref])
      .split("\n")
      .filter(Boolean)
  );
  // `git ls-tree -r -l`: mode type sha size<TAB>path
  return run("git", ["ls-tree", "-r", "-l", ref])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [meta, path] = line.split("\t");
      const size = Number(meta.trim().split(/\s+/)[3]);
      return { path, size };
    })
    .filter(({ path, size }) => changed.has(path) && size > LARGE_FILE_BYTES)
    .map(({ path, size }) => `${path} (${(size / 1024 / 1024).toFixed(1)} MB)`);
}

function pushKilde(kilde: Kilde): void {
  run("git", ["push", "--quiet", remote, `+${localRef(kilde)}:refs/heads/${kilde.branch}`]);
}

// --- main -------------------------------------------------------------------

let kilder: Kilde[];
try {
  run("git", ["fetch", "--no-tags", "--quiet", remote, "main"]);
  if (fromAllForks) {
    console.log(`Henter alle forker av ${repo} ...`);
    kilder = fromAllForksOnGitHub();
  } else if (listFile) {
    console.log(`Leser registreringer fra ${listFile} ...`);
    kilder = fromFile(listFile).flatMap(kilderFor);
  } else {
    console.log(`Leser åpne issues i ${repo} med label «${LABEL}» ...`);
    kilder = fromIssues().flatMap(kilderFor);
  }
} catch (error) {
  console.error(`Kom ikke i gang: ${feilmelding(error)}`);
  process.exit(2);
}

if (kilder.length === 0) {
  console.log("Ingen kilder å hente. Ingenting gjort.");
  process.exit(0);
}

const rapporter: Rapport[] = [];
for (const kilde of kilder) {
  const rapport: Rapport = {
    team: kilde.team, branch: kilde.branch, commit: "", foranMain: 0, harInnlevering: false, storeFiler: []
  };
  rapporter.push(rapport);
  try {
    rapport.commit = fetchKilde(kilde);
    const ref = localRef(kilde);
    rapport.foranMain = commitsAheadOfMain(ref);
    rapport.harInnlevering = hasFile(ref, "INNLEVERING.md");
    rapport.storeFiler = largeFiles(ref);
    if (fromAllForks && rapport.foranMain === 0) {
      console.log(`  ${kilde.team}: ingen commits foran main, hoppet over.`);
      rapport.feil = "ingen commits foran main";
      continue;
    }
    if (pushEnabled) pushKilde(kilde);
    console.log(`  ${kilde.team} -> ${kilde.branch} @ ${rapport.commit}${pushEnabled ? "" : " (ikke pushet)"}`);
  } catch (error) {
    rapport.feil = feilmelding(error).split("\n")[0];
    console.error(`  ${kilde.team}: ${rapport.feil}`);
  }
}

// --- report -----------------------------------------------------------------

const hentet = rapporter.filter((r) => !r.feil);
const hoppet = rapporter.filter((r) => r.feil === "ingen commits foran main");
const feilet = rapporter.filter((r) => r.feil && !hoppet.includes(r));

console.log(`\n${hentet.length} hentet, ${hoppet.length} uten endringer, ${feilet.length} feilet.`);
if (hentet.length > 0) {
  console.log("\nBranch                          Commit   Foran main  INNLEVERING.md");
  for (const r of hentet) {
    console.log(
      `${r.branch.padEnd(32)}${r.commit.padEnd(9)}${String(r.foranMain).padStart(10)}  ` +
      (r.harInnlevering ? "ja" : "MANGLER")
    );
  }
}
const medStoreFiler = hentet.filter((r) => r.storeFiler.length > 0);
if (medStoreFiler.length > 0) {
  console.log(`\nFiler over ${LARGE_FILE_BYTES / 1024 / 1024} MB:`);
  for (const r of medStoreFiler) {
    for (const file of r.storeFiler) console.log(`  ${r.branch}: ${file}`);
  }
}
if (feilet.length > 0) {
  console.error("\nFeilet:");
  for (const r of feilet) console.error(`  ${r.team}: ${r.feil}`);
  process.exit(1);
}
if (!pushEnabled) {
  console.log("\nTørrkjøring. Kildene ligger under refs/innleveringer/ lokalt; kjør uten --ikke-push for å pushe.");
}
