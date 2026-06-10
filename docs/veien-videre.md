# Veien videre

## Formål med dette dokumentet

Dette dokumentet er laget for å gjøre det enkelt for en arkitekt eller utvikler å ta over arbeidet og drive sandboxen videre mot en hackathon-klar versjon.

Målet er ikke å beskrive alt i detalj, men å være tydelig på:

- hva som allerede er på plass
- hva som bør være ferdig før hackathon
- hva som kan vente
- hvilke valg som fortsatt er åpne
- hvilke beslutninger som bør tas av produkteier eller arkitekt

## Hva som er på plass nå

Repoet inneholder i dag:

- en kjørbar MVP-struktur i monorepo
- `sandbox-backend`
- `fiks-simulator`
- `ai-gateway`
- `demo-gui`
- `process-builder`
- syntetiske datasett
- policyfiler
- revisjonslogg
- OpenAPI-skjeletter
- eksempelprosesser

Det finnes også:

- prosessdrevet demo-GUI
- første versjon av prosessøkt-API
- enkel prosessredigering
- første modell for strukturerte `QUESTION`-steg

## Hva som bør være ferdig før hackathon

Dette er min anbefalte minimumsliste for en god hackathon-sandbox.

### Må ha

- stabil oppstart med `docker compose up --build`
- fungerende helse-endepunkter for alle tjenester
- tydelig API-dokumentasjon for backend, Fiks-simulator og AI-gateway
- minst ett komplett demo-case fra start til slutt
- fungerende samtykkeflyt
- sperre på inntektsdata uten samtykke
- revisjonslogg som viser sentrale hendelser
- nok dokumentasjon til at eksterne team kan komme i gang uten muntlig onboarding

### Bør ha

- minst 2–3 gode demo-case
- enklere og tydeligere visning av revisjonslogg
- mer komplette OpenAPI-beskrivelser
- Postman- eller curl-eksempler for sentrale flyter
- tydelig beskrivelse av hva som er referanseimplementasjon og hva som er felles kapabilitet

## Hva som kan vente

Dette bør ikke stoppe hackathonet:

- avansert prosessbygger
- penere UI
- produksjonsklar autentisering
- komplett validering av alle prosessmodeller
- full versjonering av alle API-er
- Altinn Studio-integrasjon
- avanserte adaptere
- omfattende testdekning

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
