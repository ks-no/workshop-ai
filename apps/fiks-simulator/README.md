# Fiks Simulator

Mock av KS Fiks-plattformen. Kjører på `8081`.

Ansvar:

- simulere samtykke
- simulere registeroppslag
- simulere oppgave- og meldingsflyt

Stack: Node.js med innebygd HTTP-server, null avhengigheter.

## Endepunkter

19 ruter. Samtykke:

- `POST /fiks/samtykke` — opprett
- `GET /fiks/samtykke/{samtykkeId}`
- `GET /fiks/samtykke/{samtykkeId}/historikk`
- `POST /fiks/samtykke/{samtykkeId}/svar`
- `POST /fiks/samtykke/{samtykkeId}/trekk`
- `GET /fiks/personer/{personId}/samtykker`

Register:

- `GET /fiks/register/person/{personId}`
- `GET /fiks/register/husstand/{husstandId}`
- `GET /fiks/register/inntekt/{personId}`
- `GET /fiks/register/barnehage/{personId}`
- `GET /fiks/register/kontaktinfo/{personId}`

Oppgaver og meldinger:

- `POST /fiks/oppgaver`, `GET /fiks/oppgaver/{oppgaveId}`
- `POST /fiks/meldinger`, `GET /fiks/meldinger/{meldingId}`

Beregning — den eneste ruta som speiler et ekte KS-API:

- `GET /register/api/v1/ks/{rolleId}/skatteoginntektsopplysninger/beregning/redusert-foreldrebetaling`

Modellert etter
[register-skatteoginntektsopplysninger-beregning-api-v1](https://developers.fiks.ks.no/api/register-skatteoginntektsopplysninger-beregning-api-v1.json),
beregningstype `BARNEHAGE_SFO`.

Pluss `/helse`, `/docs` og `/openapi.yaml`.

## OpenAPI henger etter

`openapi/fiks-simulator.yaml` dekker **4 av 19** ruter: `/helse`, `/fiks/samtykke`,
`/fiks/samtykke/{samtykkeId}` og beregningsruta. Hele register-, oppgave- og
meldingsdelen mangler, det samme gjør samtykkets underruter.

Å tette dette er en fin, avgrenset førsteoppgave. Rutene finnes og virker — det er
bare beskrivelsen som mangler.
