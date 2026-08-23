#!/usr/bin/env node
import { feilmelding } from "../apps/shared-ui/errors.ts";


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
    body: JSON.stringify({ personId: "person-001" })
  });

  console.log("Session:", created.sessionId);
  console.log(created.message);

  const choose = await req(`/agent/sessions/${created.sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({ message: "fritidskort" })
  });
  printReplies("After process choice", choose.replies);

  const answer = await req(`/agent/sessions/${created.sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({ message: "Dette gjelder barnet mitt, og vi onsker stotte til fotball." })
  });
  printReplies("After question answer", answer.replies);

  const consent = await req(`/agent/sessions/${created.sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({ message: "eg samtykker" })
  });
  printReplies("After consent", consent.replies);

  const submit = await req(`/agent/sessions/${created.sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({ message: "ja, send inn" })
  });
  printReplies("After submit", submit.replies);

  const status = await req(`/agent/sessions/${created.sessionId}`);
  console.log("\nFinal awaiting state:", status.awaiting);
}

run().catch((error) => {
  console.error("Agent flow test failed:", feilmelding(error));
  process.exit(1);
});

