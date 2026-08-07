# Folkeregister MCP Service

True MCP (Model Context Protocol) service for Folkeregisteret syntetiske testdata.

## What it does

Exposes two MCP tools over **stdio**:

- `folkeregister_search_persons`: Search persons by name, fnr, or municipality.
- `folkeregister_get_person`: Fetch one person by fødselsnummer.

## Data source

Default data file:

- `data/folkeregister.seed.json` — 43 syntetiske testpersoner based on `data/personer.json`,
  formatted after the Folkeregisteret "Offentlig med hjemmel" v1.6.2 API schema.

Override with:

```
FOLKEREGISTER_DATA_FILE=/absolute/path/to/seed.json
```

## Run

```bash
node apps/folkeregister-mcp/src/server.js
```

## Quick test

```bash
pnpm test:folkeregister-mcp
```

## MCP client config example

```json
{
  "mcpServers": {
    "folkeregister": {
      "command": "node",
      "args": ["apps/folkeregister-mcp/src/server.js"],
      "cwd": "/home/idar/work/workshop-ai"
    }
  }
}
```

