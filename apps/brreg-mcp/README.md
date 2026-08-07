# BRREG MCP Service

True MCP (Model Context Protocol) service for BRREG Enhetsregisteret testdata.

## What it does

This service exposes two MCP tools over **stdio**:

- `brreg_search_organisations`: Search organisations by name/orgnr with optional filters.
- `brreg_get_organisation`: Fetch one organisation by organisation number.

## Data source

By default, it reads:

- `eksport-brreg-er-fr-2026-08-07T13_05_45.656Z.json`

Override with:

- `BRREG_DATA_FILE=/absolute/path/to/export.json`

## Run

```bash
node apps/brreg-mcp/src/server.js
```

## Quick local test

```bash
pnpm test:brreg-mcp
```

## MCP client config example

```json
{
  "mcpServers": {
    "brreg": {
      "command": "node",
      "args": ["apps/brreg-mcp/src/server.js"],
      "cwd": "/home/idar/work/workshop-ai"
    }
  }
}
```

