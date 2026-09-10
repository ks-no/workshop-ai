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
 * One registration must never take the others down with it. A URL that does not
 * parse, a branch that does not exist or a fork that went private is reported for
 * that team and the loop goes on. The only things that stop the run before the first
 * fetch are an argument error and two teams whose names slug to the same branch,
 * because there the second push would silently overwrite the first.
 *
 * One thing is refused per source: a new file under .github/workflows, or one whose
 * `on:` block differs from the version the team forked from. The push is an ordinary
 * `push` event by the organiser, so a workflow on that branch whose trigger matches
 * would run with this repository's token and the secrets it can see, and no approval
 * step exists the way it does for a fork PR. A test step added to ci.yml passes: the
 * trigger still says main. The rule is vurderWorkflow in innlevering-regler.ts. The
 * source is fetched locally either way, and --godta-workflows pushes it anyway, with
 * the files listed as a warning, for the organiser who has read them.
 *
 * Usage:
 *   node scripts/hent-innleveringer.ts [--ikke-push] [--godta-workflows]
 *                                      [--liste fil.json | --alle-forker]
 *                                      [--repo ks-no/workshop-ai] [--remote origin]
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { feilmelding } from "../apps/shared/errors.ts";
import {
  beskrivWorkflowvurdering, parseIssueBody, parseRepoUrl, qualifyRef, slug, teamSlug, vurderWorkflow,
  type Workflowvurdering
} from "./innlevering-regler.ts";

// --- arguments --------------------------------------------------------------

const FLAGS = new Set(["--ikke-push", "--alle-forker", "--godta-workflows"]);
const OPTIONS = new Set(["--liste", "--repo", "--remote"]);

/**
 * Strict on purpose. An unknown flag or an option without a value must not fall
 * through to the default path, because the default path force-pushes to origin:
 * `--ikke-pusj` would have pushed, and `--liste` without a file would have read
 * the issues and pushed.
 */
function parseArgs(argv: string[]): { flags: Set<string>; options: Map<string, string> } {
  const flags = new Set<string>();
  const options = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (FLAGS.has(arg)) {
      flags.add(arg);
    } else if (OPTIONS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} trenger en verdi`);
      options.set(arg, value);
      i++;
    } else {
      throw new Error(`Ukjent argument «${arg}». Kjente: ${[...FLAGS, ...OPTIONS].join(", ")}`);
    }
  }
  if (flags.has("--alle-forker") && options.has("--liste")) {
    throw new Error("--alle-forker og --liste kan ikke brukes sammen");
  }
  return { flags, options };
}

let parsed: ReturnType<typeof parseArgs>;
try {
  parsed = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(feilmelding(error));
  process.exit(2);
}

const pushEnabled = !parsed.flags.has("--ikke-push");
const fromAllForks = parsed.flags.has("--alle-forker");
const acceptWorkflows = parsed.flags.has("--godta-workflows");
const listFile = parsed.options.get("--liste");
const repo = parsed.options.get("--repo") ?? "ks-no/workshop-ai";
const remote = parsed.options.get("--remote") ?? "origin";

/** Files above this size are reported: they become permanent history for every clone. */
const LARGE_FILE_BYTES = 5 * 1024 * 1024;
const LABEL = "innlevering";
/** Field labels in .github/ISSUE_TEMPLATE/innlevering.yml. Renaming one there breaks this. */
const FIELDS = { team: "Teamnavn", fork: "Fork", branch: "Branch", andreRepoer: "Andre repoer" };

type Registrering = {
  team: string;
  fork: string;
  /** Undefined when the field was left empty; the fork URL may carry the branch instead. */
  branch?: string;
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
  /** --alle-forker only: the fork has nothing ahead of main, so nothing was pushed. */
  hoppet: boolean;
  /** A report column that could not be computed. The source was still pushed. */
  advarsel?: string;
  feil?: string;
};

function run(cmd: string, cmdArgs: string[]): string {
  // git quotes a path with æ/ø/å as "data/KpSt\303\270ySone.geojson" unless told not
  // to, and the report is read by a person.
  const args = cmd === "git" ? ["-c", "core.quotePath=false", ...cmdArgs] : cmdArgs;
  return execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    // `git ls-tree -r -l` on a tree with node_modules committed is several MB; the
    // 1 MB default made that throw ENOBUFS and cost the team its push.
    maxBuffer: 256 * 1024 * 1024,
    // A private or misspelled fork makes git ask for a username on the tty, which
    // stdin: "ignore" does not cover. Fail instead, so the team lands in «Feilet».
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
  }).trim();
}

function gh(path: string): unknown {
  return JSON.parse(run("gh", ["api", "--paginate", "--slurp", path]));
}

/**
 * execFileSync's message is `Command failed: <cmd>` followed by stderr, so the first
 * line only echoes what was run. The reason is the last one: «couldn't find remote
 * ref», «Repository not found».
 */
function shortError(error: unknown): string {
  const lines = feilmelding(error).split("\n").map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? "ukjent feil";
}

function cloneUrl(owner: string, name: string): string {
  return `https://github.com/${owner}/${name}.git`;
}

// --- registrations ----------------------------------------------------------

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
      branch: fields.get(FIELDS.branch) || undefined,
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
      branch: row.branch || undefined,
      andreRepoer: row.andreRepoer ?? []
    };
  });
}

function describe(reg: Registrering): string {
  return reg.issue ? `${reg.team} (issue #${reg.issue})` : reg.team;
}

/** Throws on a URL that does not parse; the caller reports it for this team alone. */
function kilderFor(reg: Registrering): Kilde[] {
  const team = teamSlug(reg.team);
  const fork = parseRepoUrl(reg.fork);
  let ref = reg.branch ?? fork.branch ?? "main";
  if (reg.branch && fork.branch && reg.branch !== fork.branch) {
    console.warn(
      `  ${describe(reg)}: fork-URL-en peker på «${fork.branch}», feltet «${FIELDS.branch}» sier «${reg.branch}». Bruker feltet.`
    );
    ref = reg.branch;
  }
  const kilder: Kilde[] = [{
    team: reg.team,
    branch: `team/${team}`,
    url: cloneUrl(fork.owner, fork.name),
    ref
  }];
  for (const extra of reg.andreRepoer) {
    const other = parseRepoUrl(extra);
    kilder.push({
      team: reg.team,
      // A slash would make team/<slug> both a branch and a directory, which git refuses.
      branch: `team/${team}-${slug(other.name)}`,
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

/** Two sources on one branch means the second push erases the first. Stop before either. */
function findDuplicateBranches(kilder: Kilde[]): string[] {
  const byBranch = new Map<string, string[]>();
  for (const k of kilder) byBranch.set(k.branch, [...(byBranch.get(k.branch) ?? []), k.team]);
  return [...byBranch.entries()]
    .filter(([, teams]) => teams.length > 1)
    .map(([branch, teams]) => `${branch}: ${teams.map((t) => `«${t}»`).join(" og ")}`);
}

// --- git --------------------------------------------------------------------

function localRef(kilde: Kilde): string {
  return `refs/innleveringer/${kilde.branch.replace(/^(team|fork)\//, "")}`;
}

function fetchKilde(kilde: Kilde): string {
  const ref = localRef(kilde);
  run("git", ["fetch", "--no-tags", "--quiet", kilde.url, `+${qualifyRef(kilde.ref)}:${ref}`]);
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

type Workflowendring = { path: string; vurdering: Workflowvurdering };

/**
 * Every workflow file the team added or changed, each with vurderWorkflow's verdict.
 * The base is the merge-base with main, not the tip of main: a fork that has not
 * pulled since main touched ci.yml differs from the tip without the team having done
 * anything, and the first run against the real forks flagged two of five that way.
 * Only an unrelated history has no merge-base, and there the tip of main is the only
 * base there is. Deletions are fine: a file that is gone cannot run. `--no-renames`
 * so a moved workflow counts as added.
 */
function changedWorkflows(ref: string): Workflowendring[] {
  const main = `refs/remotes/${remote}/main`;
  let base: string;
  try {
    base = run("git", ["merge-base", main, ref]);
  } catch {
    base = main;
  }
  // `git diff --name-status`: status<TAB>path, status A or M after the filter.
  return run("git", ["diff", "--name-status", "--no-renames", "--diff-filter=d", base, ref, "--", ".github/workflows"])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, path] = line.split("\t");
      const tip = run("git", ["show", `${ref}:${path}`]);
      const before = status === "A" ? undefined : run("git", ["show", `${base}:${path}`]);
      return { path, vurdering: vurderWorkflow(before, tip) };
    });
}

function describeWorkflows(endringer: Workflowendring[]): string {
  return endringer.map((e) => `${e.path} (${beskrivWorkflowvurdering(e.vurdering)})`).join(", ");
}

function pushKilde(kilde: Kilde): void {
  run("git", ["push", "--quiet", remote, `+${localRef(kilde)}:refs/heads/${kilde.branch}`]);
}

// --- main -------------------------------------------------------------------

function newRapport(team: string, branch: string): Rapport {
  return { team, branch, commit: "", foranMain: 0, harInnlevering: false, storeFiler: [], hoppet: false };
}

const rapporter: Rapport[] = [];
const kilder: Kilde[] = [];
try {
  run("git", ["fetch", "--no-tags", "--quiet", remote, "main"]);
  if (fromAllForks) {
    console.log(`Henter alle forker av ${repo} ...`);
    kilder.push(...fromAllForksOnGitHub());
  } else {
    let registreringer: Registrering[];
    if (listFile) {
      console.log(`Leser registreringer fra ${listFile} ...`);
      registreringer = fromFile(listFile);
    } else {
      console.log(`Leser åpne issues i ${repo} med label «${LABEL}» ...`);
      registreringer = fromIssues();
    }
    for (const reg of registreringer) {
      try {
        kilder.push(...kilderFor(reg));
      } catch (error) {
        const rapport = newRapport(reg.team, `team/${teamSlug(reg.team)}`);
        rapport.feil = shortError(error);
        rapporter.push(rapport);
        console.error(`  ${describe(reg)}: ${rapport.feil}`);
      }
    }
  }
} catch (error) {
  console.error(`Kom ikke i gang: ${shortError(error)}`);
  process.exit(2);
}

const duplicates = findDuplicateBranches(kilder);
if (duplicates.length > 0) {
  console.error("Flere kilder gir samme branch. Ingenting hentet. Rediger den ene registreringen:");
  for (const d of duplicates) console.error(`  ${d}`);
  process.exit(2);
}

if (kilder.length === 0 && rapporter.length === 0) {
  console.log("Ingen kilder å hente. Ingenting gjort.");
  process.exit(0);
}

for (const kilde of kilder) {
  const rapport = newRapport(kilde.team, kilde.branch);
  rapporter.push(rapport);
  try {
    rapport.commit = fetchKilde(kilde);
    const ref = localRef(kilde);
    rapport.foranMain = commitsAheadOfMain(ref);
    rapport.harInnlevering = hasFile(ref, "INNLEVERING.md");
    if (fromAllForks && rapport.foranMain === 0) {
      console.log(`  ${kilde.team}: ingen commits foran main, hoppet over.`);
      rapport.hoppet = true;
      continue;
    }
    const workflows = changedWorkflows(ref);
    const harmless = workflows.filter((w) => w.vurdering === "ok");
    const refused = workflows.filter((w) => w.vurdering !== "ok");
    if (harmless.length > 0) {
      console.log(`  ${kilde.team}: endrer ${harmless.map((w) => w.path).join(", ")} uten å endre triggerne.`);
    }
    if (refused.length > 0 && !acceptWorkflows) {
      throw new Error(
        `endrer ${describeWorkflows(refused)}. Ikke pushet. Les filene under ${ref}, og kjør med --godta-workflows hvis de er ufarlige.`
      );
    }
    if (refused.length > 0) {
      rapport.advarsel = `workflows godtatt med --godta-workflows: ${describeWorkflows(refused)}`;
    }
    // The large-file column is advice, and advice must not cost a team its push.
    try {
      rapport.storeFiler = largeFiles(ref);
    } catch (error) {
      rapport.advarsel = [rapport.advarsel, `fikk ikke sjekket filstørrelser: ${shortError(error)}`]
        .filter(Boolean)
        .join("; ");
    }
    if (pushEnabled) pushKilde(kilde);
    console.log(`  ${kilde.team} -> ${kilde.branch} @ ${rapport.commit}${pushEnabled ? "" : " (ikke pushet)"}`);
  } catch (error) {
    rapport.feil = shortError(error);
    console.error(`  ${kilde.team}: ${rapport.feil}`);
  }
}

// --- report -----------------------------------------------------------------

const hentet = rapporter.filter((r) => !r.feil && !r.hoppet);
const hoppet = rapporter.filter((r) => r.hoppet);
const feilet = rapporter.filter((r) => r.feil);

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
const medAdvarsel = hentet.filter((r) => r.advarsel);
if (medAdvarsel.length > 0) {
  console.log("\nAdvarsler:");
  for (const r of medAdvarsel) console.log(`  ${r.branch}: ${r.advarsel}`);
}
if (!pushEnabled) {
  console.log("\nDryrun. Kildene ligger under refs/innleveringer/ lokalt; kjør uten --ikke-push for å pushe.");
}
if (feilet.length > 0) {
  console.error("\nFeilet:");
  for (const r of feilet) console.error(`  ${r.team}: ${r.feil}`);
  process.exit(1);
}
