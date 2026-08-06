import { createServer } from "node:http";

const port = Number(process.env.PORT || 8084);
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
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const processChoiceStopWords = new Set([
  "eg",
  "jeg",
  "vil",
  "ville",
  "onsk",
  "sok",
  "soknad",
  "om",
  "pa",
  "for",
  "den",
  "det",
  "en",
  "et",
  "hjelp",
  "med"
]);

function stemToken(token) {
  const ord = normalize(token);
  if (ord.length <= 3) return ord;
  if (ord.endsWith("ende") && ord.length > 6) return ord.slice(0, -4);
  if (ord.endsWith("ene") && ord.length > 5) return ord.slice(0, -3);
  if (ord.endsWith("ing") && ord.length > 5) return ord.slice(0, -3);
  if (ord.endsWith("er") && ord.length > 4) return ord.slice(0, -2);
  if (ord.endsWith("en") && ord.length > 4) return ord.slice(0, -2);
  if (ord.endsWith("e") && ord.length > 4) return ord.slice(0, -1);
  return ord;
}

function canonicalizeProcessToken(token) {
  if (token.startsWith("fartsdemp") || token.startsWith("fart") || token.startsWith("dump") || token.startsWith("hump")) {
    return "fartsdemp";
  }
  if (token.startsWith("stottekont")) {
    return "stottekontakt";
  }
  return token;
}

function tokenizeForProcessChoice(text) {
  return normalize(text)
    .split(/[\s-]+/)
    .map(stemToken)
    .map(canonicalizeProcessToken)
    .filter((token) => token && !processChoiceStopWords.has(token));
}

function tokenMatches(a, b) {
  return a === b || a.startsWith(b) || b.startsWith(a);
}

function countTokenOverlap(userTokens, processTokens) {
  const uniqueUser = [...new Set(userTokens)];
  const uniqueProcess = [...new Set(processTokens)];
  let matches = 0;

  for (const userToken of uniqueUser) {
    if (uniqueProcess.some((processToken) => tokenMatches(userToken, processToken))) {
      matches += 1;
    }
  }

  return {
    matches,
    userCount: uniqueUser.length,
    processCount: uniqueProcess.length
  };
}

function parseChoiceIndex(text, max) {
  const value = normalize(text);
  if (!value) return null;

  const ordinalMap = {
    forste: 1,
    andre: 2,
    tredje: 3,
    fjerde: 4,
    femte: 5
  };

  if (/^\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    return parsed >= 1 && parsed <= max ? parsed : null;
  }

  const tokens = value.split(/\s+/);
  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      const parsed = Number.parseInt(token, 10);
      if (parsed >= 1 && parsed <= max) {
        return parsed;
      }
    }
    if (ordinalMap[token]) {
      const parsed = ordinalMap[token];
      if (parsed <= max) {
        return parsed;
      }
    }
  }

  return null;
}

function listProcessesPrompt(processes) {
  const lines = processes.map((p, i) => `${i + 1}. ${p.navn} (${p.id})`).join("\n");
  return [
    "Hei! Jeg kan hjelpe deg med å velge prosess og guide deg steg for steg.",
    "Velg en prosess ved å skrive nummer, navn, eller id:",
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

  const number = parseChoiceIndex(value, processes.length);
  if (number) {
    return processes[number - 1];
  }

  const byId = processes.find((p) => normalize(p.id) === value);
  if (byId) return byId;

  const byNameExact = processes.find((p) => normalize(p.navn) === value);
  if (byNameExact) return byNameExact;

  const byNameContains = processes.find((p) => {
    const navn = normalize(p.navn);
    return navn.includes(value) || value.includes(navn);
  });
  if (byNameContains) return byNameContains;

  const userTokens = tokenizeForProcessChoice(value);
  if (userTokens.length > 0) {
    let bestMatch = null;
    let bestScore = 0;

    for (const process of processes) {
      const processTokens = tokenizeForProcessChoice(`${process.navn || ""} ${process.id || ""}`);
      if (!processTokens.length) continue;

      const overlap = countTokenOverlap(userTokens, processTokens);
      if (!overlap.matches) continue;

      const userCoverage = overlap.matches / overlap.userCount;
      const processCoverage = overlap.matches / overlap.processCount;
      const score = userCoverage * 0.7 + processCoverage * 0.3;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = process;
      }
    }

    // Threshold avoids accidentally selecting a process from very weak token overlap.
    if (bestMatch && bestScore >= 0.4) {
      return bestMatch;
    }
  }

  return null;
}

function formatProcessOptions(processes, title) {
  const lines = processes.map((process, index) => `${index + 1}. ${process.navn} (${process.id})`).join("\n");
  return [title, lines].join("\n\n");
}

function mapCandidateProcesses(allProcesses, candidates = []) {
  const byId = new Map((allProcesses || []).map((p) => [p.id, p]));
  return (candidates || [])
    .map((candidate) => {
      const process = byId.get(candidate.id);
      if (!process) return null;
      return {
        ...process,
        score: candidate.score
      };
    })
    .filter(Boolean);
}

function recentHistory(state, count = 8) {
  return (state.history || []).slice(-count).map((entry) => ({
    role: entry.role,
    message: entry.message
  }));
}

function parseNumberFromText(text) {
  const match = normalize(text).match(/\b(\d{1,4})\b/);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

function normalizeQuestionAnswer(stepId, text) {
  const value = String(text || "").trim();
  if (!stepId || !value) {
    return { answer: value, inferred: false, note: null };
  }

  if (stepId === "boliger-bekreft") {
    const lower = normalize(value);
    const number = parseNumberFromText(value);

    if (number !== null) {
      return {
        answer: number > 20 ? "ja" : "nei",
        inferred: true,
        note: number > 20
          ? "Takk, jeg tolker dette som at gaten har mer enn 20 boliger."
          : "Takk, jeg tolker dette som at gaten ikke har mer enn 20 boliger."
      };
    }

    if (/(flere enn|mer enn|over)\s*20/.test(lower)) {
      return {
        answer: "ja",
        inferred: true,
        note: "Takk, jeg tolker dette som at gaten har mer enn 20 boliger."
      };
    }

    if (/(mindre enn|under)\s*20/.test(lower)) {
      return {
        answer: "nei",
        inferred: true,
        note: "Takk, jeg tolker dette som at gaten ikke har mer enn 20 boliger."
      };
    }
  }

  return { answer: value, inferred: false, note: null };
}

// Per-step guided interview: ordered questions to collect before composing a final answer.
const guidedInterviewDefinitions = {
  begrunnelse: [
    {
      key: "problem",
      question: "Hva er selve trafikkproblemet i gaten? (for eksempel høy fart, mye gjennomkjøring, uoversiktlig kryss)"
    },
    {
      key: "tidspunkt",
      question: "Når på dagen eller uken skjer problemet? (for eksempel rushtid, på skolevei om morgenen, i helgene)"
    },
    {
      key: "berort",
      question: "Hvem blir berørt? (for eksempel barn på skolevei, eldre fotgjengere, syklister)"
    },
    {
      key: "tiltak",
      question: "Hva slags tiltak ønsker du? (for eksempel fartshumper, 30-sone, opphøyd gangfelt, innsnevring)"
    }
  ]
};

function composeGuidedAnswer(stepId, answers) {
  if (stepId === "begrunnelse") {
    const parts = [];
    if (answers.problem) {
      parts.push(String(answers.problem).trim().replace(/\.+$/, ""));
    }
    if (answers.tidspunkt) {
      const t = String(answers.tidspunkt).trim().replace(/\.+$/, "").toLowerCase();
      parts.push(`Dette skjer ${t}`);
    }
    if (answers.berort) {
      const b = String(answers.berort).trim().replace(/\.+$/, "");
      parts.push(`${b} blir berørt`);
    }
    if (answers.tiltak) {
      const ti = String(answers.tiltak).trim().replace(/\.+$/, "").toLowerCase();
      parts.push(`Vi ønsker ${ti}`);
    }
    return parts.join(". ") + ".";
  }
  return Object.values(answers).filter(Boolean).join(". ");
}

function looksLikeHelpQuestion(stepId, text) {
  if (!stepId) return false;
  const value = String(text || "").trim();
  if (!value) return false;

  // Only treat as help request when the step has a guided interview defined
  if (!guidedInterviewDefinitions[stepId]) return false;

  if (value.includes("?")) return true;
  const lower = normalize(value);
  return ["hvilke", "hva", "hvordan", "kan du", "eksempel", "tips", "hjelp"].some(
    (prefix) => lower.startsWith(prefix) || lower.includes(`${prefix} `)
  );
}

function fallbackGuidanceForQuestion(stepId) {
  if (stepId === "boliger-bekreft") {
    return "Du kan svare med ja/nei eller et tall, for eksempel 'ja', 'nei' eller 'det er 38 boliger'.";
  }
  return "Svar gjerne kort med de viktigste opplysningene, så hjelper jeg deg videre.";
}

// ---------------------------------------------------------------------------
// Dynamisk verktøyoppdagelse via suggest_step_tools
// ---------------------------------------------------------------------------

// Decide which step-level tools to run and how: "kontekst", "validering", or both.
// Returns { kontekst: [{name, args}], validering: [{name, args}] }
async function discoverStepTools(step) {
  if (!step || step.type !== "QUESTION") return { kontekst: [], validering: [] };
  try {
    const result = await invokeTool("suggest_step_tools", {
      steg: { id: step.id, tittel: step.tittel, tekst: step.tekst, felter: step.felter || [] }
    });
    const verktoy = Array.isArray(result?.verktoy) ? result.verktoy : [];
    const kontekst = verktoy.filter((v) => v.bruk === "kontekst" || v.bruk === "kontekst_og_validering");
    const validering = verktoy.filter((v) => v.bruk === "validering" || v.bruk === "kontekst_og_validering");
    return { kontekst, validering };
  } catch {
    return { kontekst: [], validering: [] };
  }
}

// Run a single context tool and format its result as a human-readable hint line.
async function runKontekstTool(toolName, stepAnswer) {
  if (toolName === "matrikkel_finn_veger") {
    try {
      const gater = await invokeTool("matrikkel_finn_veger", {});
      if (Array.isArray(gater) && gater.length > 0) {
        const forslag = gater.slice(0, 6).map((g) => g.adressenavn).join(", ");
        return `Tilgjengelige testgater i matrikkelen: ${forslag}.`;
      }
    } catch {
      // ignore – context hint is optional
    }
  }
  return null;
}

// Run a single validation tool against the user's raw answer.
// Returns { answer, inferred, note } on success, or null when the answer is invalid.
// On invalid input returns { retry, hint } so the agent can ask the user to try again.
async function runValideringTool(toolName, userText) {
  if (toolName === "matrikkel_finn_veger") {
    try {
      const gateTreff = await invokeTool("matrikkel_finn_veger", { gate: userText });
      if (gateTreff && gateTreff.adressenavn) {
        return {
          answer: gateTreff.adressenavn,
          inferred: true,
          note: `Takk, jeg fant ${gateTreff.adressenavn} i matrikkelen og bruker det gatenavnet videre.`
        };
      }
    } catch {
      // Gate not found – build a retry hint
    }
    // Build suggestions for retry
    try {
      const gater = await invokeTool("matrikkel_finn_veger", {});
      const forslag = Array.isArray(gater) ? gater.slice(0, 6).map((g) => g.adressenavn).join(", ") : null;
      return {
        retry: true,
        hint: forslag
          ? `Jeg fant ikke gaten i matrikkelen med det navnet. Prøv gjerne en av disse: ${forslag}.`
          : "Jeg fant ikke gaten i matrikkelen med det navnet. Prøv et annet gatenavn."
      };
    } catch {
      return { retry: true, hint: "Jeg fant ikke gaten i matrikkelen. Prøv et annet gatenavn." };
    }
  }
  return null;
}

function startGuidedInterview(state, stepId) {
  const questions = guidedInterviewDefinitions[stepId] || [];
  if (!questions.length) return null;

  state.awaiting = "guided_interview";
  state.guidedInterviewQueue = questions.slice(1);
  state.guidedInterviewCurrentKey = questions[0].key;
  state.guidedInterviewAnswers = {};
  state.guidedInterviewStepId = stepId;
  state.guidedInterviewSessionStepId = state.awaitingStepId;

  return [
    "Bra spørsmål. Jeg stiller deg noen korte spørsmål, så setter jeg sammen en god beskrivelse for deg.",
    questions[0].question
  ];
}

async function resolveProcessChoiceWithAi(state, text, options = {}) {
  const processes = options.processes || state.processes || [];
  if (!processes.length) {
    return { status: "unknown" };
  }

  const result = await invokeTool("match_process_choice", {
    tekst: text,
    prosesser: processes.map((p) => ({
      id: p.id,
      navn: p.navn,
      beskrivelse: p.beskrivelse || ""
    })),
    history: recentHistory(state),
    sporingsId: state.sporingsId || newId("flyt"),
    kontekst: {
      stegType: "PROCESS_CHOICE",
      pendingCandidates: (state.pendingProcessCandidates || []).map((p) => p.id)
    }
  });

  if (result.intent === "match" && typeof result.prosessId === "string") {
    const match = processes.find((p) => p.id === result.prosessId);
    if (match) {
      return {
        status: "matched",
        process: match,
        confidence: Number(result.confidence || 0),
        source: result.modell || "ai"
      };
    }
  }

  const mappedCandidates = mapCandidateProcesses(processes, result.kandidater || []);
  if (result.intent === "ambiguous" && mappedCandidates.length > 0) {
    return {
      status: "ambiguous",
      candidates: mappedCandidates.slice(0, 3),
      confidence: Number(result.confidence || 0),
      source: result.modell || "ai"
    };
  }

  return {
    status: "unknown",
    candidates: mappedCandidates.slice(0, 3),
    confidence: Number(result.confidence || 0),
    source: result.modell || "ai"
  };
}

async function startSelectedProcess(state, choice) {
  const started = await invokeTool("start_process_session", {
    personId: state.personId,
    prosessId: choice.id,
    sporingsId: newId("flyt")
  });

  state.selectedProcess = choice;
  state.oektsId = started.oektsId;
  state.sporingsId = started.sporingsId;
  state.pendingProcessCandidates = [];

  const intro = [`Supert. Vi starter prosessen: ${choice.navn}.`];
  return intro.concat(await advanceAndPrompt(state));
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
      messages.push("Prosessen er fullført. Søknaden er sendt inn.");
      return messages;
    }

    if (session.status === "AVVIST") {
      state.awaiting = null;
      messages.push(session.avvistMelding || "Søknaden ble avvist. Du kan starte en ny prosess om du vil prøve igjen.");
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
      if (step.id === "hent-gate") {
        messages.push("Jeg har slått opp gaten i matrikkelen.");
      } else {
        messages.push("Jeg har hentet opplysningene som trengs i dette steget.");
      }
      await tryNextStep(state.oektsId);
      continue;
    }

    if (step.type === "SJEKK") {
      const result = await invokeTool("run_current_action", { oektsId: state.oektsId });
      const avvist = result?.oekt?.status === "AVVIST" || result?.resultat?.godkjent === false;
      if (avvist) {
        state.awaiting = null;
        messages.push(result?.resultat?.melding || result?.oekt?.avvistMelding || "Søknaden kan ikke behandles videre.");
        return messages;
      }
      messages.push(result?.resultat?.melding || "Sjekken er gjennomført.");
      await tryNextStep(state.oektsId);
      continue;
    }

    if (step.type === "SUMMARY") {
      const result = await invokeTool("run_current_action", { oektsId: state.oektsId });
      const text = result?.resultat?.tekst;
      state.latestSummary = text || null;
      if (text) {
        messages.push(`Oppsummering: ${text}`);
      } else {
        messages.push("Jeg har laget en oppsummering av informasjonen.");
      }
      state.awaiting = "summary_confirm";
      messages.push("Er du enig i oppsummeringen? Svar ja for a ga videre til innsending, eller nei for a endre beskrivelsen.");
      return messages;
    }

    if (step.type === "QUESTION") {
      state.awaiting = "question";
      state.awaitingStepId = step.id;
      const prompt = step.tekst || step.tittel || "Kan du svare på et spørsmål?";
      messages.push(prompt);

      // Dynamically discover which tools can provide useful context for this step.
      const { kontekst, validering } = await discoverStepTools(step);
      state.awaitingValideringTools = validering.map((v) => v.name);
      for (const v of kontekst) {
        const hint = await runKontekstTool(v.name);
        if (hint) messages.push(hint);
      }

      return messages;
    }

    if (step.type === "CONSENT_REQUEST") {
      state.awaiting = "consent";
      const datakilder = (step.dataKilder || []).join(", ") || "nødvendige opplysninger";
      const formaal = step.formaal || "behandle saken";
      messages.push(`For å gå videre trenger jeg samtykke til å hente ${datakilder}. Dette brukes for å ${formaal.toLowerCase()}. Er det greit?`);
      return messages;
    }

    if (step.type === "SUBMIT") {
      state.awaiting = "submit";
      messages.push("Alt er klart. Vil du at jeg skal sende inn søknaden nå?");
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
    return ["Skriv en melding, så hjelper jeg deg videre."];
  }

  if (!state.selectedProcess) {
    const allProcesses = state.processes || [];
    if (!allProcesses.length) {
      return ["Jeg finner ingen tilgjengelige prosesser akkurat na. Prov igjen om litt."];
    }

    const pendingProcesses = state.pendingProcessCandidates || [];
    if (pendingProcesses.length > 0) {
      const pendingChoice = parseProcessChoice(text, pendingProcesses);
      if (pendingChoice) {
        return startSelectedProcess(state, pendingChoice);
      }
    }

    const deterministicChoice = parseProcessChoice(text, allProcesses);
    if (deterministicChoice) {
      return startSelectedProcess(state, deterministicChoice);
    }

    const aiChoice = await resolveProcessChoiceWithAi(state, text, {
      processes: pendingProcesses.length > 0 ? pendingProcesses : allProcesses
    });

    if (aiChoice.status === "matched") {
      return startSelectedProcess(state, aiChoice.process);
    }

    if (aiChoice.status === "ambiguous") {
      state.pendingProcessCandidates = aiChoice.candidates;
      return [
        "Jeg tror dette kan vaere en av disse prosessene. Hvilken mener du?",
        formatProcessOptions(aiChoice.candidates, "Svar med nummer, navn, eller id:")
      ];
    }

    if (pendingProcesses.length > 0) {
      return [
        "Jeg er fortsatt usikker pa hvilken av kandidatene du mener.",
        formatProcessOptions(pendingProcesses, "Svar med nummer, navn, eller id:")
      ];
    }

    return ["Jeg fant ikke den prosessen. Skriv nummer, navn, eller id fra listen."];
  }

  if (state.awaiting === "question") {
    const step = state.lastSession?.aktivtSteg;
    const activeQuestionId = step?.id || state.awaitingStepId || null;

    // Give hint suggestions if user asks for help on a step that has context tools.
    if (!looksLikeHelpQuestion(activeQuestionId, text)) {
      const lower = normalize(text);
      const isHelpish = text.includes("?") || ["hjelp", "vet ikke", "usikker", "forslag", "hvilke", "hva kan jeg"].some((ord) => lower.includes(ord));
      if (isHelpish && (state.awaitingValideringTools || []).length > 0) {
        const hints = [];
        for (const toolName of state.awaitingValideringTools) {
          const hint = await runKontekstTool(toolName);
          if (hint) hints.push(hint);
        }
        if (hints.length > 0) {
          return [...hints, step?.tekst || "Skriv inn svaret ditt når du er klar."];
        }
      }
    }

    if (looksLikeHelpQuestion(activeQuestionId, text)) {
      const interviewReplies = startGuidedInterview(state, activeQuestionId);
      if (interviewReplies) {
        return interviewReplies;
      }
      return [fallbackGuidanceForQuestion(activeQuestionId), step?.tekst || "Skriv gjerne svaret ditt når du er klar."];
    }

    let normalizedAnswer = normalizeQuestionAnswer(activeQuestionId, text);

    // Run dynamic validation tools discovered when the step was entered.
    const valideringsToolNavn = state.awaitingValideringTools || [];
    for (const toolName of valideringsToolNavn) {
      const valResult = await runValideringTool(toolName, text);
      if (!valResult) continue;
      if (valResult.retry) {
        return [valResult.hint];
      }
      // Successful normalisation – override answer with the canonical value.
      normalizedAnswer = { answer: valResult.answer, inferred: valResult.inferred, note: valResult.note };
      state.latestMatrikkelGate = { adressenavn: valResult.answer };
      break;
    }

    await invokeTool("answer_question", {
      oektsId: state.oektsId,
      stegId: state.awaitingStepId,
      svar: normalizedAnswer.answer
    });
    await tryNextStep(state.oektsId);
    const ack = normalizedAnswer.note || "Takk, jeg har lagret svaret ditt.";
    return [ack].concat(await advanceAndPrompt(state));
  }

  if (state.awaiting === "guided_interview") {
    // Store answer to the current question
    state.guidedInterviewAnswers[state.guidedInterviewCurrentKey] = text;

    if (state.guidedInterviewQueue && state.guidedInterviewQueue.length > 0) {
      // More questions to ask
      const next = state.guidedInterviewQueue.shift();
      state.guidedInterviewCurrentKey = next.key;
      return [next.question];
    }

    // All questions answered – compose the full answer and save it
    const composed = composeGuidedAnswer(state.guidedInterviewStepId, state.guidedInterviewAnswers);
    await invokeTool("answer_question", {
      oektsId: state.oektsId,
      stegId: state.guidedInterviewSessionStepId || state.guidedInterviewStepId,
      svar: composed
    });

    // Clean up interview state
    state.awaiting = "question";
    state.guidedInterviewQueue = [];
    state.guidedInterviewAnswers = {};
    state.guidedInterviewCurrentKey = null;
    state.guidedInterviewStepId = null;
    state.guidedInterviewSessionStepId = null;

    await tryNextStep(state.oektsId);
    return [
      `Takk. Jeg satte sammen denne beskrivelsen fra svarene dine:`,
      `«${composed}»`,
      ...await advanceAndPrompt(state)
    ];
  }

  if (state.awaiting === "summary_confirm") {
    const intent = await invokeTool("interpret_reply", {
      tekst: text,
      jaIntent: "summary_yes",
      neiIntent: "summary_no",
      ukjentIntent: "unknown",
      sporingsId: state.sporingsId,
      kontekst: {
        prosessId: state.selectedProcess?.id,
        stegType: "SUMMARY_CONFIRM"
      }
    });

    if (intent.intent === "summary_yes") {
      await tryNextStep(state.oektsId);
      return ["Flott. Da gar vi videre til innsending."].concat(await advanceAndPrompt(state));
    }

    if (intent.intent === "summary_no") {
      await invokeTool("previous_step", { oektsId: state.oektsId });
      state.awaiting = null;
      state.awaitingStepId = null;
      return [
        "Skjonner. Da gar vi tilbake sa du kan forbedre beskrivelsen av trafikkproblemet.",
        "Skriv gjerne problemet sa konkret som mulig, og hva slags tiltak du onsker."
      ].concat(await advanceAndPrompt(state));
    }

    return ["Jeg ble litt usikker. Svar gjerne 'ja' hvis oppsummeringen stemmer, eller 'nei' hvis du vil endre den."];
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
      return ["Skjønner. Jeg har registrert at du ikke vil samtykke nå."].concat(await advanceAndPrompt(state));
    }

    return ["Jeg ble litt usikker. Du kan svare for eksempel 'ja, det er greit' eller 'nei, ikke nå'."];
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
      return ["Da sender jeg inn søknaden."].concat(await advanceAndPrompt(state));
    }

    if (intent.intent === "submit_no") {
      return ["Helt i orden. Si fra når du vil sende inn."];
    }

    return ["Jeg ble litt usikker. Du kan svare for eksempel 'ja, send inn' eller 'nei, ikke ennå'."];
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
    awaitingValideringTools: [],
    lastSession: null,
    history: [],
    pendingProcessCandidates: [],
    latestSummary: null,
    latestMatrikkelGate: null,
    guidedInterviewQueue: [],
    guidedInterviewAnswers: {},
    guidedInterviewCurrentKey: null,
    guidedInterviewStepId: null,
    guidedInterviewSessionStepId: null
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
        pendingProcessCandidates: session.pendingProcessCandidates,
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
        pendingProcessCandidates: session.pendingProcessCandidates,
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
  console.log(`Process-agent kjører på http://localhost:${port}`);
});

