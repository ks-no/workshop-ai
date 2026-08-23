#!/usr/bin/env node

/*
 * Runs the curl cookbook.
 *
 * examples/curl/README.md opens by promising that a call which does not work is a
 * real bug and not a stale example. On 22.08.2026 that was false: 34 of its calls
 * answered 401, because the file had been derived from kontrakt-smoke.js with the
 * Authorization headers stripped out, and AUTH_ENFORCE defaults to on. The consent
 * lesson documented 403 where an anonymous call gets 401. Two of its shell helpers
 * sent \{} instead of {} — bash keeps the backslashes inside double quotes — so
 * five steps answered 500 without saying why.
 *
 * Nothing could catch any of it, because nothing ran the file. This does.
 *
 * Every ```bash block is extracted in order and run in ONE shell, so `export TOKEN=`
 * in §1 is still set in §6, exactly as a reader would experience it. A block fails
 * the gate if the shell exits non-zero, or if any line of its output looks like an
 * HTTP status the prose did not ask for.
 *
 * Needs the stack up, so it is not in CI — same reason as test:agent. Run it before
 * touching the cookbook, and after.
 *
 * Usage:
 *   node scripts/test-kokebok.js
 *   node scripts/test-kokebok.js --vis     # print the script it would run
 */

import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const file = "examples/curl/README.md";
const printOnly = process.argv.includes("--vis");

const text = await readFile(file, "utf8");

/*
 * Blocks are numbered by the "## " heading above them, so a failure names the
 * section a reader would be looking at rather than a line offset.
 */
const blocks = [];
let section = "(før første overskrift)";
let inBlock = false;
let buffer = [];
let startLine = 0;

text.split("\n").forEach((line, i) => {
  if (!inBlock && line.startsWith("## ")) {
    section = line.slice(3).trim();
    return;
  }
  if (!inBlock && line.trim() === "```bash") {
    inBlock = true;
    buffer = [];
    startLine = i + 2;
    return;
  }
  if (inBlock && line.trim() === "```") {
    inBlock = false;
    blocks.push({ section, line: startLine, code: buffer.join("\n") });
    return;
  }
  if (inBlock) buffer.push(line);
});

if (inBlock) {
  console.error(`${file}: en \`\`\`bash-blokk er ikke lukket.`);
  process.exit(1);
}

if (blocks.length === 0) {
  console.error(`${file}: fant ingen \`\`\`bash-blokker. Er fila tom eller omskrevet?`);
  process.exit(1);
}

/*
 * `set -u` but deliberately not `set -e`: several blocks end on a curl that is
 * *supposed* to answer 401 or 403, and -e would abort on the first one. The
 * verdict comes from the status codes instead.
 */
const script = [
  "set -u",
  "cd " + JSON.stringify(process.cwd()),
  ...blocks.map(
    ({ section, line, code }) =>
      `echo "@@BLOKK ${line} ${section}"\n${code}`
  )
].join("\n");

if (printOnly) {
  console.log(script);
  process.exit(0);
}

const output = await new Promise((resolve, reject) => {
  const child = spawn("bash", ["-c", script], { stdio: ["ignore", "pipe", "pipe"] });
  let text = "";
  child.stdout.on("data", (d) => (text += d));
  child.stderr.on("data", (d) => (text += d));
  child.on("error", reject);
  child.on("close", (code) => resolve({ text, code }));
});

/*
 * Only lines that are a *status readout* are judged. The first version matched any
 * three digits anywhere, and read "200" out of "Full pris er 35 200 kr" — a chart of
 * false positives on the one block that works. A readout has no JSON punctuation and
 * ends in the code: "uten token:          401", or "8086 200".
 */
const STATUS_LINE = /^[^{}\[\]",]*?\s(\d{3})\s*$/;
const EXPECTED = new Set(["200", "201", "204", "401", "403", "404"]);

const failures = [];
let block = null;

for (const line of output.text.split("\n")) {
  const marker = line.match(/^@@BLOKK (\d+) (.*)$/);
  if (marker) {
    block = { line: marker[1], section: marker[2] };
    continue;
  }
  const where = `${file}:${block?.line ?? "?"} «${block?.section ?? "?"}»`;
  const match = line.match(STATUS_LINE);
  if (match && !EXPECTED.has(match[1])) {
    failures.push(`${where}: ${line.trim()}`);
  }
  if (/command not found|Unexpected token|SyntaxError|Parse error/.test(line)) {
    failures.push(`${where}: ${line.trim()}`);
  }
}

/*
 * The end-to-end assertion. Every status in §4 can read 200 while the flow still
 * fails to finish — that is exactly what the \{} quoting bug did: the steps answered
 * 500, `neste` answered 200, and the session sat at AKTIV. The cookbook claims the
 * session reaches FULLFORT, so the gate checks the claim rather than the codes.
 */
if (!output.text.includes("FULLFORT")) {
  failures.push(
    `${file}: barnehageflyten i §4 nådde ikke status FULLFORT. ` +
    `Kokeboka påstår at den gjør det, så enten stoppet et steg eller så er teksten gal.`
  );
}

console.log(output.text.replace(/^@@BLOKK \d+ /gm, "\n── "));
console.log(`\n${blocks.length} bash-blokker kjørt fra ${file}.`);

if (output.code !== 0) {
  failures.push(`skallet avsluttet med kode ${output.code}`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} problem(er) i kokeboka:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(
    `\nKokeboka lover at «virker et kall ikke, er det en reell feil». ` +
    `Enten er kallet galt, eller så er koden det.`
  );
  process.exit(1);
}
console.log("Alle kall i kokeboka svarer som dokumentert.");
