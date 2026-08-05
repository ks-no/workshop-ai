import { createServer } from "node:http";

const port = 8083;
const backendBaseUrl = process.env.BACKEND_BASE_URL || "http://sandbox-backend:8080";
const aiBaseUrl = process.env.AI_BASE_URL || "http://ai-gateway:8082";

const toolDefs = [
  {
    name: "list_processes",
    description: "List available process definitions.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "list_people",
    description: "List demo people that can start a process.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "start_process_session",
    description: "Start a process session for a person and process id.",
    inputSchema: {
      type: "object",
      required: ["personId", "prosessId"],
      properties: {
        personId: { type: "string" },
        prosessId: { type: "string" },
        sporingsId: { type: "string" }
      }
    }
  },
  {
    name: "get_session",
    description: "Get current process session state and active step.",
    inputSchema: {
      type: "object",
      required: ["oektsId"],
      properties: { oektsId: { type: "string" } }
    }
  },
  {
    name: "answer_question",
    description: "Save answer for the current question step.",
    inputSchema: {
      type: "object",
      required: ["oektsId", "svar"],
      properties: {
        oektsId: { type: "string" },
        stegId: { type: "string" },
        svar: {}
      }
    }
  },
  {
    name: "consent_response",
    description: "Create consent request if needed and register approve/deny response.",
    inputSchema: {
      type: "object",
      required: ["oektsId", "approved"],
      properties: {
        oektsId: { type: "string" },
        approved: { type: "boolean" }
      }
    }
  },
  {
    name: "run_current_action",
    description: "Run action for current DATA_FETCH, SUMMARY, or SUBMIT step.",
    inputSchema: {
      type: "object",
      required: ["oektsId"],
      properties: { oektsId: { type: "string" } }
    }
  },
  {
    name: "next_step",
    description: "Move process session to next step.",
    inputSchema: {
      type: "object",
      required: ["oektsId"],
      properties: { oektsId: { type: "string" } }
    }
  },
  {
    name: "interpret_reply",
    description: "Interpret a user reply into one of three intents.",
    inputSchema: {
      type: "object",
      required: ["tekst", "jaIntent", "neiIntent", "ukjentIntent"],
      properties: {
        tekst: { type: "string" },
        jaIntent: { type: "string" },
        neiIntent: { type: "string" },
        ukjentIntent: { type: "string" },
        kontekst: { type: "object" },
        sporingsId: { type: "string" }
      }
    }
  },
  {
    name: "get_household_income",
    description: "Get the household income basis for a person, calculated via the Fiks skatte- og inntektsopplysninger API. Shows which amounts count and which are excluded.",
    inputSchema: {
      type: "object",
      required: ["personId"],
      properties: { personId: { type: "string" } }
    }
  },
  {
    name: "check_eligibility",
    description: "Check whether a person's household qualifies for a reduced-payment scheme. Deterministic: compares the income basis against the thresholds in satser.json.",
    inputSchema: {
      type: "object",
      required: ["personId", "ordning"],
      properties: {
        personId: { type: "string" },
        ordning: { type: "string", description: "Scheme id, e.g. redusert-foreldrebetaling-barnehage. Use list_schemes to see all." }
      }
    }
  },
  {
    name: "list_schemes",
    description: "List the reduced-payment schemes with their income thresholds and rules.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_audit_log",
    description: "Get audit events by tracking id.",
    inputSchema: {
      type: "object",
      required: ["sporingsId"],
      properties: { sporingsId: { type: "string" } }
    }
  }
];

function json(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  response.end(JSON.stringify(data, null, 2));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function api(path, options = {}) {
  const res = await fetch(`${backendBaseUrl}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.feil || `Backend feil ${res.status}`);
  }
  return data;
}

async function ai(path, payload) {
  const res = await fetch(`${aiBaseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.feil || `AI feil ${res.status}`);
  }
  return data;
}

async function invokeTool(name, args = {}) {
  if (name === "list_processes") {
    const prosessdata = await api("/api/prosesser");
    const prosesser = Array.isArray(prosessdata)
      ? prosessdata
      : (Array.isArray(prosessdata?.prosesser) ? prosessdata.prosesser : []);
    const maler = Array.isArray(prosessdata?.maler) ? prosessdata.maler : [];

    const toProsessInfo = (p) => ({
      id: p.id,
      navn: p.navn,
      beskrivelse: p.beskrivelse,
      antallSteg: p.steg?.length || 0
    });

    return {
      count: prosesser.length,
      prosesser: prosesser.map(toProsessInfo),
      antallMaler: maler.length,
      maler: maler.map(toProsessInfo)
    };
  }

  if (name === "list_people") {
    const personer = await api("/api/personer");
    return {
      count: personer.length,
      personer: personer.map((p) => ({
        personId: p.personId,
        navn: p.visningsnavn,
        kommune: p.bostedsadresse?.kommune
      }))
    };
  }

  if (name === "start_process_session") {
    const sporingsId = args.sporingsId || `flyt-${Date.now()}`;
    return api("/api/prosessoekter", {
      method: "POST",
      body: JSON.stringify({
        personId: args.personId,
        prosessId: args.prosessId,
        sporingsId
      })
    });
  }

  if (name === "get_session") {
    return api(`/api/prosessoekter/${args.oektsId}`);
  }

  if (name === "answer_question") {
    return api(`/api/prosessoekter/${args.oektsId}/svar`, {
      method: "POST",
      body: JSON.stringify({
        stegId: args.stegId,
        svar: args.svar
      })
    });
  }

  if (name === "consent_response") {
    const session = await api(`/api/prosessoekter/${args.oektsId}`);
    if (!session.aktivtSamtykkeId) {
      const opprett = await api(`/api/prosessoekter/${args.oektsId}/handling`, {
        method: "POST",
        body: JSON.stringify({ handling: "opprett-samtykke" })
      });
      if (!opprett?.oekt?.aktivtSamtykkeId) {
        throw new Error("Kunne ikke opprette aktivt samtykke.");
      }
    }

    return api(`/api/prosessoekter/${args.oektsId}/handling`, {
      method: "POST",
      body: JSON.stringify({
        handling: "samtykkesvar",
        status: args.approved ? "SAMTYKKET" : "IKKE_SAMTYKKET"
      })
    });
  }

  if (name === "run_current_action") {
    return api(`/api/prosessoekter/${args.oektsId}/handling`, {
      method: "POST",
      body: JSON.stringify({})
    });
  }

  if (name === "next_step") {
    return api(`/api/prosessoekter/${args.oektsId}/neste`, {
      method: "POST",
      body: JSON.stringify({})
    });
  }

  if (name === "interpret_reply") {
    return ai("/ai/tolk-svar", {
      tekst: args.tekst,
      jaIntent: args.jaIntent,
      neiIntent: args.neiIntent,
      ukjentIntent: args.ukjentIntent,
      kontekst: args.kontekst || {},
      sporingsId: args.sporingsId
    });
  }

  if (name === "get_household_income") {
    return api(`/api/personer/${args.personId}/inntekt`);
  }

  if (name === "check_eligibility") {
    return api(`/api/regler/sjekk/foreldrebetaling?personId=${encodeURIComponent(args.personId)}&ordning=${encodeURIComponent(args.ordning)}`);
  }

  if (name === "list_schemes") {
    return api("/api/regler/satser");
  }

  if (name === "get_audit_log") {
    return api(`/api/revisjonslogg/${args.sporingsId}`);
  }

  throw new Error(`Ukjent tool: ${name}`);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "OPTIONS") {
    json(response, 204, {});
    return;
  }

  try {
    if (url.pathname === "/helse" || url.pathname === "/health") {
      json(response, 200, { status: "ok", tjeneste: "mcp-services", tidspunkt: new Date().toISOString() });
      return;
    }

    if (request.method === "GET" && url.pathname === "/mcp") {
      json(response, 200, {
        name: "innbyggerdialog-mcp-services",
        protocol: "mcp-style-http",
        version: "0.1.0"
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/mcp/tools") {
      json(response, 200, { tools: toolDefs });
      return;
    }

    if (request.method === "POST" && url.pathname === "/mcp/tools/invoke") {
      const body = await readBody(request);
      const toolArgs = body.toolArgs || body.args || body["arguments"] || {};
      const result = await invokeTool(body.name, toolArgs);
      json(response, 200, { ok: true, tool: body.name, result });
      return;
    }

    const byName = url.pathname.match(/^\/mcp\/tools\/([^/]+)\/invoke$/);
    if (request.method === "POST" && byName) {
      const body = await readBody(request);
      const toolArgs = body.toolArgs || body.args || body["arguments"] || {};
      const result = await invokeTool(byName[1], toolArgs);
      json(response, 200, { ok: true, tool: byName[1], result });
      return;
    }

    json(response, 404, { feil: "Fant ikke endepunkt." });
  } catch (error) {
    json(response, 500, { feil: "Intern feil i mcp-services.", detalj: error.message });
  }
});

server.listen(port, () => {
  console.log(`MCP-services kjører på http://localhost:${port}`);
});


