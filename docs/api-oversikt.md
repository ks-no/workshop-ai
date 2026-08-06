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
- `GET /api/personer/{personId}/sfo`
- `GET /api/personer/{personId}/soknader`
- `GET /api/husstander/{husstandId}/inntektsgrunnlag`
- `GET /api/regler/satser`
- `GET /api/regler/sjekk/foreldrebetaling`
- `GET /api/matrikkel/gater`
- `GET /api/matrikkel/sjekk/eierforhold`
- `GET /api/katalog/datasett`
- `GET /api/katalog/informasjonsmodeller`
- `GET /api/katalog/ressurser`
- `POST /api/soknader`
- `GET /api/soknader/{soknadId}`
- `GET /api/revisjonslogg`
- `POST /api/revisjonslogg`
- `GET /api/revisjonslogg/{sporingsId}`

Ressursene under `/api/personer/{personId}/…`, `/api/husstander/…`,
`/api/matrikkel/…` og `/api/regler/sjekk/…` kommer fra den delte
ressurskatalogen. Hver av dem kan brukes både som HTTP-kall og som mål for et
`DATA_FETCH`- eller `SJEKK`-steg. `GET /api/katalog/ressurser` lister dem med
samtykkekrav og beskrivelse.

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
- `POST /ai/tolk-svar`
- `POST /ai/velg-prosess`
- `POST /ai/velg-verktoy` – Gitt et prosessteg og liste over tilgjengelige MCP-verktøy, returnerer hvilke som er relevante (`kontekst`, `validering`, eller `kontekst_og_validering`). Brukes av `mcp-services/suggest_step_tools`.

## MCP Services (port 8083)

- `GET /mcp/tools` – liste over alle verktøy
- `POST /mcp/tools/invoke` – kalle et navngitt verktøy
- `POST /mcp/tools/{toolName}/invoke` – alternativ sti

### Verktøy

| Navn | Beskrivelse |
|---|---|
| `list_processes` | List prosessdefinisjoner |
| `list_people` | List testbrukere |
| `start_process_session` | Start en prosessøkt |
| `get_session` | Hent øktstate |
| `answer_question` | Lagre svar på spørsmålssteg |
| `consent_response` | Opprett og besvare samtykkesteg |
| `run_current_action` | Utfør DATA_FETCH, SUMMARY eller SUBMIT |
| `next_step` / `previous_step` | Naviger i steg |
| `interpret_reply` | Tolk brukermelding til intent via AI |
| `get_household_income` | Hent inntektsgrunnlag |
| `check_eligibility` | Sjekk rett til ordning |
| `list_schemes` | List moderasjonsordninger |
| `match_process_choice` | Match fritekst til prosess via AI |
| `get_audit_log` | Hent revisjonshendelser |
| `matrikkel_finn_veger` | Søk etter gater i matrikkelen |
| `matrikkel_hent_eiendom` | Hent matrikkelenhet via id eller gnr+bnr |
| `matrikkel_hent_eiere` | Hent eiere for en matrikkelenhet |
| `suggest_step_tools` | Dynamisk verktøyoppdagelse for et prosessteg |

## Matrikkel Mock (port 8085)

SOAP-endepunkt (Geointegrasjon-sti):

- `GET /geointegrasjon/matrikkel/wsapi/v1/BasisService?wsdl`
- `POST /geointegrasjon/matrikkel/wsapi/v1/BasisService` – støtter `FinnVeger`, `FinnMatrikkelenheter`, `HentMatrikkelenhet`, `HentEiere`

REST-hjelpeendepunkter:

- `GET /mock/matrikkel/gater?gate=Storgata`
- `GET /mock/matrikkel/eiendommer?gate=Storgata&personId=person-001`
- `GET /mock/matrikkel/eiendom/{matrikkelId}`
- `GET /health`

## OpenAPI-filer

- `openapi/sandbox-backend.yaml`
- `openapi/fiks-simulator.yaml`
- `openapi/ai-gateway.yaml`
- `openapi/mcp-services.yaml`
- `openapi/matrikkel-mock.yaml`
- `openapi/process-agent.yaml`

## Videre API-retning

Se også `docs/api-foerst-integrasjoner.md` for forslag til hvordan alle tilkoblinger kan behandles som tydelige API-kontrakter mellom tjenestene.
