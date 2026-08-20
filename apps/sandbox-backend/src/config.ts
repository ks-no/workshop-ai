import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// data/ holds seed data and is tracked in git. Nothing here is ever written
// to at runtime. Everything the services change lives in state/, which is
// gitignored, so a demo run never dirties the working tree.
export const seedDir = path.resolve(__dirname, "../../../data");
export const stateDir = process.env.STATE_DIR || path.resolve(__dirname, "../../../state");
export const openapiFile = path.resolve(__dirname, "../../../openapi/sandbox-backend.yaml");
// PORT lets test scripts run an isolated instance alongside docker compose.
export const port = Number(process.env.PORT) || 8080;
export const fiksBaseUrl = process.env.FIKS_BASE_URL || "http://fiks-simulator:8081";
export const aiBaseUrl = process.env.AI_BASE_URL || "http://ai-gateway:8082";
// matrikkel-mock is the only reader of the matrikkel seed. See matrikkel.ts.
export const matrikkelBaseUrl = process.env.MATRIKKEL_BASE_URL || "http://matrikkel-mock:8085";

// Synthetic role id. In real Fiks this identifies the municipality's role.
export const fiksRolleId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
