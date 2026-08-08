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

## Hva som havner hvor — les dette før du bytter provider

**Promptene lagres på disk.** `ai-gateway` skriver én linje per modellkall til
`state/ai-trace.jsonl` med *full* prompt og *fullt* svar. Det er der med vilje —
uten det kan du ikke se hva modellen faktisk fikk. Fila er gitignorert og
nullstilles av `./start.sh --reset`.

**Prompten inneholder hele konteksten som rå JSON.** Navn, adresser og
syntetiske fødselsnumre fra prosessøkten sendes til modellen. Det er ufarlig her,
fordi alt er syntetisk — men mønsteret er ikke ett du skal kopiere til en løsning
med reelle data. En produksjonsvariant må minimere hva som forlater tjenesten.

**`AI_PROVIDER=openrouter` sender promptene ut av maskinen.** Da forlater
innholdet — inkludert det over — din maskin og går til en tredjepart. Med
`AI_PROVIDER=ollama` blir alt lokalt. Velg bevisst, og vær klar over forskjellen
når du demonstrerer for andre.

**Revisjonsloggen og KI-sporet er to separate lag.** `state/revisjonslogg.json`
vet *at* et KI-kall skjedde; `state/ai-trace.jsonl` vet *hva* som ble sagt.
De korrelerer på `sporingsId`, men revisjonsloggen peker ikke på sporet.
