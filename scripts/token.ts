#!/usr/bin/env node

// ETT TOKEN Å LIME INN
//
// Usage:
//   scripts/token.ts --innbygger person-031
//   scripts/token.ts --maskinporten ks:innbyggerdialog:les
//   scripts/token.ts --maskinporten ks:fiks:register --resource fiks-simulator
//   scripts/token.ts --innbygger person-001 --vis      # decode instead of print
//
//   export TOKEN=$(scripts/token.ts --innbygger person-031)
//   curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/personer/person-031
//
// Only the token goes to stdout, so command substitution works. Everything else —
// help, errors, decoded claims — goes to stderr.

import { getInnbyggerToken, getMaskinportenToken } from "../apps/digdir-mock/src/client.ts";
import { decodeJwt } from "../apps/digdir-mock/src/jwt.ts";

// Defaults are the host's view of the stack. Inside docker the issuer is
// digdir-mock:8086, but nobody runs this script in there.
const digdirBaseUrl = process.env.DIGDIR_BASE_URL || "http://localhost:8086";
const digdirIssuer = process.env.DIGDIR_ISSUER || "http://localhost:8086";

function verdi(navn: string): string | null {
  const i = process.argv.indexOf(navn);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}

function hjelp(feil?: string): never {
  if (feil) console.error(`\n  ${feil}\n`);
  console.error(`Bruk:
  scripts/token.ts --innbygger <personId>        ID-porten-token for én testbruker
  scripts/token.ts --maskinporten <scope>        Maskinporten-token for en maskin

Valg:
  --resource <api>   Hvilket API tokenet gjelder for. Standard: sandbox-backend.
                     Bruk fiks-simulator for ks:fiks:-scopene.
  --client <id>      client_id i tokenet. Standard: sandkasse-kokebok.
  --vis              Skriv ut claims i stedet for tokenet, til stderr.

Scopes som håndheves:
  ks:innbyggerdialog:les        lese persondata på vegne av en innbygger
  ks:innbyggerdialog:revisjon   skrive til revisjonsloggen
  ks:fiks:register              Fiks' registerflate (--resource fiks-simulator)
  ks:fiks:folkeregister         Fiks Folkeregister (--resource fiks-simulator)

Utstederen må kjøre: ${digdirBaseUrl}
`);
  process.exit(feil ? 1 : 0);
}

if (process.argv.includes("--hjelp") || process.argv.includes("--help") || process.argv.length < 3) {
  hjelp();
}

const personId = verdi("--innbygger");
const scope = verdi("--maskinporten");
const resource = verdi("--resource") || "sandbox-backend";
const clientId = verdi("--client") || "sandkasse-kokebok";

if (personId && scope) {
  hjelp("Velg én av --innbygger og --maskinporten, ikke begge.");
}
if (!personId && !scope) {
  hjelp("Mangler --innbygger <personId> eller --maskinporten <scope>.");
}

let token: string;
try {
  token = personId
    ? await getInnbyggerToken({ digdirBaseUrl, personId, clientId, resource })
    : await getMaskinportenToken({
        digdirBaseUrl, issuer: digdirIssuer, clientId, scope: scope!, resource
      });
} catch (feil) {
  console.error(`\n  Fikk ikke token: ${(feil as Error).message}`);
  console.error(`  Kjører digdir-mock på ${digdirBaseUrl}? Prøv: docker compose up -d digdir-mock\n`);
  process.exit(1);
}

if (process.argv.includes("--vis")) {
  const krav = decodeJwt(token).payload;
  const utloper = new Date(krav.exp * 1000).toISOString();
  console.error(JSON.stringify(krav, null, 2));
  console.error(`\n  Utløper ${utloper} (${krav.exp - Math.floor(Date.now() / 1000)} s)\n`);
} else {
  console.log(token);
}
