/**
 * Formålene fra politiets oversikt, og forhåndsutvalget som gjør dem til noe en modell
 * kan velge mellom.
 *
 * 164 formål er for mye å legge i en ledetekst - modellen har plass, men treffsikkerheten
 * faller når alt konkurrerer om oppmerksomheten, og hvert kall blir tregt. Så søket går i to
 * trinn: et billig ordsøk plukker kandidatene, og modellen rangerer dem. Trinn én er også
 * svaret hvis modellen ikke svarer.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Lest én gang ved oppstart, som i matrikkel-mock og pasientjournal-mock. Filen er
 * seed og endrer seg ikke mens tjenesten kjører; `node --watch` starter prosessen på
 * nytt om den gjør. Synkront, fordi `søk` under er synkron og indeksen bygges her.
 */
const dataFil = process.env.FORMAAL_DATA_FILE
  || path.resolve(__dirname, "../data/formaal.json");
const formaalData = JSON.parse(readFileSync(dataFil, "utf8"));

export interface Formaal {
  id: string;
  kategori: string;
  formaal: string;
  beskrivelse: string;
  hjemmel: string;
  attesttype: string;
  bekreftelse: string;
}

export const FORMAAL = formaalData as Formaal[];

/** Hvilken fil radene kom fra, slik `/helse` kan si det. */
export const formaalKilde = path.relative(path.resolve(__dirname, "../../.."), dataFil);

/**
 * Ord som står i nesten annenhver rad. De sier ingenting om hvilken rad det er, så de
 * ville bare gitt alle kandidatene den samme poengsummen.
 */
const STOPPORD = new Set([
  "og", "eller", "i", "på", "til", "for", "av", "som", "med", "den", "det", "de", "en",
  "et", "er", "skal", "har", "ved", "om", "fra", "under", "over", "andre", "annen",
  "personer", "person", "søknad", "arbeid", "ledd", "jf", "første", "politiregisterloven",
  "politiattest", "attest", "bekreftelse", "ingen", "vil", "kan", "være", "sin", "seg",
]);

/**
 * Norsk bøyning er ikke verdt en stemmer her; å kappe endelsen tar det meste.
 *
 * Stammen må ha noe igjen å være. «er» blir til ingenting av regelen, og en tom stamme
 * er inneholdt i alt - da matcher hvert søkeord hver eneste rad. Blir det for lite igjen,
 * står ordet som det er.
 */
function stamme(ord: string): string {
  const kappet = ord.replace(/(ene|ane|ede|er|en|et|ar|a|e)$/u, "");
  return kappet.length >= 4 ? kappet : ord;
}

function ord(tekst: string): string[] {
  return tekst
    .toLowerCase()
    .split(/[^0-9a-zæøåäöü§-]+/u)
    .filter((o) => o.length > 1 && !STOPPORD.has(o));
}

/**
 * Feltene teller ulikt. Står ordet i selve formålet, er det nesten sikkert riktig rad;
 * står det i beskrivelsen, er det bare et hint. Hjemmelen teller lavest - den er
 * lovhenvisninger, og brukeren skriver ikke lovhenvisninger, det er dem hen leter etter.
 */
const VEKTER: { felt: keyof Formaal; vekt: number }[] = [
  { felt: "formaal", vekt: 5 },
  { felt: "kategori", vekt: 3 },
  { felt: "beskrivelse", vekt: 2 },
  { felt: "hjemmel", vekt: 1 },
];

/** Ordene i hver rad, forhåndsstammet én gang ved oppstart. */
const INDEKS = FORMAAL.map((rad) =>
  VEKTER.map(({ felt, vekt }) => ({ vekt, ord: new Set(ord(rad[felt]).map(stamme)) })),
);

export interface Kandidat {
  formaal: Formaal;
  poeng: number;
}

/**
 * Kandidatene til et fritekstsøk, best først. Et ord teller én gang per felt det står i,
 * så «barnehage» i både formålet og beskrivelsen veier tyngre enn i beskrivelsen alene.
 */
export function søk(tekst: string, antall: number): Kandidat[] {
  const søkeord = [...new Set(ord(tekst).map(stamme))];
  if (søkeord.length === 0) return [];

  return FORMAAL.map((formaal, i) => {
    let poeng = 0;
    for (const { vekt, ord } of INDEKS[i]) {
      for (const s of søkeord) {
        if (ord.has(s)) {
          poeng += vekt;
          continue;
        }
        // Halvt treff på sammensatte ord: «barnehagevikar» skal finne «barnehage», og
        // «fritidsklubb» skal finne «klubb». Bare i endene - et treff midt inni ordet er
        // som regel en tilfeldighet, og korte ord slippes ikke løs på det i det hele tatt.
        const sammensatt = [...ord].some(
          (o) =>
            o.length >= 4 &&
            (o.startsWith(s) || s.startsWith(o) || o.endsWith(s) || s.endsWith(o)),
        );
        if (s.length >= 5 && sammensatt) poeng += vekt / 2;
      }
    }
    return { formaal, poeng };
  })
    .filter((k) => k.poeng > 0)
    .sort((a, b) => b.poeng - a.poeng || a.formaal.id.localeCompare(b.formaal.id))
    .slice(0, antall);
}
