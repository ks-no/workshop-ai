#!/usr/bin/env node

/**
 * Keeps the specs and the code in step, by comparing them. It fails on:
 *
 *   1. a duplicate path key - YAML keeps the last and drops the first without a
 *      word, so this has to be caught on text level, before a parser collapses them
 *   2. a route in the code that the spec does not document
 *   3. a path in the spec that the code does not serve
 *   4. a method the code does not have on a path it does document
 *   5. an operation with no `security:` - neither its own nor a document default
 *   6. a security requirement that disagrees with the route's tilgang or scope
 *   7. an enum in the spec that has drifted from the kodeverk in the code
 *   8. a service in apps/shared/tjenester.json that this list disagrees with
 *
 * The spec is read by apps/shared/openapi.ts, which every service also serves
 * from GET /openapi-ruter.json. One reader, two consumers: what the gate compares
 * against the code is the same text the API explorer renders.
 *
 * There is no YAML parser there and there is not going to be one: the sandbox does
 * not add runtime dependencies, and for check 1 a parser would actively be in the way.
 *
 * Path parameters are compared by position, not by name: the code's regexes carry
 * no parameter names at all, so `/fiks/samtykke/([^/]+)` and
 * `/fiks/samtykke/{samtykkeId}` both normalise to `/fiks/samtykke/{}`.
 *
 * Usage:
 *   pnpm test:openapi            # all services
 *   pnpm test:openapi fiks       # only services matching the argument
 *   pnpm test:openapi --vis      # print the routes the code actually serves
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSpec } from "../apps/shared/openapi.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTTP_METODER = ["get", "post", "put", "patch", "delete", "head", "options"];

type Rute = {
  metode: string;
  sti: string;
  /** Tilgangsband fra koden, der koden har et. Se autentisering.ts. */
  tilgang?: string;
  scope?: string;
};

type Tjeneste = {
  navn: string;
  spesifikasjon: string;
  /** Kilden rutene skannes ut av, for tjenestene uten rutetabell. */
  kilde?: string;
  /** Tjenester med rutetabell oppgir den i stedet, og slipper skanningen. */
  ruter?: () => Promise<Rute[]>;
  /**
   * Ruter som med vilje ikke hører i en API-spesifikasjon. Hver må ha en grunn,
   * og grunnen skrives ut - en utelatelse ingen ser er ikke en avgrensning, den
   * er et hull.
   */
  utenfor?: Record<string, string>;
  /**
   * Linjer med url.pathname som ikke er en ruteerklæring. Uten denne listen måtte
   * skanneren gjette, og en rute skrevet på en form den ikke kjenner ville blitt
   * borte i stillhet. Nå må den føres opp her, med vitende og vilje.
   */
  ikkeRuter?: string[];
  /**
   * Kodeverk spesifikasjonen gjentar, og som derfor kan komme ut av takt med
   * koden. En enum i en spesifikasjon er en tredje sannhet ved siden av
   * tilstandsmaskinen og informasjonsmodellen - den skal måles mot kilden.
   */
  kodeverk?: { skjema: string; verdier: () => Promise<readonly string[]> }[];
  /**
   * Nøstede kodeverk, målt mot verdiene dataene faktisk bruker. Relasjonen er
   * inneslutning, ikke likhet: spesifikasjonen får lov til å tillate mer enn
   * seeden inneholder (MEDMOR finnes i modellen og ikke i dataene), men aldri
   * mindre - en verdi i dataene som spesifikasjonen ikke kjenner er en kontrakt
   * som lyver.
   */
  datakodeverk?: {
    skjema: string;
    felt: string;
    verdier: () => Promise<readonly (string | null)[]>;
  }[];
};

/** Et datasett fra data/, for kodeverk som bare finnes der. */
async function lesData(fil: string): Promise<any> {
  return JSON.parse(await readFile(path.join(repoRoot, "data", fil), "utf8"));
}

// --- spesifikasjonen ------------------------------------------------------

/** Skjemablokka til `Person:` i components.schemas, uten resten av filen. */
function skjemablokk(tekst: string, skjema: string): string | null {
  const start = tekst.indexOf(`\n    ${skjema}:\n`);
  if (start === -1) return null;
  // Etter skjemaets egen linje, ellers treffer søket under seg selv.
  const rest = tekst.slice(tekst.indexOf("\n", start + 1) + 1);
  const neste = rest.search(/^ {4}\w+:$/m);
  return neste === -1 ? rest : rest.slice(0, neste);
}

/** `enum: [A, B, C]` på skjemaets eget øverste nivå. */
function readEnum(tekst: string, skjema: string): string[] | null {
  const blokk = skjemablokk(tekst, skjema);
  if (blokk === null) return null;
  const treff = blokk.match(/^ {6}enum: \[([^\]]*)\]/m);
  return treff ? treff[1].split(",").map((verdi) => verdi.trim()).filter(Boolean) : null;
}

/**
 * `enum:` under et navngitt felt inne i et skjema, uansett hvor dypt.
 *
 * Dette manglet, og det er derfor `Person.foreldrebarnrelasjon.relasjon` kunne stå
 * som `[BARN, FAR, MOR, MEDMOR]` i spesifikasjonen mens dataene skrev `FORELDER` -
 * readEnum så bare skjemaets øverste nivå, så nøstede kodeverk var utenfor
 * rekkevidde for enhver sjekk.
 */
function readNestedEnum(tekst: string, skjema: string, felt: string): string[] | null {
  const blokk = skjemablokk(tekst, skjema);
  if (blokk === null) return null;
  const feltTreff = blokk.match(new RegExp(`^(\\s+)${felt}:\\s*$`, "m"));
  if (!feltTreff) return null;
  const innrykk = feltTreff[1].length;
  const etter = blokk.slice(feltTreff.index! + feltTreff[0].length);
  for (const linje of etter.split("\n")) {
    const eget = linje.match(/^(\s*)\S/);
    if (!eget) continue;
    // Tilbake på feltets eget nivå eller grunnere: feltet er ferdig.
    if (eget[1].length <= innrykk) return null;
    const enumTreff = linje.match(/^\s+enum: \[([^\]]*)\]/);
    if (enumTreff) {
      return enumTreff[1].split(",").map((verdi) => verdi.trim()).filter(Boolean);
    }
  }
  return null;
}

// --- koden ----------------------------------------------------------------

/** `/fiks/samtykke/{samtykkeId}` og `/fiks/samtykke/([^/]+)` blir samme sti. */
function normalize(sti: string) {
  return sti.replace(/\{[^}]*\}/g, "{}").replace(/:([A-Za-z]+)/g, "{}");
}

/**
 * A path regex from the source, as a path. Anything left that a URL cannot
 * contain literally means the pattern was not understood, and then this returns
 * null rather than guessing - an unparsed route has to become an error, never a
 * silently missing one.
 */
function pathFromRegex(moenster: string): string | null {
  const sti = moenster
    .replace(/^\^/, "")
    .replace(/\$$/, "")
    .replace(/\\\//g, "/")
    .replace(/\(\[\^\\?\/\]\+\)/g, "{}");
  return /[()[\]^$*+?\\]/.test(sti) ? null : sti;
}

function scanRoutes(kilde: string, tjeneste: Tjeneste) {
  const ruter: Rute[] = [];
  const uparsede: string[] = [];

  // const X = "..."  og  const X = ["...", "..."] - matrikkel-mock legger stien
  // sin i en konstant, og ai-gateway legger fem stier i en liste.
  const strenger = new Map<string, string[]>();
  for (const treff of kilde.matchAll(/^const (\w+) = "([^"]+)";$/gm)) {
    strenger.set(treff[1], [treff[2]]);
  }
  for (const treff of kilde.matchAll(/^\s*const (\w+) = \[((?:\s*"[^"]+",?)+)\];$/gm)) {
    strenger.set(treff[1], [...treff[2].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  }

  // const xTreff = url.pathname.match(/.../);  - kan gå over flere linjer.
  const moenstre = new Map<string, string>();
  // The declaration lines themselves are not routes - the route is the `if` that
  // uses the variable further down - so they are noted here and skipped below.
  const deklarasjoner = new Set<number>();
  for (const treff of kilde.matchAll(/const (\w+) = url\.pathname\.match\(\s*\/([^\n]+?)\/\s*\)/g)) {
    moenstre.set(treff[1], treff[2]);
    const foer = kilde.slice(0, treff.index);
    deklarasjoner.add(foer.split("\n").length);
  }

  // const sti = url.pathname;  - digdir-mock names the path once and compares the
  // name from there on. The shape belongs in this scanner, not in ikkeRuter: with
  // the alias unknown, all eleven of its routes were invisible and the check would
  // have reported "0 ruter i koden" - failing loudly, but pointing at the wrong
  // thing. Teaching the shape makes it robust for the next service that writes
  // its routes this way.
  const aliaser: string[] = [];
  // [^\S\n] og ikke \s: \s matcher linjeskift, så ^ kunne feste seg på en blank
  // linje over, og treff.index pekte på den i stedet for på deklarasjonen.
  for (const treff of kilde.matchAll(/^[^\S\n]*const (\w+) = url\.pathname;[^\S\n]*$/gm)) {
    aliaser.push(treff[1]);
    deklarasjoner.add(kilde.slice(0, treff.index).split("\n").length);
  }
  const alias = aliaser.length ? new RegExp(`\\b(?:${aliaser.join("|")})\\b`, "g") : null;

  const linjer = kilde.split("\n");
  linjer.forEach((linje, indeks) => {
    // The line as the matchers below want to see it. The original is kept for the
    // ikkeRuter lookup and for the error message: both have to speak about the
    // source as it is written.
    const rutelinje = alias ? linje.replace(alias, "url.pathname") : linje;
    const metoder = [...rutelinje.matchAll(/request\.method === "([A-Z]+)"/g)].map((m) => m[1]);
    let traff = false;

    // if (request.method === "X" && xTreff)
    for (const [navn, moenster] of moenstre) {
      if (!new RegExp(`&&\\s*${navn}\\b|\\b${navn}\\s*&&`).test(rutelinje)) continue;
      const sti = pathFromRegex(moenster);
      if (!sti) {
        uparsede.push(`${indeks + 1}: kunne ikke tolke mønsteret /${moenster}/`);
        traff = true;
        continue;
      }
      for (const metode of metoder.length ? metoder : ["GET"]) {
        ruter.push({ metode, sti });
      }
      traff = true;
    }

    // url.pathname === "/x"  og  url.pathname === KONSTANT
    for (const treff of rutelinje.matchAll(/url\.pathname === (?:"([^"]+)"|(\w+))/g)) {
      const stier = treff[1] ? [treff[1]] : strenger.get(treff[2]);
      if (!stier) {
        uparsede.push(`${indeks + 1}: kjenner ikke konstanten ${treff[2]}`);
        traff = true;
        continue;
      }
      for (const sti of stier) {
        for (const metode of metoder.length ? metoder : ["GET"]) {
          ruter.push({ metode, sti });
        }
      }
      traff = true;
    }

    // LISTE.includes(url.pathname)
    for (const treff of rutelinje.matchAll(/(\w+)\.includes\(url\.pathname\)/g)) {
      const stier = strenger.get(treff[1]);
      if (!stier) {
        uparsede.push(`${indeks + 1}: kjenner ikke listen ${treff[1]}`);
        traff = true;
        continue;
      }
      for (const sti of stier) {
        for (const metode of metoder.length ? metoder : ["GET"]) {
          ruter.push({ metode, sti });
        }
      }
      traff = true;
    }

    if (traff || !rutelinje.includes("url.pathname") || deklarasjoner.has(indeks + 1)) return;
    // A url.pathname the scanner did not recognise. Either it is a route written
    // in a new shape - and then the shape belongs in this scanner - or it is not
    // a route, and then it belongs in ikkeRuter with a reason.
    if ((tjeneste.ikkeRuter || []).some((utdrag) => linje.includes(utdrag))) return;
    uparsede.push(`${indeks + 1}: ${linje.trim()}`);
  });

  return { ruter, uparsede };
}

// --- tjenestene -----------------------------------------------------------

async function backendRuter(): Promise<Rute[]> {
  const { ruter, systemruter } = await import("../apps/sandbox-backend/src/routes.ts");
  const { ressurser } = await import("../apps/sandbox-backend/src/ressurser.ts");
  const { SCOPE_LES } = await import("../apps/sandbox-backend/src/autentisering.ts");
  return [...systemruter, ...ruter, ...ressurser].map((rute: any) => ({
    metode: rute.metode,
    sti: rute.sti,
    // Absent means the closed default, both here and in the code. See Rute.
    tilgang: rute.tilgang ?? "egne-data",
    scope: rute.scope ?? SCOPE_LES
  }));
}

const tjenester: Tjeneste[] = [
  {
    navn: "sandbox-backend",
    spesifikasjon: "openapi/sandbox-backend.yaml",
    ruter: backendRuter,
    // Forsendelsesstatus står i to spesifikasjoner fordi to tjenester svarer med
    // det: fiks-simulator utleder statusen, og sandbox-backend proxer den videre
    // til søknadens eier. Kopien er greit så lenge den er portet - begge måles mot
    // den ene kodeverkslisten i koden.
    kodeverk: [
      {
        skjema: "Forsendelsesstatus",
        verdier: async () =>
          (await import("../apps/fiks-simulator/src/forsendelse.ts")).FORSENDELSESSTATUSER
      }
    ],
    // Kodeverk som bare finnes i dataene, ikke som en konstant i koden. Sjekk 7
    // over sammenligner mot en eksportert liste; disse har ingen, så de måles mot
    // seeden. Det er nettopp disse som hadde driftet: relasjon sto som
    // [BARN, FAR, MOR, MEDMOR] mens dataene skrev FORELDER, og rolle manglet
    // voksen.
    datakodeverk: [
      {
        skjema: "Person",
        felt: "personstatus",
        verdier: async () => (await lesData("personer.json")).map((p: any) => p.personstatus)
      },
      {
        skjema: "Person",
        felt: "sivilstand",
        verdier: async () => (await lesData("personer.json")).map((p: any) => p.sivilstand)
      },
      {
        skjema: "Person",
        felt: "rolle",
        verdier: async () => (await lesData("personer.json")).map((p: any) => p.rolle)
      },
      {
        skjema: "Person",
        felt: "foreldreansvar",
        verdier: async () => (await lesData("personer.json")).map((p: any) => p.foreldreansvar)
      },
      {
        skjema: "Person",
        felt: "relasjon",
        verdier: async () =>
          (await lesData("personer.json")).flatMap((p: any) =>
            (p.foreldrebarnrelasjon || []).map((r: any) => r.relasjon)
          )
      },
      {
        skjema: "Husstand",
        felt: "rolle",
        verdier: async () =>
          (await lesData("husstander.json")).flatMap((h: any) =>
            h.medlemmer.map((m: any) => m.rolle)
          )
      }
    ]
  },
  {
    navn: "fiks-simulator",
    spesifikasjon: "openapi/fiks-simulator.yaml",
    kilde: "apps/fiks-simulator/src/server.ts",
    kodeverk: [
      {
        skjema: "Samtykkestatus",
        verdier: async () => (await import("../apps/shared/samtykke.ts")).SAMTYKKESTATUSER
      },
      {
        skjema: "Oppgavestatus",
        verdier: async () => (await import("../apps/fiks-simulator/src/oppgave.ts")).OPPGAVESTATUSER
      },
      {
        skjema: "Forsendelsesstatus",
        verdier: async () =>
          (await import("../apps/fiks-simulator/src/forsendelse.ts")).FORSENDELSESSTATUSER
      },
      {
        skjema: "Informasjonsdel",
        verdier: async () =>
          (await import("../apps/fiks-simulator/src/folkeregister.ts")).INFORMASJONSDELER
      }
    ]
  },
  {
    navn: "ai-gateway",
    spesifikasjon: "openapi/ai-gateway.yaml",
    kilde: "apps/ai-gateway/src/server.ts",
    utenfor: {
      "/assets/felles.css": "statisk stilark for /docs, ikke et API"
    },
    ikkeRuter: [
      // Plukker oppgavetypen ut av stien inne i handleren; ruten er allerede
      // fanget av gyldigeStier.includes(url.pathname) på linjen over.
      'url.pathname.replace("/ai/", "")'
    ]
  },
  {
    navn: "tools-api",
    spesifikasjon: "openapi/tools-api.yaml",
    kilde: "apps/tools-api/src/server.ts"
  },
  {
    navn: "process-agent",
    spesifikasjon: "openapi/process-agent.yaml",
    kilde: "apps/process-agent/src/server.ts"
  },
  {
    navn: "matrikkel-mock",
    spesifikasjon: "openapi/matrikkel-mock.yaml",
    kilde: "apps/matrikkel-mock/src/server.ts"
  },
  {
    navn: "pasientjournal-mock",
    spesifikasjon: "openapi/pasientjournal-mock.yaml",
    kilde: "apps/pasientjournal-mock/src/server.ts",
    // De to kodeverkene i apps/shared/legeerklaering.ts, målt mot unionene i koden
    // og ikke mot verdiene seeden tilfeldigvis bruker. Seeden holdes mot de samme
    // unionene av pnpm test, så en verdi ingen rad bruker enda blir også fanget.
    datakodeverk: [
      {
        skjema: "Legeerklaering",
        felt: "funksjonsnedsetting",
        verdier: async () => (await import("../apps/shared/legeerklaering.ts")).FUNKSJONSNEDSETTINGER
      },
      {
        skjema: "Legeerklaering",
        felt: "hjelpemiddel",
        verdier: async () => (await import("../apps/shared/legeerklaering.ts")).HJELPEMIDLER
      }
    ]
  },
  {
    navn: "politiattest-mock",
    spesifikasjon: "openapi/politiattest-mock.yaml",
    kilde: "apps/politiattest-mock/src/server.ts",
    // De fire kodeverkene i apps/shared/politiattest.ts, målt mot unionene i koden.
    datakodeverk: [
      {
        skjema: "Politiattest",
        felt: "formaal",
        verdier: async () => (await import("../apps/shared/politiattest.ts")).ATTESTFORMAAL
      },
      {
        skjema: "Politiattest",
        felt: "attesttype",
        verdier: async () => (await import("../apps/shared/politiattest.ts")).ATTESTTYPER
      },
      {
        skjema: "Politiattest",
        felt: "kategori",
        verdier: async () => (await import("../apps/shared/politiattest.ts")).ANMERKNINGSKATEGORIER
      },
      {
        skjema: "Politiattest",
        felt: "reaksjon",
        verdier: async () => (await import("../apps/shared/politiattest.ts")).REAKSJONER
      }
    ]
  },
  {
    navn: "digdir-mock",
    spesifikasjon: "openapi/digdir-mock.yaml",
    kilde: "apps/digdir-mock/src/server.ts",
    ikkeRuter: [
      // 404-meldingen gjentar stien for at den skal stå i svaret. Ikke en rute.
      "`Fant ikke ${request.method} ${sti}. Se GET /docs.`"
    ]
  }
];

// --- sjekken --------------------------------------------------------------

const filter = process.argv.slice(2).filter((argument) => !argument.startsWith("-"));
const show = process.argv.includes("--vis");
const feil: string[] = [];
const notater: string[] = [];

// 8. Registeret og denne listen skal beskrive de samme tjenestene.
//
// apps/shared/tjenester.json er det dashboardet og API-utforskeren leser. Listen
// her kan ikke slås sammen med den: oppføringene under bærer `kilde`, `ikkeRuter`
// og `utenfor` - unntak som bare denne porten har bruk for. Men navnene skal stemme,
// ellers får en ny tjeneste spesifikasjon uten å dukke opp for deltakerne, eller
// omvendt.
const registeret: { navn: string; spesifikasjon: boolean }[] = JSON.parse(
  await readFile(path.join(repoRoot, "apps/shared/tjenester.json"), "utf8")
);
const iRegisteret = registeret.filter((t) => t.spesifikasjon).map((t) => t.navn).sort();
const iLista = tjenester.map((t) => t.navn).sort();
if (iRegisteret.join(",") !== iLista.join(",")) {
  const mangler = iLista.filter((n) => !iRegisteret.includes(n));
  const ekstra = iRegisteret.filter((n) => !iLista.includes(n));
  feil.push(
    "apps/shared/tjenester.json er ikke enig med tjenester-listen i dette skriptet." +
      (mangler.length ? `\n    Mangler i registeret med spesifikasjon: true: ${mangler.join(", ")}` : "") +
      (ekstra.length ? `\n    Star i registeret, men ikke i listen her: ${ekstra.join(", ")}` : "")
  );
}

for (const tjeneste of tjenester) {
  if (filter.length && !filter.some((m) => tjeneste.navn.includes(m))) continue;

  const spec = readSpec(
    await readFile(path.join(repoRoot, tjeneste.spesifikasjon), "utf8"),
    tjeneste.spesifikasjon
  );

  // 1. Duplikate path-nøkler. YAML tar den siste og kaster den første i stillhet.
  const seenPaths = new Set<string>();
  for (const sti of spec.order) {
    if (seenPaths.has(sti)) {
      feil.push(`${tjeneste.spesifikasjon}: path-nøkkelen ${sti} står oppført to ganger. YAML beholder den siste og kaster den første uten et ord.`);
    }
    seenPaths.add(sti);
  }

  let ruter: Rute[];
  if (tjeneste.ruter) {
    ruter = await tjeneste.ruter();
  } else {
    const kilde = await readFile(path.join(repoRoot, tjeneste.kilde!), "utf8");
    const scanned = scanRoutes(kilde, tjeneste);
    for (const linje of scanned.uparsede) {
      feil.push(
        `${tjeneste.kilde}:${linje}\n    Skanneren kjente ikke igjen denne bruken av url.pathname. Er det en rute, ` +
        `hører formen i scripts/sjekk-openapi-dekning.ts; er det ikke en rute, hører linjen i ikkeRuter med en grunn.`
      );
    }
    ruter = scanned.ruter;
  }

  const utenfor = tjeneste.utenfor || {};
  for (const [sti, grunn] of Object.entries(utenfor)) {
    notater.push(`${tjeneste.navn}: ${sti} er holdt utenfor spesifikasjonen - ${grunn}`);
  }

  // 2 og 4. Hver rute i koden skal finnes i spesifikasjonen, med riktig metode.
  const iSpec = new Map<string, Set<string>>();
  for (const sti of spec.paths) {
    const noekkel = normalize(sti.path);
    if (!iSpec.has(noekkel)) iSpec.set(noekkel, new Set());
    for (const operasjon of sti.operations) {
      iSpec.get(noekkel)!.add(operasjon.metode);
    }
  }

  const iKode = new Map<string, Set<string>>();
  for (const rute of ruter) {
    if (utenfor[rute.sti]) continue;
    const noekkel = normalize(rute.sti);
    if (!iKode.has(noekkel)) iKode.set(noekkel, new Set());
    iKode.get(noekkel)!.add(rute.metode.toUpperCase());
  }

  for (const [sti, metoder] of iKode) {
    if (!iSpec.has(sti)) {
      feil.push(`${tjeneste.spesifikasjon}: mangler ${[...metoder].sort().join("/")} ${sti}, som finnes i koden.`);
      continue;
    }
    for (const metode of metoder) {
      if (!iSpec.get(sti)!.has(metode)) {
        feil.push(
          `${tjeneste.spesifikasjon}: ${sti} er dokumentert med ${[...iSpec.get(sti)!].sort().join("/") || "ingen metode"}, ` +
          `men koden svarer på ${metode}.`
        );
      }
    }
  }

  // 3. Og ingenting i spesifikasjonen som koden ikke har.
  for (const [sti, metoder] of iSpec) {
    if (!iKode.has(sti)) {
      feil.push(`${tjeneste.spesifikasjon}: dokumenterer ${[...metoder].sort().join("/")} ${sti}, som koden ikke svarer på.`);
      continue;
    }
    for (const metode of metoder) {
      if (!iKode.get(sti)!.has(metode)) {
        feil.push(`${tjeneste.spesifikasjon}: dokumenterer ${metode} ${sti}, som koden ikke svarer på.`);
      }
    }
  }

  // 5 og 6. Hjemmel per rute, avledet av tilgangsbandet i koden.
  const bandFor = new Map<string, Rute>();
  for (const rute of ruter) {
    if (rute.tilgang) bandFor.set(`${rute.metode.toUpperCase()} ${normalize(rute.sti)}`, rute);
  }

  for (const sti of spec.paths) {
    for (const operasjon of sti.operations) {
      if (operasjon.security === null && !spec.documentSecurity) {
        feil.push(
          `${tjeneste.spesifikasjon}:${operasjon.linje}: ${operasjon.metode} ${sti.path} mangler security:. ` +
          `Åpne ruter skal ha «security: []» eksplisitt, slik at fraværet ikke leses som en glipp.`
        );
        continue;
      }
      const rute = bandFor.get(`${operasjon.metode} ${normalize(sti.path)}`);
      if (!rute || operasjon.security === null) continue;

      if (rute.tilgang === "aapen" && operasjon.security.length > 0) {
        feil.push(
          `${tjeneste.spesifikasjon}:${operasjon.linje}: ${operasjon.metode} ${sti.path} krever ` +
          `${operasjon.security.join("/")}, men tilgangsbandet i koden er «aapen».`
        );
      }
      if (rute.tilgang !== "aapen" && operasjon.security.length === 0) {
        feil.push(
          `${tjeneste.spesifikasjon}:${operasjon.linje}: ${operasjon.metode} ${sti.path} er dokumentert som åpen, ` +
          `men tilgangsbandet i koden er «${rute.tilgang}».`
        );
      }
      if (rute.tilgang === "bred" && operasjon.security.includes("idporten")) {
        feil.push(
          `${tjeneste.spesifikasjon}:${operasjon.linje}: ${operasjon.metode} ${sti.path} er i bandet «bred», ` +
          `som ingen innbygger kan åpne. Da skal bare maskinporten stå der.`
        );
      }
      if (operasjon.security.includes("maskinporten") && rute.scope && !operasjon.scopes.includes(rute.scope)) {
        feil.push(
          `${tjeneste.spesifikasjon}:${operasjon.linje}: ${operasjon.metode} ${sti.path} oppgir scope ` +
          `${operasjon.scopes.join(", ") || "ingen"}, men koden krever ${rute.scope}.`
        );
      }
    }
  }

  if (show) {
    for (const [sti, metoder] of [...iKode].sort()) {
      const rute = ruter.find((kandidat) => normalize(kandidat.sti) === sti);
      const band = rute?.tilgang ? `  [${rute.tilgang}${rute.scope ? ` ${rute.scope}` : ""}]` : "";
      console.log(`  ${[...metoder].sort().join(",").padEnd(8)} ${sti}${band}`);
    }
  }

  // 7. Kodeverk spesifikasjonen gjentar.
  const tekst = await readFile(path.join(repoRoot, tjeneste.spesifikasjon), "utf8");
  for (const kodeverk of tjeneste.kodeverk || []) {
    const dokumentert = readEnum(tekst, kodeverk.skjema);
    const ikode = [...(await kodeverk.verdier())];
    if (!dokumentert) {
      feil.push(`${tjeneste.spesifikasjon}: fant ingen enum under skjemaet ${kodeverk.skjema}.`);
      continue;
    }
    if (JSON.stringify(dokumentert) !== JSON.stringify(ikode)) {
      feil.push(
        `${tjeneste.spesifikasjon}: ${kodeverk.skjema} lister ${JSON.stringify(dokumentert)}, ` +
        `men kodeverket i koden er ${JSON.stringify(ikode)}.`
      );
    }
  }

  // 9. Nøstede kodeverk mot verdiene dataene faktisk bruker.
  for (const kodeverk of tjeneste.datakodeverk || []) {
    const dokumentert = readNestedEnum(tekst, kodeverk.skjema, kodeverk.felt);
    if (!dokumentert) {
      feil.push(
        `${tjeneste.spesifikasjon}: fant ingen enum under ${kodeverk.skjema}.${kodeverk.felt}.`
      );
      continue;
    }
    const iDataene = [...new Set((await kodeverk.verdier()).map((v) => (v === null ? "null" : v)))];
    const ukjente = iDataene.filter((verdi) => !dokumentert.includes(verdi));
    if (ukjente.length > 0) {
      feil.push(
        `${tjeneste.spesifikasjon}: ${kodeverk.skjema}.${kodeverk.felt} lister ` +
        `${JSON.stringify(dokumentert)}, men dataene bruker ${JSON.stringify(ukjente)} ` +
        `i tillegg. Spesifikasjonen er kontrakten - den kan tillate mer enn seeden ` +
        `inneholder, aldri mindre.`
      );
    }
  }

  const operationCount = spec.paths.reduce((sum, sti) => sum + sti.operations.length, 0);
  console.log(
    `${tjeneste.navn.padEnd(16)} ${String(iKode.size).padStart(3)} stier i koden, ` +
    `${String(iSpec.size).padStart(3)} i spesifikasjonen, ${operationCount} operasjoner`
  );
}

for (const notat of notater) {
  console.log(`  merk: ${notat}`);
}

if (feil.length > 0) {
  console.error(`\n${feil.length} avvik mellom kode og spesifikasjon:`);
  for (const linje of feil) console.error(`  - ${linje}`);
  process.exit(1);
}
console.log("\nSpesifikasjonene stemmer med koden.");
