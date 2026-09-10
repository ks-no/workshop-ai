#!/usr/bin/env node

/*
 * Unit tests for scripts/innlevering-regler.ts - the rules hent-innleveringer.ts
 * force-pushes by.
 *
 * Pure, and that is the point: no fork, no remote, no GitHub token. The script itself
 * reads argv and calls git at import, so the rules live in a module of their own and
 * this file imports that.
 *
 * What this covers that nothing else can:
 *
 *  1. The workflow rule. A branch we push is a `push` event with this repository's
 *     token, and the only thing between that and a team's `on: push` is
 *     vurderWorkflow. The first version refused every changed workflow file and
 *     stopped two of five real teams for adding a test step; the rule now reads the
 *     `on:` block, and the cases below are the ones that decided it.
 *  2. The slug. «team» is stripped from a team name and from nothing else; the
 *     first version stripped it from GitHub logins too, so `team-bergen` and `bergen`
 *     collided and the day-one backup would have stopped before the first fetch.
 *  3. The URL shapes participants actually paste, including what a browser adds.
 */

import { readFileSync } from "node:fs";
import {
  parseIssueBody, parseRepoUrl, qualifyRef, slug, teamSlug, triggerBlokk, vurderWorkflow
} from "./innlevering-regler.ts";

let bestatt = 0;
const feil: string[] = [];

function check(navn: string, betingelse: unknown, detalj = ""): void {
  if (betingelse) {
    bestatt += 1;
    return;
  }
  feil.push(`${navn}${detalj ? ` - ${detalj}` : ""}`);
}

function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

// --- names -----------------------------------------------------------------

check("«Team Bergen» blir bergen", teamSlug("Team Bergen") === "bergen");
check("«Teamwork» beholder navnet", teamSlug("Teamwork") === "teamwork");
check("«Lag Ålesund» blir lag-aalesund", teamSlug("Lag Ålesund") === "lag-aalesund");
check("«Team» alene blir team, ikke tom", teamSlug("Team") === "team");
check("tomt navn blir uten-navn", teamSlug("  ") === "uten-navn");
check("slug stripper ikke team fra et reponavn", slug("team-frontend") === "team-frontend");
check("slug skiller team-bergen fra bergen", slug("team-bergen") !== slug("bergen"));
check("slug fjerner aksenter", slug("Café Ørn") === "cafe-oern");

// --- urls ------------------------------------------------------------------

check("eier/repo", parseRepoUrl("ola/workshop-ai").owner === "ola");
check(".git strippes", parseRepoUrl("https://github.com/ola/workshop-ai.git").name === "workshop-ai");
check("/tree/<branch> gir branch", parseRepoUrl("https://github.com/ola/workshop-ai/tree/utvikling").branch === "utvikling");
check("?tab=readme strippes", parseRepoUrl("https://github.com/ola/workshop-ai/tree/main/?tab=readme").branch === "main");
check("skråstrek på slutten strippes", parseRepoUrl("https://github.com/ola/workshop-ai/").name === "workshop-ai");
check("ssh-form", parseRepoUrl("git@github.com:ola/workshop-ai.git").owner === "ola");
check("«ingen» kaster", throws(() => parseRepoUrl("ingen")));
check("en demo-lenke kaster", throws(() => parseRepoUrl("https://team-bergen.vercel.app")));
check("branch kvalifiseres", qualifyRef("main") === "refs/heads/main");
check("HEAD passerer", qualifyRef("HEAD") === "HEAD");
check("refs/ passerer", qualifyRef("refs/pull/1/head") === "refs/pull/1/head");

// --- issue form ------------------------------------------------------------

const body = "### Teamnavn\n\nTeam Bergen\n\n### Fork\n\nhttps://github.com/ola/workshop-ai\n\n### Branch\n\n_No response_\n\n### Andre repoer\n\nhttps://github.com/ola/frontend\nhttps://github.com/ola/api";
const fields = parseIssueBody(body);
check("feltet leses ved etikett", fields.get("Teamnavn") === "Team Bergen");
check("_No response_ blir tom streng", fields.get("Branch") === "");
check("flerlinjefelt beholder linjene", fields.get("Andre repoer")?.split("\n").length === 2);
check("CRLF leses som LF", parseIssueBody(body.replace(/\n/g, "\r\n")).get("Fork") === "https://github.com/ola/workshop-ai");

// --- workflows -------------------------------------------------------------

const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const ciTrigger = triggerBlokk(ci);
check("ci.yml har en on:-blokk", ciTrigger !== undefined);
check("ci.yml-blokken sier main", ciTrigger?.includes("branches: [main]"));
check("kommentarene i ci.yml-blokken er borte", !ciTrigger?.includes("#"));

check("on: push på én linje", triggerBlokk("name: x\non: push\njobs: {}\n") === "on: push");
check("\"on\": med anførselstegn finnes", triggerBlokk('"on":\n  push:\n') === '"on":\n  push:');
check("fil uten on: gir undefined", triggerBlokk("name: x\njobs: {}\n") === undefined);
check(
  "kommentarer og blanke linjer teller ikke",
  triggerBlokk("on:\n  # hvorfor\n\n  push:\n    branches: [main]\npermissions: {}\n") ===
    triggerBlokk("on:\n  push:\n    branches: [main]\npermissions: {}\n")
);
check(
  "CRLF gir samme blokk",
  triggerBlokk("on:\r\n  push:\r\n    branches: [main]\r\njobs: {}\r\n") === "on:\n  push:\n    branches: [main]"
);
check(
  "blokken stopper ved neste nøkkel",
  triggerBlokk("on:\n  push:\njobs:\n  a:\n    steps: []\n") === "on:\n  push:"
);

const withStep = ci.replace("run: pnpm test:upstream", "run: pnpm test:upstream\n      - name: Garasje\n        run: pnpm test:garasje");
check("fixturen la til et steg", withStep !== ci);
check("nytt teststeg er ok", vurderWorkflow(ci, withStep) === "ok");
check("branches: ['**'] er endret-trigger", vurderWorkflow(ci, ci.replace("branches: [main]", "branches: ['**']")) === "endret-trigger");
check("push uten filter er endret-trigger", vurderWorkflow(ci, ci.replace("  push:\n    branches: [main]", "  push:")) === "endret-trigger");
check("ny fil er ny", vurderWorkflow(undefined, "on: pull_request\n") === "ny");
check("tip uten on: er ulesbar", vurderWorkflow(ci, "name: x\njobs: {}\n") === "ulesbar");
check("base uten on: er ulesbar", vurderWorkflow("name: x\n", ci) === "ulesbar");
check("uendret fil er ok", vurderWorkflow(ci, ci) === "ok");

// Every on: block main has ever had must be one this rule would let through
// unchanged, or the «unchanged means safe» argument does not hold. The historical
// versions are pinned as text; a new trigger on main that fires outside main should
// fail here and force the reasoning to be redone.
const historiske = [
  "on:\n  pull_request:\n  push:\n    branches: [main]",
  "on:\n  pull_request:\n  merge_group:\n  push:\n    branches: [main]",
  "on:\n  push:\n    branches: [main]\n  workflow_dispatch:"
];
for (const file of ["ci.yml", "sbom.yml", "sbom-images.yml"]) {
  const block = triggerBlokk(readFileSync(`.github/workflows/${file}`, "utf8"));
  const stripped = block?.split("\n").filter((l) => !/^\s+(paths:|- )/.test(l)).join("\n");
  check(`${file} fyrer bare på main`, stripped !== undefined && historiske.includes(stripped), stripped);
}

// --- report ----------------------------------------------------------------
if (feil.length > 0) {
  console.error(`test-innlevering: ${feil.length} av ${bestatt + feil.length} sjekker feilet.`);
  for (const linje of feil) console.error(`  - ${linje}`);
  process.exit(1);
}
console.log(`test-innlevering ok. ${bestatt} sjekker, uten fork og uten GitHub.`);
