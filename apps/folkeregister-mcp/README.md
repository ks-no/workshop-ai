# Folkeregister MCP Service

A real Model Context Protocol server for synthetic Folkeregisteret test data —
JSON-RPC 2.0 over **stdio**, newline-delimited, so an actual MCP client connects
to it. Unlike `apps/mcp-services`, which is REST that only borrows the name.

## What it does

Two MCP tools:

- `folkeregister_search_persons`: Search persons by name, fnr, or municipality.
- `folkeregister_get_person`: Fetch one person by fødselsnummer.

## Data source

Default data file:

- `data/folkeregister.seed.json` — 394 syntetiske testpersoner based on `data/personer.json`,
  formatted after the Folkeregisteret "Offentlig med hjemmel" v1.6.2 API schema.

Override with:

```
FOLKEREGISTER_DATA_FILE=/absolute/path/to/seed.json
```

## Run

```bash
node apps/folkeregister-mcp/src/server.js
```

## Verify

```bash
pnpm test:folkeregister-mcp
```

That test implements the client side itself, so it proves the two halves agree —
not that the framing matches the MCP spec. **When you touch the transport, check
against a real client too:**

```bash
npx -y @modelcontextprotocol/inspector --cli \
  node apps/folkeregister-mcp/src/server.js --method tools/list
```

Both tools should be listed. `Connection timed out` means the framing broke. See
`apps/brreg-mcp/README.md` for the time that actually happened.

## MCP client config example

```json
{
  "mcpServers": {
    "folkeregister": {
      "command": "node",
      "args": ["apps/folkeregister-mcp/src/server.js"],
      "cwd": "/absolute/path/to/workshop-ai"
    }
  }
}
```

Or, in Claude Code, from the repo root:

```bash
claude mcp add folkeregister -- node "$PWD/apps/folkeregister-mcp/src/server.js"
```

