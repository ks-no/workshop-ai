# Veien videre

> **Merk:** Dette var et overleveringsdokument skrevet i juni 2026, før det meste av
> arbeidet ble gjort. Statusdelene er oppdatert i august 2026. De åpne arkitekturvalgene
> lenger ned står fortsatt — de er dokumentets varige verdi.

## Formål med dette dokumentet

Å gjøre det enkelt for en arkitekt eller utvikler å ta over arbeidet og drive sandboxen
videre. Dokumentet er tydelig på hva som er gjort, hva som gjenstår, og hvilke valg som
fortsatt er åpne og bør eies eksplisitt.

## Hva som er på plass nå (august 2026)

Åtte kjørende tjenester: `sandbox-backend` (TypeScript), `fiks-simulator`, `ai-gateway`,
`mcp-services`, `process-agent`, `matrikkel-mock`, `demo-gui`, `process-builder`.
Null runtime-avhengigheter i alle.

Minimumslista fra juni er i hovedsak innfridd:

- ✅ stabil oppstart — `./start.sh` med plattformdeteksjon, modellvalg og `--reset`
- ✅ helse-endepunkter på alle åtte tjenestene
- ✅ fem komplette demo-case, ikke ett: barnehage, SFO, støttekontakt, fritidskort,
  fartsdempende tiltak
- ✅ fungerende samtykkeflyt, med sperre på inntektsdata uten samtykke
- ✅ revisjonslogg over alle datatilganger
- ✅ deterministisk vilkårsvurdering mot satser (`SJEKK`)
- ✅ ressurskatalog som samler domeneoppslag ett sted, slik at samtykke og revisjon
  håndheves likt uansett hvilken vei man kommer inn
- ✅ curl-eksempler for sentrale flyter (`examples/curl/`)
- ✅ tydelig skille mellom referanseimplementasjon og felles kapabilitet
  (`docs/architecture.md`)
- ⚠️ API-dokumentasjon — `sandbox-backend` er godt dekket med 28 paths, men
  `fiks-simulator` har bare 4 av 19 ruter i OpenAPI

## Hva som gjenstår

- **`fiks-simulator.yaml`** — 15 udokumenterte ruter. Avgrenset og enkel oppgave.
- **KI-fallback er usynlig.** Faller modellen ut, får du maltekst uten varsel i GUI-et.
  Dette er den mest sannsynlige kilden til forvirring på en workshop.
- **Ingen timeout** på kall mot modellen.
- **Ingen CI.** Tre testskript krever ingen kjørende tjenester og kunne kjørt på PR.
- **Ingen tester av KI-laget.** Endrer du en prompt, finnes det ingen måte å vite om det
  ble bedre.
- **`mcp-services` er ikke MCP-protokollen** — REST med `protocol: "mcp-style-http"`.
  Verktøyene har korrekte `inputSchema`, så veien dit er kort.
- **Windows-oppstart.** `origin/start-og-stop-windows` er basert på pre-TypeScript-treet
  og må **ikke** merges — skriv `start.bat` på nytt i stedet.

## Hva som fortsatt kan vente

- avansert prosessbygger
- penere UI
- produksjonsklar autentisering
- full versjonering av alle API-er
- Altinn Studio-integrasjon og avanserte adaptere
- omfattende testdekning

## Hva som bevisst ikke skal bygges

Teamene har to dager og bygger sin egen KI-logikk. Bygger vi den for dem, tar vi
oppgaven fra dem. Derfor står følgende **med vilje** åpent:

- kritiker- eller revider-loop over modellsvar
- ekte tool-calling mot modellen (i dag velges verktøy av en separat prompt)
- forgrening i prosessmotoren — den er lineær, og det er et ærlig utgangspunkt
- persistente agent-sesjoner
- en god samtaleflyt

Rammen: sandboxen er en kommunal tjeneste der rørleggerarbeidet er riktig og samtalen er
elendig. Oppgaven er å gjøre samtalen god — uten å ødelegge rørleggerarbeidet.

## Åpne arkitekturvalg

Dette er valg som fortsatt ikke bør regnes som “låst”.

### 1. Prosessmodell

Vi har en enkel prosessmodell i repoet nå, men den bør behandles som:

- en referansemodell for MVP
- et mulig mellomformat
- ikke en endelig standard

Det skal være mulig å:

- erstatte den
- utvide den
- adaptere fra `Altinn Studio` eller lignende senere

### 2. Prosessbygger

`process-builder` er nyttig som støtte nå, men bør ikke være en strategisk binding.

Den bør behandles som:

- et hjelpemiddel for hackathon
- en referanseimplementasjon
- noe som senere kan erstattes

### 3. Demo-GUI

`demo-gui` skal hjelpe teamene raskt i gang, men bør ikke være eneste tenkelige klient.

Andre team skal kunne:

- bygge egne GUI-er
- bruke andre frontend-rammeverk
- eksperimentere med egne dialogopplegg

så lenge de bruker de dokumenterte API-ene.

## Beslutninger som bør tas eksplisitt

Disse valgene bør eies av deg og/eller arkitekten, ikke skli inn som tekniske tilfeldigheter:

### 1. Hva er obligatoriske felles kapabiliteter?

Anbefalt minimum:

- syntetiske data
- samtykke
- revisjonslogg
- oppgaveopprettelse
- KI-støtte
- dokumenterte API-er

### 2. Hva er kun referanseverktøy?

Anbefalt å markere som referanse:

- `demo-gui`
- `process-builder`
- dagens prosessformat

### 3. Hvor langt skal vi gå før hackathon på prosessformat?

Anbefaling:

- hold formatet enkelt
- unngå å bruke tid på å “perfeksjonere” det
- prioriter adapterbarhet og dokumentasjon

### 4. Hva er akseptkriteriene for “hackathon-klar”?

Dette bør gjerne avklares eksplisitt i en kort liste før videre utvikling.

## Foreslått arbeidsrekkefølge herfra

Hvis målet er å ferdigstille sandboxen effektivt, ville jeg anbefalt:

1. Stabiliser `docker compose` og tjenesteoppstart
2. Gjør OpenAPI og eksempelkall bedre
3. Rydd opp i feilformat og responsformat
4. Gjør revisjonsloggen lettere å lese
5. Kvalitetssikre 2–3 demo-case
6. Forbedre onboarding-dokumentasjonen
7. Kun hvis tid: forbedre prosessbygger eller GUI

## Anbefalt styringsprinsipp

For resten av arbeidet bør dere styre etter dette:

### Felles og stabile ting

- API-er
- syntetiske data
- policyer
- sporbarhet
- dokumentasjon

### Fleksible og utbyttbare ting

- frontend
- prosessredigeringsverktøy
- intern modellering i teamenes løsninger
- hvordan teamene bygger dialogopplevelsen

## Kort oppsummert

Arkitekten din har nok informasjon til å starte opp og drive arbeidet videre.

Det som fortsatt trengs er ikke først og fremst mer kode, men:

- noen tydelige prioriteringer
- et par eksplisitte arkitekturvalg
- en bevisst balanse mellom frihet og støtte

Hvis dere holder fast ved:

- API-er som felles kontrakt
- referanseimplementasjoner som støtte, ikke tvang
- enkelhet før hackathon

så er dette et godt utgangspunkt for å ferdigstille sandboxen.
