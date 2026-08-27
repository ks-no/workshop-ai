# Folkeregister MCP Service

**For deg som vil koble en ekte MCP-klient til folkeregisterdataene.** JSON-RPC 2.0 over
**stdio**, linjeseparert, med syntetiske testpersoner. I motsetning til
`apps/tools-api`, som er REST og bare låner navnet.

## Hva den gjør

To MCP-verktøy:

- `folkeregister_search_persons`: søker etter personer på navn, fødselsnummer eller kommune.
- `folkeregister_get_person`: henter én person på fødselsnummer.

## Datakilde

Leser `data/folkeregister.seed.json`, bygget på `data/personer.json` og formet etter
API-skjemaet «Offentlig med hjemmel» v1.6.2 fra Folkeregisteret. Overstyres med:

```
FOLKEREGISTER_DATA_FILE=/absolutt/sti/til/seed.json
```

## Kjør

```bash
node apps/folkeregister-mcp/src/server.ts
```

## Verifiser

```bash
pnpm test:folkeregister-mcp
```

Testen implementerer klientsiden selv, så den viser at de to halvdelene er enige, ikke
at innrammingen følger MCP-spesifikasjonen. Rører du transporten, sjekk mot en ekte
klient også. `apps/brreg-mcp/README.md` viser kommandoen og forteller om gangen det
faktisk gikk galt.

## Eksempel på MCP-klientoppsett

```json
{
  "mcpServers": {
    "folkeregister": {
      "command": "node",
      "args": ["apps/folkeregister-mcp/src/server.ts"],
      "cwd": "/absolutt/sti/til/workshop-ai"
    }
  }
}
```

Eller, i Claude Code, fra roten av repoet:

```bash
claude mcp add folkeregister -- node "$PWD/apps/folkeregister-mcp/src/server.ts"
```
