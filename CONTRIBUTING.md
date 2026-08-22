# Contributing

Takk for at du bidrar til `innbyggerdialog-sandbox`.

## Mål for samarbeid

Vi bygger en pedagogisk og teknisk fungerende sandbox for hackathon og videre arkitekturdiskusjon. Repoet skal være lett å forstå for nye team som ikke kjenner domenet fra før.

## Arbeidsprinsipper

- bruk kun syntetiske data
- hold endringer små og fokuserte
- oppdater dokumentasjon sammen med kode
- tenk API-først når du lager nye kapabiliteter
- sørg for at policyer er synlige både i kode og dokumentasjon
- bevar høy autonomi for team som bygger egne løsninger oppå sandboxen
- skill tydelig mellom felles kapabiliteter og valgfrie referanseimplementasjoner

## Forslag til teamfordeling

- Team 1: `apps/sandbox-backend`
- Team 2: `apps/fiks-simulator`
- Team 3: `apps/ai-gateway`
- Team 4: `apps/demo-gui`
- Team 5: `apps/process-builder`
- Tverrgående: `data/`, `openapi/`, `policies/`, `docs/`

## Branching og PR-er

- bruk korte feature branches
- hold PR-er enkle å reviewe
- beskriv hvilke API-er, datasett eller policyer som påvirkes
- legg ved skjermbilder eller curl-eksempler når det er nyttig

## Definisjon av ferdig

En endring er ikke ferdig før:

- kode er lagt i riktig app eller mappe
- dokumentasjon er oppdatert
- eventuelle API-endringer er synlige i `openapi/`
- syntetiske data fortsatt er konsistente
- policy-konsekvenser er vurdert

## Konvensjoner

- **språk i kode: engelsk teknikk, norsk fagspråk.** Alt som er rørlegging skrives
  engelsk — `readRequestBody`, `findPerson`, `buildPrompt`, `HttpError`. Domenebegrepene
  står på norsk, fordi de ikke har en ærlig engelsk oversettelse i denne sammenhengen:
  `samtykke`, `inntekt`, `husstand`, `ordning`, `vilkaar`, `revisjonslogg`, `matrikkel`.
  Blandede sammensetninger er riktig og forventet: `getInntektForPerson`,
  `evaluateVilkaar`, `buildGrunnlag`. Verbet er engelsk også når substantivet er norsk.
  Norske identifikatorer translittereres (`noekkel`, `foer`, `rekkefoelge`); kommentarer
  og tekst bruker ordentlige norske tegn. Hele regelen står i `AGENTS.md`.
- **wire-formatet er frosset og forblir norsk.** JSON-nøkler og ruter er kontrakten alle
  team bygger mot — `melding`, `feil`, `grunnlag`, `sporingsId`, `/api/personer`. Aldri
  døp dem om. En lokal variabel kan hete `message`; svarnøkkelen heter `melding`.
- språk i dokumentasjon: norsk er ok, engelsk er også greit hvis teamet trenger det
- filencoding: bruk UTF-8 (Unicode) for kode, dokumentasjon og datafiler
- API-felter: bruk konsistente navn og eksplisitt `syntetisk: true` der det passer
- ikke introduser tunge plattformer før behovet er reelt
- unngå å gjøre midlertidige referanseløsninger til harde krav for andre team
