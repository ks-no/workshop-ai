#!/usr/bin/env node

/*
 * Et kodeverk ingen leser er en påstand koden ikke innfrir.
 *
 * REAKSJONER er de fire ordene politiregisterloven § 39 bruker - siktet, tiltalt,
 * forelegg, dom - og de ble innført fordi skillet avgjør utfallet: bare dommen
 * utelukker fra en stilling. Likevel hadde `reaksjon` én forekomst i hele apps/:
 * sin egen typedeklarasjon. Regelen traff på kategorien alene, så en siktelse ble
 * behandlet som en dom, og ingenting var rødt - kodeverket så fullstendig ut.
 *
 * Ren tekstanalyse, som pnpm test:imports. Sjekken sier ikke at koden bruker
 * verdien riktig; den sier at noen bruker den i det hele tatt.
 *
 * Bruk:
 *   node scripts/test-kodeverk.ts
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let bestatt = 0;
const feil: string[] = [];
function check(navn: string, betingelse: unknown, detalj = "") {
  if (betingelse) { bestatt += 1; return; }
  feil.push(`${navn}${detalj ? ` - ${detalj}` : ""}`);
}

const appsDir = path.join(repoRoot, "apps");
const kilder = new Map<string, string>();
for (const navn of await readdir(appsDir, { recursive: true })) {
  if (!navn.endsWith(".ts") || navn.includes("node_modules")) continue;
  // readdir gir plattformens separator, så nøkkelen ble «apps/shared\\alder.ts» på
  // Windows og startsWith("apps/shared/") under traff aldri. Nøkkelen er en
  // repo-sti og skrives med skråstrek uansett plattform.
  kilder.set(`apps/${navn.split(path.sep).join("/")}`, await readFile(path.join(appsDir, navn), "utf8"));
}
check("fant kildefiler under apps/", kilder.size > 0, `fant ${kilder.size}`);

// Kodeverket er listen; typen avledet av den er det feltene bærer. Uten typen
// finnes det ikke noe felt å lete etter, og da er det bare en liste.
type Kodeverk = { navn: string; type: string; fil: string };
const kodeverk: Kodeverk[] = [];
for (const [fil, kilde] of kilder) {
  if (!fil.startsWith("apps/shared/")) continue;
  for (const treff of kilde.matchAll(/export const ([A-ZÆØÅ_]+) = \[[\s\S]*?\] as const;/g)) {
    const navn = treff[1]!;
    const type = kilde.match(new RegExp(`export type (\\w+) = \\(typeof ${navn}\\)\\[number\\];`))?.[1];
    if (type) kodeverk.push({ navn, type, fil });
  }
}
check("fant kodeverk i apps/shared", kodeverk.length > 0, `fant ${kodeverk.length}`);

/*
 * Kroppen til hver typeerklæring, med nøstingen intakt.
 *
 * Uten den leste feltsøket «const koder: Datakilde[] = []» som et felt som het
 * «koder», og krevde at noen leste «.koder» et sted. En lokal variabel er ikke et
 * felt, og en parameter er det heller ikke, så en regel som faktisk brukte
 * kodeverket kunne gjøre sjekken rød.
 *
 * Alternativet «| {» er for unionsmedlemmer. «kilde: Datakilde» i
 * Samtykkekildeoppslag er et like ekte felt som ett i en vanlig objekttype, og
 * uten det falt det ut av sjekken i stillhet.
 */
function typekropper(kilde: string): string[] {
  const kropper: string[] = [];
  const start = /(?:^|\n)\s*(?:\|\s*|(?:export\s+)?(?:type\s+\w+\s*=|interface\s+\w+)[^\n{]*)\{/g;
  for (const treff of kilde.matchAll(start)) {
    const foerste = treff.index! + treff[0].length - 1;
    let dybde = 0;
    for (let i = foerste; i < kilde.length; i += 1) {
      if (kilde[i] === "{") dybde += 1;
      else if (kilde[i] === "}") {
        dybde -= 1;
        if (dybde === 0) { kropper.push(kilde.slice(foerste + 1, i)); break; }
      }
    }
  }
  return kropper;
}

for (const { navn, type, fil } of kodeverk) {
  // Uten ^-anker: feltet kan stå i en innebygd objekttype eller på én linje, og en
  // erklæring sjekken ikke ser er en sjekk som består uten å ha målt noe.
  const felter = new Map<string, string>();
  for (const [sti, kilde] of kilder) {
    for (const kropp of typekropper(kilde)) {
      for (const treff of kropp.matchAll(new RegExp(`(\\w+)\\??:\\s*${type}(?:\\[\\])?\\b`, "g"))) {
        felter.set(treff[1]!, sti);
      }
    }
  }
  check(`${navn} typer minst ett felt`, felter.size > 0, `${fil} har ingen felt av typen ${type}`);

  for (const [felt, erklaertI] of felter) {
    // «.felt» dekker hver lesning i repoet i dag. Erklæringen selv er «felt: Type»
    // og treffer ikke, så filen som erklærer feltet teller på lik linje.
    const lesning = new RegExp(`\\.${felt}\\b`);
    check(
      `${navn}: feltet ${felt} leses av noen`,
      [...kilder.values()].some((kilde) => lesning.test(kilde)),
      `${felt} er typet av ${type} i ${erklaertI}, men ingen fil under apps/ leser det. ` +
      "Enten mangler regelen som skulle brukt kodeverket, eller så er kodeverket overflødig."
    );
  }
}

if (feil.length > 0) {
  console.error(`\ntest-kodeverk: ${feil.length} av ${bestatt + feil.length} sjekker feilet:`);
  for (const linje of feil) console.error(`  ✗ ${linje}`);
  process.exit(1);
}
console.log(`test-kodeverk ok. ${bestatt} sjekker over ${kodeverk.length} kodeverk, uten stack.`);
