import { readFile } from "node:fs/promises";

const filer = [
  "data/personer.json",
  "data/husstander.json",
  "data/inntekter.json",
  "data/barnehageplasser.json",
  "data/soknader.json",
  "data/samtykker.json",
  "data/prosessdefinisjoner.json",
  "data/informasjonsmodeller.json",
  "data/prosessoekter.json",
  "data/oppgaver.json",
  "data/meldinger.json",
  "data/revisjonslogg.json",
  "data/matrikkel.json"
];

for (const fil of filer) {
  JSON.parse(await readFile(fil, "utf8"));
}

const personer = JSON.parse(await readFile("data/personer.json", "utf8"));
if (personer.length < 20) {
  throw new Error("Det må finnes minst 20 personer.");
}

console.log(`Validering ok. Antall personer: ${personer.length}`);
