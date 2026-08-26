import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { feilmelding } from "../../shared/errors.ts";
import type { FolkeregisterPerson } from "../../shared/registerdata.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = process.env.FOLKEREGISTER_DATA_FILE ||
  path.resolve(__dirname, "../../../data/folkeregister.seed.json");
const protocolVersion = "2024-11-05";

type Register = {
  persons: FolkeregisterPerson[];
  byFnr: Map<string, FolkeregisterPerson>;
  byPersonId: Map<string, FolkeregisterPerson>;
};

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

function buildSearchIndex(person: FolkeregisterPerson): string {
  const navn = person.personnavn;
  return normalize([
    person.foedselsEllerDNummer,
    navn?.fornavn,
    navn?.mellomnavn,
    navn?.etternavn,
    navn?.fornavn && navn?.etternavn ? `${navn.fornavn} ${navn.etternavn}` : null,
    person.bostedsadresse?.kommune,
    person.bostedsadresse?.poststed,
    person.bostedsadresse?.postnummer,
    person._sandbox?.personId,
    person._sandbox?.husstandId,
    person._sandbox?.rolle
  ].filter(Boolean).join(" "));
}

async function loadRegister(): Promise<Register> {
  const raw = await readFile(dataFile, "utf8");
  const parsed = JSON.parse(raw) as { personer?: unknown };

  // Resolve _sandboxRelatertPersonId → foedselsEllerDNummer for easy joins
  const persons: FolkeregisterPerson[] = Array.isArray(parsed?.personer) ? parsed.personer : [];

  // Build personId → fnr map for relation resolution
  const sandboxIdToFnr = new Map<string, string>(
    persons
      .filter((p) => p._sandbox?.personId && p.foedselsEllerDNummer)
      .map((p) => [p._sandbox!.personId!, p.foedselsEllerDNummer!])
  );

  for (const person of persons) {
    person._searchIndex = buildSearchIndex(person);
    // Resolve sandbox relation ids to real fnr
    for (const rel of person.forelderbarnrelasjon || []) {
      if (!rel.relatertPersonsIdent && rel._sandboxRelatertPersonId) {
        rel.relatertPersonsIdent = sandboxIdToFnr.get(rel._sandboxRelatertPersonId) || null;
      }
    }
  }

  const byFnr = new Map<string, FolkeregisterPerson>(
    persons.filter((p) => p.foedselsEllerDNummer).map((p) => [p.foedselsEllerDNummer!, p])
  );
  const byPersonId = new Map<string, FolkeregisterPerson>(
    persons
      .filter((p) => p._sandbox?.personId)
      .map((p) => [p._sandbox!.personId!, p])
  );

  return { persons, byFnr, byPersonId };
}

function safeResponse(person: FolkeregisterPerson | undefined): Omit<FolkeregisterPerson, "_searchIndex"> | null {
  if (!person) return null;
  // Omit internal search index from output
  const { _searchIndex, ...result } = person;
  return result;
}

function toolTextResult(payload: unknown): Record<string, unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload
  };
}

function searchPersons(args: Record<string, unknown>, register: Register): Record<string, unknown> {
  const query = normalize(args.query || args.q || "");
  const fnr = String(args.foedselsEllerDNummer || args.fnr || "").trim();
  const kommune = normalize(args.kommune || "");
  const offset = Math.max(0, parseNumber(args.offset, 0));
  const limit = Math.max(1, Math.min(parseNumber(args.limit, 10), 100));
  const includeSkjermet = Boolean(args.includeSkjermet);

  if (fnr) {
    const person = register.byFnr.get(fnr);
    if (!person) return { total: 0, offset, limit, count: 0, personer: [] };
    if (person.skjermet && !includeSkjermet) {
      return { total: 0, offset, limit, count: 0, personer: [], merknad: "Skjermet person." };
    }
    return { total: 1, offset: 0, limit, count: 1, personer: [safeResponse(person)] };
  }

  const filtered = register.persons.filter((person) => {
    if (person.skjermet && !includeSkjermet) return false;
    if (query && !person._searchIndex?.includes(query)) return false;
    if (kommune) {
      const komVal = normalize(String(person.bostedsadresse?.kommune || ""));
      if (!komVal.includes(kommune)) return false;
    }
    return true;
  });

  const page = filtered.slice(offset, offset + limit).map((person) => ({
    foedselsEllerDNummer: person.foedselsEllerDNummer,
    personnavn: person.personnavn,
    foedselsdato: person.foedselsdato,
    kjoenn: person.kjoenn,
    sivilstand: person.sivilstand,
    bostedsadresse: person.bostedsadresse,
    skjermet: person.skjermet,
    _sandbox: person._sandbox
  }));

  return { total: filtered.length, offset, limit, count: page.length, personer: page };
}

function getPerson(args: Record<string, unknown>, register: Register): Omit<FolkeregisterPerson, "_searchIndex"> | null {
  const fnr = String(args.foedselsEllerDNummer || args.fnr || "").trim();
  const personId = String(args.personId || "").trim();

  if (!fnr && !personId) {
    throw new Error("Oppgi foedselsEllerDNummer eller personId.");
  }

  const person = fnr ? register.byFnr.get(fnr) : register.byPersonId.get(personId);
  if (!person) {
    throw new Error(`Fant ikke person med ${fnr ? `foedselsEllerDNummer ${fnr}` : `personId ${personId}`}.`);
  }

  if (person.skjermet && !args.includeSkjermet) {
    throw new Error("Personen er skjermet og kan ikke hentes uten eksplisitt tilgang.");
  }

  return safeResponse(person);
}

function makeTools(): Verktoy[] {
  return [
    {
      name: "folkeregister_search_persons",
      title: "Search persons",
      description: "Search Folkeregisteret syntetiske testdata for persons by name, fødselsnummer, or municipality.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Free text search over name, fnr, personId, commune, poststed." },
          foedselsEllerDNummer: { type: "string", description: "Exact fødselsnummer or D-nummer lookup." },
          fnr: { type: "string", description: "Alias for foedselsEllerDNummer." },
          kommune: { type: "string", description: "Municipality filter." },
          includeSkjermet: { type: "boolean", default: false, description: "Include shielded persons. Default false." },
          offset: { type: "integer", minimum: 0, default: 0 },
          limit: { type: "integer", minimum: 1, maximum: 100, default: 10 }
        }
      }
    },
    {
      name: "folkeregister_get_person",
      title: "Get person",
      description: "Get one person from Folkeregisteret by fødselsnummer (foedselsEllerDNummer) or sandbox personId.",
      inputSchema: {
        type: "object",
        properties: {
          foedselsEllerDNummer: { type: "string" },
          fnr: { type: "string", description: "Alias for foedselsEllerDNummer." },
          personId: { type: "string", description: "Sandbox personId, e.g. person-001." },
          includeSkjermet: { type: "boolean", default: false }
        }
      }
    }
  ];
}

function createErrorResponse(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcSvar {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) }
  };
}

function createSuccessResponse(id: JsonRpcId, result: unknown): JsonRpcSvar {
  return { jsonrpc: "2.0", id, result };
}

// Newline-delimited JSON framing, mirrored from apps/brreg-mcp/src/server.ts —
// see the comments there (encodeMessage and createMessageReader included).
function encodeMessage(message: JsonRpcSvar): Buffer {
  return Buffer.from(JSON.stringify(message) + "\n", "utf8");
}

function createMessageReader(onMessage: (melding: JsonRpcMelding) => void): (chunk: Buffer) => void {
  let buffer = Buffer.alloc(0);
  return (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const newlineIndex = buffer.indexOf(0x0a);
      if (newlineIndex === -1) return;
      const line = buffer.subarray(0, newlineIndex).toString("utf8").trim();
      buffer = buffer.subarray(newlineIndex + 1);
      if (!line) continue;
      try {
        onMessage(JSON.parse(line) as JsonRpcMelding);
      } catch (error) {
        process.stdout.write(encodeMessage(createErrorResponse(null, -32700, "Parse error", feilmelding(error))));
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
      process.stdout.write(encodeMessage(createErrorResponse(message.id ?? null, -32600, "Invalid Request")));
      return;
    }
    // Notification — no response
    if (message.id === undefined) return;

    try {
      if (message.method === "initialize") {
        process.stdout.write(encodeMessage(createSuccessResponse(message.id ?? null, {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "folkeregister-mcp", version: "0.1.0" }
        })));
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

        if (name === "folkeregister_search_persons") {
          process.stdout.write(encodeMessage(createSuccessResponse(message.id ?? null, toolTextResult(searchPersons(args, register)))));
          return;
        }

        if (name === "folkeregister_get_person") {
          process.stdout.write(encodeMessage(createSuccessResponse(message.id ?? null, toolTextResult(getPerson(args, register)))));
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

  const reader = createMessageReader((message: JsonRpcMelding) => { void handleMessage(message); });
  process.stdin.on("data", reader);
  process.stdin.on("error", (error: unknown) => { process.stderr.write(`stdin error: ${feilmelding(error)}\n`); });
  process.stderr.write(`folkeregister-mcp ready with ${register.persons.length} persons from ${dataFile}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed to start folkeregister-mcp: ${feilmelding(error)}\n`);
  process.exit(1);
});

