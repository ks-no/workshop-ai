import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Denne appen kaller aldri OpenID4VCI/OpenID4VP-tjenestene direkte. Alt under
// /api/* går til apps/lommebok, som allerede har den fungerende integrasjonen
// (utstedelse, verifisering, personoppslag). Dette er den eneste plassen den
// avhengigheten er uttrykt - se src/integrations/lommebokApi.ts for kallene.
const LOMMEBOK_BASE_URL = process.env.LOMMEBOK_BASE_URL || "http://localhost:3002";

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
      // Dekker /api/personer, /api/utsted, /api/verifikasjon/*, og /api/v1/* (lommebok
      // sin egen proxy videre til verifier-tjenesten i testmiljøet).
      "/api": {
        target: LOMMEBOK_BASE_URL,
        changeOrigin: true,
        secure: false
      }
    }
  }
});
