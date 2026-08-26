# Contributing

> **For deg som endrer selve sandkassen.** Er du deltaker på hackathon, er
> `docs/deltakerstart.md` inngangen - du trenger ikke lese denne fila, og ingenting her
> fordeler oppgaver til hackathon-team.

Takk for at du bidrar til `innbyggerdialog-sandbox`.

## Grener og PR-er

- bruk korte grener
- hold PR-er enkle å gå gjennom
- beskriv hvilke API-er, datasett eller policyer som påvirkes
- legg ved skjermbilder eller curl-eksempler når det er nyttig

## Når er en endring ferdig

En endring er ikke ferdig før:

- kode er lagt i riktig app eller mappe
- dokumentasjon er oppdatert
- eventuelle API-endringer er synlige i `openapi/`
- syntetiske data fortsatt er konsistente
- policy-konsekvenser er vurdert
- prosa følger språkregelen i `AGENTS.md` (`## Language`), og ingen identifikator,
  JSON-nøkkel eller matchemønster er omdøpt underveis

## Konvensjoner

- **språk:** hele regelen står i `AGENTS.md` under `## Language`, og gjelder også
  commit-meldinger og PR-beskrivelser. Er du i tvil om noe er prosa eller en
  identifikator, er det en identifikator.
- **wire-formatet er frosset og forblir norsk.** JSON-nøkler og ruter er kontrakten alle
  team bygger mot, så du døper dem aldri om - heller ikke for å rette en skrivefeil.
  Feltnavnene står i `openapi/*.yaml`.
- API-felter: bruk konsistente navn og eksplisitt `syntetisk: true` der det passer
- ikke introduser tunge plattformer før behovet er reelt
- unngå å gjøre midlertidige referanseløsninger til harde krav for andre team
