import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const openapiFile = path.resolve(__dirname, "../../../openapi/sandbox-backend.yaml");
// PORT lets test scripts run an isolated instance alongside docker compose.
export const port = Number(process.env.PORT) || 8080;
export const fiksBaseUrl = process.env.FIKS_BASE_URL || "http://fiks-simulator:8081";
export const aiBaseUrl = process.env.AI_BASE_URL || "http://ai-gateway:8082";
// matrikkel-mock is the only reader of the matrikkel seed. See matrikkel.ts.
export const matrikkelBaseUrl = process.env.MATRIKKEL_BASE_URL || "http://matrikkel-mock:8085";

// Synthetic role id. In real Fiks this identifies the municipality's role.
export const fiksRolleId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

// --- Maskinporten and ID-porten -------------------------------------------

// Where we dial digdir-mock, and what we accept in `iss`. These are deliberately
// two settings: inside docker this service reaches the issuer at
// http://digdir-mock:8086, while the browser reaches the same issuer at
// http://localhost:8086. `iss` must be one shared logical name regardless of who
// dialled what, so tokens minted for a browser verify here too.
export const digdirBaseUrl = process.env.DIGDIR_BASE_URL || "http://digdir-mock:8086";
export const digdirIssuer = process.env.DIGDIR_ISSUER || "http://localhost:8086";

// --- this service's own hjemmel at fiks-simulator -------------------------
//
// Every surface in Fiks is behind Maskinporten, so this service needs its own
// token to reach any of them. Two configs rather than one because they carry
// different scopes, and the scope is the hjemmel: reading the register is not the
// same authority as asking a citizen for consent.
//
// `resource: "fiks-simulator"` matters. A token minted for this backend is rejected
// there, which is what audience restriction is for.
//
// The token client caches per clientId:scope:resource, so two configs cost two
// cached tokens, not two per request.
const fiksTokenBase = {
  digdirBaseUrl,
  issuer: digdirIssuer,
  clientId: "sandbox-backend",
  resource: "fiks-simulator"
};

/** Reading the skatte- og inntektsregister. Used by regler.ts. */
export const fiksRegisterToken = { ...fiksTokenBase, scope: "ks:fiks:register" };

/**
 * Asking for consent, answering it, and putting the resulting søknad in a
 * caseworker's queue. Used by prosess.ts.
 *
 * This service is a machine here, deliberately — it holds the verified citizen
 * token, decides, and then names the citizen in `aktor` on the way out. A service
 * that handed itself the citizen's identity would be the wrong lesson.
 */
export const fiksDialogToken = {
  ...fiksTokenBase,
  scope: "ks:fiks:samtykke ks:fiks:oppgave"
};

/**
 * Sending the kvittering for a submitted søknad. Used by svarut.ts.
 *
 * Its own config rather than a third scope on fiksDialogToken: putting a letter
 * in the citizen's postbox is not the authority to ask them for consent, and one
 * token carrying both would make the two indistinguishable in fiks' audit log.
 */
export const fiksSvarutToken = { ...fiksTokenBase, scope: "ks:fiks:svarut" };

// The municipality's SvarUt account. Synthetic and fixed, like fiksRolleId above:
// in real SvarUt this is the kommune's registered konto, handed out on onboarding.
export const svarutKontoId = "6b1f0d2c-8a34-4d7e-9f51-0c8b2a6d4e13";

export const maskinportenIssuer = digdirIssuer;
export const idportenIssuer = `${digdirIssuer}/idporten`;

// The audience this service accepts. A token minted for fiks-simulator is not
// valid here, and that is the point: audience restriction bounds what a leaked
// token can reach.
export const tokenAudience = process.env.TOKEN_AUDIENCE || "sandbox-backend";

// Enforcement is on by default. A gate that is switched off teaches nobody
// anything. The switch exists so the whole test tail can be bisected during a
// migration, not as a permanent setting.
//
// Contrast with the masking in skjerming.ts, which deliberately has no switch at
// all: masking is a property of the data, and this is a gate.
export const authEnforce = process.env.AUTH_ENFORCE !== "false";
