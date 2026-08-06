#!/usr/bin/env node

import { createServer } from "node:http";
import { spawn } from "node:child_process";

const mcpPort = 19083;
const agentPort = 19084;

const fakeSession = {
  oektsId: "oekt-1",
  sporingsId: "flyt-1",
  stepIndex: 0,
  savedAnswer: null
};

const steps = [
  { id: "intro", type: "INFO", tekst: "Info" },
  {
    id: "velg-gate",
    type: "QUESTION",
    tittel: "Hvilken gate gjelder søknaden?",
    tekst: "Hvilken gate ønsker du fartsdempende tiltak i? Skriv inn gatenavnet.",
    felter: [{ id: "gatenavn", label: "Gatenavn", type: "tekst", placeholder: "f.eks. Storgata" }]
  }
];

function normalize(text) {
  return String(text || "").toLowerCase().trim();
}

function json(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(data));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function currentSessionPayload() {
  if (fakeSession.stepIndex >= steps.length) {
    return {
      oektsId: fakeSession.oektsId,
      sporingsId: fakeSession.sporingsId,
      status: "FULLFORT",
      aktivtSteg: null
    };
  }
  return {
    oektsId: fakeSession.oektsId,
    sporingsId: fakeSession.sporingsId,
    status: "AKTIV",
    aktivtSteg: steps[fakeSession.stepIndex]
  };
}

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(url, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // ignore while waiting
    }
    await wait(200);
  }
  throw new Error(`Timeout waiting for ${url}`);
}

async function req(path, options = {}) {
  const res = await fetch(`http://127.0.0.1:${agentPort}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.feil || `HTTP ${res.status}`);
  }
  return data;
}

function createFakeMcpServer() {
  return createServer(async (request, response) => {
    if (request.method === "GET" && (request.url === "/health" || request.url === "/helse")) {
      json(response, 200, { status: "ok" });
      return;
    }

    if (request.method === "POST" && request.url === "/mcp/tools/invoke") {
      const body = await readBody(request);
      const name = body.name;
      const args = body.arguments || body.args || body.toolArgs || {};

      if (name === "list_processes") {
        json(response, 200, {
          ok: true,
          result: {
            count: 1,
            prosesser: [
              {
                id: "fartsdempende-tiltak",
                navn: "Søknad om fartsdempende tiltak",
                beskrivelse: "Test",
                antallSteg: 2
              }
            ],
            antallMaler: 0,
            maler: []
          }
        });
        return;
      }

      if (name === "start_process_session") {
        fakeSession.stepIndex = 0;
        fakeSession.savedAnswer = null;
        json(response, 200, {
          ok: true,
          result: {
            oektsId: fakeSession.oektsId,
            sporingsId: fakeSession.sporingsId
          }
        });
        return;
      }

      if (name === "get_session") {
        json(response, 200, { ok: true, result: currentSessionPayload() });
        return;
      }

      if (name === "next_step") {
        fakeSession.stepIndex += 1;
        json(response, 200, { ok: true, result: currentSessionPayload() });
        return;
      }

      if (name === "answer_question") {
        fakeSession.savedAnswer = args.svar;
        json(response, 200, { ok: true, result: { lagret: true } });
        return;
      }

      // Dynamic tool discovery – the agent asks what tools to use for this step.
      if (name === "suggest_step_tools") {
        const steg = args.steg || {};
        const allText = `${steg.id || ""} ${steg.tittel || ""} ${steg.tekst || ""} ${(steg.felter || []).map((f) => `${f.label || ""} ${f.placeholder || ""}`).join(" ")}`.toLowerCase();
        const gateRelevant = allText.includes("gate") || allText.includes("gatenavn");
        json(response, 200, {
          ok: true,
          result: {
            verktoy: gateRelevant
              ? [{ name: "matrikkel_finn_veger", bruk: "kontekst_og_validering", begrunnelse: "Steget ber om gatenavn" }]
              : [],
            modell: "fake-suggest"
          }
        });
        return;
      }

      if (name === "matrikkel_finn_veger") {
        if (!args.gate) {
          json(response, 200, {
            ok: true,
            result: [
              { adressenavn: "Storgata" },
              { adressenavn: "Nordnesveien" },
              { adressenavn: "Fjøsangerveien" }
            ]
          });
          return;
        }

        const gate = normalize(args.gate);
        if (gate.includes("storg")) {
          json(response, 200, { ok: true, result: { adressenavn: "Storgata", kommunenummer: "4601" } });
          return;
        }

        json(response, 500, { ok: false, detalj: "Fant ikke gate." });
        return;
      }

      json(response, 500, { ok: false, detalj: `Ukjent tool ${name}` });
      return;
    }

    json(response, 404, { feil: "Not found" });
  });
}

async function run() {
  const mcpServer = createFakeMcpServer();
  await new Promise((resolve) => mcpServer.listen(mcpPort, resolve));

  const agent = spawn("node", ["apps/process-agent/src/server.js"], {
    env: {
      ...process.env,
      PORT: String(agentPort),
      MCP_BASE_URL: `http://127.0.0.1:${mcpPort}`
    },
    stdio: "inherit"
  });

  try {
    await waitFor(`http://127.0.0.1:${agentPort}/health`);

    const created = await req("/agent/sessions", {
      method: "POST",
      body: JSON.stringify({ personId: "person-001" })
    });

    // Start the fartsdempende-tiltak process – agent should pass INFO and land on QUESTION step
    const choose = await req(`/agent/sessions/${created.sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "fartsdempende" })
    });
    // The agent should proactively list available gates (from suggest_step_tools → matrikkel_finn_veger)
    assert(
      choose.replies.some((r) => r.includes("Tilgjengelige testgater")),
      `Mangler proaktiv matrikkel-gatehjelp. Fikk: ${JSON.stringify(choose.replies)}`
    );

    // Enter an unknown gate – agent should reject and offer suggestions
    const invalidGate = await req(`/agent/sessions/${created.sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "Ukjentveien" })
    });
    assert(
      invalidGate.replies.some((r) => r.toLowerCase().includes("fant ikke gaten")),
      `Mangler feilfeedback for ukjent gate. Fikk: ${JSON.stringify(invalidGate.replies)}`
    );

    // Enter a partial gate name – agent should normalise to canonical name
    const validGate = await req(`/agent/sessions/${created.sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "storg" })
    });
    assert(
      validGate.replies.some((r) => r.includes("fant Storgata")),
      `Mangler bekreftelse av matrikkel-oppslag. Fikk: ${JSON.stringify(validGate.replies)}`
    );
    assert(
      fakeSession.savedAnswer === "Storgata",
      `Gate ble ikke lagret med kanonisk navn fra matrikkelen. Fikk: ${fakeSession.savedAnswer}`
    );

    console.log("test:process-agent-matrikkel OK");
  } finally {
    agent.kill("SIGTERM");
    await new Promise((resolve) => mcpServer.close(resolve));
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});






