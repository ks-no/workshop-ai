# API-først integrasjoner

## Hvorfor dette er viktig

Ja — vi bør absolutt lage tilkoblingene som API-er.

Det gir oss:

- tydelige kontrakter mellom team
- enklere utskifting av simulatorer senere
- bedre dokumentasjon for eksterne hackathon-team
- mindre kobling mellom GUI, prosessbygger og backend
- enklere overgang fra sandbox til mer produksjonsnære integrasjoner

For denne sandboxen betyr det at **alle koblinger mellom komponenter bør behandles som eksterne integrasjoner**, selv når de kjører i samme Docker Compose-oppsett.

Samtidig må vi ikke bruke API-strategien til å redusere teamenes frihet unødvendig. Målet er å gi teamene felles kapabiliteter, ikke å tvinge alle inn i samme applikasjonsmønster.

## Anbefalt prinsipp

Bruk følgende tommelfingerregel:

> Hvis en komponent trenger data eller en handling fra en annen komponent, skal det skje via et dokumentert API — ikke ved direkte filtilgang eller intern funksjonskall-kobling på tvers av tjenester.

Det betyr:

- `demo-gui` snakker kun med API-er
- `prosessbygger` snakker kun med API-er
- `sandbox-backend` snakker med `fiks-simulator` og `ai-gateway` via API-er
- datafiler er kun en intern implementasjonsdetalj i den tjenesten som eier dem

Det betyr også:

- teamene kan bygge egne klienter så lenge de følger API-kontraktene
- referanseimplementasjonene våre er støtteverktøy, ikke tvang
- vi kan bytte ut `process-builder` med `Altinn Studio` eller lignende senere uten å rive hele sandboxen

## Foreslått API-modell

Vi kan dele API-landskapet i fem tydelige flater.

### 1. Opplevelses-API

Dette er API-et som frontendene bruker.

Eier:

- `sandbox-backend`

Klienter:

- `demo-gui`
- `prosessbygger`

Ansvar:

- eksponere prosesser
- eksponere testbrukere
- eksponere stegdata for demo
- håndtere innsending av søknader
- eksponere revisjonslogg
- samle underliggende kall mot samtykke, register og KI

Eksempel:

- `GET /api/prosesser`
- `GET /api/personer`
- `GET /api/personer/{personId}/husstand`
- `GET /api/personer/{personId}/inntekt`
- `POST /api/soknader`
- `GET /api/revisjonslogg/{sporingsId}`

### 2. Prosess-API

Dette kan være en egen flate i `sandbox-backend`, eller etter hvert en egen tjeneste hvis behovet vokser.

Eier:

- `sandbox-backend` i første omgang

Klienter:

- `prosessbygger`
- `demo-gui`

Ansvar:

- opprette prosessdefinisjoner
- oppdatere prosessdefinisjoner
- versjonere prosessdefinisjoner
- validere prosessdefinisjoner

Anbefalte endepunkter:

- `GET /api/prosesser`
- `GET /api/prosesser/{prosessId}`
- `POST /api/prosesser`
- `PUT /api/prosesser/{prosessId}`
- `POST /api/prosesser/{prosessId}/valider`

### 3. Samtykke- og register-API

Dette eies av `fiks-simulator` og skal alltid behandles som en separat integrasjon.

Eier:

- `fiks-simulator`

Klienter:

- `sandbox-backend`

Ansvar:

- opprette samtykkeforespørsler
- registrere svar
- trekke samtykker
- eksponere samtykkehistorikk
- eksponere syntetiske registerdata
- opprette oppgaver og meldinger

Anbefalte endepunkter:

- `POST /fiks/samtykke`
- `GET /fiks/samtykke/{samtykkeId}`
- `PUT /fiks/samtykke/{samtykkeId}/svar`
- `PUT /fiks/samtykke/{samtykkeId}/trekk`
- `GET /fiks/personer/{personId}/samtykker`
- `GET /fiks/register/person/{personId}`
- `GET /fiks/register/husstand/{personId}`
- `GET /fiks/register/inntekt/{personId}`
- `POST /fiks/oppgaver`

### 4. KI-støtte-API

Dette eies av `ai-gateway`.

Eier:

- `ai-gateway`

Klienter:

- `sandbox-backend`

Ansvar:

- oppsummering
- klarspråk
- forklaring av databruk
- dialogforslag
- enkel risikovurdering

Anbefalte endepunkter:

- `POST /ai/dialogforslag`
- `POST /ai/oppsummering`
- `POST /ai/forklar-databruk`
- `POST /ai/klarsprak`
- `POST /ai/risikosjekk`

### 5. Metadata- og katalog-API

Dette er nyttig for hackathon-team, fordi de raskt kan oppdage hvilke datasett, prosesser og modeller som finnes.

Eier:

- `sandbox-backend`

Klienter:

- `demo-gui`
- `prosessbygger`
- eksterne utviklere

Anbefalte endepunkter:

- `GET /api/katalog/datasett`
- `GET /api/katalog/informasjonsmodeller`
- `GET /api/katalog/tjenester`
- `GET /api/katalog/policyer`

## Viktig designgrep: API som kontrakt, ikke bare transport

Det viktigste er ikke bare å ha HTTP-endepunkter. Det viktige er at API-ene blir **kontraktene mellom teamene**.

Derfor bør hver API-flate ha:

- OpenAPI-beskrivelse
- eksempelrequester og eksempelsvar
- tydelige feilresponser
- tydelig sporings-ID
- versjonering

## Konkrete anbefalinger for denne sandboxen

### A. Innfør en standard for alle requester

Alle kall mellom tjenester bør støtte:

- `X-SporingsId`
- `X-KildeSystem`
- `X-DemoBruker`

Hvis vi ikke vil bruke headere i første omgang, kan vi støtte disse feltene i request body eller query-parametere, men målet bør være faste headere.

Forslag:

- `X-SporingsId`: brukes til revisjonslogg og sporing
- `X-KildeSystem`: f.eks. `demo-gui`, `prosessbygger`, `sandbox-backend`
- `X-DemoBruker`: f.eks. `person-001`

### B. Innfør en standard for alle responser

Alle responser bør ha et noenlunde likt mønster:

```json
{
  "data": {},
  "metadata": {
    "syntetisk": true,
    "sporingsId": "flyt-123",
    "kilde": "sandbox-backend",
    "tidspunkt": "2026-06-10T10:00:00Z"
  }
}
```

Dette gjør GUI og eksterne team enklere å implementere.

### C. Innfør en standard for feil

Alle API-er bør returnere samme feilformat:

```json
{
  "feil": {
    "kode": "SAMTYKKE_MANGLER",
    "melding": "Inntektsdata krever registrert samtykke.",
    "sporingsId": "flyt-123"
  }
}
```

Det gir mer stabil frontend-logikk enn fritekst alene.

### D. Eierskap til data må være tydelig

Vi bør unngå at flere tjenester leser og skriver samme filer direkte.

Anbefalt eierskap:

- `sandbox-backend` eier:
  - prosessdefinisjoner
  - søknader
  - kataloger
- `fiks-simulator` eier:
  - samtykker
  - oppgaver
  - meldinger
  - registersvar
- `ai-gateway` eier:
  - KI-kall og eventuell KI-logg

På sikt kan vi flytte data fysisk per tjeneste, men allerede nå bør vi behandle eierskapet slik logisk.

## Foreslått neste steg i repoet

Hvis vi skal gjøre dette skikkelig, anbefaler jeg følgende rekkefølge:

### Steg 1: Stabiliser API-kontrakter

- utvid OpenAPI-filene
- dokumenter request/response-eksempler
- dokumenter feilformater
- dokumenter standard headere

### Steg 2: Gjør backend til tydelig API-gateway

- `demo-gui` skal ikke vite om interne datafiler
- `prosessbygger` skal ikke vite om interne datafiler
- begge skal kun snakke med `sandbox-backend`

### Steg 3: Flytt mer funksjonalitet bak API

I dag er dette allerede delvis på plass, men vi kan gå lenger:

- opprett eget API for validering av prosessdefinisjoner
- opprett eget API for å starte en prosessøkt
- opprett eget API for å lagre svar på steg
- opprett eget API for å hente prosessstatus

Foreslåtte nye endepunkter:

- `POST /api/prosessoekter`
- `GET /api/prosessoekter/{oektsId}`
- `POST /api/prosessoekter/{oektsId}/svar`
- `POST /api/prosessoekter/{oektsId}/neste`

Status i repoet nå:

- første versjon av prosessøkt-API er implementert i `sandbox-backend`
- `demo-gui` bruker prosessøkt-API-et som primær inngang til sandboxen

Dette vil gjøre `demo-gui` enda mindre spesialtilpasset.

### Steg 4: Innfør versjonering

For hackathon er det veldig nyttig å være eksplisitt:

- `/api/v1/prosesser`
- `/api/v1/personer`
- `/fiks/v1/samtykke`
- `/ai/v1/oppsummering`

Vi trenger ikke bygge om alt med en gang, men det er lurt å bestemme mønsteret nå.

## Foreslått målbilde

Et godt mål for sandboxen er:

- frontendene kjenner kun dokumenterte API-er
- alle simulatorer skjules bak API-kontrakter
- alle viktige flyter kan testes med curl eller Postman
- alle team kan jobbe parallelt uten å måtte lese hverandres kode

Det vil være spesielt verdifullt i et hackathon med flere virksomheter og leverandører.

## Kort anbefaling

Hvis vi skal være pragmatiske, ville jeg gjort dette nå:

1. Behandle `sandbox-backend` som eneste inngang for GUI-ene
2. Utvide OpenAPI for alle tjenester
3. Standardisere respons-, feil- og sporingsformat
4. Lage API for prosessøkter som neste steg
5. Flytte all stegstyring gradvis fra GUI til backend

Da får vi en sandbox som både er pedagogisk, delbar og arkitekturmessig ryddig.

## Praktisk balanse for hackathonet

For å balansere frihet og faktisk leveringsevne anbefaler jeg:

1. Gjør API-er og syntetiske data obligatoriske som felles grunnlag
2. Gjør referanse-GUI og prosessbygger valgfrie
3. Gi teamene minst ett fungerende eksempel de kan bygge videre på
4. Unngå å kreve at alle bruker samme prosessformat internt
5. Prioriter adaptere og dokumentasjon over tunge plattformvalg

Da får vi:

- nok struktur til at teamene kommer raskt i gang
- nok frihet til at de kan utforske ulike løsningsretninger
- lavere risiko for at sandboxen låser oss til dagens verktøyvalg
