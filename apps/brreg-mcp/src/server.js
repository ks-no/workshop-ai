import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = process.env.BRREG_DATA_FILE || path.resolve(__dirname, "../../../data/brreg.seed.json");
const protocolVersion = "2024-11-05";

function normalize(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseEmbeddedMetadata(doc) {
  const raw = doc?.tenorMetadata?.kildedata;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toOrganization(doc) {
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

async function loadRegister() {
  const raw = await readFile(dataFile, "utf8");
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed?.dokumentListe) ? parsed.dokumentListe : [];
  const organizations = list.map(toOrganization).filter((o) => o.organisasjonsnummer && o.navn);
  const byOrgNumber = new Map(organizations.map((o) => [o.organisasjonsnummer, o]));
  return { organizations, byOrgNumber };
}

function toolTextResult(payload) {
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

function matchOrganizations(args, register) {
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

function getOrganization(args, register) {
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

function makeTools() {
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

function createErrorResponse(id, code, message, data) {
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

function createSuccessResponse(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result
  };
}

function encodeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = `Content-Length: ${body.length}\r\n\r\n`;
  return Buffer.concat([Buffer.from(header, "utf8"), body]);
}

function createMessageReader(onMessage) {
  let buffer = Buffer.alloc(0);

  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      const headerText = buffer.subarray(0, headerEnd).toString("utf8");
      const match = headerText.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        buffer = Buffer.alloc(0);
        return;
      }

      const contentLength = Number.parseInt(match[1], 10);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;
      if (buffer.length < messageEnd) return;

      const bodyText = buffer.subarray(messageStart, messageEnd).toString("utf8");
      buffer = buffer.subarray(messageEnd);

      try {
        const parsed = JSON.parse(bodyText);
        onMessage(parsed);
      } catch (error) {
        const response = createErrorResponse(null, -32700, "Parse error", error.message);
        process.stdout.write(encodeMessage(response));
      }
    }
  };
}

async function main() {
  const register = await loadRegister();
  const tools = makeTools();

  const handleMessage = async (message) => {
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
        const response = createSuccessResponse(message.id, {
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
        process.stdout.write(encodeMessage(createSuccessResponse(message.id, {})));
        return;
      }

      if (message.method === "tools/list") {
        process.stdout.write(encodeMessage(createSuccessResponse(message.id, { tools })));
        return;
      }

      if (message.method === "tools/call") {
        const name = message.params?.name;
        const args = message.params?.arguments || {};

        if (name === "brreg_search_organisations") {
          const payload = matchOrganizations(args, register);
          process.stdout.write(encodeMessage(createSuccessResponse(message.id, toolTextResult(payload))));
          return;
        }

        if (name === "brreg_get_organisation") {
          const payload = getOrganization(args, register);
          process.stdout.write(encodeMessage(createSuccessResponse(message.id, toolTextResult(payload))));
          return;
        }

        process.stdout.write(encodeMessage(createErrorResponse(message.id, -32601, `Unknown tool: ${name}`)));
        return;
      }

      process.stdout.write(encodeMessage(createErrorResponse(message.id, -32601, `Method not found: ${message.method}`)));
    } catch (error) {
      process.stdout.write(encodeMessage(createErrorResponse(message.id, -32000, error.message || "Server error")));
    }
  };

  const reader = createMessageReader((message) => {
    void handleMessage(message);
  });

  process.stdin.on("data", reader);
  process.stdin.on("error", (error) => {
    process.stderr.write(`stdin error: ${error.message}\n`);
  });
  process.stderr.write(`brreg-mcp ready with ${register.organizations.length} organizations from ${dataFile}\n`);
}

main().catch((error) => {
  process.stderr.write(`Failed to start brreg-mcp: ${error.message}\n`);
  process.exit(1);
});


