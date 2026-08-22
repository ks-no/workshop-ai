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

**Alle seks spesifikasjoner dekker nå hver rute i koden**, med `security:` per rute:
`sandbox-backend` 33, `fiks-simulator` 21, `ai-gateway` 16, `matrikkel-mock` 8,
`mcp-services` 6, `process-agent` 5. Beregningsendepunktet — det eneste som speiler et
ekte KS-API — er beskrevet i `openapi/fiks-simulator.yaml` med lenke til
[det ekte register-API-et](https://developers.fiks.ks.no/api/register-skatteoginntektsopplysninger-beregning-api-v1.json).

`pnpm test:openapi` sammenligner kode og spesifikasjon i begge retninger og feiler i CI
på en udokumentert rute, en dokumentert rute som ikke finnes, feil metode, en duplikat
path-nøkkel, en manglende `security:` eller et kodeverk som har kommet ut av takt. Finner
du likevel et avvik, er det en feil å melde — ikke lenger et forventet etterslep.
