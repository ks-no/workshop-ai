# Tools API

REST tool endpoints over the other services, for process guidance, AI interpretation
and Matrikkel data access.

It was called `mcp-services` and answered `protocol: "mcp-style-http"` until
23.08.2026. It is not the MCP protocol and never was - no JSON-RPC, no stdio,
no SSE - so the name has been dropped rather than the claim repeated. `apps/brreg-mcp` and
`apps/folkeregister-mcp` *are* MCP, and are now the only things here called that.

The `/mcp/*` paths remain: they are wire format, and renaming a path is a separate
decision from renaming a service.

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

`GET /mcp/tools` answers with the live catalogue - names, descriptions and
`inputSchema` - and is the only list that cannot drift. `docs/api-oversikt.md`
has the same names in prose for reading without the stack up.

A hand-copied table stood here and had lost six tools by the time anyone
noticed, so `pnpm test:docs` now fails any doc that names ten or more tools
without naming all of them.

## Matrikkel tools

`suggest_step_tools` takes a step definition (id, tittel, tekst, felter) and returns tool suggestions with `bruk`:
- `kontekst` - call proactively before showing the question
- `validering` - call when the user answers, to normalize/validate input
- `kontekst_og_validering` - both

## Endpoints

- `GET /helse`
- `GET /mcp`
- `GET /mcp/tools`
- `POST /mcp/tools/invoke`
- `POST /mcp/tools/{toolName}/invoke`

## Environment

- `BACKEND_BASE_URL` (default `http://sandbox-backend:8080`)
- `AI_BASE_URL` (default `http://ai-gateway:8082`)
- `MATRIKKEL_BASE_URL` (default `http://matrikkel-mock:8085`)
- `MATRIKKEL_MODE` - `mock` alle tre steder: kodedefault, compose-default og
  `.env.example`. `live` og `hybrid` slår opp gater direkte via Geonorge; `live` kaster
  videre ved nettfeil, `hybrid` faller tilbake til seed-dataene
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

