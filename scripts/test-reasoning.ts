#!/usr/bin/env node

/*
 * Avdriftssperre på reasoning-tabellene i apps/ai-gateway/src/reasoning.ts.
 *
 * Ren tekstanalyse pluss en import: ingen modell, ingen tjenester, ingen nett.
 * server.ts kan ikke importeres - den kaller server.listen på toppnivå - så
 * oppgavelisten leses ut av kilden i stedet.
 *
 * Det sperren finnes for: en ny oppgave eller en ny provider som ingen har vurdert.
 * Et «av» skal være et valg noen tok og begrunnet, ikke en rad noen glemte.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AI_FACTORY_MODELS, OPPGAVE_REASONING, PROVIDER_REASONING,
  providerKanReasoning, reasoningForOppgave, uvurderteOppgaver, velgReasoningModell
} from "../apps/ai-gateway/src/reasoning.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(path.join(root, "apps/ai-gateway/src/server.ts"), "utf8").replace(/\r\n/g, "\n");

let bestatt = 0;
const feil: string[] = [];
function check(navn: string, betingelse: unknown, detalj = ""): void {
  if (betingelse) { bestatt += 1; return; }
  feil.push(`${navn}${detalj ? ` - ${detalj}` : ""}`);
}

// --- oppgavene ---------------------------------------------------------------

// To kilder i server.ts, fordi oppgavenavnet oppstår to steder: som en literal på
// kallstedet, og som stien /ai/<type> for de fem som går gjennom buildAiResponse.
const literaler = [...server.matchAll(/task: "([a-z-]+)"/g)].map(treff => treff[1]);
const stier = [...(server.match(/const gyldigeStier = \[([^\]]*)\]/) || [])[1]
  ?.matchAll(/"\/ai\/([a-z-]+)"/g) || []].map(treff => treff[1]);

const oppgaver = [...new Set([...literaler, ...stier])].filter(navn => navn !== "ukjent");
check("fant oppgaver i server.ts", oppgaver.length >= 10, String(oppgaver.length));
check("hver oppgave i server.ts er vurdert", uvurderteOppgaver(oppgaver).length === 0,
  uvurderteOppgaver(oppgaver).join(", "));

// Og andre veien: en rad for en oppgave som ikke finnes lenger er en begrunnelse
// ingen kan etterprøve, og den skjuler at listen ikke er lest på en stund.
const foreldede = Object.keys(OPPGAVE_REASONING).filter(navn => !oppgaver.includes(navn));
check("ingen rad for en oppgave server.ts ikke har", foreldede.length === 0, foreldede.join(", "));

for (const [navn, rad] of Object.entries(OPPGAVE_REASONING)) {
  check(`${navn} har en begrunnelse`, rad.grunn.trim().length > 20);
}
check("en ukjent oppgave tenker ikke", reasoningForOppgave("finnes-ikke") === false);
check("en oppgave uten navn tenker ikke", reasoningForOppgave(null) === false);

// --- providerne --------------------------------------------------------------

const providere = [...(server.match(/const AI_PROVIDERS = \[([^\]]*)\]/) || [])[1]
  ?.matchAll(/"([a-z-]+)"/g) || []].map(treff => treff[1]);
check("fant providerne i server.ts", providere.length >= 5, String(providere.length));
for (const provider of providere) {
  check(`${provider} har en reasoning-rad`, Object.hasOwn(PROVIDER_REASONING, provider));
}
const ukjenteProvidere = Object.keys(PROVIDER_REASONING).filter(p => !providere.includes(p));
check("ingen rad for en provider som ikke finnes", ukjenteProvidere.length === 0, ukjenteProvidere.join(", "));
check("en ukjent provider kan ikke tenke", providerKanReasoning("finnes-ikke") === false);

// --- modellvalget ------------------------------------------------------------

const anbefalt = velgReasoningModell(AI_FACTORY_MODELS);
check("standarden er den anbefalte, ikke den første som kan",
  anbefalt.modell === "NVIDIA-Nemotron-3-Super-120B-A12B-FP8", String(anbefalt.modell));
check("standarden gir ingen advarsel", anbefalt.advarsel === undefined);

const oensket = velgReasoningModell(AI_FACTORY_MODELS, "GLM-5.2-FP8");
check("et uttrykt ønske om en modell som kan tenke respekteres", oensket.modell === "GLM-5.2-FP8");

const utenModus = velgReasoningModell(AI_FACTORY_MODELS, "Qwen3-Coder-Next-FP8");
check("en modell uten tenkemodus byttes ut", utenModus.modell === "NVIDIA-Nemotron-3-Super-120B-A12B-FP8");
check("og sier hvorfor", /har ingen tenkemodus/.test(utenModus.advarsel || ""));

const ukjent = velgReasoningModell(AI_FACTORY_MODELS, "Modell-Som-Ikke-Finnes");
check("en ukjent modell byttes ut", ukjent.modell === "NVIDIA-Nemotron-3-Super-120B-A12B-FP8");
check("og sier at den er ukjent", /er ikke en kjent modell/.test(ukjent.advarsel || ""));

const ingen = velgReasoningModell([{ id: "bare-en", reasoning: false }]);
check("uten en eneste tenkemodell er svaret null", ingen.modell === null);

// --- taket på tidsavbruddet --------------------------------------------------

// Uttrykket pinnes som tekst, fordi callModel ikke kan importeres. Fjernes taket,
// venter sandkassen ut AI_TIMEOUT_MS på en gateway som ga opp for lenge siden.
check("callModel tar det minste av vårt tak og providerens",
  /Math\.min\(\s*valg\.timeoutMs \|\| modelTimeoutMs,\s*PROVIDER_TIMEOUT_TAK\[aiProvider\] \?\? Infinity\s*\)/.test(server));
check("AI Factory har et tak", /PROVIDER_TIMEOUT_TAK[^\n]*"telenor-ai-factory": aiFactoryTimeoutMs/.test(server));
check("tidsavbruddsmeldingen siterer den effektive verdien",
  /Modellen svarte ikke innen \$\{effektivTimeout\} ms/.test(server));

// --- reasoning brukes ett sted ----------------------------------------------

check("ett sted avgjør om et kall tenker",
  (server.match(/reasoningForOppgave\(/g) || []).length === 1);
check("og det stedet krever at provideren kan det",
  /reasoningForOppgave\(valg\.task\) && providerKanReasoning\(aiProvider\)/.test(server));

// --- rapport -----------------------------------------------------------------
if (feil.length > 0) {
  console.error(`test-reasoning: ${feil.length} av ${bestatt + feil.length} sjekker feilet.`);
  for (const linje of feil) console.error(`  - ${linje}`);
  process.exit(1);
}
assert.ok(bestatt > 0);
console.log(`test-reasoning ok. ${bestatt} sjekker, uten modell og uten tjenester.`);
