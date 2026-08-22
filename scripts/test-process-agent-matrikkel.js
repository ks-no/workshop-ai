#!/usr/bin/env node

import { createServer } from "node:http";
import { spawn } from "node:child_process";

const mcpPort = 19083;
const agentPort = 19084;

const fakeSession = {
  oektsId: "oekt-1",
  sporingsId: "flyt-1",
  stepIndex: 0,
  savedAnswer: null,
  savedAnswers: {}
};

const steps = [
  { id: "intro", type: "INFO", tekst: "Info" },
  {
    id: "velg-gate",
    type: "QUESTION",
    tittel: "Hvilken gate gjelder søknaden?",
    tekst: "Hvilken gate ønsker du fartsdempende tiltak i? Skriv inn gatenavnet.",
    felter: [{ id: "gatenavn", label: "Gatenavn", type: "tekst", placeholder: "f.eks. Storgata" }]
  },
  {
    id: "boliger-bekreft",
    type: "QUESTION",
    tittel: "Antall boliger i gaten",
    tekst: "Matrikkelen kan være ufullstendig. Er det mer enn 20 boliger i gaten?"
  },
  {
    id: "begrunnelse",
    type: "QUESTION",
    tittel: "Begrunn søknaden",
    tekst: "Beskriv trafikkproblemet og hva slags tiltak du ønsker."
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
    stegIndex: fakeSession.stepIndex,
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
    if (request.method === "GET" && request.url === "/helse") {
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
                antallSteg: 4
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
        fakeSession.savedAnswers = {};
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

      if (name === "get_process_definition") {
        json(response, 200, {
          ok: true,
          result: {
            id: "fartsdempende-tiltak",
            navn: "Søknad om fartsdempende tiltak",
            steg: steps
          }
        });
        return;
      }

      if (name === "next_step") {
        fakeSession.stepIndex += 1;
        json(response, 200, { ok: true, result: currentSessionPayload() });
        return;
      }

      if (name === "previous_step") {
        fakeSession.stepIndex = Math.max(0, fakeSession.stepIndex - 1);
        json(response, 200, { ok: true, result: currentSessionPayload() });
        return;
      }

      if (name === "answer_question") {
        fakeSession.savedAnswer = args.svar;
        fakeSession.savedAnswers[args.stegId] = args.svar;
        json(response, 200, { ok: true, result: { stored: true } });
        return;
      }

      if (name === "interpret_reply") {
        const txt = normalize(args.tekst || "");
        if (["ja", "japp", "yes", "ok"].some((v) => txt.includes(v))) {
          json(response, 200, { ok: true, result: { intent: args.jaIntent || "ja", confidence: 0.9 } });
          return;
        }
        if (["nei", "no"].some((v) => txt.includes(v))) {
          json(response, 200, { ok: true, result: { intent: args.neiIntent || "nei", confidence: 0.9 } });
          return;
        }
        json(response, 200, { ok: true, result: { intent: args.ukjentIntent || "unknown", confidence: 0.2 } });
        return;
      }

      // Dynamic tool discovery – the agent asks what tools to use for this step.
      if (name === "suggest_step_tools") {
        const steg = args.steg || {};
        const allText = `${steg.id || ""} ${steg.tittel || ""} ${steg.tekst || ""} ${(steg.felter || []).map((f) => `${f.label || ""} ${f.placeholder || ""}`).join(" ")}`.toLowerCase();
        const gateRelevant = allText.includes("hvilken gate") || allText.includes("gatenavn");
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
          json(response, 200, { ok: true, result: [{ adressenavn: "Storgata", kommunenummer: "4601" }] });
          return;
        }
        if (gate.includes("nordnes")) {
          json(response, 200, { ok: true, result: [{ adressenavn: "Nordnesveien", kommunenummer: "4601" }] });
          return;
        }
        if (gate.includes("fjosanger") || gate.includes("fjøsanger")) {
          json(response, 200, { ok: true, result: [{ adressenavn: "Fjøsangerveien", kommunenummer: "4601" }] });
          return;
        }
        if (gate.includes("bones") || gate.includes("bønes")) {
          json(response, 200, { ok: true, result: [{ adressenavn: "Bønesheien", kommunenummer: "4601" }] });
          return;
        }

        json(response, 500, { ok: false, detalj: "Fant ikke gate." });
        return;
      }

      if (name === "matrikkel_hent_eiendom") {
        const adresse = normalize(args.adresse || "");
        if (adresse.includes("storgata 5")) {
          json(response, 200, {
            ok: true,
            result: {
              matrikkelId: "matr-storg-005",
              gnr: 165,
              bnr: 5,
              adresse: "Storgata 5",
              adressenavn: "Storgata",
              postnummer: "5003",
              poststed: "BERGEN",
              koordinater: { lat: 60.39, lon: 5.32 }
            }
          });
          return;
        }
        json(response, 500, { ok: false, detalj: "Fant ikke eiendom." });
        return;
      }

      if (name === "matrikkel_hent_eiere") {
        const adresse = normalize(args.adresse || "");
        if (adresse.includes("storgata 5")) {
          json(response, 200, {
            ok: true,
            result: {
              matrikkelId: "matr-storg-005",
              gnr: 165,
              bnr: 5,
              adresse: "Storgata 5",
              eiere: ["person-001"],
              antallEiere: 1,
              syntetisk: true
            }
          });
          return;
        }
        json(response, 500, { ok: false, detalj: "Fant ikke eiere." });
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
    await waitFor(`http://127.0.0.1:${agentPort}/helse`);

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
      choose.replies.some((r) => r.includes("Eksempler på veier i matrikkelen")),
      `Mangler proaktiv matrikkel-gatehjelp. Fikk: ${JSON.stringify(choose.replies)}`
    );

    const offTopicAtGate = await req(`/agent/sessions/${created.sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "eg vil gjerne har fartshumper" })
    });
    assert(
      offTopicAtGate.replies.some((r) => r.includes("lagrer dette som utkast")),
      `Agenten lagret ikke tiltaket som utkast ved gate-spørsmål. Fikk: ${JSON.stringify(offTopicAtGate.replies)}`
    );
    assert(
      offTopicAtGate.replies.some((r) => r.toLowerCase().includes("fant ikke gaten")),
      `Agenten ba ikke fortsatt om gate etter off-topic svar. Fikk: ${JSON.stringify(offTopicAtGate.replies)}`
    );
    assert(!fakeSession.savedAnswers["velg-gate"], "Off-topic svar ved gate-steg skal ikke lagres som gate");

    const metaQuestion = await req(`/agent/sessions/${created.sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "Hva gjenstår nå?" })
    });
    assert(
      metaQuestion.replies.some((r) => r.includes("gjenstår")),
      `Agenten svarte ikke på prosess-spørsmål underveis. Fikk: ${JSON.stringify(metaQuestion.replies)}`
    );

    const preciseExists = await req(`/agent/sessions/${created.sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "Finnes Storgata 5?" })
    });
    assert(
      preciseExists.replies.some((r) => r.includes("Storgata 5 finnes i matrikkelen")),
      `Agenten svarte ikke presist på adresseoppslag. Fikk: ${JSON.stringify(preciseExists.replies)}`
    );

    const preciseOwner = await req(`/agent/sessions/${created.sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "Hvem eier Storgata 5?" })
    });
    assert(
      preciseOwner.replies.some((r) => r.includes("person-001")),
      `Agenten svarte ikke presist på eierspørsmål. Fikk: ${JSON.stringify(preciseOwner.replies)}`
    );

    // Ask a question, do not answer the form yet.
    const lookupQuestion = await req(`/agent/sessions/${created.sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "Finnes Storgata 5 ?" })
    });
    assert(
      lookupQuestion.replies.some((r) => r.includes("finnes i matrikkelen")),
      `Agenten svarte ikke på oppslagsspørsmålet. Fikk: ${JSON.stringify(lookupQuestion.replies)}`
    );
    assert(fakeSession.savedAnswer === null, "Lookup-spørsmål skal ikke lagres som endelig stegsvar");

    const lookupNaturalLanguage = await req(`/agent/sessions/${created.sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "Eg ønsker det i en gante i fjøsanger, finnes den?" })
    });
    assert(
      lookupNaturalLanguage.replies.some((r) => r.includes("Mener du den gaten") || r.includes("finnes i matrikkelen") || r.includes("Fjøsangerveien")),
      `Naturlig oppslagsspørsmål ga ikke robust svar. Fikk: ${JSON.stringify(lookupNaturalLanguage.replies)}`
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

    // Enter a partial gate name – agent should ask follow-up before saving
    const validGate = await req(`/agent/sessions/${created.sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "storg" })
    });
    assert(
      validGate.replies.some((r) => r.includes("Mener du")),
      `Mangler oppfølgingsspørsmål for usikkert gateoppslag. Fikk: ${JSON.stringify(validGate.replies)}`
    );
    assert(
      fakeSession.savedAnswer === null,
      `Delvis treff skal ikke lagres før bekreftelse. Fikk: ${fakeSession.savedAnswer}`
    );

    // Confirm the suggested gate and ensure it is saved canonically
    const confirmGate = await req(`/agent/sessions/${created.sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "ja" })
    });
    assert(
      confirmGate.replies.some((r) => r.includes("Flott, jeg bruker Storgata")),
      `Mangler bekreftet lagring av gate. Fikk: ${JSON.stringify(confirmGate.replies)}`
    );
    assert(fakeSession.savedAnswers["velg-gate"] === "Storgata", "Gate ble ikke lagret på riktig steg");

    // Mentioning another gate out of order should trigger switch confirmation.
    const gateSwitchPrompt = await req(`/agent/sessions/${created.sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "Eg vil søke om dempere i Nordnesveien" })
    });
    assert(
      gateSwitchPrompt.replies.some((r) => r.includes("Vil du bytte gate")),
      `Mangler gate-bytte bekreftelse. Fikk: ${JSON.stringify(gateSwitchPrompt.replies)}`
    );

    const gateSwitchYes = await req(`/agent/sessions/${created.sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "ja" })
    });
    assert(
      gateSwitchYes.replies.some((r) => r.includes("bytter vi gate til Nordnesveien")),
      `Mangler bekreftelse etter gate-bytte. Fikk: ${JSON.stringify(gateSwitchYes.replies)}`
    );
    assert(fakeSession.savedAnswers["velg-gate"] === "Nordnesveien", "Gate-bytte ble ikke lagret");

    // Now provide out-of-order free text while still at boliger-bekreft.
    const deferredDraft = await req(`/agent/sessions/${created.sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "Vi har høy fart og ønsker fartshumper." })
    });
    assert(
      deferredDraft.replies.some((r) => r.includes("lagrer dette som utkast")),
      `Mangler utkast-lagring for senere fritekststeg. Fikk: ${JSON.stringify(deferredDraft.replies)}`
    );

    const boligerYes = await req(`/agent/sessions/${created.sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "ja" })
    });
    assert(fakeSession.savedAnswers["boliger-bekreft"] === "ja", "Boliger-svar ble ikke lagret riktig");
    assert(
      boligerYes.replies.some((r) => r.includes("svarte tidligere")),
      `Agenten ba ikke om bekreftelse av utkast ved neste steg. Fikk: ${JSON.stringify(boligerYes.replies)}`
    );

    const useDeferred = await req(`/agent/sessions/${created.sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "ja" })
    });
    assert(fakeSession.savedAnswers.begrunnelse, "Utkast ble ikke brukt som svar på begrunnelse");
    assert(
      useDeferred.replies.some((r) => r.includes("bruker svaret du ga tidligere")) || useDeferred.replies.some((r) => r.includes("fullført")),
      `Manglet bekreftet bruk av utkast. Fikk: ${JSON.stringify(useDeferred.replies)}`
    );

    // Fresh session: compact gate input with attached house number should still validate gate name.
    const createdCompact = await req("/agent/sessions", {
      method: "POST",
      body: JSON.stringify({ personId: "person-001" })
    });
    await req(`/agent/sessions/${createdCompact.sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "fartsdempende" })
    });
    const compactGateInput = await req(`/agent/sessions/${createdCompact.sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "Bønesheien258" })
    });
    assert(
      compactGateInput.replies.some((r) => r.includes("Bønesheien")),
      `Kompakt gatenavn med husnummer ble ikke tolket riktig. Fikk: ${JSON.stringify(compactGateInput.replies)}`
    );
    assert(fakeSession.savedAnswers["velg-gate"] === "Bønesheien", "Kompakt gateinput ble ikke lagret kanonisk");

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



















