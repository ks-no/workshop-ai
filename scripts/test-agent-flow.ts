#!/usr/bin/env node
import { feilmelding } from "../apps/shared/errors.ts";
import assert from "node:assert/strict";
import { assertAgentSubmitted } from "./agent-test-assertions.ts";


const agentBaseUrl = process.env.AGENT_BASE_URL || "http://localhost:8084";

async function req(
  path: string,
  options: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {}
): Promise<any> {
  const res = await fetch(`${agentBaseUrl}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = (await res.json()) as any;
  if (!res.ok) {
    throw new Error(`${res.status} ${data.feil || "Feil"}`);
  }
  return data;
}

function printReplies(title: string, replies: string[] = []): void {
  console.log(`\n${title}`);
  for (const line of replies) {
    console.log(`- ${line}`);
  }
}

async function run() {
  const created = await req("/agent/sessions", {
    method: "POST",
    body: JSON.stringify({ personId: "person-028" })
  });

  console.log("Økt:", created.sessionId);
  console.log(created.message);

  const choose = await req(`/agent/sessions/${created.sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({ message: "fritidskort" })
  });
  printReplies("Etter prosessvalg", choose.replies);

  const gjelderFor = await req(`/agent/sessions/${created.sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({ message: "barnet mitt" })
  });
  printReplies("Etter første spørsmålsfelt", gjelderFor.replies);

  const answer = await req(`/agent/sessions/${created.sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({ message: "fotball" })
  });
  printReplies("Etter spørsmålssvar", answer.replies);

  const consent = await req(`/agent/sessions/${created.sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({ message: "eg samtykker" })
  });
  printReplies("Etter samtykke", consent.replies);

  const summary = await req(`/agent/sessions/${created.sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({ message: "ja" })
  });
  printReplies("Etter bekreftet oppsummering", summary.replies);

  const submit = await req(`/agent/sessions/${created.sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({ message: "ja, send inn" })
  });
  printReplies("Etter innsending", submit.replies);

  const status = await req(`/agent/sessions/${created.sessionId}`);
  console.log("\nEndelig ventetilstand:", status.awaiting);
  if (status.awaiting !== null) {
    throw new Error(`Forventet fullført agentflyt, fikk awaiting=${status.awaiting}`);
  }
  const oekt = await assertAgentSubmitted(status.oektsId, "person-028");
  assert.deepEqual(oekt.svar.behov, { gjelderFor: "barnet mitt", aktivitet: "fotball" });
}

run().catch((error) => {
  console.error("Agentflyttesten feilet:", feilmelding(error));
  process.exit(1);
});
