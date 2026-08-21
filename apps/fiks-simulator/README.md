# Fiks Simulator

Mock av KS Fiks-plattformen. Kjører på `8081`.

Ansvar:

- simulere samtykke
- simulere registeroppslag
- simulere oppgave- og meldingsflyt

Stack: Node.js med innebygd HTTP-server, null avhengigheter.

## Endepunkter

19 ruter. Samtykke — foreløpig åpne. `POST`/`PUT`-rutene kalles bare av prosessmotoren i
sandbox-backend, og aktøren i revisjonsloggen settes fra tokenet den holder:
`SAMTYKKE_OPPRETTET` er tjenesten som *ber* om samtykke, mens `SAMTYKKE_SVART` og
`SAMTYKKE_TRUKKET` er innbyggeren som svarer. Kalles de direkte med curl, står
fiks-simulator som aktør «på vegne av» personen — sant, men mindre presist.

Samtykke:

- `POST /fiks/samtykke` — opprett
- `GET /fiks/samtykke/{samtykkeId}`
- `GET /fiks/samtykke/{samtykkeId}/historikk`
- `POST /fiks/samtykke/{samtykkeId}/svar`
- `POST /fiks/samtykke/{samtykkeId}/trekk`
- `GET /fiks/personer/{personId}/samtykker`

Register — **bak Maskinporten**, scope `ks:fiks:register`:

- `GET /fiks/register/person/{personId}`
- `GET /fiks/register/husstand/{husstandId}`
- `GET /fiks/register/inntekt/{personId}`
- `GET /fiks/register/barnehage/{personId}`
- `GET /fiks/register/kontaktinfo/{personId}`

```bash
TOKEN=$(scripts/token.ts --maskinporten ks:fiks:register --resource fiks-simulator)
curl -H "Authorization: Bearer $TOKEN" http://localhost:8081/fiks/register/person/person-001
```

Uten token svarer de **401** med kode `MANGLER_TOKEN`. Med et ID-porten-token svarer de
**403** `KREVER_MASKINPORTEN`: registerflaten er maskin-til-maskin, og hjemmelen tilhører
kommunen, ikke den som tilfeldigvis er innlogget. Et token utstedt for `sandbox-backend`
avvises også — `--resource fiks-simulator` er nødvendig, og det er hele poenget med
audience-begrensning.

Person-, husstands- og kontaktinfo-rutene **maskerer adressebeskyttede personer** med
samme regler som sandbox-backend, ved å importere `skjerming.ts` framfor å gjenskape den.
Fram til Del B leste denne tjenesten `data/personer.json` selv uten å maskere, så
`/fiks/register/person/person-031` ga en kode 6-persons fulle navn og gateadresse — og
`/fiks/register/inntekt/person-001` ga full inntekt uten samtykke og uten token.

Oppgaver og meldinger:

- `POST /fiks/oppgaver`, `GET /fiks/oppgaver/{oppgaveId}`
- `POST /fiks/meldinger`, `GET /fiks/meldinger/{meldingId}`

Beregning — den eneste ruta som speiler et ekte KS-API, også bak `ks:fiks:register`:

- `GET /register/api/v1/ks/{rolleId}/skatteoginntektsopplysninger/beregning/redusert-foreldrebetaling`

Modellert etter
[register-skatteoginntektsopplysninger-beregning-api-v1](https://developers.fiks.ks.no/api/register-skatteoginntektsopplysninger-beregning-api-v1.json),
beregningstype `BARNEHAGE_SFO`.

Pluss `/helse`, `/docs` og `/openapi.yaml`.

## OpenAPI henger etter

`openapi/fiks-simulator.yaml` dekker **4 av 19** ruter: `/helse`, `/fiks/samtykke`,
`/fiks/samtykke/{samtykkeId}` og beregningsruta. Hele register-, oppgave- og
meldingsdelen mangler, det samme gjør samtykkets underruter.

`securitySchemes` er på plass i spesifikasjonen, men de enkelte rutene er ennå ikke
merket med `security:` — den delen hører til Del E.

Å tette dette er en fin, avgrenset førsteoppgave. Rutene finnes og virker — det er
bare beskrivelsen som mangler.
