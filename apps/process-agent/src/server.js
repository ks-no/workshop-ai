import { createServer } from "node:http";

const port = 8084;
const mcpBaseUrl = process.env.MCP_BASE_URL || "http://mcp-services:8083";

const sessions = new Map();

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

function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalize(text) {
  return String(text || "").toLowerCase().trim();
}

function listProcessesPrompt(processes) {
  const lines = processes.map((p, i) => `${i + 1}. ${p.navn} (${p.id})`).join("\n");
  return [
    "Hei! Jeg kan hjelpe deg med a velge prosess og guide deg steg for steg.",
    "Velg en prosess ved a skrive nummer, navn, eller id:",
    lines
  ].join("\n\n");
}

async function invokeTool(name, args = {}) {
  const res = await fetch(`${mcpBaseUrl}/mcp/tools/invoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, arguments: args })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.feil || data.detalj || `Tool call feilet: ${name}`);
  }
  return data.result;
}

function parseProcessChoice(text, processes) {
  const value = normalize(text);

  const number = Number.parseInt(value, 10);
  if (Number.isInteger(number) && number >= 1 && number <= processes.length) {
    return processes[number - 1];
  }

  const byId = processes.find((p) => normalize(p.id) === value);
  if (byId) return byId;

  const byNameExact = processes.find((p) => normalize(p.navn) === value);
  if (byNameExact) return byNameExact;

  const byNameContains = processes.find((p) => normalize(p.navn).includes(value));
  if (byNameContains) return byNameContains;

  return null;
}

async function tryNextStep(oektsId) {
  try {
    await invokeTool("next_step", { oektsId });
  } catch {
    // Ignore when already on last step.
  }
}

async function advanceAndPrompt(state) {
  const messages = [];

  while (true) {
    const session = await invokeTool("get_session", { oektsId: state.oektsId });
    state.lastSession = session;
    state.sporingsId = session.sporingsId;

    if (session.status === "FULLFORT") {
      state.awaiting = null;
      messages.push("Prosessen er fullfort. Soknaden er sendt inn.");
      return messages;
    }

    const step = session.aktivtSteg;
    if (!step) {
      state.awaiting = null;
      messages.push("Fant ikke aktivt steg. Du kan starte en ny prosess.");
      return messages;
    }

    if (step.type === "INFO") {
      if (step.tekst) {
        messages.push(step.tekst);
      }
      await tryNextStep(state.oektsId);
      continue;
    }

    if (step.type === "DATA_FETCH") {
      await invokeTool("run_current_action", { oektsId: state.oektsId });
      messages.push("Jeg har hentet opplysningene som trengs i dette steget.");
      await tryNextStep(state.oektsId);
      continue;
    }

    if (step.type === "SUMMARY") {
      const result = await invokeTool("run_current_action", { oektsId: state.oektsId });
      const text = result?.resultat?.tekst;
      if (text) {
        messages.push(`Oppsummering: ${text}`);
      } else {
        messages.push("Jeg har laget en oppsummering av informasjonen.");
      }
      await tryNextStep(state.oektsId);
      continue;
    }

    if (step.type === "QUESTION") {
      state.awaiting = "question";
      state.awaitingStepId = step.id;
      const prompt = step.tekst || step.tittel || "Kan du svare pa et sporsmal?";
      messages.push(prompt);
      return messages;
    }

    if (step.type === "CONSENT_REQUEST") {
      state.awaiting = "consent";
      const datakilder = (step.dataKilder || []).join(", ") || "nodvendige opplysninger";
      const formaal = step.formaal || "behandle saken";
      messages.push(`For a ga videre trenger jeg samtykke til a hente ${datakilder}. Dette brukes for a ${formaal.toLowerCase()}. Er det greit?`);
      return messages;
    }

    if (step.type === "SUBMIT") {
      state.awaiting = "submit";
      messages.push("Alt er klart. Vil du at jeg skal sende inn soknaden na?");
      return messages;
    }

    state.awaiting = null;
    messages.push(`Ukjent stegtype ${step.type}.`);
    return messages;
  }
}

async function handleMessage(state, message) {
  const text = String(message || "").trim();
  if (!text) {
    return ["Skriv en melding, sa hjelper jeg deg videre."];
  }

  if (!state.selectedProcess) {
    const choice = parseProcessChoice(text, state.processes || []);
    if (!choice) {
      return ["Jeg fant ikke den prosessen. Skriv nummer, navn, eller id fra listen."];
    }

    const started = await invokeTool("start_process_session", {
      personId: state.personId,
      prosessId: choice.id,
      sporingsId: newId("flyt")
    });

    state.selectedProcess = choice;
    state.oektsId = started.oektsId;
    state.sporingsId = started.sporingsId;

    const intro = [`Supert. Vi starter prosessen: ${choice.navn}.`];
    return intro.concat(await advanceAndPrompt(state));
  }

  if (state.awaiting === "question") {
    await invokeTool("answer_question", {
      oektsId: state.oektsId,
      stegId: state.awaitingStepId,
      svar: text
    });
    await tryNextStep(state.oektsId);
    return ["Takk, jeg har lagret svaret ditt."].concat(await advanceAndPrompt(state));
  }

  if (state.awaiting === "consent") {
    const intent = await invokeTool("interpret_reply", {
      tekst: text,
      jaIntent: "consent_yes",
      neiIntent: "consent_no",
      ukjentIntent: "unknown",
      sporingsId: state.sporingsId,
      kontekst: {
        prosessId: state.selectedProcess?.id,
        stegType: "CONSENT_REQUEST"
      }
    });

    if (intent.intent === "consent_yes") {
      await invokeTool("consent_response", { oektsId: state.oektsId, approved: true });
      await tryNextStep(state.oektsId);
      return ["Takk. Samtykke er registrert."].concat(await advanceAndPrompt(state));
    }

    if (intent.intent === "consent_no") {
      await invokeTool("consent_response", { oektsId: state.oektsId, approved: false });
      await tryNextStep(state.oektsId);
      return ["Skjonner. Jeg har registrert at du ikke vil samtykke na."].concat(await advanceAndPrompt(state));
    }

    return ["Jeg ble litt usikker. Du kan svare for eksempel 'ja, det er greit' eller 'nei, ikke na'."];
  }

  if (state.awaiting === "submit") {
    const intent = await invokeTool("interpret_reply", {
      tekst: text,
      jaIntent: "submit_yes",
      neiIntent: "submit_no",
      ukjentIntent: "unknown",
      sporingsId: state.sporingsId,
      kontekst: {
        prosessId: state.selectedProcess?.id,
        stegType: "SUBMIT"
      }
    });

    if (intent.intent === "submit_yes") {
      await invokeTool("run_current_action", { oektsId: state.oektsId });
      return ["Da sender jeg inn soknaden."].concat(await advanceAndPrompt(state));
    }

    if (intent.intent === "submit_no") {
      return ["Helt i orden. Si fra nar du vil sende inn."];
    }

    return ["Jeg ble litt usikker. Du kan svare for eksempel 'ja, send inn' eller 'nei, ikke enna'."];
  }

  return advanceAndPrompt(state);
}

async function createAgentSession(body) {
  const personId = body.personId || "person-001";
  const processesResult = await invokeTool("list_processes", {});

  const session = {
    sessionId: newId("agent"),
    personId,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    processes: processesResult.prosesser,
    selectedProcess: null,
    oektsId: null,
    sporingsId: null,
    awaiting: "process_choice",
    awaitingStepId: null,
    lastSession: null,
    history: []
  };

  sessions.set(session.sessionId, session);

  return {
    sessionId: session.sessionId,
    personId,
    message: listProcessesPrompt(session.processes)
  };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "OPTIONS") {
    json(response, 204, {});
    return;
  }

  try {
    if (url.pathname === "/helse" || url.pathname === "/health") {
      json(response, 200, { status: "ok", tjeneste: "process-agent", tidspunkt: new Date().toISOString() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/agent/sessions") {
      const body = await readBody(request);
      json(response, 201, await createAgentSession(body));
      return;
    }

    const getSessionMatch = url.pathname.match(/^\/agent\/sessions\/([^/]+)$/);
    if (request.method === "GET" && getSessionMatch) {
      const session = sessions.get(getSessionMatch[1]);
      if (!session) {
        json(response, 404, { feil: "Fant ikke agent-session." });
        return;
      }
      json(response, 200, {
        sessionId: session.sessionId,
        personId: session.personId,
        selectedProcess: session.selectedProcess,
        oektsId: session.oektsId,
        sporingsId: session.sporingsId,
        awaiting: session.awaiting,
        created: session.created,
        updated: session.updated
      });
      return;
    }

    const msgMatch = url.pathname.match(/^\/agent\/sessions\/([^/]+)\/messages$/);
    if (request.method === "POST" && msgMatch) {
      const session = sessions.get(msgMatch[1]);
      if (!session) {
        json(response, 404, { feil: "Fant ikke agent-session." });
        return;
      }

      const body = await readBody(request);
      const userMessage = String(body.message || "");
      session.history.push({ role: "user", message: userMessage, tidspunkt: new Date().toISOString() });

      const replies = await handleMessage(session, userMessage);
      for (const message of replies) {
        session.history.push({ role: "assistant", message, tidspunkt: new Date().toISOString() });
      }
      session.updated = new Date().toISOString();

      json(response, 200, {
        sessionId: session.sessionId,
        replies,
        awaiting: session.awaiting,
        selectedProcess: session.selectedProcess,
        oektsId: session.oektsId,
        sporingsId: session.sporingsId
      });
      return;
    }

    json(response, 404, { feil: "Fant ikke endepunkt." });
  } catch (error) {
    json(response, 500, { feil: "Intern feil i process-agent.", detalj: error.message });
  }
});

server.listen(port, () => {
  console.log(`Process-agent kjorer pa http://localhost:${port}`);
});

