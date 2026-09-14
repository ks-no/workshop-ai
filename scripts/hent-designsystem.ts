import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { feilmelding } from "../apps/shared/errors.ts";

// Vendors the KS Digital design system CSS into apps/shared/, so the sandbox
// renders correctly with no network and no build step. The files are checked in;
// this script only exists to make the download reproducible and the version visible.
//
// The version is pinned deliberately. @ks-digital/designsystem-themes is pre-1.0
// (0.0.1-alpha.*) and class names may still move, so a floating version would let a
// silent upstream change break every participant's frontend mid-hackathon.
const VERSION = "0.0.1-alpha.69";
const THEME = "ksdigital";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sharedDir = path.resolve(__dirname, "..", "apps", "shared");
const cdn = `https://cdn.jsdelivr.net/npm/@ks-digital/designsystem-themes@${VERSION}/dist`;

const files = [
  { url: `${cdn}/base.css`, navn: "ds-base.css" },
  { url: `${cdn}/themes/${THEME}.css`, navn: `ds-${THEME}.css` }
];

// MIT requires the copyright notice to travel with the redistributed file, and this
// script overwrites both files - so the header has to be written here, not by hand.
// pnpm test:docs fails if either file loses it, or if the version in it drifts from
// VERSION above.
function medLisensheader(css: string, url: string): string {
  // @charset must be the first thing in the file, so the header goes after it.
  const charset = css.match(/^@charset\s+"[^"]*";\r?\n/)?.[0] ?? "";
  const header =
    `/*\n` +
    ` * Vendored from @ks-digital/designsystem-themes@${VERSION}, MIT-licensed.\n` +
    ` * Copyright (c) 2025 KS Digital\n` +
    ` * Built on @digdir/designsystemet-css - Copyright 2024 Digitaliseringsdirektoratet (Digdir), MIT.\n` +
    ` * Full permission notices: NOTICE.md in the repository root.\n` +
    ` * Source: ${url}\n` +
    ` * Fetched by scripts/hent-designsystem.ts - do not edit by hand.\n` +
    ` */\n`;
  return `${charset}${header}${css.slice(charset.length)}`;
}

async function download({ url, navn }: { url: string; navn: string }): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} svarte ${response.status} ${response.statusText}`);
  }
  const css = await response.text();
  // A 404 page or an SPA shell would also be "text". Anything that is not CSS
  // must fail here rather than get committed as a stylesheet.
  if (!css.includes("@layer")) {
    throw new Error(`${url} ser ikke ut som CSS fra designsystemet (mangler @layer)`);
  }
  const filsti = path.join(sharedDir, navn);
  await writeFile(filsti, medLisensheader(css, url), "utf8");
  console.log(`  ${navn}  ${(css.length / 1024).toFixed(0)} kB`);
}

console.log(`Henter @ks-digital/designsystem-themes@${VERSION} (tema: ${THEME})`);
try {
  for (const fil of files) {
    await download(fil);
  }
  console.log("Ferdig. Se docs/designsystem.md for hvordan filene brukes.");
} catch (error) {
  console.error(`\nKlarte ikke hente designsystemet: ${feilmelding(error)}`);
  console.error("Filene i apps/shared/ er sjekket inn, så sandkassen virker uten dette steget.");
  process.exit(1);
}
