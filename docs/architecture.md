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

## Neste implementasjonsrekkefølge

1. `sandbox-backend`
2. `fiks-simulator`
3. policy for inntekt og samtykke
4. revisjonslogg
5. `demo-gui`
6. `process-builder`
7. `ai-gateway`
