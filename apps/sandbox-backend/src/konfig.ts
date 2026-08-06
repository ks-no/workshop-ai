import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// data/ holds seed data and is tracked in git. Nothing here is ever written
// to at runtime. Everything the services change lives in state/, which is
// gitignored, so a demo run never dirties the working tree.
export const seedMappe = path.resolve(__dirname, "../../../data");
export const stateMappe = process.env.STATE_DIR || path.resolve(__dirname, "../../../state");
export const openapiFil = path.resolve(__dirname, "../../../openapi/sandbox-backend.yaml");
// PORT lar testskript starte en isolert instans ved siden av docker compose.
export const port = Number(process.env.PORT) || 8080;
export const fiksBaseUrl = process.env.FIKS_BASE_URL || "http://fiks-simulator:8081";
export const aiBaseUrl = process.env.AI_BASE_URL || "http://ai-gateway:8082";

// Syntetisk rolle-id. I ekte Fiks identifiserer den kommunens rolle.
export const fiksRolleId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
