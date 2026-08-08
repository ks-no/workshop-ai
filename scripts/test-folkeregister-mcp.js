import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const serverPath = path.resolve(repoRoot, "apps/folkeregister-mcp/src/server.js");

// Newline-delimited JSON, exactly as MCP's stdio transport specifies — and as a
// real client (Claude Code, @modelcontextprotocol/sdk) speaks it. Keep this in
// step with the server: if both sides drift to some other framing again, this
// test goes green while no real client can connect.
function encode(message) {
  return Buffer.from(JSON.stringify(message) + "\n", "utf8");
}

function createMessageParser(onMessage) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const newlineIndex = buffer.indexOf(0x0a);
      if (newlineIndex === -1) return;
      const line = buffer.subarray(0, newlineIndex).toString("utf8").trim();
      buffer = buffer.subarray(newlineIndex + 1);
      if (!line) continue;
      onMessage(JSON.parse(line));
    }
  };
}

async function main() {
  const child = spawn("node", [serverPath], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env
  });
  child.stderr.on("data", (chunk) => process.stderr.write(`[folkeregister-mcp] ${chunk.toString("utf8")}`));

  const pending = new Map();
  let requestId = 0;
  child.stdout.on("data", createMessageParser((message) => {
    const resolver = pending.get(message.id);
    if (!resolver) return;
    pending.delete(message.id);
    resolver(message);
  }));

  function sendRequest(method, params = {}) {
    requestId += 1;
    const id = requestId;
    child.stdin.write(encode({ jsonrpc: "2.0", id, method, params }));
    return new Promise((resolve) => pending.set(id, resolve));
  }

  const init = await sendRequest("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0.1.0" } });
  if (init.error) throw new Error(`initialize failed: ${init.error.message}`);

  const toolList = await sendRequest("tools/list", {});
  if (toolList.error) throw new Error(`tools/list failed: ${toolList.error.message}`);
  const names = (toolList.result?.tools || []).map((t) => t.name);
  if (!names.includes("folkeregister_search_persons") || !names.includes("folkeregister_get_person")) {
    throw new Error(`Unexpected tools: ${JSON.stringify(names)}`);
  }

  // Search by name
  const searchResult = await sendRequest("tools/call", {
    name: "folkeregister_search_persons",
    arguments: { query: "Maja Solberg", limit: 3 }
  });
  if (searchResult.error) throw new Error(`search failed: ${searchResult.error.message}`);
  const searchPayload = searchResult.result?.structuredContent;
  if (!searchPayload?.count || searchPayload.count < 1) {
    throw new Error("Expected at least one person result for 'Maja Solberg'");
  }

  // Get by fnr
  const getResult = await sendRequest("tools/call", {
    name: "folkeregister_get_person",
    arguments: { foedselsEllerDNummer: "12018890001" }
  });
  if (getResult.error) throw new Error(`get failed: ${getResult.error.message}`);
  const person = getResult.result?.structuredContent;
  if (person?.foedselsEllerDNummer !== "12018890001") {
    throw new Error(`Expected fnr 12018890001, got ${person?.foedselsEllerDNummer}`);
  }

  // Get by sandbox personId
  const byIdResult = await sendRequest("tools/call", {
    name: "folkeregister_get_person",
    arguments: { personId: "person-001" }
  });
  if (byIdResult.error) throw new Error(`get by personId failed: ${byIdResult.error.message}`);
  if (byIdResult.result?.structuredContent?._sandbox?.personId !== "person-001") {
    throw new Error("Get by personId did not return expected person");
  }

  // Verify skjermet person is blocked
  const skjermetResult = await sendRequest("tools/call", {
    name: "folkeregister_get_person",
    arguments: { foedselsEllerDNummer: "16048390031" }
  });
  if (!skjermetResult.error && !skjermetResult.result?.isError) {
    // Should error because person-031 (Siri Rustad) is skjermet
    // The server returns an MCP error for skjermet persons
    throw new Error("Expected error for skjermet person, got success");
  }

  console.log("folkeregister-mcp test passed");
  child.kill();
}

main().catch((error) => {
  console.error(`folkeregister-mcp test failed: ${error.message}`);
  process.exit(1);
});

