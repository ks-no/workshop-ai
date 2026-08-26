# Contributing

> **For deg som endrer selve sandkassen.** Er du deltaker på hackathon, er
> `docs/deltakerstart.md` inngangen — du trenger ikke lese denne fila, og ingenting her
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
