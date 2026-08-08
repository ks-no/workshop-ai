# Process Agent

Generic process-guide agent that uses MCP-style tools from `mcp-services`.

## Purpose

The agent helps a user to:

- choose a process
- answer question steps, with proactive context from relevant MCP tools
- get matrikkel guidance when a process asks for gatenavn
- handle consent decisions
- complete the process flow end-to-end

## How tool discovery works

When the agent reaches a `QUESTION` step it calls `suggest_step_tools` in `mcp-services`.
That tool calls `ai-gateway /ai/velg-verktoy`, which uses heuristics (LLM fallback) on the
step definition to return which tools are relevant and how to use them:

- `kontekst` — the agent calls the tool proactively and adds its output as a hint in the question prompt
- `validering` — the agent calls the tool against the user's answer to normalize or reject it
- `kontekst_og_validering` — both

The dynamic discovery above is real, but it is **not the only path**. The agent also
carries hardcoded shortcuts for the `fartsdempende-tiltak` case: step ids `velg-gate`,
`hent-gate`, `boliger-bekreft` and `begrunnelse`, the tool name `matrikkel_finn_veger`,
and a step-keyed interview script in `guidedInterviewDefinitions`. Cleaning that up —
or replacing this agent entirely — is a hackathon task, not a bug to fix first.

New data sources are wired in by adding heuristics in `ai-gateway` and a tool in
`mcp-services`.

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
  -d '{"message":"søknad om fartsdempende tiltak"}'
```
