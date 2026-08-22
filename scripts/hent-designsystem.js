import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Vendors the KS Digital design system CSS into apps/shared-ui/, so the sandbox
// renders correctly with no network and no build step. The files are checked in;
// this script only exists to make the download reproducible and the version visible.
//
// The version is pinned deliberately. @ks-digital/designsystem-themes is pre-1.0
// (0.0.1-alpha.*) and class names may still move, so a floating version would let a
// silent upstream change break every participant's frontend mid-hackathon.
const VERSJON = "0.0.1-alpha.69";
const TEMA = "ksdigital";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sharedUiDir = path.resolve(__dirname, "..", "apps", "shared-ui");
const cdn = `https://cdn.jsdelivr.net/npm/@ks-digital/designsystem-themes@${VERSJON}/dist`;

const filer = [
  { url: `${cdn}/base.css`, navn: "ds-base.css" },
  { url: `${cdn}/themes/${TEMA}.css`, navn: `ds-${TEMA}.css` }
];

async function hent({ url, navn }) {
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
  const filsti = path.join(sharedUiDir, navn);
  await writeFile(filsti, css, "utf8");
  console.log(`  ${navn}  ${(css.length / 1024).toFixed(0)} kB`);
}

console.log(`Henter @ks-digital/designsystem-themes@${VERSJON} (tema: ${TEMA})`);
try {
  for (const fil of filer) {
    await hent(fil);
  }
  console.log("Ferdig. Se docs/designsystem.md for hvordan filene brukes.");
} catch (error) {
  console.error(`\nKlarte ikke hente designsystemet: ${error.message}`);
  console.error("Filene i apps/shared-ui/ er sjekket inn, så sandboxen virker uten dette steget.");
  process.exit(1);
}
