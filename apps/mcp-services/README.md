# MCP Services

MCP-style HTTP tools for process guidance.

## Purpose

This service exposes tool endpoints a generic agent can call to:

- list processes and people
- start and inspect process sessions
- answer question steps
- handle consent steps
- run action steps and move to next step
- interpret user replies through `ai-gateway`

## Endpoints

- `GET /health`
- `GET /mcp`
- `GET /mcp/tools`
- `POST /mcp/tools/invoke`
- `POST /mcp/tools/{toolName}/invoke`

## Example

```bash
curl -s http://localhost:8083/mcp/tools
```

```bash
curl -s -X POST http://localhost:8083/mcp/tools/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "name": "list_processes",
    "arguments": {}
  }'
```

