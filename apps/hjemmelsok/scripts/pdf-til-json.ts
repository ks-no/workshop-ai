/**
 * Gjør politiets formålsoversikt om til `data/formaal.json`.
 *
 * PDF-en er én lang tabell over 26 sider med seks kolonner: kategori, formål, beskrivelse,
 * hjemmel, attesttype og bekreftelse. Den er en tabell, ikke en tekst - så den leses som
 * geometri, ikke som linjer. `pdftotext -bbox-layout` gir hvert ord med koordinater, og
 * resten er to observasjoner om hvordan Word setter en slik tabell:
 *
 *   1. Alle celler i en rad starter på samme y, og kolonnene står på faste x-er hele veien
 *      (36, 135, 305, 532, 688, 759). Et ord hører til kolonnen som starter nærmest til
 *      venstre for det.
 *   2. Linjeavstanden inni en celle er 0. Mellom to rader er den 0,5. Det er hele
 *      radskillet - ingen streker å lete etter.
 *
 * Kjør: `node apps/hjemmelsok/scripts/pdf-til-json.ts [sti-til-pdf]`
 *
 * Krever `pdftotext` (poppler-utils). Skriptet er en engangsjobb som ligger igjen for at
 * dataene skal kunne lages på nytt hvis politiet oppdaterer oversikten - tjenesten selv
 * leser bare JSON-en.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HER = dirname(fileURLToPath(import.meta.url));
const STANDARD_PDF = resolve(HER, "../data/formal-til-soknad-om-politiattest.pdf");
const UT = resolve(HER, "../data/formaal.json");

/** Kolonnene, i rekkefølge, med x-en de starter på. Lest av overskriftsraden på side 1. */
const KOLONNER = [
  { felt: "kategori", x: 36.0 },
  { felt: "formaal", x: 135.2 },
  { felt: "beskrivelse", x: 305.3 },
  { felt: "hjemmel", x: 532.0 },
  { felt: "attesttype", x: 688.0 },
  { felt: "bekreftelse", x: 758.8 },
] as const;

type Felt = (typeof KOLONNER)[number]["felt"];

/** Tittelen står over tabellen og bunnteksten under. Alt utenfor båndet er ikke data. */
const TABELL_TOPP = 150;
const TABELL_BUNN = 495;

/** Større enn dette mellom to linjer betyr ny rad. Inni en celle er avstanden 0. */
const RADSKILLE = 0.25;

interface Ord {
  x: number;
  xMax: number;
  y: number;
  yMax: number;
  tekst: string;
}

/** En linje slik den står i én celle: ordene i én kolonne på én y. */
interface Cellelinje {
  felt: Felt;
  ord: Ord[];
}

export interface Formaal {
  /** Stabil nøkkel utledet av kategori + formål. Brukes som verdi i nedtrekket. */
  id: string;
  kategori: string;
  formaal: string;
  beskrivelse: string;
  hjemmel: string;
  attesttype: string;
  bekreftelse: string;
}

function pdfTilXml(pdf: string): string {
  const mappe = mkdtempSync(join(tmpdir(), "hjemmelsok-"));
  const xml = join(mappe, "sider.xml");
  const kjørt = spawnSync("pdftotext", ["-bbox-layout", pdf, xml], { encoding: "utf8" });
  if (kjørt.error || kjørt.status !== 0) {
    throw new Error(
      `pdftotext feilet (${kjørt.error?.message ?? `status ${kjørt.status}`}). ` +
        "Installer poppler-utils: apt-get install poppler-utils / brew install poppler.",
    );
  }
  return readFileSync(xml, "utf8");
}

function avkod(tekst: string): string {
  return tekst
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, kode: string) => String.fromCodePoint(Number(kode)))
    .replace(/&amp;/g, "&");
}

/** Ordene per side, i dokumentrekkefølge. */
function lesSider(xml: string): Ord[][] {
  const ORD =
    /<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">([\s\S]*?)<\/word>/g;
  return xml
    .split("<page ")
    .slice(1)
    .map((side) =>
      [...side.matchAll(ORD)].map((treff) => ({
        x: Number(treff[1]),
        y: Number(treff[2]),
        xMax: Number(treff[3]),
        yMax: Number(treff[4]),
        tekst: avkod(treff[5]).trim(),
      })),
    );
}

/** Kolonnen et ord hører til: den som starter nærmest til venstre for det. */
function kolonne(x: number): Felt {
  let valgt: Felt = KOLONNER[0].felt;
  for (const kol of KOLONNER) {
    if (x + 2 >= kol.x) valgt = kol.felt;
  }
  return valgt;
}

/**
 * Cellelinjene på en side, gruppert på y og deretter på kolonne, med et flagg for om
 * linjen starter en ny rad.
 */
function linjerPåSide(ord: Ord[]): { nyRad: boolean; linjer: Cellelinje[] }[] {
  const påY = new Map<string, Ord[]>();
  for (const o of ord) {
    if (!o.tekst || o.y < TABELL_TOPP || o.y > TABELL_BUNN) continue;
    const nøkkel = o.y.toFixed(2);
    const bøtte = påY.get(nøkkel);
    if (bøtte) bøtte.push(o);
    else påY.set(nøkkel, [o]);
  }

  const sortert = [...påY.entries()]
    .map(([y, ord]) => ({ y: Number(y), ord: ord.sort((a, b) => a.x - b.x) }))
    .sort((a, b) => a.y - b.y);

  const ut: { nyRad: boolean; linjer: Cellelinje[] }[] = [];
  let forrigeBunn = -Infinity;
  for (const { y, ord } of sortert) {
    const perFelt = new Map<Felt, Ord[]>();
    for (const o of ord) {
      const felt = kolonne(o.x);
      const bøtte = perFelt.get(felt);
      if (bøtte) bøtte.push(o);
      else perFelt.set(felt, [o]);
    }
    ut.push({
      nyRad: y - forrigeBunn > RADSKILLE,
      linjer: [...perFelt.entries()].map(([felt, ord]) => ({ felt, ord })),
    });
    forrigeBunn = Math.max(...ord.map((o) => o.yMax));
  }
  return ut;
}

/**
 * Høyrekanten hver kolonne faktisk bruker - den bredeste linjen som forekommer i den.
 * Den ligger konsekvent 11 punkter til venstre for neste kolonnes start, altså på
 * celleinnrykket, så den er kanten og ikke bare den lengste tilfeldigheten.
 */
function høyrekanter(sider: ReturnType<typeof linjerPåSide>[]): Map<Felt, number> {
  const kant = new Map<Felt, number>();
  for (const side of sider) {
    for (const rad of side) {
      for (const linje of rad.linjer) {
        const xMax = Math.max(...linje.ord.map((o) => o.xMax));
        kant.set(linje.felt, Math.max(kant.get(linje.felt) ?? 0, xMax));
      }
    }
  }
  return kant;
}

const kolonnestart = (felt: Felt) => KOLONNER.find((k) => k.felt === felt)!.x;

/**
 * Breddene til Helvetica/Arial, i tusendels em. Trengs for å vite om det var plass til
 * én bokstav til på en linje - og der er gjennomsnittsbredden ubrukelig: «l» er 222 og
 * «m» er 833, nesten fire ganger så bred.
 *
 * Bare tegn som kan starte fortsettelsen av et kappet ord står her; resten faller på
 * standardverdien. Punktstørrelsen gjettes ikke, den måles av dokumentet selv.
 */
const TEGNBREDDER: Record<string, number> = {
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222,
  j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333,
  s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  æ: 1000, ø: 611, å: 556,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556,
  "7": 556, "8": 556, "9": 556,
  ".": 278, ",": 278, "-": 333, "(": 333, ")": 333, "/": 278, "§": 556,
};
const STANDARD_TEGNBREDDE = 556;

/**
 * Punktstørrelsen tabellen er satt i, målt som medianen av «hvor bred ble ordet» delt
 * på «hvor bred sier metrikken at det er». Medianen tåler at et og annet ord har et
 * tegn som ikke står i tabellen.
 */
function punktstørrelse(ord: Ord[]): number {
  const forhold: number[] = [];
  for (const o of ord) {
    if (o.tekst.length < 4) continue;
    let em = 0;
    for (const tegn of o.tekst.toLowerCase()) {
      em += TEGNBREDDER[tegn] ?? STANDARD_TEGNBREDDE;
    }
    if (em > 0) forhold.push(((o.xMax - o.x) / em) * 1000);
  }
  forhold.sort((a, b) => a - b);
  return forhold[Math.floor(forhold.length / 2)] ?? 9;
}

/**
 * Setter cellas linjer sammen til én tekst.
 *
 * De smale kolonnene kapper ord på midten uten bindestrek - «Barneomsorgsa» + «ttest» -
 * så et blindt mellomrom mellom linjene er feil. Nøkkelen er hvordan Word kapper: et ord
 * kappes bare når det ikke får plass på en tom linje, og da flyttes det først ned til en
 * egen linje og fylles derfra. Hodet i et kappet ord står altså alltid alene, helt til
 * venstre i cella, og strekker seg til kanten. Alle tre må stemme:
 *
 *   - linjen som slutter har bare det ene ordet, og det starter i venstrekanten,
 *   - det er ikke plass til én bokstav til av det neste ordet, og
 *   - ordet satt sammen igjen er bredere enn cella, så det aldri kunne stått samlet.
 *
 * «Bekreftelse fra» + «Barneombudet» faller på den første: «fra» deler linje med
 * «Bekreftelse», så ordet under er et helt ord som bare ikke fikk plass.
 */
function slåSammen(linjer: Cellelinje[], kant: number, felt: Felt, pt: number): string {
  const bredde = kant - kolonnestart(felt);
  const tekst = (linje: Cellelinje) => linje.ord.map((o) => o.tekst).join(" ");

  let ut = "";
  for (const [i, linje] of linjer.entries()) {
    if (i === 0) {
      ut = tekst(linje);
      continue;
    }
    const forrige = linjer[i - 1];
    const siste = forrige.ord[forrige.ord.length - 1];
    const neste = linje.ord[0];
    const plassIgjen = kant - siste.xMax;
    const bokstavbredde =
      ((TEGNBREDDER[neste.tekst[0].toLowerCase()] ?? STANDARD_TEGNBREDDE) * pt) / 1000;
    const kappetOrd =
      forrige.ord.length === 1 &&
      siste.x <= kolonnestart(felt) + 1 &&
      plassIgjen < bokstavbredde &&
      siste.xMax - siste.x + (neste.xMax - neste.x) > bredde;
    // Word deler også på en bindestrek som allerede står der. «§ 12-» + «2» er ett
    // paragrafnummer; «musikk-» + «og» er to ord, og det er sifferet som skiller dem.
    const kappetBindestrek = /-$/.test(siste.tekst) && /^\d/.test(neste.tekst);

    ut += kappetOrd || kappetBindestrek ? tekst(linje) : ` ${tekst(linje)}`;
  }
  return ut.replace(/\s+/g, " ").trim();
}

function lagId(kategori: string, formaal: string, brukte: Set<string>): string {
  const grunn =
    `${kategori}-${formaal}`
      .toLowerCase()
      .replace(/æ/g, "ae")
      .replace(/ø/g, "oe")
      .replace(/å/g, "aa")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "formaal";
  let id = grunn;
  let n = 2;
  while (brukte.has(id)) id = `${grunn}-${n++}`;
  brukte.add(id);
  return id;
}

function parse(xml: string): Formaal[] {
  const rå = lesSider(xml);
  const pt = punktstørrelse(rå.flat());
  const sider = rå.map(linjerPåSide);
  const kant = høyrekanter(sider);

  // Rådataene: hver rad som en liste cellelinjer, på tvers av sider.
  const rader: Cellelinje[][] = [];
  for (const side of sider) {
    for (const [i, linje] of side.entries()) {
      // Første rad på en side står alltid øverst, så y-avstanden sier ingenting om den
      // er ny. En fortsettelse ville manglet både kategori og formål; det gjør ingen her.
      const fortsetter =
        i === 0 && rader.length > 0 && !linje.linjer.some((l) => l.felt === "kategori");
      if (linje.nyRad && !fortsetter) rader.push([]);
      rader[rader.length - 1]?.push(...linje.linjer);
    }
  }

  const brukte = new Set<string>();
  const ut: Formaal[] = [];
  for (const rad of rader) {
    const celle = (felt: Felt) =>
      slåSammen(
        rad.filter((l) => l.felt === felt),
        kant.get(felt) ?? Infinity,
        felt,
        pt,
      );

    const kategori = celle("kategori");
    const formaal = celle("formaal");
    const hjemmel = celle("hjemmel");
    // Overskriftsraden ser ut som en rad, men er ikke det.
    if (kategori === "Kategori" || !formaal || !hjemmel) continue;

    ut.push({
      id: lagId(kategori, formaal, brukte),
      kategori,
      formaal,
      beskrivelse: celle("beskrivelse"),
      hjemmel,
      attesttype: celle("attesttype"),
      bekreftelse: celle("bekreftelse"),
    });
  }
  return ut;
}

const pdf = process.argv[2] ?? STANDARD_PDF;
const formaal = parse(pdfTilXml(pdf));
writeFileSync(UT, `${JSON.stringify(formaal, null, 2)}\n`, "utf8");

const kategorier = new Set(formaal.map((f) => f.kategori));
const attesttyper = new Set(formaal.map((f) => f.attesttype));
console.log(`${formaal.length} formål i ${kategorier.size} kategorier -> ${UT}`);
console.log(`Attesttyper: ${[...attesttyper].sort().join(" | ")}`);
