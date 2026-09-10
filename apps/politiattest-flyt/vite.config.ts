import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Denne appen kaller aldri OpenID4VCI/OpenID4VP-tjenestene direkte. Alt under
// /api/* går til apps/lommebok, som allerede har den fungerende integrasjonen
// (utstedelse, verifisering, personoppslag). Dette er den eneste plassen den
// avhengigheten er uttrykt - se src/integrations/lommebokApi.ts for kallene.
const LOMMEBOK_BASE_URL = process.env.LOMMEBOK_BASE_URL || "http://localhost:3002";
const VERIFIER_SERVICE_URL =
  process.env.VERIFIER_SERVICE_URL || "https://verifier-service.test.eidas2sandkasse.net";

function helsesjekkPlugin() {
  return {
    name: "politiattest-flyt-helse",
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        if (req.url === "/helse") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ tjeneste: "politiattest-flyt", status: "oppe", port: 3003 }));
          return;
        }
        next();
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), helsesjekkPlugin()],
  server: {
    port: 3003,
    host: true,
    proxy: {
      // Samme direkte verifier-proxy som apps/lommebok bruker.
      "/api/v1": {
        target: VERIFIER_SERVICE_URL,
        changeOrigin: true,
        secure: false,
        headers: {
          "X-API-KEY": "KS-HACKATHON"
        }
      },
      // Personer, utstedelse og lagrede verifiseringsresultater eies av lommebok.
      "/api": {
        target: LOMMEBOK_BASE_URL,
        changeOrigin: true,
        secure: false
      }
    }
  }
});
