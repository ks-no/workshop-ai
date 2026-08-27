# BRREG MCP Service

**For deg som vil koble en ekte MCP-klient til sandkassen.** JSON-RPC 2.0 over
**stdio**, linjeseparert, med testdata fra BRREG Enhetsregisteret. I motsetning til
`apps/tools-api`, som er REST og bare låner navnet.

## Hva den gjør

To MCP-verktøy:

- `brreg_search_organisations` - søker på navn eller organisasjonsnummer, med valgfrie
  filtre på `kommune` og `organisasjonsform`, sidedelt med `offset`/`limit`.
- `brreg_get_organisation` - henter én organisasjon på `organisasjonsnummer`.

## Datakilde

Leser `data/brreg.seed.json`, syntetiske organisasjoner fra Tenor. Overstyres med en
absolutt sti:

```bash
BRREG_DATA_FILE=/absolutt/sti/til/export.json node apps/brreg-mcp/src/server.ts
```

Serveren finner standardfilen ut fra sin egen plassering, så den virker uansett hvor du
starter den fra.

## Kjør

```bash
node apps/brreg-mcp/src/server.ts
```

Den snakker stdio, så alene står den bare og venter. Pek en klient mot den.

## Verifiser

```bash
pnpm test:brreg-mcp
```

Den testen implementerer klientsiden selv, så den viser at de to halvdelene er enige -
ikke at innrammingen følger MCP-spesifikasjonen. **Rører du transporten, sjekk mot en
ekte klient også:**

```bash
npx -y @modelcontextprotocol/inspector --cli \
  node apps/brreg-mcp/src/server.ts --method tools/list
```

Begge verktøyene skal komme opp i listen. `Connection timed out` betyr at innrammingen
er brutt.

> Dette er ikke tenkt. Den første versjonen rammet inn meldinger med `Content-Length`
> fra LSP i stedet for MCP sin linjeseparerte JSON. `pnpm test:brreg-mcp` gikk grønt,
> fordi testen brukte den samme gale innrammingen, mens hver eneste ekte klient hang
> på `initialize`.

## Eksempel på MCP-klientoppsett

```json
{
  "mcpServers": {
    "brreg": {
      "command": "node",
      "args": ["apps/brreg-mcp/src/server.ts"],
      "cwd": "/absolutt/sti/til/workshop-ai"
    }
  }
}
```

Eller, i Claude Code, fra roten av repoet:

```bash
claude mcp add brreg -- node "$PWD/apps/brreg-mcp/src/server.ts"
```
