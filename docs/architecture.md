# Arkitektur

## Målbilde

Sandboxen deles i fem hovedtjenester:

- `process-builder`
- `demo-gui`
- `sandbox-backend`
- `fiks-simulator`
- `ai-gateway`

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
- `apps/ai-gateway`: mockede AI-endepunkter
- `apps/demo-gui`: innbyggerreisen
- `apps/process-builder`: definisjon og visualisering av flyter

## Samspill mellom tjenestene

1. `process-builder` viser prosesser via `sandbox-backend`
2. `demo-gui` henter prosessdefinisjon fra `sandbox-backend` og renderer steg dynamisk
3. `sandbox-backend` henter samtykkestatus fra `fiks-simulator`
4. `sandbox-backend` blokkerer inntektsdata uten gyldig samtykke
5. `sandbox-backend` kaller `ai-gateway` for oppsummering og forklaring
6. alle relevante hendelser sendes til revisjonslogg

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
