# Tools API

**For deg som bygger en agent og trenger verktøy å kalle.** REST-endepunkter oppå de
andre tjenestene: prosessveiledning, KI-tolkning og matrikkeldata i ett sett. Skal du
bruke sandkassens API-er direkte, går du utenom denne og rett på tjenesten selv.

## Verktøylisten

`GET /verktoy` svarer med den levende katalogen: navn, beskrivelser og `inputSchema`.
Den er den eneste listen som ikke kan komme i utakt. `docs/api-oversikt.md` har de samme
navnene i prosa, til lesing uten at stacken er oppe.

Formen er den vanlige for verktøykalling - `name`, `description` og et JSON Schema - så
du kan mate katalogen rett inn i et modellkall. Derfor er de feltene engelske selv om
resten av wire-formatet er norsk.

Her sto det en håndkopiert tabell, og den hadde mistet flere verktøy før noen oppdaget
det. Derfor feiler `pnpm test:docs` nå ethvert dokument som navngir minst ti av dem uten
å navngi alle.

`suggest_step_tools` er den ene som fortjener en forklaring, og den bor i
`docs/prosessmodell.md`: hva et steg må inneholde, og hva `bruk`-verdiene betyr.

## Endepunkter

- `GET /helse`
- `GET /info`
- `GET /verktoy`
- `POST /verktoy/invoke`
- `POST /verktoy/{toolName}/invoke`

## Miljøvariabler

- `BACKEND_BASE_URL` (standard `http://sandbox-backend:8080`)
- `AI_BASE_URL` (standard `http://ai-gateway:8082`)
- `MATRIKKEL_BASE_URL` (standard `http://matrikkel-mock:8085`)
- `MATRIKKEL_MODE` - `mock` alle tre steder: standardverdi i koden, i compose og i
  `.env.example`. `live` og `hybrid` slår opp gater direkte via Geonorge; `live` kaster
  videre ved nettfeil, `hybrid` faller tilbake til seed-dataene
- `GEONORGE_ADRESSE_API_BASE_URL` (standard `https://ws.geonorge.no/adresser/v1`)
- `MATRIKKEL_HTTP_TIMEOUT_MS` (standard `6000`)

I `live`/`hybrid` brukes Geonorge også for eksakte adresseoppslag i `matrikkel_hent_eiendom`.
`matrikkel_hent_eiere` kan da returnere tom eierliste med en forklarende `merknad`, siden den offentlige adressekilden ikke inneholder eierinformasjon.

## Eksempel

```bash
curl -s http://localhost:8083/verktoy
```

```bash
curl -s -X POST http://localhost:8083/verktoy/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "name": "list_processes",
    "arguments": {}
  }'
```

```bash
curl -s -X POST http://localhost:8083/verktoy/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "name": "suggest_step_tools",
    "arguments": {
      "steg": {
        "id": "velg-gate",
        "tekst": "Hvilken gate ønsker du fartsdempende tiltak i?",
        "felter": [{"id": "gatenavn", "label": "Gatenavn"}]
      }
    }
  }'
```

```bash
curl -s -X POST http://localhost:8083/verktoy/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "name": "matrikkel_hent_eiere",
    "arguments": {
      "matrikkelId": "matr-storg-003"
    }
  }'
```

```bash
curl -s -X POST http://localhost:8083/verktoy/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "name": "matrikkel_hent_eiendom",
    "arguments": {
      "adresse": "Storgata 5"
    }
  }'
```

