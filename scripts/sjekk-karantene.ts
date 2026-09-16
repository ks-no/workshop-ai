/*
 * Karantenen på nye versjoner, som en port.
 *
 * AGENTS.md says a new version must be at least seven days old before it enters the
 * repo, and named `cooldown` in .github/dependabot.yml as what enforces it. That holds
 * for npm and not for docker-compose: ollama/ollama:0.34.1 was pushed 2026-09-15 19:21
 * UTC and Dependabot opened the bump nine hours later. dependabot-core#14072, #14044
 * and #15446 are the same bug upstream. The claim needed a check of its own.
 *
 * Only the references this diff changes are looked up, because the rule is about what
 * enters the repo. A branch that touches no version makes no network call at all.
 *
 * A lookup that cannot be answered is an error, not a skip: a check that cannot resolve
 * its subject has to go red.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { feilmelding } from "../apps/shared/errors.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** En versjonsreferanse slik den står i en fil. */
type Referanse = {
  /** `ollama/ollama` eller `@aws-sdk/client-bedrock-runtime` */
  navn: string;
  /** `0.34.1` eller `3.1128.0` */
  versjon: string;
  kilde: "image" | "npm";
};

// --- the pure half ----------------------------------------------------------

/** Image references in a compose file. The tag is everything after the last colon. */
export function imagereferanser(innhold: string): Referanse[] {
  const treff = innhold.matchAll(/^\s*image:\s*["']?([^\s"'#]+)["']?/gm);
  const funn: Referanse[] = [];
  for (const [, ref] of treff) {
    const skille = ref.lastIndexOf(":");
    if (skille <= 0) continue; // no tag: the «nothing floats» rule owns that case
    funn.push({ navn: ref.slice(0, skille), versjon: ref.slice(skille + 1), kilde: "image" });
  }
  return funn;
}

/** Specifiers that name no registry version, so there is nothing to date. */
const UTENFOR = ["workspace:", "file:", "link:", "catalog:", "npm:", "github:"];

/** Dependencies in a package.json. A range prefix is stripped; `^3.1.0` is 3.1.0. */
export function pakkereferanser(innhold: string): Referanse[] {
  const pakke = JSON.parse(innhold) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const funn: Referanse[] = [];
  for (const blokk of [pakke.dependencies, pakke.devDependencies]) {
    for (const [navn, spesifikator] of Object.entries(blokk ?? {})) {
      if (UTENFOR.some((prefiks) => spesifikator.startsWith(prefiks))) continue;
      const versjon = spesifikator.replace(/^[\^~>=<\s]+/, "");
      if (!/^\d+\.\d+\.\d+/.test(versjon)) continue; // `*`, a tag or a URL
      funn.push({ navn, versjon, kilde: "npm" });
    }
  }
  return funn;
}

/**
 * The references whose version differs from the base, or that are new. Deduplicated:
 * docker-compose.yml names the same image on three services.
 */
export function endrede(foer: Referanse[], etter: Referanse[]): Referanse[] {
  const gammel = new Map(foer.map((r) => [`${r.kilde} ${r.navn}`, r.versjon]));
  const funn = new Map<string, Referanse>();
  for (const ref of etter) {
    const noekkel = `${ref.kilde} ${ref.navn}`;
    if (gammel.get(noekkel) === ref.versjon) continue;
    funn.set(`${noekkel} ${ref.versjon}`, ref);
  }
  return [...funn.values()];
}

/** Når en versjon publisert på `publisert` kan tas inn. */
export function tidligstInn(publisert: string, grenseMs: number): Date {
  return new Date(Date.parse(publisert) + grenseMs);
}

/** Seven days, in minutes, from the one place the number is written. */
export function lesGrenseMs(pnpmWorkspace: string): number {
  const treff = pnpmWorkspace.match(/^minimumReleaseAge:\s*(\d+)\s*$/m);
  if (!treff) throw new Error("fant ikke minimumReleaseAge i pnpm-workspace.yaml");
  return Number(treff[1]) * 60_000;
}

// --- self-check on the pure half, so the logic is covered without a network --

function paastand(navn: string, betingelse: unknown): void {
  if (!betingelse) {
    console.error(`sjekk-karantene: egensjekken «${navn}» feilet.`);
    process.exit(1);
  }
}

paastand(
  "leser image med tagg",
  imagereferanser('services:\n  a:\n    image: ollama/ollama:0.34.1\n')[0]?.versjon === "0.34.1"
);
paastand(
  "hopper over image uten tagg",
  imagereferanser("    image: ollama/ollama\n").length === 0
);
paastand(
  "strengrekkevidde blir versjon",
  pakkereferanser('{"dependencies":{"a":"^3.1128.0"}}')[0]?.versjon === "3.1128.0"
);
paastand(
  "workspace-spesifikator er utenfor",
  pakkereferanser('{"dependencies":{"a":"workspace:*"}}').length === 0
);
paastand(
  "uendret versjon er ikke endret",
  endrede(
    [{ navn: "a", versjon: "1.0.0", kilde: "npm" }],
    [{ navn: "a", versjon: "1.0.0", kilde: "npm" }]
  ).length === 0
);
paastand(
  "ny versjon er endret",
  endrede(
    [{ navn: "a", versjon: "1.0.0", kilde: "npm" }],
    [{ navn: "a", versjon: "1.0.1", kilde: "npm" }]
  ).length === 1
);
paastand(
  "samme image tre steder telles én gang",
  endrede(
    [{ navn: "a", versjon: "1.0.0", kilde: "image" }],
    [
      { navn: "a", versjon: "1.0.1", kilde: "image" },
      { navn: "a", versjon: "1.0.1", kilde: "image" },
    ]
  ).length === 1
);
paastand(
  "sju dager legges til publiseringsdatoen",
  tidligstInn("2026-09-15T19:21:57Z", 10080 * 60_000).toISOString() === "2026-09-22T19:21:57.000Z"
);
paastand("grensen leses av arbeidsområdefilen", lesGrenseMs("minimumReleaseAge: 10080\n") === 604_800_000);

// --- git --------------------------------------------------------------------

function git(...argumenter: string[]): string {
  return execFileSync("git", argumenter, { cwd: repoRoot, encoding: "utf8" }).trim();
}

/**
 * KARANTENE_BASIS is what CI passes: actions/checkout builds a merge ref for a pull
 * request and fetches no branches, so origin/main is not there to merge-base against.
 */
function basis(): string {
  const oppgitt = process.env.KARANTENE_BASIS;
  if (oppgitt) return git("rev-parse", oppgitt);
  const gren = process.env.GITHUB_BASE_REF ?? "main";
  for (const ref of [`origin/${gren}`, gren]) {
    try {
      return git("merge-base", ref, "HEAD");
    } catch {
      continue;
    }
  }
  throw new Error(`fant ingen felles forgjenger med ${gren} eller origin/${gren}`);
}

/** The file as it stood on the base. Missing there means the file is new. */
function innholdVedBasis(basisSha: string, sti: string): string {
  try {
    return git("show", `${basisSha}:${sti}`);
  } catch {
    return "";
  }
}

// --- lookups ----------------------------------------------------------------

async function hentJson(url: string): Promise<unknown> {
  const svar = await fetch(url, { headers: { accept: "application/json" } });
  if (!svar.ok) throw new Error(`${url} svarte ${svar.status}`);
  return await svar.json();
}

/** When a tag was pushed. Docker Hub only: everything this repo runs lives there. */
async function imagePublisert(navn: string, tagg: string): Promise<string> {
  if (navn.split("/")[0]?.includes(".")) {
    throw new Error(`${navn} ligger ikke på Docker Hub, og har ingen oppslag her`);
  }
  const bane = navn.includes("/") ? navn : `library/${navn}`;
  const svar = (await hentJson(`https://hub.docker.com/v2/repositories/${bane}/tags/${tagg}`)) as {
    last_updated?: string;
  };
  if (!svar.last_updated) throw new Error(`Docker Hub oppga ingen dato for ${navn}:${tagg}`);
  return svar.last_updated;
}

async function pakkePublisert(navn: string, versjon: string): Promise<string> {
  const svar = (await hentJson(`https://registry.npmjs.org/${navn.replace("/", "%2f")}`)) as {
    time?: Record<string, string>;
  };
  const dato = svar.time?.[versjon];
  if (!dato) throw new Error(`npm oppga ingen dato for ${navn}@${versjon}`);
  return dato;
}

// --- the run ----------------------------------------------------------------

const grenseMs = lesGrenseMs(readFileSync(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8"));
const basisSha = basis();
const endredeFiler = git("diff", "--name-only", basisSha)
  .split("\n")
  .filter((sti) => /(^|\/)docker-compose[^/]*\.ya?ml$/.test(sti) || /(^|\/)package\.json$/.test(sti));

const kandidater: Referanse[] = [];
for (const sti of endredeFiler) {
  const les = sti.endsWith(".json") ? pakkereferanser : imagereferanser;
  const foer = innholdVedBasis(basisSha, sti);
  const etter = readFileSync(path.join(repoRoot, sti), "utf8");
  kandidater.push(...endrede(foer ? les(foer) : [], les(etter)));
}

if (kandidater.length === 0) {
  console.log(
    `sjekk-karantene ok. Ingen versjoner endret mot ${basisSha.slice(0, 8)}` +
    `${endredeFiler.length > 0 ? ` i ${endredeFiler.length} rørte filer` : ""} - ingen oppslag gjort.`
  );
  process.exit(0);
}

const naa = new Date();
const feil: string[] = [];
const godkjent: string[] = [];

for (const ref of kandidater) {
  let publisert: string;
  try {
    publisert =
      ref.kilde === "image"
        ? await imagePublisert(ref.navn, ref.versjon)
        : await pakkePublisert(ref.navn, ref.versjon);
  } catch (aarsak) {
    // A lookup we cannot answer is red, not green: an unchecked version is the
    // whole failure this gate exists for.
    console.error(
      `sjekk-karantene: fant ikke publiseringsdatoen for ${ref.navn} ${ref.versjon}.`
    );
    console.error(`  - ${feilmelding(aarsak)}`);
    process.exit(1);
  }
  const tidligst = tidligstInn(publisert, grenseMs);
  const alderDoegn = (naa.getTime() - Date.parse(publisert)) / 86_400_000;
  const linje = `${ref.navn} ${ref.versjon} - publisert ${publisert.slice(0, 16).replace("T", " ")} UTC, ${alderDoegn.toFixed(1)} døgn gammel`;
  if (tidligst > naa) {
    feil.push(`${linje}. Kan tas inn ${tidligst.toISOString().slice(0, 16).replace("T", " ")} UTC.`);
  } else {
    godkjent.push(linje);
  }
}

if (feil.length > 0) {
  console.error(
    `sjekk-karantene: ${feil.length} av ${kandidater.length} nye versjoner er yngre enn karantenen.`
  );
  for (const linje of feil) console.error(`  - ${linje}`);
  console.error("  Regelen står i AGENTS.md under «Project conventions you must follow».");
  process.exit(1);
}

const antall = godkjent.length === 1 ? "1 ny versjon" : `${godkjent.length} nye versjoner`;
console.log(`sjekk-karantene ok. ${antall}, forbi karantenen:`);
for (const linje of godkjent) console.log(`  - ${linje}`);
