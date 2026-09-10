# Contributing

> **For deg som endrer selve sandkassen.** Er du deltaker på hackathon, er
> `docs/deltakerstart.md` inngangen - du trenger ikke lese denne filen, og ingenting her
> fordeler oppgaver til hackathon-team.

Takk for at du bidrar til `innbyggerdialog-sandbox`. Alle som bidrar følger
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## Grener og PR-er

- bruk korte grener
- hold PR-er enkle å gå gjennom
- beskriv hvilke API-er, datasett eller policyer som påvirkes
- legg ved skjermbilder eller curl-eksempler når det er nyttig

## Innlevering fra hackathon-team

Team leverer ikke gjennom pull requests. Arrangøren henter fra forkene med
`pnpm innlevering:hent` og legger hvert team på `team/<navn>`. Hvordan, og hva du gjør
med en PR som likevel kommer fra en fork, står i
[`docs/innlevering.md`](docs/innlevering.md#for-arrangøren).

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
- **nye pakke- og imageversjoner skal være minst sju dager gamle, og ingen referanse
  får flyte.** Hele regelen står i `AGENTS.md` under
  `## Project conventions you must follow`.
- API-felter: bruk konsistente navn og eksplisitt `syntetisk: true` der det passer
- ikke introduser tunge plattformer før behovet er reelt
- unngå å gjøre midlertidige referanseløsninger til harde krav for andre team
