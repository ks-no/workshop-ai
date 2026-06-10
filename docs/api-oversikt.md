# API-oversikt

## Sandbox Backend

Forventede hovedendepunkter:

- `GET /helse`
- `GET /api/prosesser`
- `GET /api/prosesser/{prosessId}`
- `POST /api/prosesser`
- `PUT /api/prosesser/{prosessId}`
- `POST /api/prosessoekter`
- `GET /api/prosessoekter/{oektsId}`
- `POST /api/prosessoekter/{oektsId}/svar`
- `POST /api/prosessoekter/{oektsId}/handling`
- `POST /api/prosessoekter/{oektsId}/neste`
- `POST /api/prosessoekter/{oektsId}/forrige`
- `GET /api/personer`
- `GET /api/personer/{personId}`
- `GET /api/personer/{personId}/husstand`
- `GET /api/personer/{personId}/inntekt`
- `GET /api/personer/{personId}/barnehage`
- `GET /api/personer/{personId}/soknader`
- `POST /api/soknader`
- `GET /api/soknader/{soknadId}`
- `GET /api/revisjonslogg`
- `GET /api/revisjonslogg/{sporingsId}`

## Fiks Simulator

- `POST /fiks/samtykke`
- `GET /fiks/samtykke/{samtykkeId}`
- `PUT /fiks/samtykke/{samtykkeId}/svar`
- `PUT /fiks/samtykke/{samtykkeId}/trekk`
- `GET /fiks/samtykke/{samtykkeId}/historikk`
- `GET /fiks/personer/{personId}/samtykker`
- `GET /fiks/register/person/{personId}`
- `GET /fiks/register/husstand/{personId}`
- `GET /fiks/register/inntekt/{personId}`
- `GET /fiks/register/barnehage/{personId}`
- `GET /fiks/register/kontaktinfo/{personId}`

## AI Gateway

- `POST /ai/dialogforslag`
- `POST /ai/oppsummering`
- `POST /ai/forklar-databruk`
- `POST /ai/klarsprak`
- `POST /ai/risikosjekk`

## OpenAPI-filer

- `openapi/sandbox-backend.yaml`
- `openapi/fiks-simulator.yaml`
- `openapi/ai-gateway.yaml`

## Videre API-retning

Se også `docs/api-foerst-integrasjoner.md` for forslag til hvordan alle tilkoblinger kan behandles som tydelige API-kontrakter mellom tjenestene.
