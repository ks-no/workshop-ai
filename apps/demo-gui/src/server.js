import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sharedUiDir = path.join(__dirname, "..", "..", "shared-ui");
const port = 3001;

// Whitelisted, because the filename comes from the URL. Never join user input
// onto a directory path without one.
const ASSETS = {
  "felles.css": "text/css; charset=utf-8",
  "felles.js": "text/javascript; charset=utf-8"
};

function send(response, statusCode, body, contentType = "text/html; charset=utf-8") {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*"
  });
  response.end(body);
}

async function sendFile(response, filsti, contentType) {
  try {
    send(response, 200, await readFile(filsti, "utf8"), contentType);
  } catch (error) {
    send(response, 500, `Kunne ikke lese ${path.basename(filsti)}: ${error.message}`, "text/plain; charset=utf-8");
  }
}

function sendHtml(response, filename) {
  return sendFile(response, path.join(__dirname, filename), "text/html; charset=utf-8");
}

const sider = {
  "/": "dashboard.html",
  "/dashboard": "dashboard.html",
  "/stegvis": "index.html",
  "/index.html": "index.html",
  "/chat": "chat.html",
  "/chat.html": "chat.html",
  "/agent": "agent.html",
  "/agent.html": "agent.html",
  "/utforsker": "utforsker.html",
  // The redirect_uri registered with ID-porten. Same path for every page: the page
  // to return to travels in `state`, not in the callback URL.
  "/callback": "callback.html"
};

const server = createServer(async (request, response) => {
  const sti = (request.url || "/").split("?")[0];

  if (sti === "/helse" || sti === "/health") {
    send(response, 200, JSON.stringify({ status: "ok", tjeneste: "demo-gui" }), "application/json; charset=utf-8");
    return;
  }

  if (sti.startsWith("/assets/")) {
    const navn = sti.slice("/assets/".length);
    const contentType = ASSETS[navn];
    if (!contentType) {
      send(response, 404, "Fant ikke fil.", "text/plain; charset=utf-8");
      return;
    }
    await sendFile(response, path.join(sharedUiDir, navn), contentType);
    return;
  }

  const side = sider[sti];
  if (side) {
    await sendHtml(response, side);
    return;
  }

  send(response, 404, "Fant ikke side.", "text/plain; charset=utf-8");
});

server.listen(port, () => {
  console.log(`Demo-GUI kjører på http://localhost:${port}`);
});
