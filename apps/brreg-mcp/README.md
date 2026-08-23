# BRREG MCP Service

A real Model Context Protocol server for BRREG Enhetsregisteret test data —
JSON-RPC 2.0 over **stdio**, newline-delimited, so an actual MCP client connects
to it. Unlike `apps/tools-api`, which is REST that only borrows the name.

## What it does

Two MCP tools:

- `brreg_search_organisations` — search by name or organisation number, with
  optional `kommune` and `organisasjonsform` filters, paged via `offset`/`limit`.
- `brreg_get_organisation` — fetch one organisation by `organisasjonsnummer`.

## Data source

Reads `data/brreg.seed.json` (200 synthetic organisations from Tenor). Override
with an absolute path:

```bash
BRREG_DATA_FILE=/absolute/path/to/export.json node apps/brreg-mcp/src/server.ts
```

The server resolves the default relative to its own location, so it works no
matter where you start it from.

## Run

```bash
node apps/brreg-mcp/src/server.ts
```

It speaks stdio, so on its own it just waits. Point a client at it.

## Verify

The bundled script spawns the server and drives it end to end:

```bash
pnpm test:brreg-mcp
```

That test implements the client side itself, so it proves the two halves agree —
not that the framing matches the MCP spec. **When you touch the transport, check
against a real client too:**

```bash
npx -y @modelcontextprotocol/inspector --cli \
  node apps/brreg-mcp/src/server.ts --method tools/list
```

Both tools should be listed. `Connection timed out` means the framing broke.

> This is not hypothetical. The first version framed messages with LSP's
> `Content-Length` header instead of MCP's newline-delimited JSON. `pnpm
> test:brreg-mcp` passed — because the test used the same wrong framing — while
> every real client hung on `initialize`.

## MCP client config example

```json
{
  "mcpServers": {
    "brreg": {
      "command": "node",
      "args": ["apps/brreg-mcp/src/server.ts"],
      "cwd": "/absolute/path/to/workshop-ai"
    }
  }
}
```

Or, in Claude Code, from the repo root:

```bash
claude mcp add brreg -- node "$PWD/apps/brreg-mcp/src/server.ts"
```
