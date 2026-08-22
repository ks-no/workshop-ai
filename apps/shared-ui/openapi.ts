/**
 * Leser et OpenAPI-dokument på tekstnivå.
 *
 * There is no YAML parser here and there is not going to be one. Two reasons: the
 * sandbox has no runtime dependencies, and the CI gate needs to see duplicate path
 * keys, which a parser collapses before anyone can look at them.
 *
 * Two consumers, which is why this lives here rather than inside the check script:
 *
 *   1. scripts/sjekk-openapi-dekning.ts, which holds the spec and the code in step
 *   2. hver tjenestes GET /openapi-ruter.json, som er det API-utforskeren i
 *      demo-gui rendrer
 *
 * IT FAILS LOUDLY, AND THE BOUNDARY IS THE POINT. It throws on a construct it does
 * not understand *within what it claims to read* — a fifth parameter shape, a $ref
 * that does not resolve, a body example that is not a string. It does not look at
 * `responses:` or `components.schemas` at all, and must not start: without that
 * boundary the next change turns this into a general YAML parser, which has been
 * considered and rejected twice.
 *
 * En parameter som forsvinner i stillhet er verre enn en feil. Utforskeren ville
 * rendret et skjema uten feltet, kallet ville svart 400, og ingenting ville sagt
 * hvorfor.
 */

import { readFile } from "node:fs/promises";

export type Parameter = {
  navn: string;
  /** `in:` fra OpenAPI — path, query, header eller cookie. */
  plassering: string;
  paakrevd: boolean;
  /** Fra `example:` på parameteren eller under `schema:`, ellers `default:`. */
  eksempel?: string;
  beskrivelse?: string;
};

export type Operasjon = {
  metode: string;
  /** Linjenummer i spesifikasjonen, så en feilmelding kan peke på stedet. */
  linje: number;
  /** null = ingen egen security:. Se dokumentSecurity. */
  security: string[] | null;
  scopes: string[];
  sammendrag?: string;
  beskrivelse?: string;
  parametere: Parameter[];
  /** Fra requestBody, når den har et eksempel. Se lesKroppEksempel. */
  kroppEksempel?: string;
};

export type Sti = {
  sti: string;
  linje: number;
  operasjoner: Operasjon[];
};

export type Spesifikasjon = {
  tittel: string;
  beskrivelse?: string;
  /** Første oppføring under servers:. Utforskeren kaller den adressen. */
  server?: string;
  stier: Sti[];
  /**
   * Stiene i den rekkefølgen de står i filen, duplikater beholdt. YAML tar den
   * siste og kaster den første uten et ord, så duplikatet må kunne sees her.
   */
  rekkefoelge: string[];
  /** En security: på dokumentnivå gjelder hver operasjon uten sin egen. */
  dokumentSecurity: boolean;
  /** Ordningene den står med. Tom liste = dokumentet erklærer alt åpent. */
  dokumentOrdninger: string[];
  dokumentScopes: string[];
};

const HTTP_METODER = ["get", "post", "put", "patch", "delete", "head", "options"];

// Nøkler på en parameter som leses, og nøkler som med vilje ikke gjør det. Alt
// annet er ukjent, og da kastes det. Se filhodet.
const PARAMETERNOEKLER = ["name", "in", "required", "example", "schema", "$ref"];
const PARAMETERNOEKLER_IGNORERT = [
  "description", "deprecated", "style", "explode", "allowEmptyValue", "allowReserved"
];

function innrykk(linje: string): number {
  return linje.length - linje.trimStart().length;
}

/** Blanke linjer og kommentarer bærer ingen struktur og hoppes over overalt. */
function erTom(linje: string): boolean {
  const klippet = linje.trim();
  return klippet === "" || klippet.startsWith("#");
}

/** Første linje etter blokken som starter på `start` og er dypere enn `basis`. */
function blokkSlutt(linjer: string[], start: number, basis: number): number {
  let i = start;
  while (i < linjer.length) {
    if (erTom(linjer[i])) {
      i++;
      continue;
    }
    if (innrykk(linjer[i]) <= basis) break;
    i++;
  }
  return i;
}

function avKlem(verdi: string): string {
  const klippet = verdi.trim();
  if (klippet.length >= 2 && (klippet.startsWith('"') || klippet.startsWith("'"))) {
    if (klippet.at(-1) === klippet[0]) return klippet.slice(1, -1);
  }
  return klippet;
}

function noekkelen(linje: string): string {
  const klippet = linje.trim().replace(/^- /, "");
  return klippet.slice(0, klippet.indexOf(":"));
}

/**
 * Verdien av `nøkkel: verdi`, også når den er en blokkskalar (`>`, `|`, med eller
 * uten `-`). `>` bretter linjene til ett avsnitt, `|` beholder linjeskiftene.
 */
function lesFeltverdi(linjer: string[], indeks: number): { verdi: string; neste: number } {
  const linje = linjer[indeks];
  const basis = innrykk(linje);
  const etter = linje.slice(linje.indexOf(":") + 1).trim();
  if (etter !== "" && !/^[>|][-+]?$/.test(etter)) {
    return { verdi: avKlem(etter), neste: indeks + 1 };
  }

  const brett = etter.startsWith(">");
  const slutt = blokkSlutt(linjer, indeks + 1, basis);
  const kropp = linjer.slice(indeks + 1, slutt);
  const fylte = kropp.filter((rad) => !erTom(rad));
  if (fylte.length === 0) return { verdi: "", neste: slutt };
  const minste = Math.min(...fylte.map(innrykk));
  const rader = kropp.map((rad) => (erTom(rad) ? "" : rad.slice(minste)));

  if (!brett) return { verdi: rader.join("\n").trim(), neste: slutt };

  const avsnitt: string[] = [];
  let gjeldende: string[] = [];
  for (const rad of rader) {
    if (rad === "") {
      if (gjeldende.length) avsnitt.push(gjeldende.join(" "));
      gjeldende = [];
    } else {
      gjeldende.push(rad.trim());
    }
  }
  if (gjeldende.length) avsnitt.push(gjeldende.join(" "));
  return { verdi: avsnitt.join("\n\n").trim(), neste: slutt };
}

/**
 * `{ in: query, name: limit, schema: { type: integer, default: 50 } }`.
 *
 * ai-gateway.yaml writes its parameters on one line, and the shape is closed
 * enough to read directly: mappings, sequences and scalars. No anchors, no tags,
 * no commas inside values — and anything else throws rather than guessing.
 */
function lesFlyt(tekst: string, hvor: string): any {
  let i = 0;
  const feil = (melding: string): never => {
    throw new Error(`${hvor}: ${melding} i «${tekst}»`);
  };
  const hoppOver = () => {
    while (i < tekst.length && /\s/.test(tekst[i])) i++;
  };
  const fram = (stopp: RegExp): string => {
    const start = i;
    while (i < tekst.length && !stopp.test(tekst[i])) i++;
    return tekst.slice(start, i);
  };

  function verdi(): any {
    hoppOver();
    if (tekst[i] === "{") {
      i++;
      const ut: Record<string, any> = {};
      hoppOver();
      if (tekst[i] === "}") {
        i++;
        return ut;
      }
      for (;;) {
        hoppOver();
        const noekkel = fram(/[:,}]/).trim();
        if (tekst[i] !== ":") feil("forventet «:»");
        i++;
        ut[noekkel] = verdi();
        hoppOver();
        if (tekst[i] === ",") {
          i++;
          continue;
        }
        if (tekst[i] === "}") {
          i++;
          return ut;
        }
        feil("forventet «,» eller «}»");
      }
    }
    if (tekst[i] === "[") {
      i++;
      const ut: any[] = [];
      hoppOver();
      if (tekst[i] === "]") {
        i++;
        return ut;
      }
      for (;;) {
        ut.push(verdi());
        hoppOver();
        if (tekst[i] === ",") {
          i++;
          continue;
        }
        if (tekst[i] === "]") {
          i++;
          return ut;
        }
        feil("forventet «,» eller «]»");
      }
    }
    return avKlem(fram(/[,}\]]/));
  }

  const ut = verdi();
  hoppOver();
  if (i < tekst.length) feil("etterfølgende tegn");
  return ut;
}

/**
 * Eksempelverdien i et skjema. Parameteren kan ha `example:` selv, men den ligger
 * like gjerne under `schema:`, og en `default:` er også et brukbart utgangspunkt
 * for et skjemafelt i utforskeren.
 */
function eksempelFraSkjema(
  linjer: string[], start: number, slutt: number, hvor: string
): string | undefined {
  const foerste = linjer[start];
  const etter = foerste.slice(foerste.indexOf(":") + 1).trim();
  if (etter.startsWith("{")) {
    const skjema = lesFlyt(etter, hvor);
    const verdi = skjema.example ?? skjema.default;
    return verdi === undefined ? undefined : String(verdi);
  }
  // Bare skjemaets egne barn. Et dypere `default:` hører til en property inne i
  // skjemaet, og å returnere den som parameterens eksempel er nettopp den stille
  // feilverdien filhodet sier at leseren finnes for å unngå.
  const barn = innrykk(foerste) + 2;
  for (let i = start + 1; i < slutt; i++) {
    if (erTom(linjer[i]) || innrykk(linjer[i]) !== barn) continue;
    if (/^\s*(example|default):/.test(linjer[i])) return lesFeltverdi(linjer, i).verdi;
  }
  return undefined;
}

function lesParameterFelter(
  linjer: string[], start: number, slutt: number, basis: number, hvor: string
): Parameter {
  let navn: string | undefined;
  let plassering: string | undefined;
  let paakrevd = false;
  let eksempel: string | undefined;
  let fraSkjema: string | undefined;
  let beskrivelse: string | undefined;

  let i = start;
  while (i < slutt) {
    if (erTom(linjer[i]) || innrykk(linjer[i]) !== basis) {
      i++;
      continue;
    }
    const noekkel = noekkelen(linjer[i]);

    if (PARAMETERNOEKLER_IGNORERT.includes(noekkel)) {
      if (noekkel === "description") {
        const lest = lesFeltverdi(linjer, i);
        beskrivelse = lest.verdi;
        i = lest.neste;
        continue;
      }
      i = blokkSlutt(linjer, i + 1, basis);
      continue;
    }
    if (!PARAMETERNOEKLER.includes(noekkel)) {
      throw new Error(
        `${hvor}:${i + 1}: ukjent nøkkel «${noekkel}» på en parameter. Leseren kjenner ` +
        `${PARAMETERNOEKLER.join(", ")}. Hører den hjemme, hører formen i ` +
        `apps/shared-ui/openapi.ts — en parameter som forsvinner i stillhet er verre enn en feil.`
      );
    }
    if (noekkel === "schema") {
      const enden = blokkSlutt(linjer, i + 1, basis);
      fraSkjema = eksempelFraSkjema(linjer, i, enden, `${hvor}:${i + 1}`);
      i = enden;
      continue;
    }

    const lest = lesFeltverdi(linjer, i);
    if (noekkel === "name") navn = lest.verdi;
    if (noekkel === "in") plassering = lest.verdi;
    if (noekkel === "required") paakrevd = lest.verdi === "true";
    if (noekkel === "example") eksempel = lest.verdi;
    i = lest.neste;
  }

  if (!navn || !plassering) {
    throw new Error(`${hvor}:${start + 1}: parameteren mangler ${!navn ? "name" : "in"}.`);
  }
  const valgt = eksempel ?? fraSkjema;
  return {
    navn,
    plassering,
    paakrevd,
    ...(valgt === undefined ? {} : { eksempel: valgt }),
    ...(beskrivelse ? { beskrivelse } : {})
  };
}

/**
 * Fire former finnes i filene i dag, og alle fire må leses. En femte kaster.
 *
 *   - name: personId          (blokk, name først)
 *   - in: query               (blokk, in først)
 *   - { in: query, name: limit, schema: { type: integer } }
 *   - $ref: "#/components/parameters/PersonId"
 */
function lesParametere(
  linjer: string[],
  start: number,
  slutt: number,
  komponenter: Map<string, Parameter>,
  hvor: string
): Parameter[] {
  const ut: Parameter[] = [];
  let i = start;
  let basis = -1;
  while (i < slutt) {
    if (erTom(linjer[i])) {
      i++;
      continue;
    }
    if (basis === -1) basis = innrykk(linjer[i]);
    if (innrykk(linjer[i]) !== basis || !linjer[i].trim().startsWith("- ")) {
      i++;
      continue;
    }

    let enden = i + 1;
    while (enden < slutt && (erTom(linjer[enden]) || innrykk(linjer[enden]) > basis)) enden++;

    const innhold = linjer[i].trim().slice(2).trim();

    if (innhold.startsWith("$ref:")) {
      const referanse = avKlem(innhold.slice("$ref:".length));
      const navn = referanse.replace("#/components/parameters/", "");
      const funnet = komponenter.get(navn);
      if (!funnet) {
        throw new Error(
          `${hvor}:${i + 1}: ${referanse} slår ikke opp i components.parameters. ` +
          `Kjente: ${[...komponenter.keys()].join(", ") || "ingen"}.`
        );
      }
      ut.push(funnet);
      i = enden;
      continue;
    }

    if (innhold.startsWith("{")) {
      const raa = lesFlyt(innhold, `${hvor}:${i + 1}`);
      if (!raa.name || !raa.in) {
        throw new Error(`${hvor}:${i + 1}: parameteren mangler ${!raa.name ? "name" : "in"}.`);
      }
      const eksempel = raa.example ?? raa.schema?.example ?? raa.schema?.default;
      ut.push({
        navn: String(raa.name),
        plassering: String(raa.in),
        paakrevd: String(raa.required) === "true",
        ...(eksempel === undefined ? {} : { eksempel: String(eksempel) }),
        ...(raa.description ? { beskrivelse: String(raa.description) } : {})
      });
      i = enden;
      continue;
    }

    if (/^[\w$]+:/.test(innhold)) {
      // Blokkformen. Første linje bærer «- » foran den første nøkkelen; bytt den
      // med to mellomrom, så hele oppføringen står med ett og samme innrykk.
      // Kopien er like lang som originalen, så linjenumrene i en feilmelding
      // fortsatt peker på riktig sted i filen.
      const kopi = [...linjer];
      kopi[i] = linjer[i].replace("- ", "  ");
      ut.push(lesParameterFelter(kopi, i, enden, basis + 2, hvor));
      i = enden;
      continue;
    }

    throw new Error(
      `${hvor}:${i + 1}: forsto ikke parameteroppføringen «${innhold}». Leseren kjenner ` +
      `blokkform, flytform på én linje og $ref til components.parameters.`
    );
  }
  return ut;
}

/**
 * Eksempelkroppen for et POST- eller PUT-kall, som utforskeren fyller tekstfeltet
 * med.
 *
 * Bare strengformene leses: `example: "…"` og en blokkskalar. Et eksempel skrevet
 * som en nestet mapping — formen OpenAPI egentlig mener — kaster, fordi å lese den
 * ville krevd en YAML-parser. Når skriving lander og eksempler skal inn i filene,
 * skriv dem som blokkskalar med JSON i, eller lær formen her. Ikke la leseren
 * droppe dem i stillhet.
 */
function lesKroppEksempel(
  linjer: string[], start: number, slutt: number, hvor: string
): string | undefined {
  for (let i = start; i < slutt; i++) {
    if (erTom(linjer[i])) continue;
    if (!/^\s*example:/.test(linjer[i])) continue;
    const etter = linjer[i].slice(linjer[i].indexOf(":") + 1).trim();
    if (etter !== "" && !/^[>|][-+]?$/.test(etter)) return avKlem(etter);
    const lest = lesFeltverdi(linjer, i);
    if (lest.verdi === "") {
      throw new Error(
        `${hvor}:${i + 1}: requestBody-eksempelet er tomt eller en nestet mapping. Leseren ` +
        `leser bare strenger — skriv eksempelet som blokkskalar med JSON i, eller lær formen ` +
        `i apps/shared-ui/openapi.ts.`
      );
    }
    return lest.verdi;
  }
  return undefined;
}

/** components.parameters, som $ref-ene i paths slår opp i. */
function lesKomponentparametere(linjer: string[], hvor: string): Map<string, Parameter> {
  const ut = new Map<string, Parameter>();
  const komponenter = linjer.findIndex((linje) => /^components:\s*$/.test(linje));
  if (komponenter === -1) return ut;
  const komponentSlutt = blokkSlutt(linjer, komponenter + 1, 0);

  let i = komponenter + 1;
  while (i < komponentSlutt) {
    if (erTom(linjer[i]) || !/^ {2}parameters:\s*$/.test(linjer[i])) {
      i++;
      continue;
    }
    const slutt = blokkSlutt(linjer, i + 1, 2);
    let j = i + 1;
    while (j < slutt) {
      if (erTom(linjer[j]) || innrykk(linjer[j]) !== 4) {
        j++;
        continue;
      }
      const navn = noekkelen(linjer[j]);
      const enden = blokkSlutt(linjer, j + 1, 4);
      ut.set(navn, lesParameterFelter(linjer, j + 1, enden, 6, hvor));
      j = enden;
    }
    i = slutt;
  }
  return ut;
}

/**
 * En security-blokk inne i en operasjon:
 *
 *   security: []                                  eksplisitt åpen
 *   security:
 *     - idporten: []
 *     - maskinporten: [ks:innbyggerdialog:les]
 */
function lesSecurity(
  linjer: string[], start: number, slutt: number, hvor: string
): { ordninger: string[]; scopes: string[] } {
  const ordninger: string[] = [];
  const scopes: string[] = [];
  for (let i = start; i < slutt; i++) {
    if (erTom(linjer[i])) continue;
    const ordning = linjer[i].match(/^\s*- (\w+):\s*(\[([^\]]*)\])?\s*$/);
    if (ordning) {
      ordninger.push(ordning[1]);
      for (const scope of (ordning[3] || "").split(",")) {
        if (scope.trim()) scopes.push(scope.trim());
      }
      continue;
    }
    // Ordningen på egen linje med scopene under seg.
    const alene = linjer[i].match(/^\s*- ([a-z]+:[^\s]+)\s*$/);
    if (alene) {
      scopes.push(alene[1]);
      continue;
    }
    throw new Error(
      `${hvor}:${i + 1}: forsto ikke security-oppføringen «${linjer[i].trim()}».`
    );
  }
  return { ordninger, scopes };
}

export function lesSpesifikasjon(tekst: string, hvor = "spesifikasjonen"): Spesifikasjon {
  const linjer = tekst.split("\n");
  const komponenter = lesKomponentparametere(linjer, hvor);

  const spek: Spesifikasjon = {
    tittel: hvor,
    stier: [],
    rekkefoelge: [],
    dokumentSecurity: false,
    dokumentOrdninger: [],
    dokumentScopes: []
  };

  let i = 0;
  while (i < linjer.length) {
    const linje = linjer[i];
    if (erTom(linje) || innrykk(linje) !== 0) {
      i++;
      continue;
    }

    if (/^security:/.test(linje)) {
      spek.dokumentSecurity = true;
      const slutt = blokkSlutt(linjer, i + 1, 0);
      const lest = lesSecurity(linjer, i + 1, slutt, hvor);
      spek.dokumentOrdninger = lest.ordninger;
      spek.dokumentScopes = lest.scopes;
      i = slutt;
      continue;
    }

    if (/^info:\s*$/.test(linje)) {
      const slutt = blokkSlutt(linjer, i + 1, 0);
      for (let j = i + 1; j < slutt; j++) {
        if (erTom(linjer[j]) || innrykk(linjer[j]) !== 2) continue;
        const noekkel = noekkelen(linjer[j]);
        if (noekkel === "title") spek.tittel = lesFeltverdi(linjer, j).verdi;
        if (noekkel === "description") spek.beskrivelse = lesFeltverdi(linjer, j).verdi;
      }
      i = slutt;
      continue;
    }

    if (/^servers:\s*$/.test(linje)) {
      const slutt = blokkSlutt(linjer, i + 1, 0);
      for (let j = i + 1; j < slutt; j++) {
        const treff = linjer[j].match(/^\s*- url:\s*(\S+)\s*$/);
        if (treff) {
          spek.server = avKlem(treff[1]);
          break;
        }
      }
      i = slutt;
      continue;
    }

    if (/^paths:\s*$/.test(linje)) {
      const slutt = blokkSlutt(linjer, i + 1, 0);
      lesPaths(linjer, i + 1, slutt, komponenter, hvor, spek);
      i = slutt;
      continue;
    }

    i++;
  }

  return spek;
}

function lesPaths(
  linjer: string[],
  start: number,
  slutt: number,
  komponenter: Map<string, Parameter>,
  hvor: string,
  spek: Spesifikasjon
): void {
  let i = start;
  while (i < slutt) {
    const stiTreff = erTom(linjer[i]) ? null : linjer[i].match(/^ {2}(\/\S*):\s*$/);
    if (!stiTreff) {
      i++;
      continue;
    }
    const stiSlutt = blokkSlutt(linjer, i + 1, 2);
    const sti: Sti = { sti: stiTreff[1], linje: i + 1, operasjoner: [] };
    spek.stier.push(sti);
    spek.rekkefoelge.push(stiTreff[1]);

    let j = i + 1;
    while (j < stiSlutt) {
      if (erTom(linjer[j]) || innrykk(linjer[j]) !== 4) {
        j++;
        continue;
      }
      const metode = linjer[j].match(/^ {4}([a-z]+):\s*$/);
      if (!metode || !HTTP_METODER.includes(metode[1])) {
        // Alt annet på sti-nivå enn en metode. `summary` og `description` er ren
        // prosa og kan ignoreres; `parameters` kan det ikke — den gjelder hver
        // operasjon under stien, og å hoppe over den ville gitt utforskeren et
        // skjema uten feltet og et kall som 404-er uten å si hvorfor.
        const noekkel = noekkelen(linjer[j]);
        if (noekkel !== "summary" && noekkel !== "description") {
          throw new Error(
            `${hvor}:${j + 1}: «${noekkel}» står på sti-nivå under ${sti.sti}. Leseren leser ` +
            `bare operasjoner der. Hører den hjemme, hører formen i apps/shared-ui/openapi.ts.`
          );
        }
        j++;
        continue;
      }
      const operasjonSlutt = blokkSlutt(linjer, j + 1, 4);
      sti.operasjoner.push(
        lesOperasjon(linjer, j, operasjonSlutt, metode[1].toUpperCase(), komponenter, hvor)
      );
      j = operasjonSlutt;
    }
    i = stiSlutt;
  }
}

function lesOperasjon(
  linjer: string[],
  start: number,
  slutt: number,
  metode: string,
  komponenter: Map<string, Parameter>,
  hvor: string
): Operasjon {
  const operasjon: Operasjon = {
    metode,
    linje: start + 1,
    security: null,
    scopes: [],
    parametere: []
  };

  let i = start + 1;
  while (i < slutt) {
    if (erTom(linjer[i]) || innrykk(linjer[i]) !== 6) {
      i++;
      continue;
    }
    const noekkel = noekkelen(linjer[i]);

    if (noekkel === "security") {
      const etter = linjer[i].slice(linjer[i].indexOf(":") + 1).trim();
      if (/^\[\s*\]$/.test(etter)) {
        operasjon.security = [];
        i++;
        continue;
      }
      const enden = blokkSlutt(linjer, i + 1, 6);
      const lest = lesSecurity(linjer, i + 1, enden, hvor);
      operasjon.security = lest.ordninger;
      operasjon.scopes = lest.scopes;
      i = enden;
      continue;
    }

    if (noekkel === "parameters") {
      const enden = blokkSlutt(linjer, i + 1, 6);
      operasjon.parametere = lesParametere(linjer, i + 1, enden, komponenter, hvor);
      i = enden;
      continue;
    }

    if (noekkel === "requestBody") {
      const enden = blokkSlutt(linjer, i + 1, 6);
      operasjon.kroppEksempel = lesKroppEksempel(linjer, i + 1, enden, hvor);
      i = enden;
      continue;
    }

    if (noekkel === "summary" || noekkel === "description") {
      const lest = lesFeltverdi(linjer, i);
      if (noekkel === "summary") operasjon.sammendrag = lest.verdi;
      else operasjon.beskrivelse = lest.verdi;
      i = lest.neste;
      continue;
    }

    // responses, tags, operationId og resten leses ikke. Se filhodet: grensen er
    // med vilje, ikke en mangel.
    i = blokkSlutt(linjer, i + 1, 6);
  }

  return operasjon;
}

// --- det tjenestene serverer ----------------------------------------------

/** En operasjon med stien sin, som er formen utforskeren vil ha den i. */
export type Rute = Operasjon & { sti: string };

export type Ruteoversikt = {
  tjeneste: string;
  beskrivelse?: string;
  /** Adressen utforskeren skal kalle. Fra servers: i spesifikasjonen. */
  server?: string;
  ruter: Rute[];
};

/**
 * Svaret på GET /openapi-ruter.json.
 *
 * Hver tjeneste serverer sin egen spesifikasjon, lest. Grunnen til at det ikke er
 * nettleseren som leser YAML-en er at leseren er TypeScript i Node, og at sidene
 * her lastes uten byggsteg; grunnen til at det ikke er én samlerute i demo-gui er
 * at en tjeneste skal kunne svare for seg selv.
 */
export async function ruteoversikt(filsti: string): Promise<Ruteoversikt> {
  const spek = lesSpesifikasjon(await readFile(filsti, "utf8"), filsti);
  return {
    tjeneste: spek.tittel,
    ...(spek.beskrivelse ? { beskrivelse: spek.beskrivelse } : {}),
    ...(spek.server ? { server: spek.server } : {}),
    // En operasjon uten egen security: arver dokumentets. Uten den oppløsningen
    // her ville de fire tjenestene som erklærer «security: []» én gang på toppen
    // sett ut som om hjemmelen deres var udokumentert.
    ruter: spek.stier.flatMap((sti) =>
      sti.operasjoner.map((operasjon) => ({
        sti: sti.sti,
        ...operasjon,
        security: operasjon.security ?? (spek.dokumentSecurity ? spek.dokumentOrdninger : null),
        scopes: operasjon.security ? operasjon.scopes : spek.dokumentScopes
      }))
    )
  };
}

function escapeHtml(tekst: string): string {
  return tekst
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Hjemmelen en rute krever, sagt på norsk, avledet av `security:`. */
export function hjemmelFor(rute: Rute): string {
  if (rute.security === null) return "udokumentert";
  if (rute.security.length === 0) return "åpen";
  const scopes = rute.scopes.length ? ` (${rute.scopes.join(", ")})` : "";
  return rute.security.join(" eller ") + scopes;
}

/**
 * En /docs-side generert av spesifikasjonen.
 *
 * Grunnen til at den genereres: en håndskrevet liste er en tredje sannhet ved
 * siden av koden og spesifikasjonen, og de to første holdes i takt av
 * pnpm test:openapi mens den tredje driver i stillhet. Tjenestene som allerede
 * har en håndskrevet side beholder den; denne er for de som ikke har noen.
 */
export function docsHtml(oversikt: Ruteoversikt, utforsker = "http://localhost:3001/utforsker"): string {
  const rader = oversikt.ruter
    .map((rute) =>
      `        <tr><td><code>${escapeHtml(rute.metode)}</code></td>` +
      `<td><code>${escapeHtml(rute.sti)}</code></td>` +
      `<td>${escapeHtml(rute.sammendrag || "")}</td>` +
      `<td>${escapeHtml(hjemmelFor(rute))}</td></tr>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="nb">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(oversikt.tjeneste)}</title>
    <style>
      body { font-family: Arial, Helvetica, sans-serif; padding: 24px; max-width: 1100px; color: #17232f; }
      p.ingress { max-width: 85ch; color: #5b6a7a; }
      table { border-collapse: collapse; width: 100%; font-size: 14px; margin-top: 18px; }
      th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #e6edf5; vertical-align: top; }
      th { color: #5b6a7a; font-size: 13px; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      .lenker { display: flex; gap: 20px; font-size: 14px; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(oversikt.tjeneste)}</h1>
    ${oversikt.beskrivelse ? `<p class="ingress">${escapeHtml(oversikt.beskrivelse)}</p>` : ""}
    <div class="lenker">
      <a href="/openapi.yaml">Spesifikasjonen</a>
      <a href="/openapi-ruter.json">Samme, lest, som JSON</a>
      <a href="${escapeHtml(utforsker)}">Prøv rutene i API-utforskeren</a>
    </div>
    <p class="ingress">Denne siden er generert av spesifikasjonen, ikke skrevet for hånd.
      <code>pnpm test:openapi</code> holder spesifikasjonen i takt med koden, så listen under
      kan ikke drive fra rutene tjenesten faktisk har.</p>
    <table>
      <thead><tr><th>Metode</th><th>Sti</th><th>Hva den gjør</th><th>Hjemmel</th></tr></thead>
      <tbody>
${rader}
      </tbody>
    </table>
  </body>
</html>`;
}
