#!/usr/bin/env node

import { access } from "node:fs/promises";
import { constants } from "node:fs";

const defaultUrl = process.env.MATRIKKEL_HEALTH_URL || "http://localhost:8085/health";
const defaultDataFile = process.env.MATRIKKEL_DATA_FILE || "data/matrikkel.seed.json";

function parseArgs(argv) {
  const opts = { url: defaultUrl, dataFile: defaultDataFile };
  for (const arg of argv) {
    if (arg.startsWith("--url=")) opts.url = arg.slice("--url=".length);
    if (arg.startsWith("--data-file=")) opts.dataFile = arg.slice("--data-file=".length);
  }
  return opts;
}

async function fileExists(filePath) {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function formatKilde(kilde) {
  if (!kilde) return "ukjent";
  const fil = kilde.fil ? ` fil=${kilde.fil}` : "";
  return `${kilde.format || "ukjent"}${fil}`.trim();
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  try {
    const res = await fetch(opts.url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const body = await res.json();
    const kilde = body.kilde || null;

    console.log("matrikkel-mock datakilde (live)");
    if (kilde?.fil) console.log(`- fil: ${kilde.fil}`);
    if (kilde?.format) console.log(`- format: ${kilde.format}`);
    if (body.antallGater !== undefined) console.log(`- antallGater: ${body.antallGater}`);
    if (body.antallEiendommer !== undefined) console.log(`- antallEiendommer: ${body.antallEiendommer}`);
    if (body.lastetTidspunkt) console.log(`- lastetTidspunkt: ${body.lastetTidspunkt}`);
    if (!kilde?.fil && !kilde?.format) {
      console.log(`- kilde: ${formatKilde(kilde)}`);
    }
    return;
  } catch (error) {
    const exists = await fileExists(opts.dataFile);
    console.error("Kunne ikke lese live helsesvar fra matrikkel-mock.");
    console.error(`- url: ${opts.url}`);
    console.error(`- feil: ${error.message}`);
    console.error("Forventet datakilde ved neste oppstart:");
    if (process.env.MATRIKKEL_DATA_FILE) {
      console.error(`- MATRIKKEL_DATA_FILE: ${opts.dataFile} (${exists ? "finnes" : "mangler"})`);
      console.error("- fallback: data/matrikkel.seed.json");
    } else {
      console.error(`- standard: ${opts.dataFile} (${exists ? "finnes" : "mangler"})`);
    }
    process.exitCode = 1;
  }
}

main();


