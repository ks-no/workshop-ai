# Arkitektur

## Målbilde

Sandboxen er delt i følgende tjenester:

- `process-builder`
- `demo-gui`
- `sandbox-backend`
- `fiks-simulator`
- `matrikkel-mock`
- `ai-gateway`
- `mcp-services`
- `process-agent`

Dette gir en enkel og samarbeidsvennlig struktur der flere team kan jobbe parallelt uten å blokkere hverandre unødvendig.

## Arkitekturprinsipper

1. Syntetisk først
2. API først
3. Sporbarhet som standard
4. Policy synlig i kode og dokumentasjon
5. KI som støtte, ikke beslutningstaker
6. Enkel lokal kjøring
7. Utvidbar struktur
8. Pedagogisk over realisme
9. Høy teamautonomi med pragmatisk støtte

## Autonomi og støtte

Hackathonet skal balansere to hensyn:

- teamene skal ha frihet til å velge egne løsningsgrep
- sandboxen skal gi nok støtte til at teamene rekker å produsere en fungerende prototype

Derfor skiller vi mellom:

### Kapabiliteter som bør være felles

- API-er for data, samtykke, KI-støtte, oppgaver og revisjon
- syntetiske datasett
- policyer
- OpenAPI og eksempelkall

### Ting teamene bør kunne velge selv

- frontend-rammeverk
- hvordan de modellerer brukeropplevelsen
- om de bruker vår referanse-GUI eller lager sin egen
- om de bruker vår enkle prosessmodell, Altinn Studio senere, eller en adapter

### Ting vi tilbyr som støtte, ikke krav

- `demo-gui`
- `process-builder`
- eksempelprosesser
- eksempeldatasett

Disse finnes for å senke terskelen og spare tid, ikke for å definere én riktig måte å bygge på.

## Foreslått arbeidsdeling

- `apps/sandbox-backend`: data, prosess-API, revisjon og policyhåndheving
- `apps/fiks-simulator`: samtykke, register og oppgaver
- `apps/matrikkel-mock`: Geointegrasjon BasisService og matrikkeldata (SOAP + REST)
- `apps/ai-gateway`: mockede AI-endepunkter inkl. `velg-verktoy` for dynamisk verktøyoppdagelse
- `apps/mcp-services`: MCP-stil verktøy over backend, AI og matrikkel
- `apps/process-agent`: agentdialog med dynamisk steghåndtering via MCP
- `apps/demo-gui`: innbyggerreisen
- `apps/process-builder`: definisjon og visualisering av flyter

## Samspill mellom tjenestene

1. `process-builder` viser prosesser via `sandbox-backend`
2. `demo-gui` henter prosessdefinisjon fra `sandbox-backend` og renderer steg dynamisk
3. `sandbox-backend` henter samtykkestatus fra `fiks-simulator`
4. `sandbox-backend` blokkerer inntektsdata uten gyldig samtykke
5. `sandbox-backend` kaller `ai-gateway` for oppsummering og forklaring
6. `sandbox-backend` slår opp matrikkeldata mot `matrikkel-mock` via `GET /api/matrikkel/gater` og `SJEKK`-steg
7. `mcp-services` eksponerer verktøy mot backend, ai-gateway og matrikkel-mock
8. `process-agent` bruker `mcp-services` for all tilstand og data; oppdager relevante verktøy dynamisk per steg via `suggest_step_tools`
9. alle relevante hendelser sendes til revisjonslogg

## Dynamisk verktøyoppdagelse i agenten

Når agenten møter et `QUESTION`-steg kaller den `suggest_step_tools` i `mcp-services`.
Dette kallet sender stegdefinisjonens tekst og feltlabeler til `ai-gateway /ai/velg-verktoy`,
som returnerer hvilke MCP-verktøy som er relevante (`kontekst`, `validering` eller begge).
Agenten kjører så `kontekst`-verktøy proaktivt og bruker `validering`-verktøy til å normalisere
brukerens svar. Ingen steg-ID-er er hardkodet i agenten.

## Utskiftbarhet

Vi må unngå å låse oss til dagens referanseverktøy.

Det betyr at:

- `process-builder` skal kunne erstattes av `Altinn Studio` eller lignende senere
- `demo-gui` skal kunne erstattes av teamenes egne klienter
- prosessformat og GUI-logikk bør holdes enkle nok til at vi kan lage adaptere senere
- API-ene er mer viktige enn den interne implementasjonen

## Neste implementasjonsrekkefølge

1. `sandbox-backend`
2. `fiks-simulator`
3. policy for inntekt og samtykke
4. revisjonslogg
5. `demo-gui`
6. `process-builder`
7. `ai-gateway`
