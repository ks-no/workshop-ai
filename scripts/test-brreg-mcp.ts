import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { feilmelding } from "../apps/shared/errors.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const serverPath = path.resolve(repoRoot, "apps/brreg-mcp/src/server.ts");

// Newline-delimited JSON, exactly as MCP's stdio transport specifies - and as a
// real client (Claude Code, @modelcontextprotocol/sdk) speaks it. Keep this in
// step with the server: if both sides drift to some other framing again, this
// test goes green while no real client can connect.
/*
 * Svarformen fra en MCP-server. Testen er nettopp til for å sjekke at svaret har
 * den formen, så feltene står som valgfrie - en type som lover dem ville skjult
 * det testen finnes for å oppdage.
 */
type McpSvar = {
  jsonrpc?: string;
  id?: number;
  result?: any;
  error?: { code?: number; message?: string };
};

function encode(message: McpSvar | Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify(message) + "\n", "utf8");
}

function createMessageParser(onMessage: (melding: McpSvar) => void): (chunk: Buffer) => void {
  let buffer = Buffer.alloc(0);
  return (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const newlineIndex = buffer.indexOf(0x0a);
      if (newlineIndex === -1) return;
      const line = buffer.subarray(0, newlineIndex).toString("utf8").trim();
      buffer = buffer.subarray(newlineIndex + 1);
      if (!line) continue;
      onMessage(JSON.parse(line) as McpSvar);
    }
  };
}

async function main() {
  const child = spawn("node", [serverPath], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env
  });

  child.stderr.on("data", (chunk: Buffer) => {
    process.stderr.write(`[brreg-mcp] ${chunk.toString("utf8")}`);
  });

  const pending = new Map<number, (melding: McpSvar) => void>();
  let requestId = 0;

  child.stdout.on("data", createMessageParser((message: McpSvar) => {
    const resolver = pending.get(message.id!);
    if (!resolver) return;
    pending.delete(message.id!);
    resolver(message);
  }));

  function sendRequest(method: string, params: Record<string, unknown> = {}): Promise<McpSvar> {
    requestId += 1;
    const id = requestId;
    const payload = { jsonrpc: "2.0", id, method, params };
    child.stdin.write(encode(payload));
    return new Promise<McpSvar>((resolve) => pending.set(id, resolve));
  }

  const init = await sendRequest("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "local-test", version: "0.1.0" }
  });
  if (init.error) throw new Error(`initialize failed: ${init.error.message}`);

  const tools = await sendRequest("tools/list", {});
  if (tools.error) throw new Error(`tools/list failed: ${tools.error.message}`);
  const names = (tools.result?.tools || []).map((tool: { name: string }) => tool.name);
  if (!names.includes("brreg_search_organisations") || !names.includes("brreg_get_organisation")) {
    throw new Error(`Unexpected tools list: ${JSON.stringify(names)}`);
  }

  const search = await sendRequest("tools/call", {
    name: "brreg_search_organisations",
    arguments: { query: "RING SJOKKERT TIGER AS", limit: 1 }
  });
  if (search.error) throw new Error(`tools/call search failed: ${search.error.message}`);
  const searchResult = search.result?.structuredContent;
  if (!searchResult || searchResult.count < 1) {
    throw new Error("Expected at least one organisation search hit");
  }

  const getOne = await sendRequest("tools/call", {
    name: "brreg_get_organisation",
    arguments: { organisasjonsnummer: "310633372" }
  });
  if (getOne.error) throw new Error(`tools/call get failed: ${getOne.error.message}`);
  if (getOne.result?.structuredContent?.organisasjonsnummer !== "310633372") {
    throw new Error("Unexpected organisation payload from get tool");
  }

  console.log("brreg-mcp test passed");
  child.kill();
}

main().catch((error) => {
  console.error(`brreg-mcp test failed: ${feilmelding(error)}`);
  process.exit(1);
});

