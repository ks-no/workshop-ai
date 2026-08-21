#!/usr/bin/env node

/**
 * Holder spesifikasjonene og koden i takt.
 *
 * The specs used to be aspirational. sandbox-backend.yaml had two path keys listed
 * twice — YAML keeps the last and drops the first without a word, so the file
 * looked like it had 28 paths where it had 30 entries. fiks-simulator.yaml
 * documented 4 of 19 routes, and its README promised POST where the code answers
 * PUT. Nothing could catch any of it, because nothing compared the two.
 *
 * This does, and it fails on:
 *
 *   1. a duplicate path key (has to be caught on text level — a parser collapses
 *      them before anyone gets to see them)
 *   2. a route in the code that the spec does not document
 *   3. a path in the spec that the code does not serve
 *   4. a method the code does not have on a path it does document
 *   5. an operation with no `security:` — neither its own nor a document default
 *   6. a security requirement that disagrees with the route's tilgang or scope
 *   7. an enum in the spec that has drifted from the kodeverk in the code
 *
 * There is no YAML parser here and there is not going to be one: the sandbox has
 * no runtime dependencies, and for check 1 a parser would actively be in the way.
 *
 * Path parameters are compared by position, not by name: the code's regexes carry
 * no parameter names at all, so `/fiks/samtykke/([^/]+)` and
 * `/fiks/samtykke/{samtykkeId}` both normalise to `/fiks/samtykke/{}`.
 *
 * Usage:
 *   pnpm test:openapi            # alle tjenester
 *   pnpm test:openapi fiks       # bare de som matcher
 *   pnpm test:openapi --vis      # skriv ut rutene koden faktisk har
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTTP_METODER = ["get", "post", "put", "patch", "delete", "head", "options"];

type Rute = {
  metode: string;
  sti: string;
  /** Tilgangsband fra koden, der koden har et. Se autentisering.ts. */
  tilgang?: string;
  scope?: string;
};

type Operasjon = {
  metode: string;
  linje: number;
  security: string[] | null;
  scopes: string[];
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
   * og grunnen skrives ut — en utelatelse ingen ser er ikke en avgrensning, den
   * er et hull.
   */
  utenfor?: Record<string, string>;
  /**
   * Linjer med url.pathname som ikke er en ruteerklæring. Uten denne lista måtte
   * skanneren gjette, og en rute skrevet på en form den ikke kjenner ville blitt
   * borte i stillhet. Nå må den føres opp her, med vitende og vilje.
   */
  ikkeRuter?: string[];
  /**
   * Kodeverk spesifikasjonen gjentar, og som derfor kan komme ut av takt med
   * koden. En enum i en spesifikasjon er en tredje sannhet ved siden av
   * tilstandsmaskinen og informasjonsmodellen — den skal måles mot kilden.
   */
  kodeverk?: { skjema: string; verdier: () => Promise<readonly string[]> }[];
};

// --- spesifikasjonen ------------------------------------------------------

/** `enum: [A, B, C]` under et navngitt skjema i components.schemas. */
function lesEnum(tekst: string, skjema: string): string[] | null {
  const start = tekst.indexOf(`\n    ${skjema}:\n`);
  if (start === -1) return null;
  // Etter skjemaets egen linje, ellers treffer søket under seg selv.
  const rest = tekst.slice(tekst.indexOf("\n", start + 1) + 1);
  const neste = rest.search(/^ {4}\w+:$/m);
  const blokk = neste === -1 ? rest : rest.slice(0, neste);
  const treff = blokk.match(/^ {6}enum: \[([^\]]*)\]/m);
  return treff ? treff[1].split(",").map((verdi) => verdi.trim()).filter(Boolean) : null;
}

function lesSpesifikasjon(tekst: string) {
  const linjer = tekst.split("\n");
  const stier: { sti: string; linje: number; operasjoner: Operasjon[] }[] = [];
  const rekkefoelge: string[] = [];
  let iPaths = false;
  let naavaerende: (typeof stier)[number] | null = null;
  let naavaerendeOperasjon: Operasjon | null = null;
  let securityInnrykk = -1;
  // A document-level `security:` applies to every operation that does not declare
  // its own. Nothing else at the top level is read here.
  let dokumentSecurity = false;

  linjer.forEach((linje, indeks) => {
    if (/^paths:\s*$/.test(linje)) {
      iPaths = true;
      return;
    }
    if (/^security:\s*/.test(linje)) {
      dokumentSecurity = true;
      return;
    }
    if (/^\S/.test(linje) && !/^paths:/.test(linje)) {
      iPaths = false;
    }
    if (!iPaths) return;

    const stiTreff = linje.match(/^ {2}(\/\S*):\s*$/);
    if (stiTreff) {
      naavaerende = { sti: stiTreff[1], linje: indeks + 1, operasjoner: [] };
      naavaerendeOperasjon = null;
      securityInnrykk = -1;
      stier.push(naavaerende);
      rekkefoelge.push(stiTreff[1]);
      return;
    }
    if (!naavaerende) return;

    const metodeTreff = linje.match(/^ {4}([a-z]+):\s*$/);
    if (metodeTreff && HTTP_METODER.includes(metodeTreff[1])) {
      naavaerendeOperasjon = { metode: metodeTreff[1].toUpperCase(), linje: indeks + 1, security: null, scopes: [] };
      securityInnrykk = -1;
      naavaerende.operasjoner.push(naavaerendeOperasjon);
      return;
    }
    if (!naavaerendeOperasjon) return;

    // `security: []` on one line is the explicit "open" marker; a block form
    // follows on the lines below it, indented deeper.
    const tomSecurity = linje.match(/^ {6}security:\s*\[\s*\]\s*$/);
    if (tomSecurity) {
      naavaerendeOperasjon.security = [];
      return;
    }
    if (/^ {6}security:\s*$/.test(linje)) {
      naavaerendeOperasjon.security = [];
      securityInnrykk = 6;
      return;
    }
    if (securityInnrykk >= 0) {
      const innrykk = linje.search(/\S/);
      if (innrykk <= securityInnrykk && linje.trim() !== "") {
        securityInnrykk = -1;
        return;
      }
      // - maskinporten: [ks:innbyggerdialog:les]  eller  - idporten: []
      // eller ordningen på egen linje med scopene under seg.
      const ordning = linje.match(/^\s*- (\w+):\s*(\[([^\]]*)\])?\s*$/);
      if (ordning) {
        naavaerendeOperasjon.security!.push(ordning[1]);
        for (const scope of (ordning[3] || "").split(",")) {
          if (scope.trim()) naavaerendeOperasjon.scopes.push(scope.trim());
        }
        return;
      }
      const scope = linje.match(/^\s*- ([a-z]+:[^\s]+)\s*$/);
      if (scope) {
        naavaerendeOperasjon.scopes.push(scope[1]);
      }
    }
  });

  return { stier, rekkefoelge, dokumentSecurity };
}

// --- koden ----------------------------------------------------------------

/** `/fiks/samtykke/{samtykkeId}` og `/fiks/samtykke/([^/]+)` blir samme sti. */
function normaliser(sti: string) {
  return sti.replace(/\{[^}]*\}/g, "{}").replace(/:([A-Za-z]+)/g, "{}");
}

/**
 * A path regex from the source, as a path. Anything left that a URL cannot
 * contain literally means the pattern was not understood, and then this returns
 * null rather than guessing — an unparsed route has to become an error, never a
 * silently missing one.
 */
function stiFraRegex(moenster: string): string | null {
  const sti = moenster
    .replace(/^\^/, "")
    .replace(/\$$/, "")
    .replace(/\\\//g, "/")
    .replace(/\(\[\^\\?\/\]\+\)/g, "{}");
  return /[()[\]^$*+?\\]/.test(sti) ? null : sti;
}

function skannRuter(kilde: string, tjeneste: Tjeneste) {
  const ruter: Rute[] = [];
  const uparsede: string[] = [];

  // const X = "..."  og  const X = ["...", "..."] — matrikkel-mock legger stien
  // sin i en konstant, og ai-gateway legger fem stier i en liste.
  const strenger = new Map<string, string[]>();
  for (const treff of kilde.matchAll(/^const (\w+) = "([^"]+)";$/gm)) {
    strenger.set(treff[1], [treff[2]]);
  }
  for (const treff of kilde.matchAll(/^\s*const (\w+) = \[((?:\s*"[^"]+",?)+)\];$/gm)) {
    strenger.set(treff[1], [...treff[2].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  }

  // const xTreff = url.pathname.match(/.../);  — kan gå over flere linjer.
  const moenstre = new Map<string, string>();
  // The declaration lines themselves are not routes — the route is the `if` that
  // uses the variable further down — so they are noted here and skipped below.
  const deklarasjoner = new Set<number>();
  for (const treff of kilde.matchAll(/const (\w+) = url\.pathname\.match\(\s*\/([^\n]+?)\/\s*\)/g)) {
    moenstre.set(treff[1], treff[2]);
    const foer = kilde.slice(0, treff.index);
    deklarasjoner.add(foer.split("\n").length);
  }

  const linjer = kilde.split("\n");
  linjer.forEach((linje, indeks) => {
    const metoder = [...linje.matchAll(/request\.method === "([A-Z]+)"/g)].map((m) => m[1]);
    let traff = false;

    // if (request.method === "X" && xTreff)
    for (const [navn, moenster] of moenstre) {
      if (!new RegExp(`&&\\s*${navn}\\b|\\b${navn}\\s*&&`).test(linje)) continue;
      const sti = stiFraRegex(moenster);
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
    for (const treff of linje.matchAll(/url\.pathname === (?:"([^"]+)"|(\w+))/g)) {
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
    for (const treff of linje.matchAll(/(\w+)\.includes\(url\.pathname\)/g)) {
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

    if (traff || !linje.includes("url.pathname") || deklarasjoner.has(indeks + 1)) return;
    // A url.pathname the scanner did not recognise. Either it is a route written
    // in a new shape — and then the shape belongs in this scanner — or it is not
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
    ruter: backendRuter
  },
  {
    navn: "fiks-simulator",
    spesifikasjon: "openapi/fiks-simulator.yaml",
    kilde: "apps/fiks-simulator/src/server.js",
    kodeverk: [
      {
        skjema: "Samtykkestatus",
        verdier: async () => (await import("../apps/fiks-simulator/src/samtykke.ts")).SAMTYKKESTATUSER
      },
      {
        skjema: "Oppgavestatus",
        verdier: async () => (await import("../apps/fiks-simulator/src/oppgave.ts")).OPPGAVESTATUSER
      }
    ]
  },
  {
    navn: "ai-gateway",
    spesifikasjon: "openapi/ai-gateway.yaml",
    kilde: "apps/ai-gateway/src/server.js",
    utenfor: {
      "/assets/felles.css": "statisk stilark for /docs, ikke et API"
    },
    ikkeRuter: [
      // Plukker oppgavetypen ut av stien inne i handleren; ruta er allerede
      // fanget av gyldigeStier.includes(url.pathname) på linja over.
      'url.pathname.replace("/ai/", "")'
    ]
  },
  {
    navn: "mcp-services",
    spesifikasjon: "openapi/mcp-services.yaml",
    kilde: "apps/mcp-services/src/server.js"
  },
  {
    navn: "process-agent",
    spesifikasjon: "openapi/process-agent.yaml",
    kilde: "apps/process-agent/src/server.js"
  },
  {
    navn: "matrikkel-mock",
    spesifikasjon: "openapi/matrikkel-mock.yaml",
    kilde: "apps/matrikkel-mock/src/server.js"
  }
];

// --- sjekken --------------------------------------------------------------

const filter = process.argv.slice(2).filter((argument) => !argument.startsWith("-"));
const vis = process.argv.includes("--vis");
const feil: string[] = [];
const notater: string[] = [];

for (const tjeneste of tjenester) {
  if (filter.length && !filter.some((m) => tjeneste.navn.includes(m))) continue;

  const spec = lesSpesifikasjon(await readFile(path.join(rot, tjeneste.spesifikasjon), "utf8"));

  // 1. Duplikate path-nøkler. YAML tar den siste og kaster den første i stillhet.
  const settSti = new Set<string>();
  for (const sti of spec.rekkefoelge) {
    if (settSti.has(sti)) {
      feil.push(`${tjeneste.spesifikasjon}: path-nøkkelen ${sti} står oppført to ganger. YAML beholder den siste og kaster den første uten et ord.`);
    }
    settSti.add(sti);
  }

  let ruter: Rute[];
  if (tjeneste.ruter) {
    ruter = await tjeneste.ruter();
  } else {
    const kilde = await readFile(path.join(rot, tjeneste.kilde!), "utf8");
    const skannet = skannRuter(kilde, tjeneste);
    for (const linje of skannet.uparsede) {
      feil.push(
        `${tjeneste.kilde}:${linje}\n    Skanneren kjente ikke igjen denne bruken av url.pathname. Er det en rute, ` +
        `hører formen i scripts/sjekk-openapi-dekning.ts; er det ikke en rute, hører linjen i ikkeRuter med en grunn.`
      );
    }
    ruter = skannet.ruter;
  }

  const utenfor = tjeneste.utenfor || {};
  for (const [sti, grunn] of Object.entries(utenfor)) {
    notater.push(`${tjeneste.navn}: ${sti} er holdt utenfor spesifikasjonen — ${grunn}`);
  }

  // 2 og 4. Hver rute i koden skal finnes i spesifikasjonen, med riktig metode.
  const iSpec = new Map<string, Set<string>>();
  for (const sti of spec.stier) {
    const noekkel = normaliser(sti.sti);
    if (!iSpec.has(noekkel)) iSpec.set(noekkel, new Set());
    for (const operasjon of sti.operasjoner) {
      iSpec.get(noekkel)!.add(operasjon.metode);
    }
  }

  const iKode = new Map<string, Set<string>>();
  for (const rute of ruter) {
    if (utenfor[rute.sti]) continue;
    const noekkel = normaliser(rute.sti);
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
    if (rute.tilgang) bandFor.set(`${rute.metode.toUpperCase()} ${normaliser(rute.sti)}`, rute);
  }

  for (const sti of spec.stier) {
    for (const operasjon of sti.operasjoner) {
      if (operasjon.security === null && !spec.dokumentSecurity) {
        feil.push(
          `${tjeneste.spesifikasjon}:${operasjon.linje}: ${operasjon.metode} ${sti.sti} mangler security:. ` +
          `Åpne ruter skal ha «security: []» eksplisitt, slik at fraværet ikke leses som en glipp.`
        );
        continue;
      }
      const rute = bandFor.get(`${operasjon.metode} ${normaliser(sti.sti)}`);
      if (!rute || operasjon.security === null) continue;

      if (rute.tilgang === "aapen" && operasjon.security.length > 0) {
        feil.push(
          `${tjeneste.spesifikasjon}:${operasjon.linje}: ${operasjon.metode} ${sti.sti} krever ` +
          `${operasjon.security.join("/")}, men tilgangsbandet i koden er «aapen».`
        );
      }
      if (rute.tilgang !== "aapen" && operasjon.security.length === 0) {
        feil.push(
          `${tjeneste.spesifikasjon}:${operasjon.linje}: ${operasjon.metode} ${sti.sti} er dokumentert som åpen, ` +
          `men tilgangsbandet i koden er «${rute.tilgang}».`
        );
      }
      if (rute.tilgang === "bred" && operasjon.security.includes("idporten")) {
        feil.push(
          `${tjeneste.spesifikasjon}:${operasjon.linje}: ${operasjon.metode} ${sti.sti} er i bandet «bred», ` +
          `som ingen innbygger kan åpne. Da skal bare maskinporten stå der.`
        );
      }
      if (operasjon.security.includes("maskinporten") && rute.scope && !operasjon.scopes.includes(rute.scope)) {
        feil.push(
          `${tjeneste.spesifikasjon}:${operasjon.linje}: ${operasjon.metode} ${sti.sti} oppgir scope ` +
          `${operasjon.scopes.join(", ") || "ingen"}, men koden krever ${rute.scope}.`
        );
      }
    }
  }

  if (vis) {
    for (const [sti, metoder] of [...iKode].sort()) {
      const rute = ruter.find((kandidat) => normaliser(kandidat.sti) === sti);
      const band = rute?.tilgang ? `  [${rute.tilgang}${rute.scope ? ` ${rute.scope}` : ""}]` : "";
      console.log(`  ${[...metoder].sort().join(",").padEnd(8)} ${sti}${band}`);
    }
  }

  // 7. Kodeverk spesifikasjonen gjentar.
  const tekst = await readFile(path.join(rot, tjeneste.spesifikasjon), "utf8");
  for (const kodeverk of tjeneste.kodeverk || []) {
    const dokumentert = lesEnum(tekst, kodeverk.skjema);
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

  const antallOperasjoner = spec.stier.reduce((sum, sti) => sum + sti.operasjoner.length, 0);
  console.log(
    `${tjeneste.navn.padEnd(16)} ${String(iKode.size).padStart(3)} stier i koden, ` +
    `${String(iSpec.size).padStart(3)} i spesifikasjonen, ${antallOperasjoner} operasjoner`
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
