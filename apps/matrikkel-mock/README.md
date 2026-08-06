# matrikkel-mock

Mock av Kartverket Matrikkel Geointegrasjon API i egen Docker-image.

## Kjor lokalt med Node

```bash
node apps/matrikkel-mock/src/server.js
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
- `GET /mock/matrikkel/eiendom/matr-storg-003`

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

