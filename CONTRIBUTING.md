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

- språk i kode: engelsk
- språk i dokumentasjon: norsk er ok, engelsk er også greit hvis teamet trenger det
- API-felter: bruk konsistente navn og eksplisitt `syntetisk: true` der det passer
- ikke introduser tunge plattformer før behovet er reelt
