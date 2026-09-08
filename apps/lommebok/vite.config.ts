import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Global in-memory cache for verifiserte resultater
const verificationResultsStore = new Map<string, any>();

function lommebokApiPlugin() {
  return {
    name: "lommebok-api-plugin",
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        const url = new URL(req.url, `http://${req.headers.host || "localhost:3002"}`);

        // Helsesjekk for tjenestetabell
        if (url.pathname === "/helse") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ tjeneste: "lommebok", status: "oppe", port: 3002 }));
          return;
        }

        // Hent alle personer fra KS-sandkassedata
        if (url.pathname === "/api/personer" && req.method === "GET") {
          try {
            const dataPath = path.resolve(__dirname, "../../data/personer.json");
            const raw = fs.readFileSync(dataPath, "utf-8");
            const personer = JSON.parse(raw).map((p: any) => ({
              ...p,
              visningsnavn: [p.navn?.fornavn, p.navn?.mellomnavn, p.navn?.etternavn]
                .filter(Boolean)
                .join(" ")
            }));
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(personer));
            return;
          } catch (err: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: "Kunne ikke lese personer.json", details: err.message }));
            return;
          }
        }

        // Output resultat av query i et API for hackathon-deltakere
        // GET /api/verifikasjon/:transactionId
        if (url.pathname.startsWith("/api/verifikasjon/") && req.method === "GET") {
          const parts = url.pathname.split("/");
          const transactionId = parts[3];
          if (!transactionId) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "Mangler transactionId i URL" }));
            return;
          }

          const cached = verificationResultsStore.get(transactionId);
          if (cached) {
            res.setHeader("Content-Type", "application/json");
            res.setHeader("X-API-KEY", "KS-HACKATHON");
            res.end(JSON.stringify(cached, null, 2));
            return;
          }

          // Forsøk å hente direkte fra verifier-service hvis ikke i cache
          const verifierBase = process.env.VERIFIER_SERVICE_URL || "http://localhost:9285";
          const clientApp = process.env.VERIFIER_CLIENT_ID || "bevisgenerator-login";
          try {
            const fetchRes = await fetch(`${verifierBase}/api/v1/${clientApp}/verify/result/${transactionId}`, {
              headers: {
                "Accept": "application/json",
                "X-API-KEY": "KS-HACKATHON"
              }
            });

            if (fetchRes.ok) {
              const data = await fetchRes.json();
              verificationResultsStore.set(transactionId, data);
              res.setHeader("Content-Type", "application/json");
              res.setHeader("X-API-KEY", "KS-HACKATHON");
              res.end(JSON.stringify(data, null, 2));
              return;
            } else {
              res.statusCode = fetchRes.status;
              const text = await fetchRes.text();
              res.end(text);
              return;
            }
          } catch (err: any) {
            res.statusCode = 404;
            res.end(JSON.stringify({
              error: `Fant ikke verifiseringsresultat for transaksjon: ${transactionId}`,
              melding: "Sørg for at lommeboken har fullført verifiseringen mot verifier-tjenesten.",
              detaljer: err.message
            }));
            return;
          }
        }

        // Lagre verifiseringsresultat i minnet når frontend henter eller lagrer
        if (url.pathname === "/api/verifikasjon/lagre" && req.method === "POST") {
          let body = "";
          req.on("data", (chunk: any) => { body += chunk; });
          req.on("end", () => {
            try {
              const parsed = JSON.parse(body);
              if (parsed.transactionId && parsed.result) {
                verificationResultsStore.set(parsed.transactionId, parsed.result);
              }
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ success: true }));
            } catch (err: any) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: err.message }));
            }
          });
          return;
        }

        next();
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), lommebokApiPlugin()],
  server: {
    port: 3002,
    host: true,
    proxy: {
      "/api/v1": {
        target: process.env.VERIFIER_SERVICE_URL || "http://localhost:9285",
        changeOrigin: true,
        headers: {
          "X-API-KEY": "KS-HACKATHON"
        }
      }
    }
  }
});
