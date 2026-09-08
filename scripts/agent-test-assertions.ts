import assert from "node:assert/strict";
import { getInnbyggerToken } from "../apps/digdir-mock/src/client.ts";

export async function readAgentProsessoekt(oektsId: string, personId: string) {
  const token = await getInnbyggerToken({
    digdirBaseUrl: process.env.DIGDIR_BASE_URL || "http://localhost:8086",
    personId, clientId: "agent-dialogtest"
  });
  const base = process.env.BACKEND_BASE_URL || "http://localhost:8080";
  const headers = { Authorization: `Bearer ${token}` };
  const response = await fetch(`${base}/api/prosessoekter/${oektsId}`, { headers });
  assert.equal(response.status, 200, "Prosessøkten skal kunne leses med innbyggertoken");
  return { oekt: await response.json() as any, base, headers };
}

export async function assertAgentSubmitted(oektsId: string, personId: string) {
  const { oekt, base, headers } = await readAgentProsessoekt(oektsId, personId);
  assert.equal(oekt.status, "FULLFORT", "En avsluttet dialog er ikke nok: motoren må ha fullført");
  const response = await fetch(`${base}/api/personer/${personId}/soknader`, { headers });
  assert.equal(response.status, 200);
  const soknader = await response.json() as any[];
  assert.ok(oekt.resultater?.["send-inn"], "SUBMIT skal ha et lagret resultat");
  const matching = soknader.filter((s) => s.sporingsId === oekt.sporingsId);
  assert.equal(matching.length, 1, "Økten skal ha nøyaktig én innsendt søknad");
  assert.equal(matching[0].status, "SENDT_INN");
  assert.equal(matching[0].soknadId, oekt.resultater["send-inn"].soknadId);
  return oekt;
}
