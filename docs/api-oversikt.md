# API-oversikt

**Denne siden lister ikke endepunktene.** Den forteller hvor de står, og forklarer det
spesifikasjonene ikke kan forklare selv.

Grunnen: endepunktene fantes her i en håndskrevet liste, ved siden av `openapi/*.yaml`,
ved siden av hver tjenestes `/docs`, og ved siden av `/openapi-ruter.json`. Fire lister
over det samme driver fra hverandre, og den håndskrevne taper alltid. `pnpm test:openapi`
holder spesifikasjonene i takt med koden; ingenting holdt denne filen i takt med noe.

## Hvor endepunktene står

| Vil du | Bruk |
|---|---|
| Prøve et kall, med skjema og en `curl` som virker | <http://localhost:3001/utforsker> |
| Se rutene i én tjeneste | `http://localhost:<port>/docs` |
| Lese kontrakten | `http://localhost:<port>/openapi.yaml`, eller `openapi/*.yaml` i repoet |
| Lese den maskinelt | `http://localhost:<port>/openapi-ruter.json` |
| Utforske i Postman | importer spesifikasjonene direkte - [`examples/postman/README.md`](../examples/postman/README.md) |

Dashboardet på <http://localhost:3001> har alle fire per tjeneste, i én tabell.

| Tjeneste | Port | Spesifikasjon |
|---|---|---|
| sandbox-backend | 8080 | `openapi/sandbox-backend.yaml` |
| fiks-simulator | 8081 | `openapi/fiks-simulator.yaml` |
| ai-gateway | 8082 | `openapi/ai-gateway.yaml` |
| tools-api | 8083 | `openapi/tools-api.yaml` |
| process-agent | 8084 | `openapi/process-agent.yaml` |
| matrikkel-mock | 8085 | `openapi/matrikkel-mock.yaml` |
| digdir-mock | 8086 | `openapi/digdir-mock.yaml` |

Listen over tjenester bor i `apps/shared/tjenester.json`, som dashboardet og
API-utforskeren begge leser. `pnpm test:openapi` krever at den er enig med seg selv.

Alle sju svarer også på `GET /helse`. Det finnes ingen `/health` - den var et alias som
gjorde at hver tjeneste sto oppført to ganger i utforskeren.

## Sandbox Backend: ressurskatalogen

Ressursene under `/api/personer/{personId}/…`, `/api/husstander/…`,
`/api/matrikkel/…` og `/api/regler/sjekk/…` kommer fra den delte
ressurskatalogen. Hver av dem kan brukes både som HTTP-kall og som mål for et
`DATA_FETCH`- eller `SJEKK`-steg. `GET /api/katalog/ressurser` lister dem med
samtykkekrav og beskrivelse.

Det er den listen som er sann, ikke en kopi her: katalogen er én tabell i
`apps/sandbox-backend/src/ressurser.ts`, og `pnpm test:openapi` leser den direkte.

## AI Gateway: hva hvert endepunkt er til

Spesifikasjonen har signaturene. Dette er det den ikke sier:

- `POST /ai/dialogforslag`
- `POST /ai/oppsummering`
- `POST /ai/forklar-databruk`
- `POST /ai/klarsprak`
- `POST /ai/risikosjekk`
- `POST /ai/tolk-svar`
- `POST /ai/sporsmaal` – Fritt spørsmål fra innbygger, midt i en prosessflyt. Svarer bare
  fra grunnlaget kalleren sender med, har ingen egen dataadgang, og kjører sperrer i kode
  på svaret. `tekst` ligger på toppnivå, som i `/ai/tolk-svar`. Se
  [`apps/ai-gateway/README.md`](../apps/ai-gateway/README.md).
- `POST /ai/dommer` – LLM-as-judge for `scripts/eval.ts`. Ikke en del av en innbyggerflyt.
- `POST /ai/velg-prosess`
- `POST /ai/velg-verktoy` – Gitt et prosessteg og liste over tilgjengelige MCP-verktøy, returnerer hvilke som er relevante (`kontekst`, `validering`, eller `kontekst_og_validering`). Brukes av `tools-api/suggest_step_tools`.

## Tools API (port 8083)

`GET /mcp/tools` er fasit og svarer med den levende katalogen. Tabellen under er der for
den som leser uten å kjøre stacken.

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
| `answer_citizen_question` | Fritt spørsmål fra innbygger midt i en flyt. Henter satser selv og kaller `/ai/sporsmaal` |
| `get_process_definition` | Hent én prosessdefinisjon |
| `brreg_search_organisations` | Søk i enhetsregisteret |
| `brreg_get_organisation` | Hent organisasjon på orgnr |
| `folkeregister_search_persons` | Søk i folkeregisteret |
| `folkeregister_get_person` | Hent person på fødselsnummer |

## Matrikkel Mock (port 8085)

SOAP-flaten er den eneste i sandkassen som ikke lar seg beskrive godt i OpenAPI, så den
står her:

- `GET /geointegrasjon/matrikkel/wsapi/v1/BasisService?wsdl`
- `POST /geointegrasjon/matrikkel/wsapi/v1/BasisService` – støtter `FinnVeger`,
  `FinnMatrikkelenheter`, `HentMatrikkelenhet`, `HentEiere`

REST-hjelpeendepunktene står i `openapi/matrikkel-mock.yaml`.
