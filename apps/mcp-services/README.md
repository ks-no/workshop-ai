# MCP Services

MCP-style HTTP tools for process guidance, AI interpretation, and Matrikkel data access.

## Purpose

This service exposes tool endpoints a generic agent can call to:

- list processes and people
- start and inspect process sessions
- answer question steps
- handle consent steps
- run action steps and move to next step
- interpret user replies through `ai-gateway`
- look up matrikkel streets, properties, and owners through `matrikkel-mock` and optional live gate lookup
- **dynamically discover which tools are relevant for any given process step** via `suggest_step_tools`

## Tool list

| Tool | Description |
|---|---|
| `list_processes` | List available processes |
| `list_people` | List demo users |
| `start_process_session` | Start a process session |
| `get_session` | Get session state and active step |
| `answer_question` | Save answer for question step |
| `consent_response` | Create and answer consent step |
| `run_current_action` | Execute DATA_FETCH, SUMMARY or SUBMIT |
| `next_step` / `previous_step` | Navigate steps |
| `interpret_reply` | Classify user reply via AI |
| `get_household_income` | Household income basis |
| `check_eligibility` | Check reduced-payment eligibility |
| `list_schemes` | List payment schemes |
| `match_process_choice` | Match free text to process via AI |
| `get_audit_log` | Fetch audit events by tracking id |
| `matrikkel_finn_veger` | Search streets in matrikkel |
| `matrikkel_hent_eiendom` | Fetch property by matrikkelId, gnr+bnr, or exact address |
| `matrikkel_hent_eiere` | Fetch owners for a property by matrikkelId, gnr+bnr, or exact address |
| `suggest_step_tools` | Ask AI gateway which tools are relevant for a step |

## Matrikkel tools

`suggest_step_tools` takes a step definition (id, tittel, tekst, felter) and returns tool suggestions with `bruk`:
- `kontekst` — call proactively before showing the question
- `validering` — call when the user answers, to normalize/validate input
- `kontekst_og_validering` — both

## Endpoints

- `GET /health`
- `GET /mcp`
- `GET /mcp/tools`
- `POST /mcp/tools/invoke`
- `POST /mcp/tools/{toolName}/invoke`

## Environment

- `BACKEND_BASE_URL` (default `http://sandbox-backend:8080`)
- `AI_BASE_URL` (default `http://ai-gateway:8082`)
- `MATRIKKEL_BASE_URL` (default `http://matrikkel-mock:8085`)
- `MATRIKKEL_MODE` (default `mock`; `live` or `hybrid` enables direct gate lookup via Geonorge)
- `GEONORGE_ADRESSE_API_BASE_URL` (default `https://ws.geonorge.no/adresser/v1`)
- `MATRIKKEL_HTTP_TIMEOUT_MS` (default `6000`)

I `live`/`hybrid` brukes Geonorge også for eksakte adresseoppslag i `matrikkel_hent_eiendom`.
`matrikkel_hent_eiere` kan da returnere tom eierliste med en forklarende `merknad`, siden den offentlige adressekilden ikke inneholder eierinformasjon.

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

```bash
curl -s -X POST http://localhost:8083/mcp/tools/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "name": "suggest_step_tools",
    "arguments": {
      "steg": {
        "id": "velg-gate",
        "tekst": "Hvilken gate ønsker du fartsdempende tiltak i?",
        "felter": [{"id": "gatenavn", "label": "Gatenavn"}]
      }
    }
  }'
```

```bash
curl -s -X POST http://localhost:8083/mcp/tools/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "name": "matrikkel_hent_eiere",
    "arguments": {
      "matrikkelId": "matr-storg-003"
    }
  }'
```

```bash
curl -s -X POST http://localhost:8083/mcp/tools/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "name": "matrikkel_hent_eiendom",
    "arguments": {
      "adresse": "Storgata 5"
    }
  }'
```

