import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const serverPath = path.resolve(repoRoot, "apps/brreg-mcp/src/server.js");

function encode(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8"),
    body
  ]);
}

function createMessageParser(onMessage) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = buffer.subarray(0, headerEnd).toString("utf8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) throw new Error("Missing Content-Length header in response");
      const length = Number.parseInt(match[1], 10);
      const start = headerEnd + 4;
      const end = start + length;
      if (buffer.length < end) return;
      const body = buffer.subarray(start, end).toString("utf8");
      buffer = buffer.subarray(end);
      onMessage(JSON.parse(body));
    }
  };
}

async function main() {
  const child = spawn("node", [serverPath], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env
  });

  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[brreg-mcp] ${chunk.toString("utf8")}`);
  });

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
    const payload = { jsonrpc: "2.0", id, method, params };
    child.stdin.write(encode(payload));
    return new Promise((resolve) => pending.set(id, resolve));
  }

  const init = await sendRequest("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "local-test", version: "0.1.0" }
  });
  if (init.error) throw new Error(`initialize failed: ${init.error.message}`);

  const tools = await sendRequest("tools/list", {});
  if (tools.error) throw new Error(`tools/list failed: ${tools.error.message}`);
  const names = (tools.result?.tools || []).map((tool) => tool.name);
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
  console.error(`brreg-mcp test failed: ${error.message}`);
  process.exit(1);
});

