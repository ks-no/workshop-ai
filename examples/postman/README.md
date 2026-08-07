# Postman

**Det ligger ingen collection her, med vilje.** Postman importerer OpenAPI direkte, og
en håndholdt collection ved siden av spesifikasjonene ville blitt en andre sannhet som
driver fra koden. Importer i stedet.

## Importer

`File → Import` og pek på filene i `openapi/`:

| Fil | Tjeneste | Port |
|---|---|---|
| `openapi/sandbox-backend.yaml` | Orkestrering, data, prosesser, revisjon | 8080 |
| `openapi/fiks-simulator.yaml` | Samtykke, register, oppgaver | 8081 |
| `openapi/ai-gateway.yaml` | KI-støtte | 8082 |
| `openapi/mcp-services.yaml` | Verktøy over backend | 8083 |
| `openapi/process-agent.yaml` | Agent i naturlig språk | 8084 |
| `openapi/matrikkel-mock.yaml` | Kartverket Matrikkel-mock | 8085 |

Tre av tjenestene serverer også sin egen spesifikasjon mens de kjører, så du kan
importere via URL: `sandbox-backend` (`http://localhost:8080/openapi.yaml`),
`fiks-simulator` (`:8081`) og `ai-gateway` (`:8082`). `mcp-services`,
`process-agent` og `matrikkel-mock` gjør det ikke — for dem må du importere fila
fra `openapi/` direkte.

Sett en environment-variabel `basisUrl` per tjeneste, eller bruk `http://localhost:<port>`
direkte.

## Dekningsgrad, per august 2026

`sandbox-backend` er godt dekket med 28 paths, inkludert den deterministiske
vilkårsvurderingen. Beregningsendepunktet — det eneste som speiler et ekte KS-API — er
beskrevet i `openapi/fiks-simulator.yaml` med lenke til
[det ekte register-API-et](https://developers.fiks.ks.no/api/register-skatteoginntektsopplysninger-beregning-api-v1.json).

**Det store hullet er `fiks-simulator`: 4 av 19 ruter er dokumentert.** Udokumentert i dag:

- hele register-delen — `/fiks/register/person/{id}`, `/husstand/{id}`, `/inntekt/{id}`,
  `/barnehage/{id}`, `/kontaktinfo/{id}`
- samtykkets underruter — `/historikk`, `/svar`, `/trekk`, `/fiks/personer/{id}/samtykker`
- oppgaver og meldinger — `/fiks/oppgaver`, `/fiks/meldinger` med oppslag

Finner du et endepunkt som ikke er i spesifikasjonen, henger som regel spesifikasjonen
etter — ruta finnes. **`examples/curl/` er den mest verifiserte oversikten** over hva
som faktisk er der: alle kallene er hentet fra testskriptene og kjørt.

Å tette `fiks-simulator.yaml` er en fin, avgrenset førsteoppgave. `openapi/` tar imot
pull requests.
