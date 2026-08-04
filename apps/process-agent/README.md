# Process Agent

Generic process-guide agent that uses MCP-style tools from `mcp-services`.

## Purpose

The agent helps a user to:

- choose a process
- answer question steps
- handle consent decisions
- complete the process flow end-to-end

## Endpoints

- `GET /health`
- `POST /agent/sessions` create a new agent session
- `GET /agent/sessions/{sessionId}` get session status
- `POST /agent/sessions/{sessionId}/messages` send a user message

## Quick test

```bash
curl -s -X POST http://localhost:8084/agent/sessions \
  -H "Content-Type: application/json" \
  -d '{"personId":"person-001"}'
```

```bash
curl -s -X POST http://localhost:8084/agent/sessions/<sessionId>/messages \
  -H "Content-Type: application/json" \
  -d '{"message":"1"}'
```

