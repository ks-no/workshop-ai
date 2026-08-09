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
6. `sandbox-backend` leser matrikkeldata **direkte fra `data/matrikkel.seed.json`** (`state.ts:195`) og eksponerer dem via `GET /api/matrikkel/gater` og `SJEKK`-steg — den snakker aldri med `matrikkel-mock`, og har ingen `MATRIKKEL_BASE_URL`. Mocken nås bare gjennom `mcp-services`, som er den eneste veien til SOAP-flaten. Samme fil har altså to uavhengige lesestier: backend leser den fra disk, mocken seeder fra den ved oppstart
7. `mcp-services` eksponerer verktøy mot backend, ai-gateway og matrikkel-mock
8. `process-agent` bruker `mcp-services` for all tilstand og data; oppdager relevante verktøy dynamisk per steg via `suggest_step_tools`
9. alle relevante hendelser sendes til revisjonslogg

## Dynamisk verktøyoppdagelse i agenten

Når agenten møter et `QUESTION`-steg kaller den `suggest_step_tools` i `mcp-services`.
Dette kallet sender stegdefinisjonens tekst og feltlabeler til `ai-gateway /ai/velg-verktoy`,
som returnerer hvilke MCP-verktøy som er relevante (`kontekst`, `validering` eller begge).
Agenten kjører så `kontekst`-verktøy proaktivt og bruker `validering`-verktøy til å normalisere
brukerens svar.

Agenten har i tillegg hardkodede snarveier for `fartsdempende-tiltak`: steg-ID-ene
`velg-gate`, `hent-gate`, `boliger-bekreft` og `begrunnelse`, samt verktøynavnet
`matrikkel_finn_veger`. Den dynamiske oppdagelsen er altså ekte, men ikke enerådende.

## Utskiftbarhet

Vi må unngå å låse oss til dagens referanseverktøy.

Det betyr at:

- `process-builder` skal kunne erstattes av `Altinn Studio` eller lignende senere
- `demo-gui` skal kunne erstattes av teamenes egne klienter
- prosessformat og GUI-logikk bør holdes enkle nok til at vi kan lage adaptere senere
- API-ene er mer viktige enn den interne implementasjonen

## Status og kjente avvik

Alle åtte tjenestene er implementert og kjører. Samtykkesperre, revisjonslogg,
deterministisk vilkårsvurdering og fem demo-case er på plass. Det som følger er
avvik mellom hvordan sandboxen presenterer seg og hva den faktisk gjør — verdt å
kjenne til før du bygger på den.

**`mcp-services` er ikke MCP-protokollen.** Den svarer `protocol: "mcp-style-http"`
og eksponerer 20 verktøy over REST. Det er ingen JSON-RPC og ingen stdio- eller
SSE-transport, så en MCP-klient som Claude Code eller Cursor kan ikke koble seg på.
Verktøyene har derimot korrekt formede `inputSchema`, så veien til ekte MCP er kort.

**KI-fallback er delvis synlig.** Når modellen ikke svarer, faller `ai-gateway` tilbake
til maltekst og setter et `advarsel`-felt. `GET /helse` rapporterer `modellNaaBar`, og
begge GUI-ene viser en gul stripe ved sidelast hvis modellen er nede. `/chat` viser i
tillegg `advarsel` per svar — men bare for resultater som kommer via backend (i praksis
`SUMMARY`). `advarsel` fra `/ai/tolk-svar` vises ikke. Verifiser med
`POST /ai/klarsprak` — svaret skal ha `modell: "ollama:<navn>"` og ingen `advarsel`.

**Modellkall har timeout.** `AI_TIMEOUT_MS` (default 180000) avbryter og faller tilbake
i stedet for å henge. Merk at `modellNaaBar` for `openrouter` bare sjekker at en nøkkel
finnes — den sonderer ikke tjenesten, så feil nøkkel rapporteres som tilgjengelig.

**Alle modellkall spores.** `state/ai-trace.jsonl` får én linje per kall med prompt,
svar, modell og varighet. Les på `GET /trace` eller `GET /trace.json`
(`?sporingsId=`, `?task=`, `?limit=`). Dette er raskeste vei til å se hva modellen
faktisk fikk, før heuristikk og validering rørte det.

**Prosessmotoren er lineær.** `stegIndex` teller oppover; ingen forgrening, ingen
betinget hopping. Det er et bevisst enkelt utgangspunkt, ikke en mangel som må
lukkes før hackathonet.

**Agent-sesjoner ligger i minnet** i `process-agent`, uten TTL eller opprydding.
De forsvinner ved omstart.

**`fiks-simulator` er tynt dokumentert:** 4 av 19 ruter i OpenAPI. Se
`examples/postman/README.md` for hvilke.

**Ingen autentisering noe sted.** `personId` tas fra requesten uten verifikasjon.
Det er bevisst i en sandbox med syntetiske data, men det betyr at ingenting her
kan flyttes til produksjon uten et reelt identitetslag.
