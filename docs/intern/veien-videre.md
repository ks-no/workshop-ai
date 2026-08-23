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
- ✅ KI-spor — hvert modellkall skrives til `state/ai-trace.jsonl` med prompt, svar,
  modell og varighet, lesbart på `GET /trace` og `/trace.json`. Alle kall går gjennom
  én funksjon (`callModel`), som er det som gjorde både spor og timeout mulig
- ✅ timeout på modellkall (`AI_TIMEOUT_MS`, default 180000) med fallback i stedet for
  å henge
- ✅ synlig KI-fallback — `GET /helse` rapporterer `modellNaaBar`, og begge GUI-ene
  viser en gul stripe når modellen er nede
- ✅ evals av KI-laget — `pnpm test:eval` scorer mot datasett i `evals/`, med terskel
  per datasett og exit≠0 under. Harnesset nekter å score maltekst
- ✅ API-dokumentasjon — alle seks spesifikasjoner dekker hver rute i koden, med
  `security:` per rute. `pnpm test:openapi` sammenligner de to i begge retninger og
  feiler i CI hvis de kommer ut av takt

## Hva som gjenstår

- **Evalene og stack-testene er ikke i CI.** `.github/workflows/ci.yml` kjører `lint`,
  `test`, `test:sperrer`, `test:skjerming`, `test:samtykke`, `test:openapi` og
  `test:kontrakt`, som ikke trenger modell eller kjørende tjenester.
  `test:eval` krever en modell og holdes bevisst utenfor; `test:agent*` krever at
  stacken er oppe. Å kjøre dem i CI ville krevd Ollama i workflowen.
- **`mcp-services` er ikke MCP-protokollen** — REST med `protocol: "mcp-style-http"`.
  Verktøyene har korrekte `inputSchema`, så veien dit er kort. Men det er ikke
  nødvendigvis verdt å gå: verktøyene er tynne proxier over dokumenterte HTTP-API-er,
  og verktøysettet er formet rundt vår lineære stegmotor. Komplett OpenAPI er mer verdt.
- **KI-laget har tynn evaldekning.** `evals/` har 11 caser for 9 endepunkter, og 5 av de
  8 samtykke-casene treffer heuristikken i stedet for modellen — de er fine
  regresjonstester, men de sier ingenting om modellen. Ingen datasett for
  `velg-prosess`, `velg-verktoy`, `klarsprak`, `risikosjekk`, `forklar-databruk` eller
  `dialogforslag`. Å utvide dekningen er en god og avgrenset oppgave.
- **`process-agent` er urørt** siden før KI-sporet: 1421 linjer, egen norsk stemming
  duplisert fra `ai-gateway`, hardkodede snarveier for `fartsdempende-tiltak`, og
  sesjoner i minnet som tapes ved restart. Å slå den er hackathon-oppgaven.
- **Windows-oppstart.** Batchfiler for ledeteksten er under arbeid i egen pull request
  (`start-og-stop-windows`). Merk at branchen ble laget før TypeScript-konverteringen, så
  den trenger en rebase mot `main` før merge. Inntil videre går Windows-brukere via
  Git Bash eller WSL.

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
