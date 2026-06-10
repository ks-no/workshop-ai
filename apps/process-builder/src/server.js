import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = 3000;

function send(response, statusCode, body, contentType = "text/html; charset=utf-8") {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*"
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  if (request.url === "/helse" || request.url === "/health") {
    send(response, 200, JSON.stringify({ status: "ok", tjeneste: "prosessbygger" }), "application/json; charset=utf-8");
    return;
  }

  const filsti = path.join(__dirname, "index.html");
  const innhold = await readFile(filsti, "utf8");
  send(response, 200, innhold);
});

server.listen(port, () => {
  console.log(`Prosessbygger kjører på http://localhost:${port}`);
});
