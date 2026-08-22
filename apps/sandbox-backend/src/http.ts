import type { IncomingMessage, ServerResponse } from "node:http";

// Authorization must be in Allow-Headers: demo-gui calls this service
// cross-origin from :3001, and the moment it sends a bearer token the request
// becomes preflighted. Without it every browser call fails in preflight, visible
// only in the console, while curl keeps working perfectly.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization"
};

export function jsonResponse(
  response: ServerResponse,
  statusCode: number,
  data: unknown,
  headers: Record<string, string> = {}
) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...CORS,
    ...headers
  });
  response.end(JSON.stringify(data, null, 2));
}

export function textResponse(response: ServerResponse, statusCode: number, data: string, contentType = "text/html; charset=utf-8") {
  response.writeHead(statusCode, { "Content-Type": contentType, ...CORS });
  response.end(data);
}

export async function readRequestBody(request: IncomingMessage): Promise<any> {
  const chunks = [];
  for await (const del of request) {
    chunks.push(del);
  }
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function docsHtml() {
  return `
  <!doctype html>
  <html lang="nb">
    <head><meta charset="utf-8"><title>Sandbox Backend API</title></head>
    <body style="font-family: Arial, sans-serif; padding: 24px;">
      <h1>Sandbox Backend API</h1>
      <p><a href="/openapi.yaml">Spesifikasjonen</a> · <a href="/openapi-ruter.json">Samme, lest, som JSON</a> · <a href="http://localhost:3001/utforsker">Prøv rutene i API-utforskeren</a></p>
      <ul>
        <li><code>GET /helse</code></li>
        <li><code>GET /api/personer</code></li>
        <li><code>GET /api/prosesser</code></li>
        <li><code>POST /api/prosessoekter</code></li>
        <li><code>GET /api/prosessoekter/{oektsId}</code></li>
        <li><code>POST /api/prosessoekter/{oektsId}/svar</code></li>
        <li><code>POST /api/prosessoekter/{oektsId}/handling</code></li>
        <li><code>POST /api/prosessoekter/{oektsId}/neste</code></li>
        <li><code>POST /api/prosessoekter/{oektsId}/forrige</code></li>
      </ul>
    </body>
  </html>`;
}
