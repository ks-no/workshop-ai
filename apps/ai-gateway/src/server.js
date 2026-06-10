import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataMappe = path.resolve(__dirname, "../../../data");
const port = 8082;

function jsonSvar(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  response.end(JSON.stringify(data, null, 2));
}

function tekstSvar(response, statusCode, data, contentType = "text/html; charset=utf-8") {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*"
  });
  response.end(data);
}

async function lesBody(request) {
  const deler = [];
  for await (const del of request) {
    deler.push(del);
  }
  return deler.length ? JSON.parse(Buffer.concat(deler).toString("utf8")) : {};
}

async function lesJson(filnavn) {
  return JSON.parse(await readFile(path.join(dataMappe, filnavn), "utf8"));
}

async function skrivJson(filnavn, data) {
  await writeFile(path.join(dataMappe, filnavn), JSON.stringify(data, null, 2) + "\n");
}

function nyttId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function leggTilRevisjon(hendelse) {
  const revisjonslogg = await lesJson("revisjonslogg.json");
  revisjonslogg.push({
    hendelseId: nyttId("revisjon"),
    tidspunkt: new Date().toISOString(),
    syntetisk: true,
    ...hendelse
  });
  await skrivJson("revisjonslogg.json", revisjonslogg);
}

function docsHtml() {
  return `
  <!doctype html>
  <html lang="nb">
    <head><meta charset="utf-8"><title>AI Gateway API</title></head>
    <body style="font-family: Arial, sans-serif; padding: 24px;">
      <h1>AI Gateway API</h1>
      <ul>
        <li><code>POST /ai/dialogforslag</code></li>
        <li><code>POST /ai/oppsummering</code></li>
        <li><code>POST /ai/forklar-databruk</code></li>
        <li><code>POST /ai/klarsprak</code></li>
        <li><code>POST /ai/risikosjekk</code></li>
      </ul>
    </body>
  </html>`;
}

function byggSvar(type, body) {
  const tjeneste = body?.kontekst?.tjeneste || "kommunal tjeneste";
  const tekster = {
    dialogforslag: `Hei! Jeg kan hjelpe deg med ${tjeneste}. Vi går steg for steg og bruker bare syntetiske opplysninger i denne demoen.`,
    oppsummering: `Du har gjennomført en demo for ${tjeneste}. Opplysninger om husstand og inntekt brukes kun for å illustrere hvordan kommunen kan forklare databruk tydeligere.`,
    "forklar-databruk": `Vi bruker opplysningene i denne demoen for å vise hvordan saksflyten kan bli enklere å forstå. Dataene er syntetiske og brukes ikke til reelle vedtak.`,
    klarsprak: "Dette betyr kort fortalt at du får en enklere forklaring på hvilke opplysninger som brukes og hvorfor.",
    risikosjekk: "Ingen kritiske risikoer funnet i denne demoen, men løsningen må fortsatt unngå reelle persondata og automatiserte vedtak."
  };

  return {
    tekst: tekster[type],
    syntetisk: true,
    modell: "mock-ai-gateway",
    sprak: body.sprak || "nb"
  };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "OPTIONS") {
    jsonSvar(response, 204, {});
    return;
  }

  try {
    if (url.pathname === "/helse" || url.pathname === "/health") {
      jsonSvar(response, 200, { status: "ok", tjeneste: "ai-gateway", tidspunkt: new Date().toISOString() });
      return;
    }

    if (url.pathname === "/docs") {
      tekstSvar(response, 200, docsHtml());
      return;
    }

    if (url.pathname === "/openapi.yaml") {
      const yaml = await readFile(path.resolve(__dirname, "../../../openapi/ai-gateway.yaml"), "utf8");
      tekstSvar(response, 200, yaml, "text/yaml; charset=utf-8");
      return;
    }

    const gyldigeStier = ["/ai/dialogforslag", "/ai/oppsummering", "/ai/forklar-databruk", "/ai/klarsprak", "/ai/risikosjekk"];
    if (request.method === "POST" && gyldigeStier.includes(url.pathname)) {
      const body = await lesBody(request);
      const type = url.pathname.replace("/ai/", "");
      const svar = byggSvar(type, body);
      await leggTilRevisjon({
        sporingsId: body.sporingsId || nyttId("flyt"),
        handling: "KI_KALL",
        ressurs: type,
        aktor: { type: "system", id: "ai-gateway" }
      });
      jsonSvar(response, 200, svar);
      return;
    }

    jsonSvar(response, 404, { feil: "Fant ikke endepunkt." });
  } catch (error) {
    jsonSvar(response, 500, { feil: "Intern feil i AI-gateway.", detalj: error.message, syntetisk: true });
  }
});

server.listen(port, () => {
  console.log(`AI-gateway kjører på http://localhost:${port}`);
});
