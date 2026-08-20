# matrikkel-mock

Mock av Kartverket Matrikkel Geointegrasjon API i egen Docker-image.

## Datasett

`matrikkel-mock` starter fra `data/matrikkel.json` — 220 Bergen-gater og 8202 eiendommer — og bygger et syntetisk matrikkelregister ved oppstart. Den er eneste leser av matrikkeldataene i sandkassen: `sandbox-backend` kaller den over HTTP via `MATRIKKEL_BASE_URL`. Mangler et søk i seed-datasettet, prøver mocken å slå opp adressen direkte mot Geonorge.

Bakgrunn:

- `seeiendom.no` er fin til manuell utforsking, men frontend-en eksponerer ikke en stabil offentlig bulk-liste over alle veier i Bergen som egner seg godt for automatisert mocking.
- Derfor holder vi `matrikkel-mock` lett og lokalt syntetisk, samtidig som vi beholder håndkuraterte demo-gater som `Storgata`, `Nordnesveien`, `Fjøsangerveien` og `Laksevågvegen`.

Seedfila er stabil og skal være nok for vanlig lokal utvikling. Ved enkelte oppslag kan mocken hente data fra Geonorge dersom et treff mangler i seeden.

## Kjor lokalt med Node

```bash
node apps/matrikkel-mock/src/server.js
```

`MATRIKKEL_DATA_FILE` stotter fortsatt:

- vanlig JSON (`data/matrikkel.json`-format)
- `jsonl` / `ndjson`
- `jsonl.gz` / `ndjson.gz`

I `docker compose` leser `matrikkel-mock` standardfilen `data/matrikkel.json`. `data/matrikkel.seed.json` er beholdt som liten fixture for mockens egne tester.

Ved store datamengder kan du bruke `limit` og `offset` paa `GET /mock/matrikkel/gater` og `GET /mock/matrikkel/eiendommer`.

Sjekk aktiv datakilde i en kjoerende mock:

```bash
pnpm check:matrikkel-source
```

Mot en annen URL:

```bash
pnpm check:matrikkel-source -- --url=http://localhost:18085/health
```

## Bygg og kjor egen Docker-image

```bash
docker build -t workshop-ai/matrikkel-mock:local -f apps/matrikkel-mock/Dockerfile .
docker run --rm -p 8085:8085 workshop-ai/matrikkel-mock:local
```

## Endepunkt

- `GET /health`
- `GET /docs`
- `GET /geointegrasjon/matrikkel/wsapi/v1/BasisService?wsdl`
- `POST /geointegrasjon/matrikkel/wsapi/v1/BasisService` (SOAP)
- `GET /mock/matrikkel/gater?gate=Storgata`
- `GET /mock/matrikkel/eiendommer?gate=Storgata`
- `GET /mock/matrikkel/eiendom-oppslag?adresse=Storgata%205`
- `GET /mock/matrikkel/eiendom/matr-storg-003`

Responsene for eiendom inneholder nå også rikere mock-felter som `husnummer`, `husbokstav`, `adressekode`, `postnummer`, `poststed`, `koordinater`, `festenummer` og `undernummer` når data finnes eller kan utledes.

## Tester

Grunnleggende mocktest:

```bash
node scripts/test-matrikkel-mock.js
```

Bergen bulk-smoke test:

```bash
node scripts/test-bergen-matrikkel-bulk.js
```

MCP-integrasjonstest for matrikkel-oppslag:

```bash
pnpm test:mcp-matrikkel
```

## Stoettede SOAP-operasjoner

- `FinnVeger`
- `FinnMatrikkelenheter`
- `HentMatrikkelenhet`
- `HentEiere`

Andre operasjoner fra Geointegrasjon Basis-WSDL svarer med SOAP fault `Client.UnsupportedOperation`.

## Eksempel SOAP-kall

```bash
curl -s -X POST http://localhost:8085/geointegrasjon/matrikkel/wsapi/v1/BasisService \
  -H "Content-Type: text/xml; charset=utf-8" \
  -d '<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:mat="http://rep.geointegrasjon.no/Matrikkel/Basis/xml.wsdl/2012.01.31">
  <soapenv:Body>
    <mat:HentMatrikkelenhet>
      <matrikkelId>matr-storg-003</matrikkelId>
    </mat:HentMatrikkelenhet>
  </soapenv:Body>
</soapenv:Envelope>'
```

