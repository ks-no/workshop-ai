# Prosessmodell

## MVP-stegtyper

- `INFO`
- `QUESTION`
- `DATA_FETCH`
- `CONSENT_REQUEST`
- `CONFIRMATION`
- `SUMMARY`
- `SUBMIT`

## Første demo-prosess

Prosessen `reduced-kindergarten-payment` er definert i `data/prosessdefinisjoner.json`.

Formålet er å demonstrere:

- datahenting
- samtykkeflyt
- policyhåndheving
- AI-støttet oppsummering
- innsending og revisjonsspor

## Flere demo-case

Repoet inneholder også:

- `sfo-moderasjon`
- `stottekontakt-behov`

## Redigering i prosessbygger

Prosessbyggeren støtter nå:

- hente prosesser fra backend
- velge eksisterende prosess
- opprette ny prosess
- redigere navn, beskrivelse og versjon
- redigere steg som JSON
- lagre prosess til backend

Demo-GUI-en støtter nå:

- å velge mellom flere prosesser
- å drive flyten direkte fra stegdefinisjonen
- å hente data, håndtere samtykke, lage oppsummering og sende inn søknad uten hardkodede case-knapper
