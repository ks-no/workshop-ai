import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8085);
const wsPath = "/geointegrasjon/matrikkel/wsapi/v1/BasisService";
const wsNamespace = "http://rep.geointegrasjon.no/Matrikkel/Basis/xml.wsdl/2012.01.31";

async function readMatrikkelData() {
  const kandidatfiler = [
    process.env.MATRIKKEL_DATA_FILE,
    path.resolve(__dirname, "../../../data/matrikkel.json"),
    path.resolve(__dirname, "../data/matrikkel.json")
  ].filter(Boolean);

  for (const fil of kandidatfiler) {
    try {
      return JSON.parse(await readFile(fil, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  throw new Error("Fant ikke matrikkeldata. Sett MATRIKKEL_DATA_FILE eller legg data/matrikkel.json i repoet.");
}

function jsonResponse(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,SOAPAction"
  });
  response.end(JSON.stringify(data, null, 2));
}

function textResponse(response, statusCode, data, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,SOAPAction"
  });
  response.end(data);
}

function xmlEscape(verdi) {
  return String(verdi)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function finnTagg(xml, taggnavn) {
  const treff = xml.match(new RegExp(`<(?:\\w+:)?${taggnavn}[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${taggnavn}>`, "i"));
  return treff ? treff[1].trim() : null;
}

function findOperation(xml) {
  const bodyTreff = xml.match(/<(?:\w+:)?Body[^>]*>([\s\S]*?)<\/(?:\w+:)?Body>/i);
  if (!bodyTreff) return null;
  const operasjonTreff = bodyTreff[1].match(/<\s*(?:\w+:)?([A-Za-z0-9_]+)\b[^>]*>/);
  return operasjonTreff ? operasjonTreff[1] : null;
}

function normaliser(verdi) {
  return String(verdi || "").trim().toLowerCase();
}

function finnGate(matrikkel, gateSoek) {
  const soek = normaliser(gateSoek);
  return (matrikkel.gater || []).find((gate) => normaliser(gate.adressenavn).includes(soek));
}

function finnEiendom(matrikkel, matrikkelId, gnr, bnr) {
  for (const gate of matrikkel.gater || []) {
    for (const eiendom of gate.eiendommer || []) {
      if (matrikkelId && eiendom.matrikkelId === matrikkelId) {
        return { gate, eiendom };
      }
      if (
        gnr !== null &&
        bnr !== null &&
        Number(eiendom.gnr) === Number(gnr) &&
        Number(eiendom.bnr) === Number(bnr)
      ) {
        return { gate, eiendom };
      }
    }
  }
  return null;
}

function soapEnvelope(innhold) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:mat="${wsNamespace}">\n  <soapenv:Body>\n${innhold}\n  </soapenv:Body>\n</soapenv:Envelope>`;
}

function soapFault(feilkode, melding) {
  return soapEnvelope(`    <soapenv:Fault>\n      <faultcode>${xmlEscape(feilkode)}</faultcode>\n      <faultstring>${xmlEscape(melding)}</faultstring>\n    </soapenv:Fault>`);
}

function wsdlDocument(baseUrl) {
  const serviceUrl = `${baseUrl}${wsPath}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<wsdl:definitions
  name="MatrikkelBasisMock"
  targetNamespace="${wsNamespace}"
  xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
  xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:tns="${wsNamespace}">
  <wsdl:types>
    <xs:schema targetNamespace="${wsNamespace}" elementFormDefault="qualified">
      <xs:element name="FinnVeger" type="xs:anyType"/>
      <xs:element name="FinnMatrikkelenheter" type="xs:anyType"/>
      <xs:element name="HentMatrikkelenhet" type="xs:anyType"/>
      <xs:element name="HentEiere" type="xs:anyType"/>
      <xs:element name="FinnVegerResponse" type="xs:anyType"/>
      <xs:element name="FinnMatrikkelenheterResponse" type="xs:anyType"/>
      <xs:element name="HentMatrikkelenhetResponse" type="xs:anyType"/>
      <xs:element name="HentEiereResponse" type="xs:anyType"/>
    </xs:schema>
  </wsdl:types>
  <wsdl:message name="FinnVegerRequest"><wsdl:part name="parameters" element="tns:FinnVeger"/></wsdl:message>
  <wsdl:message name="FinnVegerResponse"><wsdl:part name="parameters" element="tns:FinnVegerResponse"/></wsdl:message>
  <wsdl:message name="FinnMatrikkelenheterRequest"><wsdl:part name="parameters" element="tns:FinnMatrikkelenheter"/></wsdl:message>
  <wsdl:message name="FinnMatrikkelenheterResponse"><wsdl:part name="parameters" element="tns:FinnMatrikkelenheterResponse"/></wsdl:message>
  <wsdl:message name="HentMatrikkelenhetRequest"><wsdl:part name="parameters" element="tns:HentMatrikkelenhet"/></wsdl:message>
  <wsdl:message name="HentMatrikkelenhetResponse"><wsdl:part name="parameters" element="tns:HentMatrikkelenhetResponse"/></wsdl:message>
  <wsdl:message name="HentEiereRequest"><wsdl:part name="parameters" element="tns:HentEiere"/></wsdl:message>
  <wsdl:message name="HentEiereResponse"><wsdl:part name="parameters" element="tns:HentEiereResponse"/></wsdl:message>
  <wsdl:portType name="MatrikkelBasisPortType">
    <wsdl:operation name="FinnVeger"><wsdl:input message="tns:FinnVegerRequest"/><wsdl:output message="tns:FinnVegerResponse"/></wsdl:operation>
    <wsdl:operation name="FinnMatrikkelenheter"><wsdl:input message="tns:FinnMatrikkelenheterRequest"/><wsdl:output message="tns:FinnMatrikkelenheterResponse"/></wsdl:operation>
    <wsdl:operation name="HentMatrikkelenhet"><wsdl:input message="tns:HentMatrikkelenhetRequest"/><wsdl:output message="tns:HentMatrikkelenhetResponse"/></wsdl:operation>
    <wsdl:operation name="HentEiere"><wsdl:input message="tns:HentEiereRequest"/><wsdl:output message="tns:HentEiereResponse"/></wsdl:operation>
  </wsdl:portType>
  <wsdl:binding name="MatrikkelBasisBinding" type="tns:MatrikkelBasisPortType">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <wsdl:operation name="FinnVeger"><soap:operation soapAction="FinnVeger"/><wsdl:input><soap:body use="literal"/></wsdl:input><wsdl:output><soap:body use="literal"/></wsdl:output></wsdl:operation>
    <wsdl:operation name="FinnMatrikkelenheter"><soap:operation soapAction="FinnMatrikkelenheter"/><wsdl:input><soap:body use="literal"/></wsdl:input><wsdl:output><soap:body use="literal"/></wsdl:output></wsdl:operation>
    <wsdl:operation name="HentMatrikkelenhet"><soap:operation soapAction="HentMatrikkelenhet"/><wsdl:input><soap:body use="literal"/></wsdl:input><wsdl:output><soap:body use="literal"/></wsdl:output></wsdl:operation>
    <wsdl:operation name="HentEiere"><soap:operation soapAction="HentEiere"/><wsdl:input><soap:body use="literal"/></wsdl:input><wsdl:output><soap:body use="literal"/></wsdl:output></wsdl:operation>
  </wsdl:binding>
  <wsdl:service name="MatrikkelBasisMockService">
    <wsdl:port name="MatrikkelBasisMockPort" binding="tns:MatrikkelBasisBinding">
      <soap:address location="${serviceUrl}"/>
    </wsdl:port>
  </wsdl:service>
</wsdl:definitions>`;
}

function byggGateReturn(gate) {
  return [
    "      <return>",
    `        <gateId>${xmlEscape(gate.gateId)}</gateId>`,
    `        <adressenavn>${xmlEscape(gate.adressenavn)}</adressenavn>`,
    `        <kommunenummer>${xmlEscape(gate.kommunenummer)}</kommunenummer>`,
    `        <kommune>${xmlEscape(gate.kommune)}</kommune>`,
    `        <postnummer>${xmlEscape(gate.postnummer)}</postnummer>`,
    `        <poststed>${xmlEscape(gate.poststed)}</poststed>`,
    "      </return>"
  ].join("\n");
}

function byggEiendomReturn(gate, eiendom) {
  return [
    "      <return>",
    `        <matrikkelId>${xmlEscape(eiendom.matrikkelId)}</matrikkelId>`,
    `        <gnr>${xmlEscape(eiendom.gnr)}</gnr>`,
    `        <bnr>${xmlEscape(eiendom.bnr)}</bnr>`,
    `        <adresse>${xmlEscape(eiendom.adresse)}</adresse>`,
    `        <bruksenhetstype>${xmlEscape(eiendom.bruksenhetstype)}</bruksenhetstype>`,
    `        <adressenavn>${xmlEscape(gate.adressenavn)}</adressenavn>`,
    `        <kommunenummer>${xmlEscape(gate.kommunenummer)}</kommunenummer>`,
    "      </return>"
  ].join("\n");
}

async function readBody(request) {
  const chunks = [];
  for await (const del of request) {
    chunks.push(del);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function handleSoap(operasjon, xml, matrikkel) {
  if (operasjon === "FinnVeger") {
    const tekst = finnTagg(xml, "soeketekst") || finnTagg(xml, "adressenavn") || "";
    const kommunenummer = finnTagg(xml, "kommunenummer");
    const gater = (matrikkel.gater || []).filter((gate) => {
      const matcherKommune = !kommunenummer || gate.kommunenummer === kommunenummer;
      const matcherTekst = !tekst || normaliser(gate.adressenavn).includes(normaliser(tekst));
      return matcherKommune && matcherTekst;
    });

    return soapEnvelope(`    <mat:FinnVegerResponse>\n${gater.map(byggGateReturn).join("\n")}\n    </mat:FinnVegerResponse>`);
  }

  if (operasjon === "FinnMatrikkelenheter") {
    const gateSoek = finnTagg(xml, "adressenavn") || finnTagg(xml, "soeketekst") || finnTagg(xml, "gate");
    const kommunenummer = finnTagg(xml, "kommunenummer");
    const gater = (matrikkel.gater || []).filter((gate) => {
      const matcherKommune = !kommunenummer || gate.kommunenummer === kommunenummer;
      const matcherGate = !gateSoek || normaliser(gate.adressenavn).includes(normaliser(gateSoek));
      return matcherKommune && matcherGate;
    });
    const eiendommer = gater.flatMap((gate) => (gate.eiendommer || []).map((eiendom) => ({ gate, eiendom })));

    return soapEnvelope(`    <mat:FinnMatrikkelenheterResponse>\n${eiendommer.map(({ gate, eiendom }) => byggEiendomReturn(gate, eiendom)).join("\n")}\n    </mat:FinnMatrikkelenheterResponse>`);
  }

  if (operasjon === "HentMatrikkelenhet") {
    const matrikkelId = finnTagg(xml, "matrikkelId") || finnTagg(xml, "matrikkelenhetsId");
    const gnr = finnTagg(xml, "gaardsnummer") || finnTagg(xml, "gnr");
    const bnr = finnTagg(xml, "bruksnummer") || finnTagg(xml, "bnr");
    const treff = finnEiendom(matrikkel, matrikkelId, gnr, bnr);
    if (!treff) {
      return soapFault("Client.NotFound", "Fant ikke matrikkelenhet for forespoerselen.");
    }

    return soapEnvelope(`    <mat:HentMatrikkelenhetResponse>\n${byggEiendomReturn(treff.gate, treff.eiendom)}\n    </mat:HentMatrikkelenhetResponse>`);
  }

  if (operasjon === "HentEiere") {
    const matrikkelId = finnTagg(xml, "matrikkelId") || finnTagg(xml, "matrikkelenhetsId");
    const gnr = finnTagg(xml, "gaardsnummer") || finnTagg(xml, "gnr");
    const bnr = finnTagg(xml, "bruksnummer") || finnTagg(xml, "bnr");
    const treff = finnEiendom(matrikkel, matrikkelId, gnr, bnr);
    if (!treff) {
      return soapFault("Client.NotFound", "Fant ikke matrikkelenhet for forespoerselen.");
    }

    const eiere = treff.eiendom.eiere || [];
    return soapEnvelope(`    <mat:HentEiereResponse>\n${eiere.map((eier) => `      <return><personId>${xmlEscape(eier)}</personId></return>`).join("\n")}\n    </mat:HentEiereResponse>`);
  }

  return soapFault(
    "Client.UnsupportedOperation",
    `Operasjonen ${operasjon} er ikke implementert i mocken. Stoettede: FinnVeger, FinnMatrikkelenheter, HentMatrikkelenhet, HentEiere.`
  );
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "OPTIONS") {
    jsonResponse(response, 204, {});
    return;
  }

  try {
    const matrikkel = await readMatrikkelData();

    if (request.method === "GET" && (url.pathname === "/helse" || url.pathname === "/health")) {
      jsonResponse(response, 200, {
        status: "ok",
        tjeneste: "matrikkel-mock",
        wsdl: `${wsPath}?wsdl`,
        tidspunkt: new Date().toISOString()
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/mock/matrikkel/gater") {
      const gateSoek = url.searchParams.get("gate");
      if (gateSoek) {
        const gate = finnGate(matrikkel, gateSoek);
        jsonResponse(response, gate ? 200 : 404, gate || { feil: `Fant ikke gate ${gateSoek}.` });
        return;
      }
      jsonResponse(response, 200, matrikkel.gater || []);
      return;
    }

    const eiendomTreff = url.pathname.match(/^\/mock\/matrikkel\/eiendom\/([^/]+)$/);
    if (request.method === "GET" && eiendomTreff) {
      const treff = finnEiendom(matrikkel, decodeURIComponent(eiendomTreff[1]), null, null);
      if (!treff) {
        jsonResponse(response, 404, { feil: "Fant ikke matrikkelenhet." });
        return;
      }
      jsonResponse(response, 200, {
        ...treff.eiendom,
        adressenavn: treff.gate.adressenavn,
        kommunenummer: treff.gate.kommunenummer,
        kommune: treff.gate.kommune,
        syntetisk: true
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/mock/matrikkel/eiendommer") {
      const gateSoek = url.searchParams.get("gate");
      const personId = url.searchParams.get("personId");
      const gater = gateSoek ? [finnGate(matrikkel, gateSoek)].filter(Boolean) : (matrikkel.gater || []);
      const funn = gater.flatMap((gate) => (gate.eiendommer || []).map((eiendom) => ({
        ...eiendom,
        adressenavn: gate.adressenavn,
        kommunenummer: gate.kommunenummer,
        kommune: gate.kommune,
        syntetisk: true
      })));
      const filtrert = personId ? funn.filter((eiendom) => (eiendom.eiere || []).includes(personId)) : funn;
      jsonResponse(response, 200, filtrert);
      return;
    }

    if (request.method === "GET" && url.pathname === wsPath && url.searchParams.has("wsdl")) {
      const baseUrl = `http://${request.headers.host}`;
      textResponse(response, 200, wsdlDocument(baseUrl), "text/xml; charset=utf-8");
      return;
    }

    if (request.method === "POST" && url.pathname === wsPath) {
      const xml = await readBody(request);
      const operasjon = findOperation(xml);
      if (!operasjon) {
        textResponse(response, 400, soapFault("Client.InvalidRequest", "Fant ingen SOAP-operasjon i Body."), "text/xml; charset=utf-8");
        return;
      }
      textResponse(response, 200, handleSoap(operasjon, xml, matrikkel), "text/xml; charset=utf-8");
      return;
    }

    if (request.method === "GET" && url.pathname === "/docs") {
      textResponse(
        response,
        200,
        [
          "<!doctype html>",
          "<html lang=\"nb\"><head><meta charset=\"utf-8\"><title>Matrikkel Mock</title></head><body>",
          "<h1>Matrikkel Mock API</h1>",
          "<ul>",
          `<li><code>GET ${wsPath}?wsdl</code></li>`,
          `<li><code>POST ${wsPath}</code> (SOAP)</li>`,
          "<li><code>GET /mock/matrikkel/gater?gate=Storgata</code></li>",
          "<li><code>GET /mock/matrikkel/eiendommer?gate=Storgata</code></li>",
          "<li><code>GET /mock/matrikkel/eiendom/matr-storg-003</code></li>",
          "</ul>",
          "</body></html>"
        ].join("\n"),
        "text/html; charset=utf-8"
      );
      return;
    }

    jsonResponse(response, 404, { feil: "Fant ikke endepunkt." });
  } catch (error) {
    jsonResponse(response, 500, { feil: "Intern feil i matrikkel-mock.", detalj: error.message, syntetisk: true });
  }
});

server.listen(port, () => {
  console.log(`Matrikkel-mock kjorer pa http://localhost:${port}`);
});

