/**
 * The rules behind scripts/hent-innleveringer.ts, as pure functions: how a team name
 * becomes a branch, what counts as a fork URL, how an issue form is read back, and
 * which change to a workflow file is one we refuse to push.
 *
 * Separate from the script because that file runs at import - it reads argv and
 * calls git at the top level - and scripts/test-innlevering.ts needs these without
 * a remote, a fork or a GitHub token. Nothing here touches the filesystem or a
 * child process.
 */

// --- names ------------------------------------------------------------------

/** Any name to a branch segment: ascii, lowercase, hyphens. */
export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "oe")
    .replace(/å/g, "aa")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "uten-navn";
}

/**
 * A team name additionally loses a leading «team»: the branch is already under
 * team/. Only the word, so «Teamwork» keeps its name and «Team Bergen» becomes
 * bergen. Repo names and GitHub logins do not get this: a login is unique as it is,
 * and stripping made `team-bergen` and `bergen` the same fork/ branch.
 */
export function teamSlug(name: string): string {
  const ascii = slug(name);
  return ascii.replace(/^team(?:-|$)/, "") || ascii;
}

/** Accepts `owner/repo`, a github.com URL, with or without .git or /tree/<branch>. */
export function parseRepoUrl(text: string): { owner: string; name: string; branch?: string } {
  // What a browser address bar adds: a trailing slash, `?tab=readme`, a `#fragment`.
  const trimmed = text.trim().replace(/^<|>$/g, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  const match = trimmed.match(
    /^(?:https?:\/\/github\.com\/|git@github\.com:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/(\S+))?$/
  );
  if (!match) throw new Error(`«${text}» er ikke en GitHub-repo-URL eller eier/repo`);
  return { owner: match[1], name: match[2], branch: match[3] };
}

/**
 * An unqualified source like `+v1:...` resolves tags before heads, so a team that
 * tagged its branch with the branch's own name would have the tag fetched and the
 * push rejected. HEAD and anything already under refs/ pass through.
 */
export function qualifyRef(ref: string): string {
  return ref === "HEAD" || ref.startsWith("refs/") ? ref : `refs/heads/${ref}`;
}

// --- issue form -------------------------------------------------------------

/** GitHub renders an issue form as `### <label>` followed by the value, one block per field. */
export function parseIssueBody(body: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const block of body.replace(/\r\n/g, "\n").split(/^###\s+/m).slice(1)) {
    const newline = block.indexOf("\n");
    const label = (newline < 0 ? block : block.slice(0, newline)).trim();
    const value = (newline < 0 ? "" : block.slice(newline + 1)).trim();
    fields.set(label, value === "_No response_" ? "" : value);
  }
  return fields;
}

// --- workflows --------------------------------------------------------------

/**
 * Pushing a team's branch is an ordinary `push` event by the organiser, so a workflow
 * on that branch whose trigger matches runs with this repository's token and the
 * secrets it can see. The danger sits in the `on:` block alone: a job that gains a
 * test step is inert as long as the trigger still says `branches: [main]`, and every
 * `on:` block main has ever had says that. So a changed file passes when its `on:`
 * block is the one it forked from, and a new file or a changed block does not.
 *
 * `ulesbar` is a refusal too. A check that cannot find what it is meant to compare
 * must fail rather than skip - sjekk-openapi-dekning passed for years on a `continue`.
 */
export type Workflowvurdering = "ok" | "ny" | "endret-trigger" | "ulesbar";

/**
 * The `on:` block of a workflow file as text, or undefined when there is none. Read
 * line by line, the way check-dokumentasjon.ts reads `run: pnpm`, because this repo
 * has no YAML parser and has decided not to get one. The block is the `on:` line and
 * every line until the next key in column 0. Comment-only and blank lines are
 * dropped so a comment does not count as a change; inline comments are kept, since
 * `#` is legal inside a quoted glob and refusing a new one is the safe side.
 */
export function triggerBlokk(yaml: string): string | undefined {
  const lines = yaml.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => /^["']?on["']?\s*:/.test(line));
  if (start < 0) return undefined;
  const block = [lines[start]];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    block.push(line);
  }
  return block
    .filter((line) => !/^\s*(#.*)?$/.test(line))
    .map((line) => line.trimEnd())
    .join("\n");
}

/** `base` is the file at the merge-base with main; undefined when the file is new there. */
export function vurderWorkflow(base: string | undefined, tip: string): Workflowvurdering {
  if (base === undefined) return "ny";
  const before = triggerBlokk(base);
  const after = triggerBlokk(tip);
  if (before === undefined || after === undefined) return "ulesbar";
  return before === after ? "ok" : "endret-trigger";
}

export function beskrivWorkflowvurdering(vurdering: Workflowvurdering): string {
  switch (vurdering) {
    case "ok": return "uendrede triggere";
    case "ny": return "ny workflow";
    case "endret-trigger": return "endrer triggerne (on:)";
    case "ulesbar": return "fant ikke on:";
  }
}
