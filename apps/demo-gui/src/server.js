import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = 3001;

async function sendHtml(response, filename) {
  const filsti = path.join(__dirname, filename);
  const innhold = await readFile(filsti, "utf8");
  send(response, 200, innhold);
}

function send(response, statusCode, body, contentType = "text/html; charset=utf-8") {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*"
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  if (request.url === "/helse" || request.url === "/health") {
    send(response, 200, JSON.stringify({ status: "ok", tjeneste: "demo-gui" }), "application/json; charset=utf-8");
    return;
  }

  if (request.url === "/" || request.url === "/index.html") {
    await sendHtml(response, "index.html");
    return;
  }

  if (request.url === "/chat" || request.url === "/chat.html") {
    await sendHtml(response, "chat.html");
    return;
  }

  send(response, 404, "Fant ikke side.", "text/plain; charset=utf-8");
});

server.listen(port, () => {
  console.log(`Demo-GUI kjører på http://localhost:${port}`);
});
