import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { feilmelding } from "../../shared/errors.ts";
import type { Adresse, Organisasjon, TenorEnhet } from "../../shared/registerdata.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = process.env.BRREG_DATA_FILE || path.resolve(__dirname, "../../../data/brreg.seed.json");
const protocolVersion = "2024-11-05";

type Register = { organizations: Organisasjon[]; byOrgNumber: Map<string, Organisasjon> };

// --- MCP over JSON-RPC 2.0 -------------------------------------------------

type JsonRpcId = string | number | null;

type JsonRpcMelding = {
  jsonrpc?: unknown;
  id?: JsonRpcId;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
};

type JsonRpcSvar = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type Verktoy = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
};


function normalize(value: unknown): string {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value: unknown, fallback = 0): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseEmbeddedMetadata(doc: TenorEnhet): TenorEnhet | null {
  const raw = doc?.tenorMetadata?.kildedata;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    // Kildedata er en JSON-streng inne i JSON-en. Samme form som ytterdokumentet.
    return JSON.parse(raw) as TenorEnhet;
  } catch {
    return null;
  }
}

function toOrganization(doc: TenorEnhet): Organisasjon {
  const embedded = parseEmbeddedMetadata(doc);
  const orgForm = embedded?.organisasjonsform || {};
  const addr = doc?.forretningsadresse || embedded?.forretningsadresse || null;
  const postAddr = doc?.postadresse || embedded?.postadresse || null;

  return {
    organisasjonsnummer: String(doc?.organisasjonsnummer || embedded?.organisasjonsnummer || ""),
    navn: String(doc?.navn || embedded?.navn || ""),
    organisasjonsform: {
      kode: orgForm?.kode ? String(orgForm.kode) : null,
      beskrivelse: orgForm?.beskrivelse ? String(orgForm.beskrivelse) : null
    },
    naeringKode: Array.isArray(doc?.naeringKode) ? doc.naeringKode.map(String) : [],
    naeringBeskrivelse: Array.isArray(doc?.naeringBeskrivelse) ? doc.naeringBeskrivelse.map(String) : [],
    registrertIForetaksregisteret: Boolean(doc?.registrertIForetaksregisteret),
    registrertIMvaregisteret: Boolean(doc?.registrertIMvaregisteret),
    antallUnderenheter: doc?.antallUnderenheter ?? null,
    forretningsadresse: addr,
    postadresse: postAddr,
    telefonnummer: doc?.telefonnummer ? String(doc.telefonnummer) : null,
    nettside: doc?.hjemmeside ? String(doc.hjemmeside) : null,
    _search: normalize([
      doc?.organisasjonsnummer,
      doc?.navn,
      orgForm?.kode,
      orgForm?.beskrivelse,
      addr?.kommune,
      addr?.poststed,
      postAddr?.kommune,
      postAddr?.poststed,
      ...(Array.isArray(doc?.naeringKode) ? doc.naeringKode : []),
      ...(Array.isArray(doc?.naeringBeskrivelse) ? doc.naeringBeskrivelse : [])
    ].filter(Boolean).join(" "))
  };
}

async function loadRegister(): Promise<Register> {
  const raw = await readFile(dataFile, "utf8");
  const parsed = JSON.parse(raw) as { dokumentListe?: unknown };
  const list = Array.isArray(parsed?.dokumentListe) ? parsed.dokumentListe : [];
  const organizations = (list as TenorEnhet[]).map(toOrganization).filter((o) => o.organisasjonsnummer && o.navn);
  const byOrgNumber = new Map(organizations.map((o) => [o.organisasjonsnummer, o]));
  return { organizations, byOrgNumber };
}

function toolTextResult(payload: unknown): Record<string, unknown> {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ],
    structuredContent: payload
  };
}

function matchOrganizations(args: Record<string, unknown>, register: Register): Record<string, unknown> {
  const query = normalize(args.query || args.q || "");
  const kommune = normalize(args.kommune || "");
  const organisasjonsform = normalize(args.organisasjonsform || "");
  const offset = Math.max(0, parseNumber(args.offset, 0));
  const limit = Math.max(1, Math.min(parseNumber(args.limit, 10), 100));

  const filtered = register.organizations.filter((org) => {
    if (query && !org._search.includes(query)) return false;
    if (kommune) {
      const kommuneValues = [org.forretningsadresse?.kommune, org.postadresse?.kommune]
        .filter(Boolean)
        .map(normalize);
      if (!kommuneValues.some((value) => value.includes(kommune))) return false;
    }
    if (organisasjonsform) {
      const formSearch = normalize(`${org.organisasjonsform?.kode || ""} ${org.organisasjonsform?.beskrivelse || ""}`);
      if (!formSearch.includes(organisasjonsform)) return false;
    }
    return true;
  });

  const page = filtered.slice(offset, offset + limit).map((org) => ({
    organisasjonsnummer: org.organisasjonsnummer,
    navn: org.navn,
    organisasjonsform: org.organisasjonsform,
    naeringKode: org.naeringKode,
    registrertIForetaksregisteret: org.registrertIForetaksregisteret,
    registrertIMvaregisteret: org.registrertIMvaregisteret,
    forretningsadresse: org.forretningsadresse
  }));

  return {
    total: filtered.length,
    offset,
    limit,
    count: page.length,
    organisasjoner: page
  };
}

function getOrganization(args: Record<string, unknown>, register: Register): Omit<Organisasjon, "_search"> {
  const organisasjonsnummer = String(args.organisasjonsnummer || "").trim();
  if (!organisasjonsnummer) {
    throw new Error("organisasjonsnummer is required.");
  }
  const org = register.byOrgNumber.get(organisasjonsnummer);
  if (!org) {
    throw new Error(`Fant ikke organisasjon med organisasjonsnummer ${organisasjonsnummer}.`);
  }
  const { _search, ...result } = org;
  return result;
}

function makeTools(): Verktoy[] {
  return [
    {
      name: "brreg_search_organisations",
      title: "Search organisations",
      description: "Search BRREG Enhetsregisteret testdata for organisations by name/orgnr and optional filters.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Free text search over orgnr, navn, and industry info." },
          kommune: { type: "string", description: "Optional municipality filter." },
          organisasjonsform: { type: "string", description: "Optional organization type filter, e.g. AS." },
          offset: { type: "integer", minimum: 0, default: 0 },
          limit: { type: "integer", minimum: 1, maximum: 100, default: 10 }
        }
      }
    },
    {
      name: "brreg_get_organisation",
      title: "Get organisation",
      description: "Get one organisation by organisasjonsnummer.",
      inputSchema: {
        type: "object",
        required: ["organisasjonsnummer"],
        properties: {
          organisasjonsnummer: { type: "string" }
        }
      }
    }
  ];
}

function createErrorResponse(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcSvar {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data })
    }
  };
}

function createSuccessResponse(id: JsonRpcId, result: unknown): JsonRpcSvar {
  return {
    jsonrpc: "2.0",
    id,
    result
  };
}

// MCP's stdio transport is newline-delimited JSON: one message per line, no
// headers. An earlier version framed messages with LSP's `Content-Length`
// header, which made every real MCP client hang - the client writes `{...}\n`,
// and this server waited forever for a header that never arrived. The bundled
// test script repeated the same framing, so it passed while nothing else could
// connect.
function encodeMessage(message: JsonRpcSvar): Buffer {
  // JSON.stringify escapes newlines inside strings, so the payload can never
  // contain a raw \n and break the framing.
  return Buffer.from(JSON.stringify(message) + "\n", "utf8");
}

function createMessageReader(onMessage: (melding: JsonRpcMelding) => void): (chunk: Buffer) => void {
  let buffer = Buffer.alloc(0);

  return (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (true) {
      const newlineIndex = buffer.indexOf(0x0a);
      if (newlineIndex === -1) return;

      // Split on the byte, then decode - a multi-byte character straddling two
      // chunks would be corrupted if we decoded first.
      // trim() also drops the \r a CRLF client leaves behind.
      const line = buffer.subarray(0, newlineIndex).toString("utf8").trim();
      buffer = buffer.subarray(newlineIndex + 1);

      if (!line) continue;

      try {
        onMessage(JSON.parse(line) as JsonRpcMelding);
      } catch (error) {
        const response = createErrorResponse(null, -32700, "Parse error", feilmelding(error));
        process.stdout.write(encodeMessage(response));
      }
    }
  };
}

async function main(): Promise<void> {
  const register = await loadRegister();
  const tools = makeTools();

  const handleMessage = async (message: JsonRpcMelding): Promise<void> => {
    if (typeof message !== "object" || message === null) return;
    if (message.jsonrpc !== "2.0") {
      const response = createErrorResponse(message.id ?? null, -32600, "Invalid Request");
      process.stdout.write(encodeMessage(response));
      return;
    }

    // Notification: no id means no response.
    if (message.id === undefined) {
      return;
    }

    try {
      if (message.method === "initialize") {
        const response = createSuccessResponse(message.id ?? null, {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: {
            name: "brreg-mcp",
            version: "0.1.0"
          }
        });
        process.stdout.write(encodeMessage(response));
        return;
      }

      if (message.method === "ping") {
        process.stdout.write(encodeMessage(createSuccessResponse(message.id ?? null, {})));
        return;
      }

      if (message.method === "tools/list") {
        process.stdout.write(encodeMessage(createSuccessResponse(message.id ?? null, { tools })));
        return;
      }

      if (message.method === "tools/call") {
        const name = message.params?.name;
        const args = message.params?.arguments || {};

        if (name === "brreg_search_organisations") {
          const payload = matchOrganizations(args, register);
          process.stdout.write(encodeMessage(createSuccessResponse(message.id ?? null, toolTextResult(payload))));
          return;
        }

        if (name === "brreg_get_organisation") {
          const payload = getOrganization(args, register);
          process.stdout.write(encodeMessage(createSuccessResponse(message.id ?? null, toolTextResult(payload))));
          return;
        }

        process.stdout.write(encodeMessage(createErrorResponse(message.id ?? null, -32601, `Unknown tool: ${name}`)));
        return;
      }

      process.stdout.write(encodeMessage(createErrorResponse(message.id ?? null, -32601, `Method not found: ${message.method}`)));
    } catch (error) {
      process.stdout.write(encodeMessage(createErrorResponse(message.id ?? null, -32000, feilmelding(error) || "Server error")));
    }
  };

  const reader = createMessageReader((message) => {
    void handleMessage(message);
  });

  process.stdin.on("data", reader);
  process.stdin.on("error", (error: unknown) => {
    process.stderr.write(`stdin error: ${feilmelding(error)}\n`);
  });
  process.stderr.write(`brreg-mcp ready with ${register.organizations.length} organizations from ${dataFile}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed to start brreg-mcp: ${feilmelding(error)}\n`);
  process.exit(1);
});


