# Veien videre

> **Internt dokument. Ikke deltakermateriell, og ikke gjeldende status.**
>
> Dette var en overlevering skrevet i juni 2026, før det meste av arbeidet ble gjort.
> Statusdelene er etterjustert, men de rekker aldri koden — den flytter seg raskere enn
> dokumentet. **Kod ikke mot statusdelene her; les koden, `README.md` eller
> `apps/shared/tjenester.json`.** Den varige verdien ligger i de åpne
> arkitekturvalgene lenger ned, og i formuleringen av hva oppgaven er.

## Formål med dette dokumentet

Å gjøre det enkelt for en arkitekt eller utvikler å ta over arbeidet og drive sandboxen
videre. Dokumentet er tydelig på hva som er gjort, hva som gjenstår, og hvilke valg som
fortsatt er åpne og bør eies eksplisitt.

## Hva som er på plass nå (august 2026)

Ni kjørende tjenester, listet med port og rolle i `apps/shared/tjenester.json` —
den er kilden, og denne siden gjentar den ikke. Null runtime-avhengigheter i alle.
I tillegg `brreg-mcp` og `folkeregister-mcp`, som er ekte MCP over stdio og ikke har
port.

Minimumslista fra juni er i hovedsak innfridd:

- ✅ stabil oppstart — `./start.sh` med plattformdeteksjon, modellvalg og `--reset`
- ✅ helse-endepunkter på alle ni tjenestene
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
- ✅ API-dokumentasjon — alle sju spesifikasjonene dekker hver rute i koden, med
  `security:` per rute. `pnpm test:openapi` sammenligner de to i begge retninger og
  feiler i CI hvis de kommer ut av takt

## Hva som gjenstår

- **Evalene og stack-testene er ikke i CI.** Workflowen kjører de sjekkene som verken
  trenger modell eller kjørende tjenester; lista står i `.github/workflows/ci.yml` og
  gjengis ikke her, fordi den ble utdatert to steder da den ble kopiert.
  `test:eval` krever en modell og holdes bevisst utenfor; `test:agent*` krever at
  stacken er oppe. Å kjøre dem i CI ville krevd Ollama i workflowen.
- **`tools-api` er ikke MCP-protokollen** — REST med `protocol: "rest"`. Den het
  `mcp-services`; navnet ble droppet 23.08.2026.
  Verktøyene har korrekte `inputSchema`, så veien dit er kort. Men det er ikke
  nødvendigvis verdt å gå: verktøyene er tynne proxier over dokumenterte HTTP-API-er,
  og verktøysettet er formet rundt vår lineære stegmotor. Komplett OpenAPI er mer verdt.
- **KI-laget har tynn evaldekning.** `evals/` har 20 caser fordelt på tre endepunkter,
  og flere av samtykke-casene treffer heuristikken i stedet for modellen — de er fine
  regresjonstester, men de sier ingenting om modellen. Ingen datasett for
  `velg-prosess`, `velg-verktoy`, `klarsprak`, `risikosjekk`, `forklar-databruk` eller
  `dialogforslag`. Å utvide dekningen er en god og avgrenset oppgave.
- **`process-agent` er urørt** siden før KI-sporet: godt over 1 700 linjer, egen norsk stemming
  duplisert fra `ai-gateway`, hardkodede snarveier for `fartsdempende-tiltak`, og
  sesjoner i minnet som tapes ved restart. Å slå den er hackathon-oppgaven.
- ~~**Windows-oppstart.**~~ Løst: `start.bat` og `stop.bat` er i repoet og dokumentert i
  `README.md`. Advarselen som sto her om at `start.bat --reload` utelot `digdir-mock`,
  var utdatert — `start.bat` lister den.

## Hva som fortsatt kan vente

- avansert prosessbygger
- penere UI
- full versjonering av alle API-er
- Altinn Studio-integrasjon og avanserte adaptere
- omfattende testdekning

Autentisering sto på denne lista fram til Del B. Den er nå bygget og håndhevet som
standard — `digdir-mock` utsteder ID-porten- og Maskinporten-tokener, og
`AUTH_ENFORCE` er på. Se `apps/sandbox-backend/src/autentisering.ts`.

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
