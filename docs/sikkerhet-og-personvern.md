# Sikkerhet og personvern

## Formål

Denne sandkassen er laget for trygg eksperimentering i et hackathon- og samarbeidsoppsett.

## Grunnregler

- ingen reelle persondata
- ingen produksjonsintegrasjoner
- tydelig merking av syntetiske data
- revisjonslogg for relevante hendelser
- KI brukes kun som støtte

## Risikoer vi eksplisitt prøver å redusere

- at eksterne team forveksler sandboxen med produksjonsnære tjenester
- at reelle data havner i repo eller logger
- at AI-komponenter brukes til beslutninger
- at samtykke og datatilgang blir utydelig i demo

## Praktiske tiltak

- policyfiler ligger i `policies/`
- OpenAPI-filer synliggjør API-kontrakter
- datasett ligger separat i `data/`
- dokumentasjonen skal oppdateres når data eller API-er endres
