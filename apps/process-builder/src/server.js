import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sharedUiDir = path.join(__dirname, "..", "..", "shared-ui");
const port = 3000;

// Whitelisted, because the filename comes from the URL.
const ASSETS = {
  "felles.css": "text/css; charset=utf-8",
  "felles.js": "text/javascript; charset=utf-8",
  // Vendored design system, see docs/designsystem.md. Flat filenames on purpose:
  // the lookup below joins the URL name onto a directory, so no name may contain a slash.
  "ds-base.css": "text/css; charset=utf-8",
  "ds-ksdigital.css": "text/css; charset=utf-8"
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

const server = createServer(async (request, response) => {
  const sti = (request.url || "/").split("?")[0];

  if (sti === "/helse" || sti === "/health") {
    send(response, 200, JSON.stringify({ status: "ok", tjeneste: "prosessbygger" }), "application/json; charset=utf-8");
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

  await sendFile(response, path.join(__dirname, "index.html"), "text/html; charset=utf-8");
});

server.listen(port, () => {
  console.log(`Prosessbygger kjører på http://localhost:${port}`);
});
