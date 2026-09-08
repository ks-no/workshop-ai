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

        // Hent alle personer fra KS-sandkassedata, beriket med KRR, barnehage, politiattest og inntekt
        if (url.pathname === "/api/personer" && req.method === "GET") {
          try {
            const dataDir = path.resolve(__dirname, "../../data");
            const readJson = (file: string, fallback: any = []) => {
              try {
                return JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf-8"));
              } catch {
                return fallback;
              }
            };

            const personer = readJson("personer.json", []);
            const krr = readJson("krr.json", []);
            const bhg = readJson("barnehageplasser.json", []);
            const politiRaw = readJson("politiattester.json", { attester: [] });
            const politi = politiRaw.attester || [];
            const inntekter = readJson("inntekter.json", []);
            const husstander = readJson("husstander.json", []);

            const krrMap = new Map(krr.map((k: any) => [k.fnr, k]));
            const bhgMap = new Map(bhg.map((b: any) => [b.personId, b]));
            const politiMap = new Map(politi.map((a: any) => [a.fnr, a]));
            const inntektMap = new Map(inntekter.map((i: any) => [i.identifikator, i]));
            const husstandMap = new Map(husstander.map((h: any) => [h.husstandId, h]));
            const personMap = new Map(personer.map((p: any) => [p.personId, p]));

            const beriket = personer.map((p: any) => {
              const krrData = krrMap.get(p.syntetiskFodselsnummer) || null;
              const politiData = politiMap.get(p.syntetiskFodselsnummer) || null;
              const inntektData = inntektMap.get(p.syntetiskFodselsnummer) || null;
              const husstandData = p.husstandId ? husstandMap.get(p.husstandId) || null : null;

              // Sjekk barnehageplass for personen selv eller personens barn
              let bhgData = bhgMap.get(p.personId);
              let barnFnr = null;
              let barnNavn = null;

              if (!bhgData && p.foreldrebarnrelasjon) {
                for (const rel of p.foreldrebarnrelasjon) {
                  if (rel.relasjon === "BARN") {
                    const funnetBhg = bhgMap.get(rel.relatertPersonId);
                    if (funnetBhg) {
                      bhgData = funnetBhg;
                      const barnPerson = personMap.get(rel.relatertPersonId);
                      if (barnPerson) {
                        barnFnr = barnPerson.syntetiskFodselsnummer;
                        barnNavn = [barnPerson.navn?.fornavn, barnPerson.navn?.mellomnavn, barnPerson.navn?.etternavn]
                          .filter(Boolean)
                          .join(" ");
                      }
                      break;
                    }
                  }
                }
              }

              const barnehageplass = bhgData
                ? {
                    ...bhgData,
                    barnFnr: barnFnr || p.syntetiskFodselsnummer,
                    barnNavn: barnNavn || [p.navn?.fornavn, p.navn?.mellomnavn, p.navn?.etternavn].filter(Boolean).join(" ")
                  }
                : null;

              return {
                ...p,
                visningsnavn: [p.navn?.fornavn, p.navn?.mellomnavn, p.navn?.etternavn]
                  .filter(Boolean)
                  .join(" "),
                krr: krrData,
                barnehageplass,
                politiattest: politiData,
                inntekt: inntektData,
                husstand: husstandData
              };
            });

            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(beriket));
            return;
          } catch (err: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: "Kunne ikke lese sandkassedata", details: err.message }));
            return;
          }
        }

        // Utsted bevis via bevisgenerator i testmiljøet (OpenID4VCI Pre-authorized flow)
        // POST /api/utsted
        if (url.pathname === "/api/utsted" && req.method === "POST") {
          let body = "";
          req.on("data", (chunk: any) => { body += chunk; });
          req.on("end", async () => {
            try {
              const reqData = JSON.parse(body);
              const {
                credentialConfigurationId,
                personIdentifier,
                credentialIssuer,
                credentialData
              } = reqData;

              if (!credentialConfigurationId || !personIdentifier) {
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ error: "Mangler credentialConfigurationId eller personIdentifier" }));
                return;
              }

              const bevisgeneratorBase = process.env.BEVISGENERATOR_URL || "https://bevisgenerator.test.eidas2sandkasse.net";
              const targetUrl = `${bevisgeneratorBase}/start-issuance/${encodeURIComponent(credentialConfigurationId)}`;

              const payload: any = {
                credential_issuer: credentialIssuer || "https://utsteder.test.eidas2sandkasse.net/bevisgenerator",
                credential_configuration_id: credentialConfigurationId,
                subject: {
                  identifier: personIdentifier
                }
              };

              if (credentialData && Object.keys(credentialData).length > 0) {
                payload.credential_data = credentialData;
              }

              const form = new URLSearchParams();
              form.append("personIdentifier", personIdentifier);
              form.append("json", JSON.stringify(payload));

              const bevisRes = await fetch(targetUrl, {
                method: "POST",
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded"
                },
                body: form.toString()
              });

              const html = await bevisRes.text();

              const offerMatch = html.match(/href="(openid-credential-offer:\/\/[^"]+)"/);
              if (!offerMatch) {
                const errMatch = html.match(/<code>([^<]+)<\/code>/g);
                const errText = errMatch ? errMatch.map(m => m.replace(/<\/?code>/g, "")).join(" | ") : "Ukjent feil ved opprettelse av bevis";
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({
                  error: "Testmiljøets bevisgenerator avviste forespørselen",
                  detaljer: errText,
                  rawStatus: bevisRes.status
                }));
                return;
              }

              const credentialOfferUri = offerMatch[1].replace(/&amp;/g, "&");
              let parsedOffer: any = null;
              try {
                const urlObj = new URL(credentialOfferUri);
                const offerParam = urlObj.searchParams.get("credential_offer");
                if (offerParam) parsedOffer = JSON.parse(offerParam);
              } catch (e) {
                // Ignore parse error
              }

              const qrMatch = html.match(/src="(data:image\/png;base64,[^"]+)"/);
              const qrCodeDataUri = qrMatch ? qrMatch[1] : null;

              const transIdMatch = html.match(/issuance_transaction_id&quot; : &quot;([^&]+)&quot;/);
              const issuanceTransactionId = transIdMatch ? transIdMatch[1] : `tx-${Date.now()}`;

              const statusMatch = html.match(/const statusEndpoint = "([^"]+)";/);
              const statusEndpoint = statusMatch ? statusMatch[1].replace(/\\/g, "") : null;

              const preAuthGrant = parsedOffer?.grants?.["urn:ietf:params:oauth:grant-type:pre-authorized_code"];
              const preAuthorizedCode = preAuthGrant?.["pre-authorized_code"] || null;
              const txCode = preAuthGrant?.tx_code || null;

              res.setHeader("Content-Type", "application/json");
              res.setHeader("X-API-KEY", "KS-HACKATHON");
              res.end(JSON.stringify({
                success: true,
                credentialOfferUri,
                credentialOffer: parsedOffer,
                preAuthorizedCode,
                txCode,
                qrCodeDataUri,
                issuanceTransactionId,
                statusEndpoint: statusEndpoint ? `${bevisgeneratorBase}${statusEndpoint}` : null,
                backendRequest: {
                  endpoint: targetUrl,
                  payload
                }
              }, null, 2));
            } catch (err: any) {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Feil i /api/utsted", message: err.message }));
            }
          });
          return;
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
          const verifierBase = process.env.VERIFIER_SERVICE_URL || "https://verifier-service.test.eidas2sandkasse.net";
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
        target: process.env.VERIFIER_SERVICE_URL || "https://verifier-service.test.eidas2sandkasse.net",
        changeOrigin: true,
        secure: false,
        headers: {
          "X-API-KEY": "KS-HACKATHON"
        }
      }
    }
  }
});
