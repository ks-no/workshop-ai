/**
 * Reads an OpenAPI document at text level.
 *
 * There is no YAML parser here and there is not going to be one. Two reasons: the
 * sandbox has no runtime dependencies, and the CI gate needs to see duplicate path
 * keys, which a parser collapses before anyone can look at them.
 *
 * Three consumers, which is why this lives here rather than inside a script:
 *
 *   1. scripts/sjekk-openapi-dekning.ts, which holds the spec and the code in step
 *   2. each service's GET /openapi-ruter.json, which is what the API explorer in
 *      demo-gui renders
 *   3. scripts/check-dokumentasjon.ts, which counts paths and operations to check
 *      claims in prose against the specs
 *
 * IT FAILS LOUDLY, AND THE BOUNDARY IS THE POINT. It throws on a construct it does
 * not understand *within what it claims to read* — a fifth parameter shape, a $ref
 * that does not resolve, a body example that is not a string. It does not look at
 * `responses:` or `components.schemas` at all, and must not start: without that
 * boundary the next change turns this into a general YAML parser, which has been
 * considered and rejected twice.
 *
 * A parameter that disappears in silence is worse than an error. The explorer
 * would have rendered a form without the field, the call would have answered 400,
 * and nothing would have said why.
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

export type Operation = {
  metode: string;
  /** Linjenummer i spesifikasjonen, så en feilmelding kan peke på stedet. */
  linje: number;
  /** null = ingen egen security:. Se documentSecurity. */
  security: string[] | null;
  scopes: string[];
  sammendrag?: string;
  beskrivelse?: string;
  parametere: Parameter[];
  /** Fra requestBody, når den har et eksempel. Se readBodyExample. */
  kroppEksempel?: string;
};

export type PathEntry = {
  path: string;
  line: number;
  operations: Operation[];
};

export type Spec = {
  title: string;
  description?: string;
  /** Første oppføring under servers:. Utforskeren kaller den adressen. */
  server?: string;
  paths: PathEntry[];
  /**
   * Stiene i den rekkefølgen de står i filen, duplikater beholdt. YAML tar den
   * siste og kaster den første uten et ord, så duplikatet må kunne sees her.
   */
  order: string[];
  /** En security: på dokumentnivå gjelder hver operasjon uten sin egen. */
  documentSecurity: boolean;
  /** Ordningene den står med. Tom liste = dokumentet erklærer alt åpent. */
  documentSchemes: string[];
  documentScopes: string[];
};

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

// Nøkler på en parameter som leses, og nøkler som med vilje ikke gjør det. Alt
// annet er ukjent, og da kastes det. Se filhodet.
const PARAMETER_KEYS = ["name", "in", "required", "example", "schema", "$ref"];
const PARAMETER_KEYS_IGNORED = [
  "description", "deprecated", "style", "explode", "allowEmptyValue", "allowReserved"
];

function indent(line: string): number {
  return line.length - line.trimStart().length;
}

/** Blanke linjer og kommentarer bærer ingen struktur og hoppes over overalt. */
function isBlank(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === "" || trimmed.startsWith("#");
}

/** Første line etter blokken som starter på `start` og er dypere enn `baseIndent`. */
function blockEnd(lines: string[], start: number, baseIndent: number): number {
  let i = start;
  while (i < lines.length) {
    if (isBlank(lines[i])) {
      i++;
      continue;
    }
    if (indent(lines[i]) <= baseIndent) break;
    i++;
  }
  return i;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && (trimmed.startsWith('"') || trimmed.startsWith("'"))) {
    if (trimmed.at(-1) === trimmed[0]) return trimmed.slice(1, -1);
  }
  return trimmed;
}

function keyOf(line: string): string {
  const trimmed = line.trim().replace(/^- /, "");
  return trimmed.slice(0, trimmed.indexOf(":"));
}

/**
 * Verdien av `nøkkel: verdi`, også når den er en blokkskalar (`>`, `|`, med eller
 * uten `-`). `>` bretter linjene til ett avsnitt, `|` beholder linjeskiftene.
 */
function readFieldValue(lines: string[], index: number): { value: string; next: number } {
  const line = lines[index];
  const baseIndent = indent(line);
  const after = line.slice(line.indexOf(":") + 1).trim();
  if (after !== "" && !/^[>|][-+]?$/.test(after)) {
    return { value: unquote(after), next: index + 1 };
  }

  const folded = after.startsWith(">");
  const end = blockEnd(lines, index + 1, baseIndent);
  const body = lines.slice(index + 1, end);
  const filled = body.filter((row) => !isBlank(row));
  if (filled.length === 0) return { value: "", next: end };
  const smallest = Math.min(...filled.map(indent));
  const rows = body.map((row) => (isBlank(row) ? "" : row.slice(smallest)));

  if (!folded) return { value: rows.join("\n").trim(), next: end };

  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const row of rows) {
    if (row === "") {
      if (current.length) paragraphs.push(current.join(" "));
      current = [];
    } else {
      current.push(row.trim());
    }
  }
  if (current.length) paragraphs.push(current.join(" "));
  return { value: paragraphs.join("\n\n").trim(), next: end };
}

/**
 * `{ in: query, name: limit, schema: { type: integer, default: 50 } }`.
 *
 * ai-gateway.yaml writes its parameters on one line, and the shape is closed
 * enough to read directly: mappings, sequences and scalars. No anchors, no tags,
 * no commas inside values — and anything else throws rather than guessing.
 */
function readFlowScalar(text: string, where: string): any {
  let i = 0;
  const fail = (message: string): never => {
    throw new Error(`${where}: ${message} i «${text}»`);
  };
  const skipSpace = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  const advance = (stopp: RegExp): string => {
    const start = i;
    while (i < text.length && !stopp.test(text[i])) i++;
    return text.slice(start, i);
  };

  function value(): any {
    skipSpace();
    if (text[i] === "{") {
      i++;
      const ut: Record<string, any> = {};
      skipSpace();
      if (text[i] === "}") {
        i++;
        return ut;
      }
      for (;;) {
        skipSpace();
        const key = advance(/[:,}]/).trim();
        if (text[i] !== ":") fail("forventet «:»");
        i++;
        ut[key] = value();
        skipSpace();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "}") {
          i++;
          return ut;
        }
        fail("forventet «,» eller «}»");
      }
    }
    if (text[i] === "[") {
      i++;
      const ut: any[] = [];
      skipSpace();
      if (text[i] === "]") {
        i++;
        return ut;
      }
      for (;;) {
        ut.push(value());
        skipSpace();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "]") {
          i++;
          return ut;
        }
        fail("forventet «,» eller «]»");
      }
    }
    return unquote(advance(/[,}\]]/));
  }

  const ut = value();
  skipSpace();
  if (i < text.length) fail("etterfølgende tegn");
  return ut;
}

/**
 * Eksempelverdien i et skjema. Parameteren kan ha `example:` selv, men den ligger
 * like gjerne under `schema:`, og en `default:` er også et brukbart utgangspunkt
 * for et skjemafelt i utforskeren.
 */
function exampleFromSchema(
  lines: string[], start: number, end: number, where: string
): string | undefined {
  const first = lines[start];
  const after = first.slice(first.indexOf(":") + 1).trim();
  if (after.startsWith("{")) {
    const skjema = readFlowScalar(after, where);
    const value = skjema.example ?? skjema.default;
    return value === undefined ? undefined : String(value);
  }
  // Bare skjemaets egne barn. Et dypere `default:` hører til en property inne i
  // skjemaet, og å returnere den som parameterens example er nettopp den stille
  // feilverdien filhodet sier at leseren finnes for å unngå.
  const barn = indent(first) + 2;
  for (let i = start + 1; i < end; i++) {
    if (isBlank(lines[i]) || indent(lines[i]) !== barn) continue;
    if (/^\s*(example|default):/.test(lines[i])) return readFieldValue(lines, i).value;
  }
  return undefined;
}

function readParameterFields(
  lines: string[], start: number, end: number, baseIndent: number, where: string
): Parameter {
  let name: string | undefined;
  let location: string | undefined;
  let required = false;
  let example: string | undefined;
  let fromSchema: string | undefined;
  let description: string | undefined;

  let i = start;
  while (i < end) {
    if (isBlank(lines[i]) || indent(lines[i]) !== baseIndent) {
      i++;
      continue;
    }
    const key = keyOf(lines[i]);

    if (PARAMETER_KEYS_IGNORED.includes(key)) {
      if (key === "description") {
        const read = readFieldValue(lines, i);
        description = read.value;
        i = read.next;
        continue;
      }
      i = blockEnd(lines, i + 1, baseIndent);
      continue;
    }
    if (!PARAMETER_KEYS.includes(key)) {
      throw new Error(
        `${where}:${i + 1}: ukjent nøkkel «${key}» på en parameter. Leseren kjenner ` +
        `${PARAMETER_KEYS.join(", ")}. Hører den hjemme, hører formen i ` +
        `apps/shared/openapi.ts — en parameter som forsvinner i stillhet er verre enn en feil.`
      );
    }
    if (key === "schema") {
      const innerEnd = blockEnd(lines, i + 1, baseIndent);
      fromSchema = exampleFromSchema(lines, i, innerEnd, `${where}:${i + 1}`);
      i = innerEnd;
      continue;
    }

    const read = readFieldValue(lines, i);
    if (key === "name") name = read.value;
    if (key === "in") location = read.value;
    if (key === "required") required = read.value === "true";
    if (key === "example") example = read.value;
    i = read.next;
  }

  if (!name || !location) {
    throw new Error(`${where}:${start + 1}: parameteren mangler ${!name ? "name" : "in"}.`);
  }
  const chosen = example ?? fromSchema;
  // Wire-nøklene står eksplisitt. Skrives de som shorthand, følger de navnet på den
  // lokale variabelen, og GET /openapi-ruter.json bytter nøkkel uten en feilmelding.
  return {
    navn: name,
    plassering: location,
    paakrevd: required,
    ...(chosen === undefined ? {} : { eksempel: chosen }),
    ...(description ? { beskrivelse: description } : {})
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
function readParameters(
  lines: string[],
  start: number,
  end: number,
  components: Map<string, Parameter>,
  where: string
): Parameter[] {
  const ut: Parameter[] = [];
  let i = start;
  let baseIndent = -1;
  while (i < end) {
    if (isBlank(lines[i])) {
      i++;
      continue;
    }
    if (baseIndent === -1) baseIndent = indent(lines[i]);
    if (indent(lines[i]) !== baseIndent || !lines[i].trim().startsWith("- ")) {
      i++;
      continue;
    }

    let innerEnd = i + 1;
    while (innerEnd < end && (isBlank(lines[innerEnd]) || indent(lines[innerEnd]) > baseIndent)) innerEnd++;

    const content = lines[i].trim().slice(2).trim();

    if (content.startsWith("$ref:")) {
      const reference = unquote(content.slice("$ref:".length));
      const name = reference.replace("#/components/parameters/", "");
      const found = components.get(name);
      if (!found) {
        throw new Error(
          `${where}:${i + 1}: ${reference} slår ikke opp i components.parameters. ` +
          `Kjente: ${[...components.keys()].join(", ") || "ingen"}.`
        );
      }
      ut.push(found);
      i = innerEnd;
      continue;
    }

    if (content.startsWith("{")) {
      const raa = readFlowScalar(content, `${where}:${i + 1}`);
      if (!raa.name || !raa.in) {
        throw new Error(`${where}:${i + 1}: parameteren mangler ${!raa.name ? "name" : "in"}.`);
      }
      const example = raa.example ?? raa.schema?.example ?? raa.schema?.default;
      ut.push({
        navn: String(raa.name),
        plassering: String(raa.in),
        paakrevd: String(raa.required) === "true",
        ...(example === undefined ? {} : { eksempel: String(example) }),
        ...(raa.description ? { beskrivelse: String(raa.description) } : {})
      });
      i = innerEnd;
      continue;
    }

    if (/^[\w$]+:/.test(content)) {
      // Blokkformen. Første line bærer «- » foran den første nøkkelen; bytt den
      // med to mellomrom, så hele oppføringen står med ett og samme innrykk.
      // Kopien er like lang som originalen, så linjenumrene i en feilmelding
      // fortsatt peker på riktig sted i filen.
      const copy = [...lines];
      copy[i] = lines[i].replace("- ", "  ");
      ut.push(readParameterFields(copy, i, innerEnd, baseIndent + 2, where));
      i = innerEnd;
      continue;
    }

    throw new Error(
      `${where}:${i + 1}: forsto ikke parameteroppføringen «${content}». Leseren kjenner ` +
      `blokkform, flytform på én line og $ref til components.parameters.`
    );
  }
  return ut;
}

/**
 * Eksempelkroppen for et POST- eller PUT-kall, som utforskeren fyller tekstfeltet
 * med.
 *
 * Bare strengformene leses: `example: "…"` og en blokkskalar. Et example skrevet
 * som en nestet mapping — formen OpenAPI egentlig mener — kaster, fordi å lese den
 * ville krevd en YAML-parser. Når skriving lander og eksempler skal inn i filene,
 * skriv dem som blokkskalar med JSON i, eller lær formen her. Ikke la leseren
 * droppe dem i stillhet.
 */
function readBodyExample(
  lines: string[], start: number, end: number, where: string
): string | undefined {
  for (let i = start; i < end; i++) {
    if (isBlank(lines[i])) continue;
    if (!/^\s*example:/.test(lines[i])) continue;
    const after = lines[i].slice(lines[i].indexOf(":") + 1).trim();
    if (after !== "" && !/^[>|][-+]?$/.test(after)) return unquote(after);
    const read = readFieldValue(lines, i);
    if (read.value === "") {
      throw new Error(
        `${where}:${i + 1}: requestBody-eksempelet er tomt eller en nestet mapping. Leseren ` +
        `leser bare strenger — skriv eksempelet som blokkskalar med JSON i, eller lær formen ` +
        `i apps/shared/openapi.ts.`
      );
    }
    return read.value;
  }
  return undefined;
}

/** components.parameters, som $ref-ene i paths slår opp i. */
function readComponentParameters(lines: string[], where: string): Map<string, Parameter> {
  const ut = new Map<string, Parameter>();
  const components = lines.findIndex((line) => /^components:\s*$/.test(line));
  if (components === -1) return ut;
  const componentsEnd = blockEnd(lines, components + 1, 0);

  let i = components + 1;
  while (i < componentsEnd) {
    if (isBlank(lines[i]) || !/^ {2}parameters:\s*$/.test(lines[i])) {
      i++;
      continue;
    }
    const end = blockEnd(lines, i + 1, 2);
    let j = i + 1;
    while (j < end) {
      if (isBlank(lines[j]) || indent(lines[j]) !== 4) {
        j++;
        continue;
      }
      const name = keyOf(lines[j]);
      const innerEnd = blockEnd(lines, j + 1, 4);
      ut.set(name, readParameterFields(lines, j + 1, innerEnd, 6, where));
      j = innerEnd;
    }
    i = end;
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
function readSecurity(
  lines: string[], start: number, end: number, where: string
): { schemes: string[]; scopes: string[] } {
  const schemes: string[] = [];
  const scopes: string[] = [];
  for (let i = start; i < end; i++) {
    if (isBlank(lines[i])) continue;
    const scheme = lines[i].match(/^\s*- (\w+):\s*(\[([^\]]*)\])?\s*$/);
    if (scheme) {
      schemes.push(scheme[1]);
      for (const scope of (scheme[3] || "").split(",")) {
        if (scope.trim()) scopes.push(scope.trim());
      }
      continue;
    }
    // Ordningen på egen line med scopene under seg.
    const lone = lines[i].match(/^\s*- ([a-z]+:[^\s]+)\s*$/);
    if (lone) {
      scopes.push(lone[1]);
      continue;
    }
    throw new Error(
      `${where}:${i + 1}: forsto ikke security-oppføringen «${lines[i].trim()}».`
    );
  }
  return { schemes, scopes };
}

export function readSpec(text: string, where = "spesifikasjonen"): Spec {
  const lines = text.split("\n");
  const components = readComponentParameters(lines, where);

  const spec: Spec = {
    title: where,
    paths: [],
    order: [],
    documentSecurity: false,
    documentSchemes: [],
    documentScopes: []
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line) || indent(line) !== 0) {
      i++;
      continue;
    }

    if (/^security:/.test(line)) {
      spec.documentSecurity = true;
      const end = blockEnd(lines, i + 1, 0);
      const read = readSecurity(lines, i + 1, end, where);
      spec.documentSchemes = read.schemes;
      spec.documentScopes = read.scopes;
      i = end;
      continue;
    }

    if (/^info:\s*$/.test(line)) {
      const end = blockEnd(lines, i + 1, 0);
      for (let j = i + 1; j < end; j++) {
        if (isBlank(lines[j]) || indent(lines[j]) !== 2) continue;
        const key = keyOf(lines[j]);
        if (key === "title") spec.title = readFieldValue(lines, j).value;
        if (key === "description") spec.description = readFieldValue(lines, j).value;
      }
      i = end;
      continue;
    }

    if (/^servers:\s*$/.test(line)) {
      const end = blockEnd(lines, i + 1, 0);
      for (let j = i + 1; j < end; j++) {
        const match = lines[j].match(/^\s*- url:\s*(\S+)\s*$/);
        if (match) {
          spec.server = unquote(match[1]);
          break;
        }
      }
      i = end;
      continue;
    }

    if (/^paths:\s*$/.test(line)) {
      const end = blockEnd(lines, i + 1, 0);
      readPaths(lines, i + 1, end, components, where, spec);
      i = end;
      continue;
    }

    i++;
  }

  return spec;
}

function readPaths(
  lines: string[],
  start: number,
  end: number,
  components: Map<string, Parameter>,
  where: string,
  spec: Spec
): void {
  let i = start;
  while (i < end) {
    const pathMatch = isBlank(lines[i]) ? null : lines[i].match(/^ {2}(\/\S*):\s*$/);
    if (!pathMatch) {
      i++;
      continue;
    }
    const stiSlutt = blockEnd(lines, i + 1, 2);
    const path: PathEntry = { path: pathMatch[1], line: i + 1, operations: [] };
    spec.paths.push(path);
    spec.order.push(pathMatch[1]);

    let j = i + 1;
    while (j < stiSlutt) {
      if (isBlank(lines[j]) || indent(lines[j]) !== 4) {
        j++;
        continue;
      }
      const metode = lines[j].match(/^ {4}([a-z]+):\s*$/);
      if (!metode || !HTTP_METHODS.includes(metode[1])) {
        // Alt annet på path-nivå enn en metode. `summary` og `description` er ren
        // prosa og kan ignoreres; `parameters` kan det ikke — den gjelder hver
        // operasjon under stien, og å hoppe over den ville gitt utforskeren et
        // skjema uten feltet og et kall som 404-er uten å si hvorfor.
        const key = keyOf(lines[j]);
        if (key !== "summary" && key !== "description") {
          throw new Error(
            `${where}:${j + 1}: «${key}» står på path-nivå under ${path.path}. Leseren leser ` +
            `bare operasjoner der. Hører den hjemme, hører formen i apps/shared/openapi.ts.`
          );
        }
        j++;
        continue;
      }
      const operasjonSlutt = blockEnd(lines, j + 1, 4);
      path.operations.push(
        readOperation(lines, j, operasjonSlutt, metode[1].toUpperCase(), components, where)
      );
      j = operasjonSlutt;
    }
    i = stiSlutt;
  }
}

function readOperation(
  lines: string[],
  start: number,
  end: number,
  metode: string,
  components: Map<string, Parameter>,
  where: string
): Operation {
  const operation: Operation = {
    metode,
    linje: start + 1,
    security: null,
    scopes: [],
    parametere: []
  };

  let i = start + 1;
  while (i < end) {
    if (isBlank(lines[i]) || indent(lines[i]) !== 6) {
      i++;
      continue;
    }
    const key = keyOf(lines[i]);

    if (key === "security") {
      const after = lines[i].slice(lines[i].indexOf(":") + 1).trim();
      if (/^\[\s*\]$/.test(after)) {
        operation.security = [];
        i++;
        continue;
      }
      const innerEnd = blockEnd(lines, i + 1, 6);
      const read = readSecurity(lines, i + 1, innerEnd, where);
      operation.security = read.schemes;
      operation.scopes = read.scopes;
      i = innerEnd;
      continue;
    }

    if (key === "parameters") {
      const innerEnd = blockEnd(lines, i + 1, 6);
      operation.parametere = readParameters(lines, i + 1, innerEnd, components, where);
      i = innerEnd;
      continue;
    }

    if (key === "requestBody") {
      const innerEnd = blockEnd(lines, i + 1, 6);
      operation.kroppEksempel = readBodyExample(lines, i + 1, innerEnd, where);
      i = innerEnd;
      continue;
    }

    if (key === "summary" || key === "description") {
      const read = readFieldValue(lines, i);
      if (key === "summary") operation.sammendrag = read.value;
      else operation.beskrivelse = read.value;
      i = read.next;
      continue;
    }

    // responses, tags, operationId og resten leses ikke. Se filhodet: grensen er
    // med vilje, ikke en mangel.
    i = blockEnd(lines, i + 1, 6);
  }

  return operation;
}

// --- det tjenestene serverer ----------------------------------------------

/** En operasjon med stien sin, som er formen utforskeren vil ha den i. */
export type Route = Operation & { sti: string };

export type RouteOverview = {
  tjeneste: string;
  beskrivelse?: string;
  /** Adressen utforskeren skal kalle. Fra servers: i spesifikasjonen. */
  server?: string;
  ruter: Route[];
};

/**
 * Svaret på GET /openapi-ruter.json.
 *
 * Hver tjeneste serverer sin egen spesifikasjon, lest. Grunnen til at det ikke er
 * nettleseren som leser YAML-en er at leseren er TypeScript i Node, og at sidene
 * her lastes uten byggsteg; grunnen til at det ikke er én samlerute i demo-gui er
 * at en tjeneste skal kunne svare for seg selv.
 */
export async function routeOverview(filePath: string): Promise<RouteOverview> {
  const spec = readSpec(await readFile(filePath, "utf8"), filePath);
  return {
    tjeneste: spec.title,
    // beskrivelse, ikke description: dette er wire. TypeScript ser det ikke — et
    // spread-uttrykk omgår excess property-sjekken, så nøkkelen kan skifte navn
    // uten at tsc sier fra. Sjekken som fanger det er en diff av
    // /openapi-ruter.json før og etter.
    ...(spec.description ? { beskrivelse: spec.description } : {}),
    ...(spec.server ? { server: spec.server } : {}),
    // En operasjon uten egen security: arver dokumentets. Uten den oppløsningen
    // her ville de fire tjenestene som erklærer «security: []» én gang på toppen
    // sett ut som om hjemmelen deres var udokumentert.
    ruter: spec.paths.flatMap((path) =>
      path.operations.map((operation) => ({
        sti: path.path,
        ...operation,
        security: operation.security ?? (spec.documentSecurity ? spec.documentSchemes : null),
        scopes: operation.security ? operation.scopes : spec.documentScopes
      }))
    )
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Hjemmelen en route krever, sagt på norsk, avledet av `security:`. */
export function hjemmelFor(route: Route): string {
  if (route.security === null) return "udokumentert";
  if (route.security.length === 0) return "åpen";
  const scopes = route.scopes.length ? ` (${route.scopes.join(", ")})` : "";
  return route.security.join(" eller ") + scopes;
}

/**
 * En /docs-side generert av spesifikasjonen.
 *
 * Grunnen til at den genereres: en håndskrevet liste er en tredje sannhet ved
 * siden av koden og spesifikasjonen, og de to første holdes i takt av
 * pnpm test:openapi mens den tredje driver i stillhet. Tjenestene som allerede
 * har en håndskrevet side beholder den; denne er for de som ikke har noen.
 */
export function docsHtml(overview: RouteOverview, explorer = "http://localhost:3001/explorer"): string {
  const rows = overview.ruter
    .map((route) =>
      `        <tr><td><code>${escapeHtml(route.metode)}</code></td>` +
      `<td><code>${escapeHtml(route.sti)}</code></td>` +
      `<td>${escapeHtml(route.sammendrag || "")}</td>` +
      `<td>${escapeHtml(hjemmelFor(route))}</td></tr>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="nb">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(overview.tjeneste)}</title>
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
    <h1>${escapeHtml(overview.tjeneste)}</h1>
    ${overview.beskrivelse ? `<p class="ingress">${escapeHtml(overview.beskrivelse)}</p>` : ""}
    <div class="lenker">
      <a href="/openapi.yaml">Spesifikasjonen</a>
      <a href="/openapi-ruter.json">Samme, lest, som JSON</a>
      <a href="${escapeHtml(explorer)}">Prøv rutene i API-utforskeren</a>
    </div>
    <p class="ingress">Denne siden er generert av spesifikasjonen, ikke skrevet for hånd.
      <code>pnpm test:openapi</code> holder spesifikasjonen i takt med koden, så listen under
      kan ikke drive fra rutene tjenesten faktisk har.</p>
    <table>
      <thead><tr><th>Metode</th><th>Sti</th><th>Hva den gjør</th><th>Hjemmel</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </body>
</html>`;
}
